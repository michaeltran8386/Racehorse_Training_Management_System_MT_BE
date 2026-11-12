import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DailyTaskType, Prisma, Role, HorseStatus } from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CompleteDailyTaskDto, QueryDailyTasksDto } from './dto/daily-task.dto';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { InventoryService } from '../inventory/inventory.service';
import { planDailyTasks, ScheduleHorse, ScheduleCareInstruction } from './daily-schedule';

const UNDO_WINDOW_MS = 15 * 60 * 1000; // 15 phút (900.000 ms)
const CLUB_OFFSET_MS = 7 * 60 * 60 * 1000;

function clubDateStr(d = new Date()): string {
  return new Date(d.getTime() + CLUB_OFFSET_MS).toISOString().slice(0, 10);
}

const TASK_DETAIL_INCLUDE = {
  horse: {
    select: {
      id: true,
      name: true,
      horseCode: true,
      avatarUrl: true,
      status: true,
      isMedicalLocked: true,
    },
  },
  stallZone: {
    select: { id: true, code: true, name: true },
  },
  stall: {
    select: { id: true, code: true, zone: true },
  },
  completedBy: {
    select: { id: true, fullName: true, role: true },
  },
  assignedGroom: {
    select: { id: true, fullName: true },
  },
  shift: {
    select: {
      id: true,
      name: true,
      startTime: true,
      endTime: true,
      sortOrder: true,
    },
  },
};

@Injectable()
export class DailyTasksService {
  private readonly logger = new Logger(DailyTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly inventoryService: InventoryService,
  ) {}

