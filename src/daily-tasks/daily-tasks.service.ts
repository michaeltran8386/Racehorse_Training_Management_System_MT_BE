import { effectiveNow } from '../common/utils/demo-clock';
import { onDutyGrooms } from '../shift-rosters/groom-zones';
import { lockCareAssignments } from '../stalls/groom-care.rules';
import { stallMoveCompleted } from '../business-mail/templates/health-templates';
import { taskAssigned, taskRejected } from '../business-mail/templates/violation-templates';
import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DailyTaskType, Prisma, Role, HorseStatus, WorkoutStatus } from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CompleteDailyTaskDto, QueryDailyTasksDto } from './dto/daily-task.dto';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { InventoryService } from '../inventory/inventory.service';
import {
  planDailyTasks,
  ScheduleHorse,
  ScheduleCareInstruction,
  requiresStallRest,
  STALL_HANDOVER_PREFIX,
  WORKOUT_PREP_PREFIX,
  shiftCovers,
  toMinutes,
} from './daily-schedule';
import { clubTime } from '../training/training-rules';
import { CareCostLedgerService } from '../financial/care-cost-ledger.service';

const UNDO_WINDOW_MS = 15 * 60 * 1000; // 15 phút (900.000 ms)
const CLUB_OFFSET_MS = 7 * 60 * 60 * 1000;

