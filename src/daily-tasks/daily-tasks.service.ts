import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DailyTaskType, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CompleteDailyTaskDto, QueryDailyTasksDto } from './dto/daily-task.dto';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { InventoryService } from '../inventory/inventory.service';
import { planDailyTasks, ScheduleHorse } from './daily-schedule';

const UNDO_WINDOW_MS = 15 * 60 * 1000; // 15 phút (900.000 ms)

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
  ): Promise<{
    date: string;
    totalGenerated: number;
    horsesProcessed: number;
  }> {
    const dateStr = targetDate.toISOString().slice(0, 10);
    const dayDate = new Date(`${dateStr}T00:00:00.000Z`);

    this.logger.log(`[DailyTasksService] Generating daily care tasks for date: ${dateStr}`);

    // Lấy danh sách ngựa đang quản lý (không bị xóa mềm)
    const horses = await this.prisma.horse.findMany({
      where: {
        deletedAt: null,
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
      },
    });

    // Bảng phân ca trong ngày: mỗi việc giao cho Groom trực ca chứa giờ đó, việc của một Groom xếp nối tiếp (không trùng giờ)
    const shiftRosters = await this.prisma.shiftRoster.findMany({
      where: { date: dayDate },
      include: { shift: true },
    });

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
      return {
        id: horse.id,
        zoneId: stall?.zoneId || undefined,
        stallId: stall?.id || undefined,
        stallCode: stall?.code,
        allocationGroomId: horse.stallAllocations[0]?.assignedGroomUserId || undefined,
        isLocked,
        mealsJson: horse.nutritionPlans[0]?.mealsJson,
      };
    });
    const planned = planDailyTasks(
      scheduleHorses,
      shiftRosters.map((r) => ({
        zoneId: r.zoneId,
        groomUserId: r.groomUserId,
        shiftId: r.shiftId,
        startTime: r.shift.startTime,
        endTime: r.shift.endTime,
        isOvernight: r.shift.isOvernight,
      })),
    );
    const lockedHorses = new Set(scheduleHorses.filter((h) => h.isLocked).map((h) => h.id));

    let totalGenerated = 0;

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
      } else if (
        !existing.isCompleted &&
        (existing.stallZoneId !== t.zoneId ||
          existing.stallId !== t.stallId ||
          existing.scheduledTime !== t.scheduledTime ||
          (t.assignedGroomUserId && existing.assignedGroomUserId !== t.assignedGroomUserId))
      ) {
        await this.prisma.dailyCareTask.update({
          where: { id: existing.id },
          data: {
            stallZoneId: t.zoneId,
            stallId: t.stallId,
            scheduledTime: t.scheduledTime,
            shiftId: t.shiftId ?? existing.shiftId,
            assignedGroomUserId: t.assignedGroomUserId || existing.assignedGroomUserId,
            isMedicalLocked: isLocked,
            medicalLockNotes: lockNotes,
          },
        });
      }
    }

    this.logger.log(
      `[DailyTasksService] Generated ${totalGenerated} tasks for ${horses.length} horses on ${dateStr}`,
    );

    return {
      date: dateStr,
      totalGenerated,
      horsesProcessed: horses.length,
    };
  }

  /**
   * SC-4.04: Lấy danh sách checklist công việc theo ngày, khu chuồng, ca trực và quyền xem
   */
  async findAll(query: QueryDailyTasksDto, currentUser: CurrentUserPayload) {
    const dateStr = query.date || new Date().toISOString().slice(0, 10);
    const dayDate = new Date(`${dateStr}T00:00:00.000Z`);

    // Tự động sinh công việc nếu ngày đó chưa có task nào (on-demand self-healing)
    const existingCount = await this.prisma.dailyCareTask.count({
      where: { date: dayDate },
    });
    if (existingCount === 0) {
      await this.generateDailyTasksForDate(dayDate, query.zoneId);
    } else {
      // Tự động đồng bộ zone/stall của các task chưa hoàn thành theo phân bổ chuồng mới nhất của ngựa
      const horsesWithStall = await this.prisma.horse.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          stallAllocations: {
            where: { isActive: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              assignedGroomUserId: true,
              stall: { select: { id: true, zoneId: true } },
            },
          },
        },
      });

      for (const h of horsesWithStall || []) {
        const activeAlloc = h.stallAllocations[0];
        if (activeAlloc?.stall) {
          await this.prisma.dailyCareTask.updateMany({
            where: {
              date: dayDate,
              horseId: h.id,
              isCompleted: false,
              OR: [
                { stallZoneId: { not: activeAlloc.stall.zoneId } },
                { stallId: { not: activeAlloc.stall.id } },
              ],
            },
            data: {
              stallZoneId: activeAlloc.stall.zoneId,
              stallId: activeAlloc.stall.id,
            },
          });
        }
      }
    }

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
        include: {
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
        },
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

    const now = new Date();
    const undoUntil = new Date(now.getTime() + UNDO_WINDOW_MS);

    // Chỉ request đổi được isCompleted false -> true mới trừ kho (RULE-CONC-01): hai lần bấm đồng thời không trừ đôi.
    const updated = await this.prisma.dailyCareTask
      .update({
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
        include: {
          horse: true,
          completedBy: { select: { id: true, fullName: true } },
        },
      })
      .catch((err: unknown) => {
        if (lostRace(err)) return null;
        throw err;
      });
    if (!updated) {
      return this.prisma.dailyCareTask.findUniqueOrThrow({
        where: { id },
        include: { horse: true },
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

    // Trừ kho tự động nếu là việc cho ăn (FEEDING)
    if (task.taskType === DailyTaskType.FEEDING && task.stallZoneId && task.itemsSnapshotJson) {
      await this.inventoryService.deductStockForFeeding(
        task.stallZoneId,
        task.itemsSnapshotJson as any,
      );
    }

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
      throw new ForbiddenException(
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
        include: {
          horse: true,
        },
      })
      .catch((err: unknown) => {
        if (lostRace(err)) return null;
        throw err;
      });
    if (!updated) {
      return this.prisma.dailyCareTask.findUniqueOrThrow({
        where: { id },
        include: { horse: true },
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

    // Hoàn lại kho vật tư nếu hoàn tác việc cho ăn (FEEDING)
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