  /**
   * TASK F4-04-BE: Sinh danh sách công việc chăm sóc hàng ngày cho từng con ngựa.
   * Đảm bảo tính Idempotent: chạy lại 10 lần trong ngày vẫn không nhân đôi công việc và
   * không làm mất trạng thái công việc đã hoàn thành trước đó.
   */
  async generateDailyTasksForDate(
    targetDate = new Date(),
    zoneIdFilter?: string,
    horseIdFilter?: string,
  ): Promise<{
    date: string;
    totalGenerated: number;
    horsesProcessed: number;
  }> {
    const dateStr = targetDate.toISOString().slice(0, 10);
    const dayDate = new Date(`${dateStr}T00:00:00.000Z`);

    this.logger.log(`[DailyTasksService] Generating daily care tasks for date: ${dateStr}`);

    // Lấy danh sách ngựa đang quản lý (không bị xóa mềm và chưa ngừng quản lý)
    const horses =
      (await this.prisma.horse.findMany({
        where: {
          deletedAt: null,
          status: { not: HorseStatus.RETIRED },
          ...(horseIdFilter ? { id: horseIdFilter } : {}),
          ...(zoneIdFilter
            ? {
                stallAllocations: {
                  some: {
                    isActive: true,
                    stall: { zoneId: zoneIdFilter },
                  },
                },
              }
            : {}),
        },
        include: {
          stallAllocations: {
            where: { isActive: true },
            orderBy: { createdAt: 'desc' },
            include: {
              stall: {
                include: { zoneRef: true },
              },
            },
            take: 1,
          },
          medicalLocks: {
            where: { isLocked: true },
            take: 1,
          },
          nutritionPlans: {
            where: { status: 'APPROVED' },
            orderBy: { updatedAt: 'desc' },
            take: 1,
          },
          medicalRecords: {
            where: { status: 'OPEN' },
            select: {
              id: true,
              prescriptions: true,
              prescriptionDetails: true,
              treatmentPhases: true,
            },
          },
        },
      })) || [];

    // Bảng phân ca trong ngày: mỗi việc giao cho Groom trực ca chứa giờ đó, việc của một Groom xếp nối tiếp (không trùng giờ)
    const shiftRosters =
      (await this.prisma.shiftRoster.findMany({
        where: { date: dayDate },
        include: { shift: true },
      })) || [];

    const lockNotesByHorse = new Map<string, string | undefined>();
    const planByHorse = new Map<string, string | undefined>();
    const scheduleHorses: ScheduleHorse[] = horses.map((horse) => {
      const stall = horse.stallAllocations[0]?.stall;
      const activeLock = horse.medicalLocks[0];
      const isLocked = Boolean(horse.isMedicalLocked || activeLock?.isLocked);
      lockNotesByHorse.set(
        horse.id,
        activeLock
          ? `Khóa y tế: ${activeLock.lockReason}. Chú ý điều trị phục hồi.`
          : horse.isMedicalLocked
            ? 'Ngựa đang được giám sát y tế đặc biệt.'
            : undefined,
      );
      planByHorse.set(horse.id, horse.nutritionPlans[0]?.id);

      const activeMeds: Array<{
        name: string;
        dosage: string | number;
        unit?: string;
        route?: string;
        notes?: string;
        supplyId?: string;
        frequencyPerDay?: number;
      }> = [];

      const activeCareInstructions: ScheduleCareInstruction[] = [];
      let allowedActivityLevel: string | undefined;

      for (const rec of (horse as any).medicalRecords || []) {
        // 1. Chỉ dẫn chăm sóc y tế từ phác đồ điều trị của Vet
        if (rec.treatmentPhases) {
          try {
            const phases = JSON.parse(rec.treatmentPhases);
            if (Array.isArray(phases)) {
              for (const phase of phases) {
                const start = phase.startDate ? String(phase.startDate).slice(0, 10) : '';
                const end = phase.endDate ? String(phase.endDate).slice(0, 10) : '';
                if ((!start || dateStr >= start) && (!end || dateStr <= end)) {
                  if (phase.allowedActivity || phase.allowedActivityLevel) {
                    allowedActivityLevel = phase.allowedActivity || phase.allowedActivityLevel;
                  }
                  const instructions = Array.isArray(phase.careInstructions)
                    ? phase.careInstructions
                    : [];
                  for (const inst of instructions) {
                    let activity = '';
                    let freq = 1;
                    let notes = '';
                    if (typeof inst === 'string') {
                      const match = inst.match(
                        /^(.*?)(?:\s*\((?:(\d+)\s*(?:lần|times?)[^)]*|[^)]*)\))?$/i,
                      );
                      activity = match ? match[1].trim() : inst.trim();
                      if (match && match[2]) {
                        freq = Math.min(3, Math.max(1, parseInt(match[2], 10)));
                      }
                    } else if (inst && typeof inst === 'object') {
                      activity = String(inst.activity || '').trim();
                      const parsedFreq = Number(inst.frequencyPerDay ?? inst.frequency);
                      freq =
                        !isNaN(parsedFreq) && parsedFreq > 0
                          ? Math.min(3, Math.max(1, Math.floor(parsedFreq)))
                          : 1;
                      notes = inst.notes || '';
                    }
                    if (activity) {
                      activeCareInstructions.push({
                        activity,
                        frequencyPerDay: freq,
                        notes,
                        phaseName: phase.phaseName,
                      });
                    }
                  }
                }
              }
            }
          } catch {
            // ignore malformed JSON
          }
        }

        // 2. Đơn thuốc thú y
        const raw = rec.prescriptions || rec.prescriptionDetails;
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          const rxs = Array.isArray(parsed) ? parsed : [parsed];
          for (const rx of rxs) {
            if (rx && rx.status === 'ACTIVE') {
              const start = rx.startDate ? String(rx.startDate).slice(0, 10) : '';
              const end = rx.endDate ? String(rx.endDate).slice(0, 10) : '';
              if ((!start || dateStr >= start) && (!end || dateStr <= end)) {
                activeMeds.push({
                  name: rx.medicationName || 'Thuốc thú y',
                  dosage: rx.dosage || '1',
                  unit: rx.unit,
                  route: rx.route || rx.administrationRoute,
                  notes: rx.notes,
                  supplyId: rx.supplyId,
                  frequencyPerDay: rx.frequencyPerDay
                    ? Math.min(3, Math.max(1, Number(rx.frequencyPerDay)))
                    : 1,
                });
              }
            }
          }
        } catch {
          // ignore malformed JSON
        }
      }