function clubDateStr(d = effectiveNow()): string {
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

  private async publishAssignment(task: {
    id: string;
    taskCode?: string | null;
    title: string;
    horseId: string;
    date: Date;
    scheduledTime?: string | null;
    assignedGroomUserId?: string | null;
  }): Promise<void> {
    if (!task.assignedGroomUserId) return;
    try {
      await this.notifications.notifyUsers([task.assignedGroomUserId], {
        type: 'TASK_ASSIGNED',
        category: 'SYSTEM',
        title: 'Được giao nhiệm vụ chăm sóc',
        message: task.title,
        link: '/tasks?date=' + task.date.toISOString().slice(0, 10),
        dedupeKey: 'task-assigned:' + task.id + ':' + task.assignedGroomUserId,
        email: {
          eventCode: 'TASK_ASSIGNED',
          body: {
            ...taskAssigned(
              {
                taskCode: task.taskCode ?? task.id,
                title: task.title,
                date: task.date.toISOString().slice(0, 10),
                scheduledTime: task.scheduledTime ?? undefined,
              },
              undefined,
              { name: 'Nhân viên được phân công' },
            ),
            refId: task.id,
            milestone: task.assignedGroomUserId,
          },
        },
      });
    } catch (error) {
      this.logger.warn('Could not publish task assignment: ' + (error as Error).message);
    }
  }

  /**
   * TASK F4-04-BE: Sinh danh sách công việc chăm sóc hàng ngày cho từng con ngựa.
   * Đảm bảo tính Idempotent: chạy lại 10 lần trong ngày vẫn không nhân đôi công việc và
   * không làm mất trạng thái công việc đã hoàn thành trước đó.
   */
  async generateDailyTasksForDate(
    targetDate = effectiveNow(),
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
          workoutSessions: {
            where: {
              status: WorkoutStatus.SCHEDULED,
              scheduledDate: {
                gte: new Date(dayDate.getTime() - CLUB_OFFSET_MS),
                lt: new Date(dayDate.getTime() - CLUB_OFFSET_MS + 86400000),
              },
            },
            select: { id: true, scheduledDate: true },
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
              recordNumber: true,
              examinationDate: true,
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
        where: {
          date: dayDate,
          shift: { isActive: true },
          groom: { role: Role.GROOM, status: 'ACTIVE' },
        },
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
        medicalRecordId?: string;
        prescriptionId?: string;
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
                  if (phase.allowedActivity) {
                    allowedActivityLevel = phase.allowedActivity;
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
                  medicalRecordId: rec.id,
                  prescriptionId: rx.id,
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
        allowedActivityLevel:
          horse.status === HorseStatus.ISOLATED ? 'strict' : allowedActivityLevel,
        workouts: horse.workoutSessions?.map((workout) => {
          const { hour, minute } = clubTime(workout.scheduledDate);
          return {
            id: workout.id,
            time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
          };
        }),
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
        dutyTypes: r.dutyTypes,
      })),
    );
    const lockedHorses = new Set(scheduleHorses.filter((h) => h.isLocked).map((h) => h.id));
    const restingHorses = scheduleHorses.filter(requiresStallRest).map((horse) => horse.id);
    const prepCodes = planned.flatMap((task) => (task.taskCode ? [task.taskCode] : []));
    await this.prisma.dailyCareTask.deleteMany?.({
      where: {
        date: dayDate,
        isCompleted: false,
        horseId: { in: scheduleHorses.map((horse) => horse.id) },
        OR: [
          { taskType: DailyTaskType.WALKING, horseId: { in: restingHorses } },
          { taskCode: { startsWith: WORKOUT_PREP_PREFIX, notIn: prepCodes } },
        ],
      },
    });

    let totalGenerated = 0;

    const activeMedicalTitlesByHorse = new Map<string, Set<string>>();
    for (const t of planned) {
      if (
        t.taskType === DailyTaskType.MEDICATION ||
        t.taskType === DailyTaskType.ICE_BOOT_REST ||
        t.taskType === DailyTaskType.PHYSICAL_THERAPY
      ) {
        if (!activeMedicalTitlesByHorse.has(t.horseId)) {
          activeMedicalTitlesByHorse.set(t.horseId, new Set());
        }
        activeMedicalTitlesByHorse.get(t.horseId)!.add(t.title);
      }
    }

    // Upsert từng task để bảo đảm Idempotent (nhận diện theo ngựa + loại + tiêu đề, vì giờ có thể dời khi đàn thay đổi)
    for (const t of planned) {
      if (t.taskType === DailyTaskType.MEDICATION && Array.isArray(t.itemsSnapshotJson)) {
        const source = t.itemsSnapshotJson[0];
        if (source?.medicalRecordId && source?.prescriptionId && source?.doseNumber)
          t.taskCode = `RX-${dateStr}-${source.medicalRecordId}-${source.prescriptionId}-${source.doseNumber}`;
      }
      let existing = await this.prisma.dailyCareTask.findFirst({
        where: t.taskCode
          ? { taskCode: t.taskCode }
          : { date: dayDate, horseId: t.horseId, taskType: t.taskType, title: t.title },
      });
      if (!existing && t.taskType === DailyTaskType.MEDICATION && t.taskCode?.startsWith('RX-')) {
        const legacy = await this.prisma.dailyCareTask.findFirst({
          where: {
            date: dayDate,
            horseId: t.horseId,
            taskType: DailyTaskType.MEDICATION,
            title: t.title,
            OR: [{ taskCode: null }, { taskCode: { not: { startsWith: 'RX-' } } }],
          },
        });
        // Completed administrations are never recreated or assigned a historical price.
        if (legacy?.isCompleted) continue;
        if (legacy) {
          const ambiguous =
            planned.filter(
              (row) =>
                row.horseId === t.horseId &&
                row.taskType === DailyTaskType.MEDICATION &&
                row.title === t.title,
            ).length > 1;
          if (ambiguous) continue;
          existing = legacy;
        }
      }
      const isLocked = lockedHorses.has(t.horseId);
      const lockNotes = lockNotesByHorse.get(t.horseId);

      if (!existing) {
        const taskCode =
          t.taskCode ??
          `TSK-${dateStr.replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const data = {
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
        };
        let created;
        if (t.taskCode) {
          created = await this.prisma.dailyCareTask.upsert({
            where: { taskCode },
            create: data,
            update: {},
          });
        } else {
          created = await this.prisma.dailyCareTask.create({ data });
        }
        if (created) await this.publishAssignment(created);
        totalGenerated++;
      } else {
        const nextZoneId = t.zoneId ?? null;
        const nextStallId = t.stallId ?? null;
        const nextShiftId = t.shiftId ?? null;
        const nextGroomId = t.assignedGroomUserId ?? null;
        const nextLockNotes = lockNotes ?? null;
        const nextItemsJson = (t.itemsSnapshotJson as any) || null;
        if (
          !existing.isCompleted &&
          (Boolean(existing.cancelledAt) ||
            (existing.date != null && +existing.date !== +dayDate) ||
            (existing.stallZoneId ?? null) !== nextZoneId ||
            (existing.stallId ?? null) !== nextStallId ||
            existing.scheduledTime !== t.scheduledTime ||
            existing.description !== t.description ||
            (existing.shiftId ?? null) !== nextShiftId ||
            (existing.assignedGroomUserId ?? null) !== nextGroomId ||
            existing.isMedicalLocked !== isLocked ||
            (existing.medicalLockNotes ?? null) !== nextLockNotes ||
            JSON.stringify(existing.itemsSnapshotJson ?? null) !== JSON.stringify(nextItemsJson))
        ) {
          const updated = await this.prisma.dailyCareTask.update({
            where: { id: existing.id, isCompleted: false },
            data: {
              cancelledAt: null,
              ...(t.taskCode && { taskCode: t.taskCode }),
              date: dayDate,
              stallZoneId: nextZoneId,
              stallId: nextStallId,
              scheduledTime: t.scheduledTime,
              description: t.description,
              shiftId: nextShiftId,
              assignedGroomUserId: nextGroomId,
              isMedicalLocked: isLocked,
              medicalLockNotes: nextLockNotes,
              itemsSnapshotJson: nextItemsJson,
            },
          });
          if (updated && existing.assignedGroomUserId !== nextGroomId) {
            await this.publishAssignment(updated);
          }
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
          taskType: {
            in: [
              DailyTaskType.MEDICATION,
              DailyTaskType.ICE_BOOT_REST,
              DailyTaskType.PHYSICAL_THERAPY,
            ],
          },
          isCompleted: false,
          cancelledAt: null,
        },
        select: { id: true, horseId: true, title: true },
      })) || [];

    for (const emt of existingMedicalTasks || []) {
      const activeTitles = activeMedicalTitlesByHorse.get(emt.horseId);
      if (!activeTitles || !activeTitles.has(emt.title)) {
        await this.prisma.dailyCareTask.update({
          where: { id: emt.id, isCompleted: false },
          data: { cancelledAt: effectiveNow() },
        });
      }
    }

    const handovers = await this.prisma.dailyCareTask.findMany({
      where: {
        date: dayDate,
        isCompleted: false,
        taskCode: { startsWith: STALL_HANDOVER_PREFIX },
        ...(zoneIdFilter && { stallZoneId: zoneIdFilter }),
        ...(horseIdFilter && { horseId: horseIdFilter }),
      },
      select: {
        id: true,
        scheduledTime: true,
        stallZoneId: true,
        assignedGroomUserId: true,
        shiftId: true,
        taskCode: true,
      },
    });
    for (const handover of handovers ?? []) {
      if (!handover.taskCode?.startsWith(STALL_HANDOVER_PREFIX)) continue;
      const time = handover.scheduledTime ? toMinutes(handover.scheduledTime) : undefined;
      const eligible = shiftRosters.filter(
        (roster) =>
          roster.zoneId === handover.stallZoneId &&
          roster.shift?.isActive &&
          time !== undefined &&
          shiftCovers(roster.shift, time),
      );
      const roster =
        eligible.find((row) => row.groomUserId === handover.assignedGroomUserId) ?? eligible[0];
      if (
        (roster?.groomUserId ?? null) !== handover.assignedGroomUserId ||
        (roster?.shiftId ?? null) !== handover.shiftId
      ) {
        await this.prisma.dailyCareTask.updateMany({
          where: { id: handover.id, isCompleted: false },
          data: {
            assignedGroomUserId: roster?.groomUserId ?? null,
            shiftId: roster?.shiftId ?? null,
          },
        });
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
    // Thay đổi từ phía Bác sĩ thú y áp dụng từ ngày hôm sau để không làm xáo trộn ca hôm nay của Groom
    const tomorrow = effectiveNow();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const startStr =
      fromDateStr && fromDateStr.slice(0, 10) > tomorrowStr
        ? fromDateStr.slice(0, 10)
        : tomorrowStr;
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
      if (curStr === startStr || existingCount > 0) {
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
      cancelledAt: null,
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

    // Nếu người dùng bật cờ "Chỉ việc của tôi" hoặc là Groom xem mặc định (khi onlyMine chưa được truyền)
    const isOnlyMine = query.onlyMine === true || currentUser.role === Role.GROOM;

    if (isOnlyMine && currentUser.userId) {
      where.OR = [
        { assignedGroomUserId: currentUser.userId },
        { completedById: currentUser.userId },
      ];
      if (query.zoneId) where.stallZoneId = query.zoneId;
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
  private async assertTaskGroom(tx: any, task: any, actor: CurrentUserPayload) {
    if (actor.role !== Role.GROOM) return;
    if (task.assignedGroomUserId !== actor.userId)
      throw apiError(
        HttpStatus.FORBIDDEN,
        'TASK_NOT_ASSIGNED_TO_YOU',
        'Chỉ Groom được phân công mới được xác nhận công việc.',
      );
    if (task.isCompleted && task.completedById === actor.userId) return;
    const roster =
      task.stallZoneId &&
      (await onDutyGrooms(tx, task.stallZoneId)).find(
        (r) =>
          r.groomUserId === actor.userId &&
          r.shiftId === task.shiftId &&
          r.date.getTime() === new Date(task.date).getTime(),
      );
    const duty = task.taskType === DailyTaskType.CLEANING ? 'CLEANING' : 'HORSE_CARE';
    if (!roster || !roster.dutyTypes.includes(duty))
      throw apiError(
        HttpStatus.FORBIDDEN,
        'GROOM_NOT_ON_DUTY',
        'Công việc phải thuộc đúng ca đang trực và nhiệm vụ được giao.',
      );
    const allocation = await tx.stallAllocation.findFirst({
      where: {
        horseId: task.horseId,
        isActive: true,
        stallId: task.stallId,
        stall: { zoneId: task.stallZoneId },
      },
    });
    if (!allocation)
      throw apiError(
        HttpStatus.CONFLICT,
        'TASK_STALL_OUTDATED',
        'Ngựa đã đổi ô chuồng. Vui lòng tải lại danh sách công việc.',
      );
  }

  async completeTask(id: string, dto: CompleteDailyTaskDto, currentUser: CurrentUserPayload) {
    const task = await this.prisma.dailyCareTask.findUnique({
      where: { id },
      include: { horse: true },
    });

    if (!task) {
      throw new NotFoundException('Không tìm thấy công việc chăm sóc.');
    }

    await this.assertTaskGroom(this.prisma, task, currentUser);
    if (task.isCompleted) return task;

    if (task.cancelledAt) {
      throw apiError(HttpStatus.BAD_REQUEST, 'TASK_CANCELLED', 'Công việc chăm sóc này đã bị hủy.');
    }

    if (
      task.isMedicalLocked &&
      (task.taskType === DailyTaskType.MEDICATION ||
        task.taskType === DailyTaskType.ICE_BOOT_REST ||
        task.taskType === DailyTaskType.PHYSICAL_THERAPY)
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TASK_MEDICAL_LOCKED',
        task.medicalLockNotes ||
          'Công việc y tế này đã bị dừng do Bác sĩ thú y đã kết thúc điều trị hoặc thay đổi đơn thuốc.',
      );
    }
    const workoutId = task.taskCode?.startsWith(WORKOUT_PREP_PREFIX)
      ? task.taskCode.slice(WORKOUT_PREP_PREFIX.length)
      : null;
    if (workoutId) {
      const workout = await this.prisma.workoutSession.findUnique({
        where: { id: workoutId },
        select: { status: true, scheduledDate: true },
      });
      if (
        !workout ||
        workout.status !== WorkoutStatus.SCHEDULED ||
        clubDateStr(workout.scheduledDate) !== clubDateStr(task.date)
      ) {
        throw apiError(
          HttpStatus.CONFLICT,
          'WORKOUT_PREP_OUTDATED',
          'Buổi tập đã đổi lịch hoặc không còn hoạt động.',
        );
      }
    }
    if (
      (task.taskType === DailyTaskType.WALKING || workoutId) &&
      (task.horse?.isMedicalLocked || task.horse?.status === HorseStatus.ISOLATED)
    ) {
      throw apiError(
        HttpStatus.CONFLICT,
        'MEDICAL_LOCK_ACTIVE',
        'Công việc vận động đã bị chặn theo tình trạng y tế.',
      );
    }

    if (task.horse?.status === HorseStatus.RETIRED) {
      throw new BadRequestException('Không thể hoàn thành việc cho ngựa đã ngừng quản lý.');
    }

    const now = effectiveNow();

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
      await lockCareAssignments(tx);
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${task.horseId} FOR UPDATE`;
      const current = await tx.dailyCareTask.findUnique({
        where: { id },
        include: { horse: true },
      });
      if (!current) throw new NotFoundException('Không tìm thấy công việc chăm sóc.');
      await this.assertTaskGroom(tx, current, currentUser);
      if (current.isCompleted) return current;
      if (current.cancelledAt)
        throw apiError(
          HttpStatus.CONFLICT,
          'TASK_CANCELLED',
          'This clinical instruction was withdrawn. Refresh the checklist.',
        );
      if (
        (current.taskType === DailyTaskType.WALKING || workoutId) &&
        (current.horse?.isMedicalLocked || current.horse?.status === HorseStatus.ISOLATED)
      )
        throw apiError(HttpStatus.CONFLICT, 'MEDICAL_LOCK_ACTIVE', 'Horse is medically protected.');
      if (current.horse?.deletedAt || current.horse?.status === HorseStatus.RETIRED)
        throw new BadRequestException('Ngựa không còn hoạt động.');
      if (
        current.completionVersion !== task.completionVersion ||
        current.updatedAt?.getTime() !== task.updatedAt?.getTime()
      )
        throw apiError(
          HttpStatus.CONFLICT,
          'TASK_CHANGED',
          'Task changed. Refresh before recording completion.',
        );
      const taskUpdated = await tx.dailyCareTask.update({
        where: { id, isCompleted: false, completionVersion: task.completionVersion },
        data: {
          completionVersion: { increment: 1 },
          isCompleted: true,
          completedAt: now,
          completedById: currentUser.userId,
          undoUntil,
          description: dto.notes
            ? `${task.description || ''}\n[Ghi chú nhân viên chăm sóc: ${dto.notes}]`
            : task.description,
        },
        include: TASK_DETAIL_INCLUDE,
      });

      // Trừ kho tự động cho việc cho ăn (FEEDING) hoặc cho uống thuốc (MEDICATION) cùng transaction
      if (task.taskType === DailyTaskType.MEDICATION) {
        let zoneId = task.stallZoneId;
        if (!zoneId) {
          const allocation = await tx.stallAllocation.findFirst({
            where: { horseId: task.horseId, isActive: true },
            include: { stall: true },
          });
          zoneId = allocation?.stall.zoneId ?? null;
        }
        await new CareCostLedgerService().consumeMedication(
          tx,
          { ...task, completionVersion: taskUpdated.completionVersion },
          zoneId,
          currentUser.userId,
          now,
        );
      }
      if (task.taskType === DailyTaskType.FEEDING) {
        let targetZoneId = task.stallZoneId;
        if (!targetZoneId && task.horseId) {
          const alloc = await (tx || this.prisma).stallAllocation.findFirst({
            where: { horseId: task.horseId, isActive: true },
            include: { stall: true },
          });
          targetZoneId = alloc?.stall?.zoneId || null;
        }

        const itemsToDeduct = Array.isArray(task.itemsSnapshotJson)
          ? (task.itemsSnapshotJson as any[])
          : typeof task.itemsSnapshotJson === 'string'
            ? (() => {
                try {
                  const parsed = JSON.parse(task.itemsSnapshotJson as string);
                  return Array.isArray(parsed) ? parsed : null;
                } catch {
                  return null;
                }
              })()
            : null;

        if (targetZoneId && itemsToDeduct && itemsToDeduct.length > 0) {
          await this.inventoryService.deductStockForFeeding(targetZoneId, itemsToDeduct as any, tx);
        }
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

    if (task.taskCode?.startsWith(STALL_HANDOVER_PREFIX)) {
      const snapshot = task.itemsSnapshotJson as { toStallCode?: string } | null;
      const input = {
        type: 'STALL_HANDOVER_DONE',
        category: 'SYSTEM' as const,
        title: 'Hoàn tất bàn giao chuồng',
        message: task.title,
        link: '/tasks',
        dedupeKey: 'handover-done:' + task.id,
        email: {
          eventCode: 'STALL_HANDOVER_DONE',
          body: {
            ...stallMoveCompleted(
              task.horse,
              { code: snapshot?.toStallCode ?? 'Xem lịch sử chuyển chuồng' },
              { name: currentUser.fullName },
              now,
              dto.notes,
            ),
            refId: task.id,
          },
        },
      };
      await this.notifications.notifyHorse(
        task.horseId,
        { roles: [Role.CLUB_MANAGER], owner: true, trainer: true, groom: true },
        input,
      );
      await this.notifications.notifyUsers([task.assignedGroomUserId, currentUser.userId], input);
    }

    return updated;
  }

  /**
   * TASK F4-05-BE: Hoàn tác trạng thái hoàn thành trong vòng 15 phút nếu bấm nhầm.
   * Sau 15 phút, khóa không cho phép hoàn tác.
   */
  async uncompleteTask(
    id: string,
    currentUser: CurrentUserPayload,
    review?: { reason: string; retryBy?: string },
    correction?: { administrationNotPerformed?: boolean },
  ) {
    const task = await this.prisma.dailyCareTask.findUnique({
      where: { id },
      include: { horse: true },
    });

    if (!task) {
      throw new NotFoundException('Không tìm thấy công việc chăm sóc.');
    }

    if (
      review &&
      (currentUser.role !== Role.CLUB_MANAGER ||
        [DailyTaskType.FEEDING, DailyTaskType.MEDICATION].includes(
          task.taskType as 'FEEDING' | 'MEDICATION',
        ))
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TASK_REVIEW_NOT_ALLOWED',
        'Chỉ quản lý được yêu cầu làm lại công việc. Với cho ăn hoặc thuốc đã dùng, hãy lập báo cáo sai lệch.',
      );
    }
    if (!task.isCompleted) {
      return task; // Đang chưa hoàn thành sẵn
    }
    if (
      task.taskType === DailyTaskType.MEDICATION &&
      correction?.administrationNotPerformed !== true
    )
      throw apiError(
        HttpStatus.CONFLICT,
        'MEDICATION_ALREADY_ADMINISTERED',
        'Only undo an accidental click when the medicine was not administered. Report a clinical discrepancy for medicine already used.',
      );

    // Kiểm tra quyền: Người bấm hoàn thành, hoặc Club Manager mới được hoàn tác
    if (task.completedById !== currentUser.userId && currentUser.role !== Role.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'TASK_UNDO_FORBIDDEN',
        'Bạn không có quyền hoàn tác công việc do nhân viên khác thực hiện.',
      );
    }

    // Kiểm tra cửa sổ 15 phút
    const now = effectiveNow();
    if (task.undoUntil && now > task.undoUntil && currentUser.role !== Role.CLUB_MANAGER) {
      const minutesPassed = Math.round(
        (now.getTime() - (task.completedAt?.getTime() || 0)) / 60000,
      );
      throw new BadRequestException(
        `Cửa sổ hoàn tác 15 phút đã hết hạn (đã trôi qua ${minutesPassed} phút). Vui lòng liên hệ Quản lý nếu cần điều chỉnh.`,
      );
    }

    // Hoàn lại kho nếu hoàn tác việc cho ăn (FEEDING) hoặc cho uống thuốc (MEDICATION): chuẩn bị trước, ghi trong transaction.
    let targetZoneId: string | null = null;
    let itemsToRestore: any[] | null = null;
    if (task.taskType === DailyTaskType.FEEDING) {
      targetZoneId = task.stallZoneId;
      if (!targetZoneId && task.horseId) {
        const alloc = await this.prisma.stallAllocation.findFirst({
          where: { horseId: task.horseId, isActive: true },
          include: { stall: true },
        });
        targetZoneId = alloc?.stall?.zoneId || null;
      }

      itemsToRestore = Array.isArray(task.itemsSnapshotJson)
        ? (task.itemsSnapshotJson as any[])
        : typeof task.itemsSnapshotJson === 'string'
          ? (() => {
              try {
                const parsed = JSON.parse(task.itemsSnapshotJson as string);
                return Array.isArray(parsed) ? parsed : null;
              } catch {
                return null;
              }
            })()
          : null;
    }

    // Tương tự: hai lần hoàn tác đồng thời chỉ hoàn kho một lần.
    const updated = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${task.horseId} FOR UPDATE`;
        const reopened = await tx.dailyCareTask.update({
          where: { id, isCompleted: true, completionVersion: task.completionVersion },
          data: {
            isCompleted: false,
            completedAt: null,
            completedById: null,
            undoUntil: null,
            ...(review && {
              description: (task.description ?? '') + '\n[Kiểm tra lại] ' + review.reason,
            }),
          },
          include: TASK_DETAIL_INCLUDE,
        });
        if (task.taskType === DailyTaskType.MEDICATION)
          await new CareCostLedgerService().reverseMedication(tx, task, currentUser.userId, now);
        if (targetZoneId && itemsToRestore && itemsToRestore.length > 0) {
          await this.inventoryService.restoreStockForFeeding(targetZoneId, itemsToRestore, tx);
        }
        return reopened;
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

    if (review && task.completedById) {
      await this.notifications.notifyUsers([task.completedById], {
        type: 'TASK_REJECTED',
        category: 'SYSTEM',
        title: 'Yêu cầu kiểm tra và làm lại',
        message: review.reason,
        link: '/tasks',
        dedupeKey: 'task-rejected:' + task.id + ':' + now.toISOString(),
        email: {
          eventCode: 'TASK_REJECTED',
          body: {
            ...taskRejected(
              {
                taskCode: task.taskCode ?? task.id,
                title: task.title,
                date: task.date.toISOString().slice(0, 10),
                scheduledTime: task.scheduledTime ?? undefined,
              },
              { name: currentUser.fullName },
              review.reason,
              review.retryBy,
            ),
            refId: task.id,
            milestone: now.toISOString(),
          },
        },
      });
    }
    return updated;
  }
}

/** Prisma P2025: update có điều kiện không khớp dòng nào (request khác đã đổi trạng thái trước). */
const lostRace = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025';