      return {
        id: horse.id,
        zoneId: stall?.zoneId || undefined,
        stallId: stall?.id || undefined,
        stallCode: stall?.code,
        allocationGroomId: horse.stallAllocations[0]?.assignedGroomUserId || undefined,
        isLocked,
        allowedActivityLevel,
        mealsJson: horse.nutritionPlans[0]?.mealsJson,
        medications: activeMeds,
        careInstructions: activeCareInstructions,
      };
    });
    const planned = planDailyTasks(
      scheduleHorses,
      shiftRosters.map((r) => ({
        zoneId: r.zoneId,
        groomUserId: r.groomUserId,
        shiftId: r.shiftId,
        startTime: r.shift?.startTime || '05:00',
        endTime: r.shift?.endTime || '13:00',
        isOvernight: Boolean(r.shift?.isOvernight),
      })),
    );
    const lockedHorses = new Set(scheduleHorses.filter((h) => h.isLocked).map((h) => h.id));

    let totalGenerated = 0;

    const activeMedicalTitlesByHorse = new Map<string, Set<string>>();
    for (const t of planned) {
      if (t.taskType === DailyTaskType.MEDICATION || t.taskType === DailyTaskType.ICE_BOOT_REST) {
        if (!activeMedicalTitlesByHorse.has(t.horseId)) {
          activeMedicalTitlesByHorse.set(t.horseId, new Set());
        }
        activeMedicalTitlesByHorse.get(t.horseId)!.add(t.title);
      }
    }

    // Upsert từng task để bảo đảm Idempotent (nhận diện theo ngựa + loại + tiêu đề, vì giờ có thể dời khi đàn thay đổi)
    for (const t of planned) {
      const existing = await this.prisma.dailyCareTask.findFirst({
        where: { date: dayDate, horseId: t.horseId, taskType: t.taskType, title: t.title },
      });
      const isLocked = lockedHorses.has(t.horseId);
      const lockNotes = lockNotesByHorse.get(t.horseId);

      if (!existing) {
        const taskCode = `TSK-${dateStr.replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        await this.prisma.dailyCareTask.create({
          data: {
            taskCode,
            date: dayDate,
            horseId: t.horseId,
            stallZoneId: t.zoneId,
            stallId: t.stallId,
            taskType: t.taskType,
            title: t.title,
            description: t.description,
            mealType: t.mealType,
            scheduledTime: t.scheduledTime,
            shiftId: t.shiftId,
            nutritionPlanId: planByHorse.get(t.horseId),
            isMedicalLocked: isLocked,
            medicalLockNotes: lockNotes,
            itemsSnapshotJson: (t.itemsSnapshotJson as any) || null,
            assignedGroomUserId: t.assignedGroomUserId,
          },
        });
        totalGenerated++;
      } else {
        const nextZoneId = t.zoneId ?? null;
        const nextStallId = t.stallId ?? null;
        const nextShiftId = t.shiftId ?? null;
        const nextGroomId = t.assignedGroomUserId ?? null;
        const nextLockNotes = lockNotes ?? null;
        if (
          !existing.isCompleted &&
          ((existing.stallZoneId ?? null) !== nextZoneId ||
            (existing.stallId ?? null) !== nextStallId ||
            existing.scheduledTime !== t.scheduledTime ||
            existing.description !== t.description ||
            (existing.shiftId ?? null) !== nextShiftId ||
            (existing.assignedGroomUserId ?? null) !== nextGroomId ||
            existing.isMedicalLocked !== isLocked ||
            (existing.medicalLockNotes ?? null) !== nextLockNotes)
        ) {
          await this.prisma.dailyCareTask.update({
            where: { id: existing.id },
            data: {
              stallZoneId: nextZoneId,
              stallId: nextStallId,
              scheduledTime: t.scheduledTime,
              description: t.description,
              shiftId: nextShiftId,
              assignedGroomUserId: nextGroomId,
              isMedicalLocked: isLocked,
              medicalLockNotes: nextLockNotes,
            },
          });
        }
      }
    }

    // Tự động dọn dẹp các task y tế/thuốc CHƯA HOÀN THÀNH nếu bác sĩ đã dừng thuốc hoặc đổi phác đồ
    const processedHorseIds = horses.map((h) => h.id);
    const existingMedicalTasks =
      (await this.prisma.dailyCareTask.findMany({
        where: {
          date: dayDate,
          horseId: { in: processedHorseIds },
          taskType: { in: [DailyTaskType.MEDICATION, DailyTaskType.ICE_BOOT_REST] },
          isCompleted: false,
        },
        select: { id: true, horseId: true, title: true },
      })) || [];

    for (const emt of existingMedicalTasks || []) {
      const activeTitles = activeMedicalTitlesByHorse.get(emt.horseId);
      if (!activeTitles || !activeTitles.has(emt.title)) {
        if (this.prisma.dailyCareTask.delete) {
          await this.prisma.dailyCareTask.delete({ where: { id: emt.id } });
        }
      }
    }

    this.logger.log(
      `[DailyTasksService] Generated/Synced ${totalGenerated} new tasks for ${horses.length} horses on ${dateStr}`,
    );

    return {
      date: dateStr,
      totalGenerated,
      horsesProcessed: horses.length,
    };
  }

  /**
   * Đồng bộ động các công việc y tế (thuốc và phác đồ điều trị) cho ngựa theo khoảng ngày.
   * Tự động gọi khi Bác sĩ thú y thêm/sửa phác đồ điều trị hoặc kê/dừng đơn thuốc.
   */
  async syncMedicalTasksForHorse(
    horseId: string,
    fromDateStr?: string,
    toDateStr?: string,
  ): Promise<void> {
    const todayStr = clubDateStr();
    const startStr =
      fromDateStr && fromDateStr.slice(0, 10) > todayStr ? fromDateStr.slice(0, 10) : todayStr;
    const startDate = new Date(`${startStr}T00:00:00.000Z`);

    const maxDays = 14;
    const rawEndStr = toDateStr ? toDateStr.slice(0, 10) : undefined;
    const endDate = rawEndStr
      ? new Date(`${rawEndStr}T00:00:00.000Z`)
      : new Date(startDate.getTime() + maxDays * 86400000);

    if (endDate < startDate) {
      return;
    }

    const horse = await this.prisma.horse.findUnique({
      where: { id: horseId },
      select: {
        stallAllocations: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { stall: { select: { zoneId: true } } },
        },
      },
    });
    const zoneId = horse?.stallAllocations?.[0]?.stall?.zoneId ?? undefined;

    const cur = new Date(startDate);
    while (cur <= endDate && cur.getTime() <= startDate.getTime() + maxDays * 86400000) {
      const curDate = new Date(cur);
      const curStr = curDate.toISOString().slice(0, 10);
      const existingCount = await this.prisma.dailyCareTask.count({
        where: { date: curDate },
      });
      if (curStr === todayStr || existingCount > 0) {
        await this.generateDailyTasksForDate(curDate, zoneId, zoneId ? undefined : horseId);
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }

  /**
   * Đồng bộ lại các công việc chưa hoàn thành khi CM thay đổi phân ca trực.
   */
  async syncTasksForDateZones(targets: Array<{ date: Date; zoneId?: string }>): Promise<void> {
    const todayStr = clubDateStr();
    const seen = new Set<string>();
    for (const target of targets) {
      const dateStr = target.date.toISOString().slice(0, 10);
      const key = `${dateStr}|${target.zoneId ?? 'ALL'}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const dayDate = new Date(`${dateStr}T00:00:00.000Z`);
      const existingCount = await this.prisma.dailyCareTask.count({
        where: { date: dayDate, ...(target.zoneId ? { stallZoneId: target.zoneId } : {}) },
      });
      if (dateStr === todayStr || existingCount > 0) {
        await this.generateDailyTasksForDate(dayDate, target.zoneId);
      }
    }
  }

  /**
   * SC-4.04: Lấy danh sách checklist công việc theo ngày, khu chuồng, ca trực và quyền xem
   */
  async findAll(query: QueryDailyTasksDto, currentUser: CurrentUserPayload) {
    const dateStr = query.date || clubDateStr();
    const dayDate = new Date(`${dateStr}T00:00:00.000Z`);

    // Luôn đảm bảo Idempotent: sinh công việc nếu chưa có, hoặc đồng bộ lại các task y tế/chuồng mới nhất
    await this.generateDailyTasksForDate(dayDate, query.zoneId);

    const where: any = {
      date: dayDate,
      horse: { deletedAt: null },
    };

    if (query.horseId) {
      where.horseId = query.horseId;
    }

    if (query.taskType) {
      where.taskType = query.taskType;
    }

    if (query.isCompleted !== undefined) {
      where.isCompleted = query.isCompleted;
    }

    // Nếu người dùng bật cờ "Chỉ việc của tôi" hoặc là Groom xem mặc định (khi cả onlyMine và onlyMyTasks chưa được truyền)
    const isOnlyMine =
      query.onlyMine === true ||
      query.onlyMyTasks === true ||
      (currentUser.role === Role.GROOM &&
        query.onlyMine === undefined &&
        query.onlyMyTasks === undefined);

    if (isOnlyMine && currentUser.userId) {
      const myRosters = await this.prisma.shiftRoster.findMany({
        where: {
          date: dayDate,
          groomUserId: currentUser.userId,
        },
        select: { zoneId: true },
      });
      const myZoneIds = myRosters.map((r) => r.zoneId);

      const groomOrConditions: any[] = [
        { assignedGroomUserId: currentUser.userId },
        { completedById: currentUser.userId },
      ];
      if (myZoneIds.length > 0) {
        groomOrConditions.push({ stallZoneId: { in: myZoneIds } });
      }

      if (query.zoneId) {
        where.stallZoneId = query.zoneId;
        if (!myZoneIds.includes(query.zoneId)) {
          where.OR = [
            { assignedGroomUserId: currentUser.userId },
            { completedById: currentUser.userId },
          ];
        }
      } else {
        where.OR = groomOrConditions;
      }
    } else if (query.zoneId) {
      where.stallZoneId = query.zoneId;
    }

    const [items, total] = await Promise.all([
      this.prisma.dailyCareTask.findMany({
        where,
        include: TASK_DETAIL_INCLUDE,
        orderBy: [{ scheduledTime: 'asc' }, { taskType: 'asc' }],
      }),
      this.prisma.dailyCareTask.count({ where }),
    ]);

    // Thống kê KPIs tiến độ ca trực
    const completedCount = items.filter((t) => t.isCompleted).length;
    const pendingCount = items.length - completedCount;
    const completionRatePct =
      items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0;
    const medicalLockedCount = items.filter((t) => t.isMedicalLocked).length;

    return {
      date: dateStr,
      items,
      total,
      stats: {
        total: items.length,
        completed: completedCount,
        pending: pendingCount,
        completionRatePct,
        medicalLockedCount,
      },
    };
  }

  /**
   * TASK F4-05-BE: Xác nhận hoàn thành công việc
   * Ghi nhận timestamp, groomId và thiết lập cửa sổ hoàn tác 15 phút.
   */
  async completeTask(id: string, dto: CompleteDailyTaskDto, currentUser: CurrentUserPayload) {
    const task = await this.prisma.dailyCareTask.findUnique({
      where: { id },
      include: { horse: true },
    });

    if (!task) {
      throw new NotFoundException('Không tìm thấy công việc chăm sóc.');
    }

    if (task.isCompleted) {
      return task; // Đã xong rồi, trả về idempotent
    }

    if (
      currentUser.role === Role.GROOM &&
      task.assignedGroomUserId &&
      task.assignedGroomUserId !== currentUser.userId
    ) {
      const hasZoneRoster =
        task.date && task.stallZoneId
          ? await this.prisma.shiftRoster?.findFirst?.({
              where: {
                date: task.date,
                zoneId: task.stallZoneId,
                groomUserId: currentUser.userId,
              },
              select: { id: true },
            })
          : null;

      if (!hasZoneRoster) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'TASK_NOT_ASSIGNED_TO_YOU',
          'Bạn chỉ có thể hoàn thành công việc chăm sóc được phân công cho mình hoặc tại khu trực của mình.',
        );
      }
    }

    if (task.horse?.status === HorseStatus.RETIRED) {
      throw new BadRequestException('Không thể hoàn thành việc cho ngựa đã ngừng quản lý.');
    }

    const now = new Date();

    if (task.date) {
      const todayStr = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const taskDate = task.date instanceof Date ? task.date : new Date(task.date);
      const taskDateStr = new Date(taskDate.getTime() + 7 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      if (taskDateStr > todayStr) {
        throw new BadRequestException(
          'Không thể hoàn thành trước công việc của các ngày trong tương lai.',
        );
      }
    }

    const undoUntil = new Date(now.getTime() + UNDO_WINDOW_MS);

    // Bọc cập nhật Task và Trừ kho trong cùng một transaction để đảm bảo toàn vẹn dữ liệu (H-42, H-25)
    const runInTx = async (tx: any) => {
      const taskUpdated = await tx.dailyCareTask.update({
        where: { id, isCompleted: false },
        data: {
          isCompleted: true,
          completedAt: now,
          completedById: currentUser.userId,
          undoUntil,
          description: dto.notes
            ? `${task.description || ''}\n[Ghi chú Groom: ${dto.notes}]`
            : task.description,
        },
        include: TASK_DETAIL_INCLUDE,
      });

      // Trừ kho tự động cho việc cho ăn (FEEDING) cùng transaction
      if (task.taskType === DailyTaskType.FEEDING && task.stallZoneId && task.itemsSnapshotJson) {
        await this.inventoryService.deductStockForFeeding(
          task.stallZoneId,
          task.itemsSnapshotJson as any,
          tx,
        );
      }

      return taskUpdated;
    };

    const updated = await (
      typeof (this.prisma as any).$transaction === 'function'
        ? this.prisma.$transaction(runInTx)
        : runInTx(this.prisma)
    ).catch((err: unknown) => {
      if (lostRace(err)) return null;
      throw err;
    });

    if (!updated) {
      return this.prisma.dailyCareTask.findUniqueOrThrow({
        where: { id },
        include: TASK_DETAIL_INCLUDE,
      });
    }

    await this.auditService.record(
      { id: currentUser.userId, name: currentUser.fullName } as any,
      'COMPLETE_DAILY_TASK',
      `Hoàn thành công việc: ${task.title} cho ngựa ${task.horse.name}`,
      task.id,
      {
        entityName: 'DailyCareTask',
        newValues: {
          taskCode: task.taskCode,
          horseName: task.horse.name,
          taskType: task.taskType,
          completedAt: now,
        },
      },
    );

    return updated;
  }

  /**
   * TASK F4-05-BE: Hoàn tác trạng thái hoàn thành trong vòng 15 phút nếu bấm nhầm.
   * Sau 15 phút, khóa không cho phép hoàn tác.
   */
  async uncompleteTask(id: string, currentUser: CurrentUserPayload) {
    const task = await this.prisma.dailyCareTask.findUnique({
      where: { id },
      include: { horse: true },
    });

    if (!task) {
      throw new NotFoundException('Không tìm thấy công việc chăm sóc.');
    }

    if (!task.isCompleted) {
      return task; // Đang chưa hoàn thành sẵn
    }

    // Kiểm tra quyền: Người bấm hoàn thành, hoặc Club Manager mới được hoàn tác
    if (task.completedById !== currentUser.userId && currentUser.role !== Role.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'TASK_UNDO_FORBIDDEN',
        'Bạn không có quyền hoàn tác công việc do nhân viên khác thực hiện.',
      );
    }

    // Kiểm tra cửa sổ 15 phút
    const now = new Date();
    if (task.undoUntil && now > task.undoUntil && currentUser.role !== Role.CLUB_MANAGER) {
      const minutesPassed = Math.round(
        (now.getTime() - (task.completedAt?.getTime() || 0)) / 60000,
      );
      throw new BadRequestException(
        `Cửa sổ hoàn tác 15 phút đã hết hạn (đã trôi qua ${minutesPassed} phút). Vui lòng liên hệ Quản lý nếu cần điều chỉnh.`,
      );
    }

    // Tương tự: hai lần hoàn tác đồng thời chỉ hoàn kho một lần.
    const updated = await this.prisma.dailyCareTask
      .update({
        where: { id, isCompleted: true },
        data: {
          isCompleted: false,
          completedAt: null,
          completedById: null,
          undoUntil: null,
        },
        include: TASK_DETAIL_INCLUDE,
      })
      .catch((err: unknown) => {
        if (lostRace(err)) return null;
        throw err;
      });
    if (!updated) {
      return this.prisma.dailyCareTask.findUniqueOrThrow({
        where: { id },
        include: TASK_DETAIL_INCLUDE,
      });
    }

    await this.auditService.record(
      { id: currentUser.userId, name: currentUser.fullName } as any,
      'UNCOMPLETE_DAILY_TASK',
      `Hoàn tác công việc: ${task.title} cho ngựa ${task.horse.name}`,
      task.id,
      {
        entityName: 'DailyCareTask',
        newValues: {
          taskCode: task.taskCode,
          horseName: task.horse.name,
          uncompletedAt: now,
        },
      },
    );

    // Hoàn lại kho thức ăn nếu hoàn tác việc cho ăn (FEEDING)
    if (task.taskType === DailyTaskType.FEEDING && task.stallZoneId && task.itemsSnapshotJson) {
      await this.inventoryService.restoreStockForFeeding(
        task.stallZoneId,
        task.itemsSnapshotJson as any,
      );
    }

    return updated;
  }
}

/** Prisma P2025: update có điều kiện không khớp dòng nào (request khác đã đổi trạng thái trước). */
const lostRace = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
