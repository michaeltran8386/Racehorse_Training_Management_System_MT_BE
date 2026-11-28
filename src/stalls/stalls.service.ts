import { effectiveNow } from '../common/utils/demo-clock';
import {
  assertPrimaryGroom,
  assertReceivingGroom,
  lockCareAssignments,
  transferPendingCare,
} from './groom-care.rules';
import { stallMove } from '../business-mail/templates/health-templates';
import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { HorseStatus, Prisma, Role, StallStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  SetStallStatusDto,
  SetZoneStatusDto,
  SettableStallStatus,
  UpdateStallDto,
  UpdateZoneDto,
} from './dto/stall.dto';
import { AssignHorseDto } from './dto/assign-horse.dto';
import { TransferHorseDto } from './dto/transfer-horse.dto';
import { ReturnStallDto } from './dto/return-stall.dto';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { apiError } from '../common/exceptions/api-error';
import { DailyTasksService } from '../daily-tasks/daily-tasks.service';
import { STALL_HANDOVER_PREFIX } from '../daily-tasks/daily-schedule';
import { NotificationsService } from '../notifications/notifications.service';
import { clubTime } from '../training/training-rules';
import { rosterDay, zoneGroomIds } from '../shift-rosters/groom-zones';
import { assertTrainerZone, LIVE_TRAINER_PLAN_STATUSES } from '../training/trainer-zones';

type Tx = Prisma.TransactionClient;

const LIVE_TRAINERS = {
  where: { status: { in: LIVE_TRAINER_PLAN_STATUSES } },
  select: { trainerUserId: true },
} satisfies Prisma.Horse$trainingPlansArgs;

export const MAX_STALLS_PER_ZONE = 12;
export const MAX_STALLS_PER_GROOM = 6;

function assertGridSize(rows: number, cols: number) {
  if (rows * cols > MAX_STALLS_PER_ZONE) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'ZONE_TOO_LARGE',
      `Mỗi khu tối đa ${MAX_STALLS_PER_ZONE} ô chuồng (hàng × cột = ${rows * cols}).`,
      { max: MAX_STALLS_PER_ZONE },
    );
  }
}

const STALL_INCLUDE = {
  zoneRef: { select: { id: true, code: true, name: true, rows: true, cols: true, isActive: true } },
  allocations: {
    where: { isActive: true },
    include: {
      horse: {
        select: {
          id: true,
          horseCode: true,
          name: true,
          status: true,
          isMedicalLocked: true,
          isDebtImpounded: true,
          debtImpoundReason: true,
          assignedTrainerId: true,
          trainerAssignmentStatus: true,
          assignedTrainer: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          owner: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      },
      assignedGroom: { select: { id: true, fullName: true, email: true } },
    },
  },
} satisfies Prisma.StallInclude;

/** Mã khu sinh từ tên khu cũ (dữ liệu trước khi có bảng StallZone): "Zone A - Barn 1" -> "ZONE-A-BARN-1". */
function codeFromName(name: string): string {
  const code = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return code || 'ZONE';
}

/**
 * Flow 1 – SC-1.04 Sơ đồ chuồng, SC-1.07 Danh mục khu & ô chuồng, DL-1.02 / DL-1.03 Gán, chuyển, trả ô.
 * Không xóa cứng ô (Q-1.C): ô không dùng nữa chuyển sang Ngừng dùng (INACTIVE).
 */
@Injectable()
export class StallsService {
  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    @Optional() private readonly dailyTasks?: DailyTasksService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private async alertGroomAssignment(allocationId: string) {
    if (!this.notifications) return false;
    try {
      const row = await this.prisma.stallAllocation.findUnique({
        where: { id: allocationId },
        include: { horse: true, stall: true },
      });
      if (!row || !row.isActive || row.assignedGroomUserId) return true;
      const managers = await this.prisma.user.findMany({
        where: { role: Role.CLUB_MANAGER, status: UserStatus.ACTIVE },
        select: { id: true },
      });
      return await this.notifications.notifyUsers(
        managers.map((user) => user.id),
        {
          type: 'STALL_GROOM_ASSIGNMENT_REQUIRED',
          category: 'SYSTEM',
          title: 'Cần phân công Groom chăm sóc',
          message: `Ngựa ${row.horse.name} đã đến ô ${row.stall.code}. Yêu cầu chỉ định Groom đang trực tại khu.`,
          link: `/stalls?assignGroom=${row.id}`,
          params: { allocationId: row.id, horseId: row.horseId, zoneId: row.stall.zoneId ?? '' },
          dedupeKey: `allocation-groom:${row.id}`,
        },
      );
    } catch {
      return false;
    }
  }

  async groomCandidates(allocationId: string, user: CurrentUserPayload) {
    if (user.role !== Role.CLUB_MANAGER)
      throw apiError(HttpStatus.FORBIDDEN, 'MANAGER_REQUIRED', 'Only Manager can assign care.');
    const allocation = await this.prisma.stallAllocation.findUnique({
      where: { id: allocationId },
      include: { stall: true },
    });
    if (!allocation?.isActive || !allocation.stall.zoneId)
      throw apiError(
        HttpStatus.CONFLICT,
        'ALLOCATION_NOT_ACTIVE',
        'Allocation is no longer active.',
      );
    const targetZoneId = allocation.stall.zoneId;

    const grooms = await this.prisma.user.findMany({
      where: {
        role: Role.GROOM,
        status: UserStatus.ACTIVE,
        OR: [{ assignedBarnId: targetZoneId }, { assignedBarnId: null }],
      },
      select: { id: true, fullName: true, email: true, assignedBarnId: true },
      orderBy: { fullName: 'asc' },
    });

    const candidates: Array<{
      id: string;
      fullName: string;
      email: string;
      currentStallsCount: number;
      maxStallsCount: number;
      isFull: boolean;
    }> = [];
    for (const g of grooms) {
      const activeAllocations = await this.prisma.stallAllocation.findMany({
        where: { assignedGroomUserId: g.id, isActive: true },
        include: { stall: true },
      });
      // Kiểm tra xem Groom đã phụ trách chuồng ở phân khu khác chưa (1 Groom chỉ thuộc 1 Barn)
      const otherZone = activeAllocations.find(
        (a) => a.stall.zoneId && a.stall.zoneId !== targetZoneId,
      );
      if (!otherZone) {
        candidates.push({
          id: g.id,
          fullName: g.fullName,
          email: g.email,
          currentStallsCount: activeAllocations.length,
          maxStallsCount: MAX_STALLS_PER_GROOM,
          isFull: activeAllocations.length >= MAX_STALLS_PER_GROOM,
        });
      }
    }
    return candidates;
  }

  async assignAllocationGroom(allocationId: string, groomUserId: string, user: CurrentUserPayload) {
    if (user.role !== Role.CLUB_MANAGER)
      throw apiError(HttpStatus.FORBIDDEN, 'MANAGER_REQUIRED', 'Only Manager can assign care.');
    const result = await this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      await tx.$queryRaw`SELECT "id" FROM "StallAllocation" WHERE "id" = ${allocationId} FOR UPDATE`;
      const row = await tx.stallAllocation.findUnique({
        where: { id: allocationId },
        include: { stall: true },
      });
      if (!row?.isActive || !row.stall.zoneId)
        throw apiError(
          HttpStatus.CONFLICT,
          'ALLOCATION_NOT_ACTIVE',
          'Allocation is no longer active.',
        );
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${row.horseId} FOR UPDATE`;

      // Kiểm tra Groom hợp lệ, chặn cứng 6 chuồng và 1 Barn
      await this.assertGroom(tx, row.stall.zoneId, groomUserId, allocationId);

      const updated = await tx.stallAllocation.update({
        where: { id: allocationId },
        data: { assignedGroomUserId: groomUserId },
      });

      await this.auditService.record(
        this.actor(user),
        'ASSIGN_ALLOCATION_GROOM',
        `Allocation ${allocationId} assigned to ${groomUserId}`,
        allocationId,
        { entityName: 'StallAllocation' },
        tx,
      );
      return updated;
    });
    let careSyncFailed = false;
    try {
      await this.dailyTasks?.syncMedicalTasksForHorse(result.horseId);
    } catch {
      careSyncFailed = true;
    }
    let sent: boolean | undefined;
    try {
      await this.notifications?.notifyUsers([groomUserId], {
        type: 'STALL_HANDOVER_ASSIGNED',
        category: 'SYSTEM',
        title: 'Gán người chăm sóc',
        message: 'Bạn đã được phân công phụ trách ô chuồng mới.',
        link: '/stalls/map',
      });
      sent = true;
    } catch {
      sent = false;
    }
    return { ...result, careSyncFailed, notificationFailed: sent === false };
  }

  async bulkAssignGroom(
    dto: { groomUserId: string; allocationIds: string[] },
    user: CurrentUserPayload,
  ) {
    if (user.role !== Role.CLUB_MANAGER)
      throw apiError(HttpStatus.FORBIDDEN, 'MANAGER_REQUIRED', 'Only Manager can assign care.');
    if (!dto.allocationIds || dto.allocationIds.length === 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'EMPTY_ALLOCATIONS',
        'Vui lòng chọn ít nhất 1 ô chuồng.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      const groom = await tx.user.findUnique({ where: { id: dto.groomUserId } });
      if (!groom || groom.role !== Role.GROOM || groom.status !== UserStatus.ACTIVE) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_GROOM',
          'Groom không hợp lệ hoặc đang không hoạt động.',
        );
      }

      // Khóa và lấy danh sách allocations
      const allocations = await tx.stallAllocation.findMany({
        where: { id: { in: dto.allocationIds }, isActive: true },
        include: { stall: true },
      });
      if (allocations.length !== dto.allocationIds.length) {
        throw apiError(
          HttpStatus.CONFLICT,
          'SOME_ALLOCATIONS_INACTIVE',
          'Một số ô chuồng không còn hoạt động.',
        );
      }

      const targetZoneId = allocations[0].stall.zoneId;
      if (!targetZoneId || allocations.some((a) => a.stall.zoneId !== targetZoneId)) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'DIFFERENT_ZONES',
          'Tất cả các ô chuồng được chọn phải thuộc cùng 1 phân khu.',
        );
      }

      if (groom.assignedBarnId && groom.assignedBarnId !== targetZoneId) {
        throw apiError(
          HttpStatus.CONFLICT,
          'GROOM_MULTI_ZONE_FORBIDDEN',
          `Nhân viên ${groom.fullName} thuộc phân khu khác. Mỗi Groom chỉ được phụ trách các ô chuồng trong phân khu của mình.`,
        );
      }

      // Kiểm tra Groom không có chuồng ở phân khu khác
      const otherZoneAlloc = await tx.stallAllocation.findFirst({
        where: {
          assignedGroomUserId: dto.groomUserId,
          isActive: true,
          stall: { zoneId: { not: targetZoneId } },
          id: { notIn: dto.allocationIds },
        },
        include: { stall: { include: { zoneRef: true } } },
      });
      if (otherZoneAlloc) {
        throw apiError(
          HttpStatus.CONFLICT,
          'GROOM_MULTI_ZONE_FORBIDDEN',
          `Nhân viên ${groom.fullName} đang phụ trách tại ${otherZoneAlloc.stall.zoneRef?.name || otherZoneAlloc.stall.zone}. Mỗi Groom chỉ được phụ trách các ô chuồng trong cùng 1 phân khu.`,
        );
      }

      // Kiểm tra Hard Limit 6 chuồng
      const currentActiveCount = await tx.stallAllocation.count({
        where: {
          assignedGroomUserId: dto.groomUserId,
          isActive: true,
          id: { notIn: dto.allocationIds },
        },
      });
      if (currentActiveCount + dto.allocationIds.length > MAX_STALLS_PER_GROOM) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'GROOM_MAX_STALLS_EXCEEDED',
          `Groom ${groom.fullName} chỉ còn nhận được ${MAX_STALLS_PER_GROOM - currentActiveCount} ô chuồng. Bạn đang gán ${dto.allocationIds.length} ô chuồng (vượt định mức tối đa ${MAX_STALLS_PER_GROOM}).`,
        );
      }

      // Cập nhật tất cả allocations
      await tx.stallAllocation.updateMany({
        where: { id: { in: dto.allocationIds } },
        data: { assignedGroomUserId: dto.groomUserId },
      });

      // Cập nhật toàn bộ dailyCareTask hôm nay của các con ngựa này
      const horseIds = allocations.map((a) => a.horseId);
      await tx.dailyCareTask.updateMany({
        where: {
          horseId: { in: horseIds },
          stallZoneId: targetZoneId,
          date: rosterDay(),
          isCompleted: false,
          OR: [{ taskCode: null }, { NOT: { taskCode: { startsWith: STALL_HANDOVER_PREFIX } } }],
        },
        data: { assignedGroomUserId: dto.groomUserId },
      });

      await this.auditService.record(
        this.actor(user),
        'BULK_ASSIGN_GROOM',
        `Phân công hàng loạt ${dto.allocationIds.length} ô chuồng cho Groom ${groom.fullName}`,
        dto.groomUserId,
        {
          entityName: 'StallAllocation',
          newValues: { groomUserId: dto.groomUserId, allocationIds: dto.allocationIds },
        },
        tx,
      );

      return { success: true, count: dto.allocationIds.length, groomName: groom.fullName };
    });

    try {
      await this.notifications?.notifyUsers([dto.groomUserId], {
        type: 'STALL_HANDOVER_ASSIGNED',
        category: 'SYSTEM',
        title: 'Phân công quản lý ô chuồng',
        message: `Bạn đã được phân công phụ trách ${dto.allocationIds.length} ô chuồng mới.`,
        link: '/stalls/map',
      });
    } catch {
      // ignore
    }

    return result;
  }

  private actor(user: CurrentUserPayload) {
    return { id: user.userId, name: user.fullName || user.email };
  }

  /**
   * Dữ liệu trước khi có bảng khu chỉ có Stall.zone (chuỗi). Lần đầu đọc thì tạo khu tương ứng và xếp
   * các ô vào lưới theo thứ tự mã ô. Chạy lại bao nhiêu lần cũng cho cùng kết quả.
   */
  async ensureZones(): Promise<void> {
    const orphans = await this.prisma.stall.findMany({
      where: { zoneId: null },
      orderBy: { code: 'asc' },
    });
    if (orphans.length === 0) return;

    const byZone = new Map<string, typeof orphans>();
    for (const s of orphans) byZone.set(s.zone, [...(byZone.get(s.zone) ?? []), s]);

    await this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      for (const [name, stalls] of byZone) {
        const existing = await tx.stallZone.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
        });
        if (existing) {
          // Khu đã có: gắn ô vào khu, chưa có vị trí trên lưới (CM xếp lại ở SC-1.07).
          await tx.stall.updateMany({
            where: { id: { in: stalls.map((s) => s.id) } },
            data: { zoneId: existing.id, zone: existing.name },
          });
          continue;
        }
        let code = codeFromName(name);
        for (let i = 2; await tx.stallZone.findUnique({ where: { code } }); i++) {
          code = `${codeFromName(name).slice(0, 17)}-${i}`;
        }
        const cols = 3;
        const rows = Math.max(4, Math.ceil(stalls.length / cols));
        const zone = await tx.stallZone.create({
          data: { code, name, cols, rows },
        });
        for (const [i, s] of stalls.entries()) {
          await tx.stall.update({
            where: { id: s.id },
            data: { zoneId: zone.id, row: Math.floor(i / cols) + 1, col: (i % cols) + 1 },
          });
        }
      }
    });
  }

  // ------------------------------------------------------------------ Khu chuồng

  /** Danh sách khu kèm số ô, số ô có ngựa (SC-1.07; dropdown khu ở SC-1.04). */
  async listZones(query: { includeInactive?: string } = {}) {
    await this.ensureZones();
    const zones = await this.prisma.stallZone.findMany({
      where: query.includeInactive === 'true' ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { stalls: { select: { status: true } } },
    });
    return zones.map(({ stalls, ...z }) => ({
      ...z,
      stallCount: stalls.filter((s) => s.status !== StallStatus.INACTIVE).length,
      occupiedCount: stalls.filter((s) => s.status === StallStatus.OCCUPIED).length,
    }));
  }

  async updateZone(id: string, dto: UpdateZoneDto, user: CurrentUserPayload) {
    const zone = await this.findZoneOrThrow(id);
    if (dto.name && dto.name.toLowerCase() !== zone.name.toLowerCase()) {
      await this.assertZoneNameFree(dto.name, id);
    }
    const used = await this.prisma.stall.aggregate({
      where: { zoneId: id },
      _max: { row: true, col: true },
    });
    const maxRow = used._max.row ?? 0;
    const maxCol = used._max.col ?? 0;
    assertGridSize(dto.rows ?? zone.rows, dto.cols ?? zone.cols);
    if (dto.rows !== undefined && dto.rows < maxRow) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ZONE_ROWS_TOO_SMALL',
        `Số hàng không được nhỏ hơn ${maxRow} vì đã có ô chuồng ở hàng ${maxRow}.`,
        { min: maxRow },
      );
    }
    if (dto.cols !== undefined && dto.cols < maxCol) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ZONE_COLS_TOO_SMALL',
        `Số cột không được nhỏ hơn ${maxCol} vì đã có ô chuồng ở cột ${maxCol}.`,
        { min: maxCol },
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      const z = await tx.stallZone.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.rows !== undefined && { rows: dto.rows }),
          ...(dto.cols !== undefined && { cols: dto.cols }),
          ...(dto.description !== undefined && { description: dto.description || null }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        },
      });
      if (z.name !== zone.name) {
        await tx.stall.updateMany({ where: { zoneId: id }, data: { zone: z.name } });
      }
      return z;
    });
    await this.auditService.record(
      this.actor(user),
      'UPDATE_STALL_ZONE',
      `Updated stall zone ${zone.code}`,
      id,
      {
        entityName: 'StallZone',
        oldValues: zone,
        newValues: updated,
      },
    );
    return updated;
  }

  /** BTN-1.32: Ngừng dùng khu bị chặn khi khu còn ngựa. */
  async setZoneStatus(id: string, dto: SetZoneStatusDto, user: CurrentUserPayload) {
    const zone = await this.findZoneOrThrow(id);
    if (!dto.isActive) {
      const horses = await this.prisma.stallAllocation.count({
        where: { isActive: true, stall: { zoneId: id } },
      });
      if (horses > 0) {
        throw apiError(
          HttpStatus.CONFLICT,
          'ZONE_HAS_HORSES',
          `Khu còn ${horses} ngựa. Vui lòng chuyển hết ngựa trước.`,
          { count: horses },
        );
      }
    }
    const updated = await this.prisma.stallZone.update({
      where: { id },
      data: { isActive: dto.isActive },
    });
    await this.auditService.record(
      this.actor(user),
      dto.isActive ? 'ACTIVATE_STALL_ZONE' : 'DEACTIVATE_STALL_ZONE',
      `${dto.isActive ? 'Activated' : 'Deactivated'} stall zone ${zone.code}`,
      id,
      {
        entityName: 'StallZone',
        oldValues: { isActive: zone.isActive },
        newValues: { isActive: dto.isActive },
      },
    );
    return updated;
  }

  // ------------------------------------------------------------------ Ô chuồng

  /**
   * Danh sách ô. Mặc định bỏ ô Ngừng dùng (sơ đồ SC-1.04 không hiện); SC-1.07 truyền includeInactive=true.
   */
  async findAll(
    query: {
      zone?: string;
      zoneId?: string;
      status?: string;
      search?: string;
      includeInactive?: string;
    },
    user?: CurrentUserPayload,
  ) {
    await this.ensureZones();
    const where: Prisma.StallWhereInput = {};
    if (query.zoneId) where.zoneId = query.zoneId;
    if (query.zone) where.zone = query.zone;
    if (query.status && (Object.values(StallStatus) as string[]).includes(query.status)) {
      where.status = query.status as StallStatus;
    } else if (query.includeInactive !== 'true') {
      where.status = { not: StallStatus.INACTIVE };
    }
    const term = query.search?.trim();
    if (term) {
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { zone: { contains: term, mode: 'insensitive' } },
        {
          allocations: {
            some: {
              isActive: true,
              horse: {
                OR: [
                  { name: { contains: term, mode: 'insensitive' } },
                  { horseCode: { contains: term, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
      ];
    }
    const stalls = await this.prisma.stall.findMany({
      where,
      include: STALL_INCLUDE,
      orderBy: [{ zone: 'asc' }, { row: 'asc' }, { col: 'asc' }, { code: 'asc' }],
    });

    // CL-1.07: Thông tin chủ sở hữu (owner PII) chỉ hiển thị cho CLUB_MANAGER và HEAD_TRAINER.
    // Ẩn hoàn toàn đối với VETERINARIAN và GROOM.
    const canViewOwner = user?.role === Role.CLUB_MANAGER || user?.role === Role.HEAD_TRAINER;

    if (!canViewOwner) {
      for (const stall of stalls) {
        if (stall.allocations) {
          for (const alloc of stall.allocations) {
            if (alloc.horse) {
              (alloc.horse as any).owner = null;
            }
          }
        }
      }
    }

    return stalls;
  }

  async update(id: string, dto: UpdateStallDto, user: CurrentUserPayload) {
    return this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      await tx.$queryRaw`SELECT "id" FROM "Stall" WHERE "id" = ${id} FOR UPDATE`;
      const stall = await this.findStallOrThrow(id, tx);
      if (dto.code && dto.code !== stall.code) await this.assertStallCodeFree(dto.code, tx);
      const row = dto.row ?? stall.row;
      const col = dto.col ?? stall.col;
      if (stall.zoneRef && row != null && col != null && (row !== stall.row || col !== stall.col)) {
        await this.assertPositionFree(stall.zoneRef, row, col, id, tx);
      }
      const status = dto.status ? this.nextStatus(stall, dto.status) : undefined;

      const updated = await tx.stall.update({
        where: { id },
        data: {
          ...(dto.code && { code: dto.code }),
          ...(dto.row !== undefined && { row: dto.row }),
          ...(dto.col !== undefined && { col: dto.col }),
          ...(status && { status }),
          ...(dto.notes !== undefined && { notes: dto.notes || null }),
        },
        include: STALL_INCLUDE,
      });
      await this.auditService.record(
        this.actor(user),
        'UPDATE_STALL',
        `Updated stall ${stall.code}`,
        id,
        {
          entityName: 'Stall',
          oldValues: {
            code: stall.code,
            row: stall.row,
            col: stall.col,
            status: stall.status,
            notes: stall.notes,
          },
          newValues: {
            code: updated.code,
            row: updated.row,
            col: updated.col,
            status: updated.status,
            notes: updated.notes,
          },
        },
        tx,
      );
      return updated;
    });
  }

  /** BTN-1.35 Đổi trạng thái ô: Hoạt động / Bảo trì / Ngừng dùng. */
  async setStatus(id: string, dto: SetStallStatusDto, user: CurrentUserPayload) {
    // Mở lại ô mà không ghi chú thì xóa lý do bảo trì cũ; các trường hợp khác giữ ghi chú khi bỏ trống.
    const notes = dto.notes || (dto.status === 'AVAILABLE' ? '' : undefined);
    return this.update(id, { status: dto.status, ...(notes !== undefined && { notes }) }, user);
  }

  /** "Hoạt động" giữ OCCUPIED nếu ô đang có ngựa; ô có ngựa không được Bảo trì / Ngừng dùng. */
  private nextStatus(
    stall: { code: string; status: StallStatus; allocations: { horse: { name: string } }[] },
    wanted: SettableStallStatus,
  ): StallStatus {
    const occupant = stall.allocations[0]?.horse;
    if (occupant) {
      if (wanted !== 'AVAILABLE') {
        throw apiError(
          HttpStatus.CONFLICT,
          'STALL_OCCUPIED',
          `Ô chuồng đang có ngựa ${occupant.name}. Vui lòng chuyển ngựa trước.`,
          { horseName: occupant.name },
        );
      }
      return StallStatus.OCCUPIED;
    }
    return wanted as StallStatus;
  }

  // ------------------------------------------------------------------ Gán / chuyển / trả ô

  /** Ô nhận ngựa phải đang Hoạt động, còn trống, thuộc khu đang dùng. Gọi sau khi đã khóa dòng ô. */
  private async assertStallReady(tx: Tx, stallId: string) {
    const stall = await tx.stall.findUnique({ where: { id: stallId }, include: STALL_INCLUDE });
    if (!stall) throw apiError(HttpStatus.NOT_FOUND, 'STALL_NOT_FOUND', 'Không tìm thấy ô chuồng.');
    const occupant = stall.allocations[0]?.horse;
    if (occupant) {
      throw apiError(
        HttpStatus.CONFLICT,
        'STALL_OCCUPIED',
        `Ô chuồng ${stall.code} đang có ngựa ${occupant.name}.`,
        { stallCode: stall.code, horseName: occupant.name },
      );
    }
    if (
      stall.status === StallStatus.MAINTENANCE ||
      stall.status === StallStatus.INACTIVE ||
      stall.zoneRef?.isActive === false
    ) {
      throw apiError(
        HttpStatus.CONFLICT,
        'STALL_UNAVAILABLE',
        `Ô chuồng ${stall.code} đang bảo trì hoặc ngừng sử dụng.`,
        { stallCode: stall.code },
      );
    }
    return stall;
  }

  private async assertGroom(
    tx: Tx,
    zoneId: string | null,
    groomId?: string,
    allocationIdToExclude?: string,
  ) {
    if (!groomId) return;
    await assertPrimaryGroom(tx, zoneId, groomId, allocationIdToExclude);
  }

  async assignHorse(stallId: string, dto: AssignHorseDto, user: CurrentUserPayload) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      // Khóa dòng ô và dòng ngựa: 2 người gán cùng lúc thì người sau chờ và thấy ô đã có ngựa.
      await tx.$queryRaw`SELECT "id" FROM "Stall" WHERE "id" = ${stallId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${dto.horseId} FOR UPDATE`;
      const stall = await this.assertStallReady(tx, stallId);

      const horse = await tx.horse.findUnique({
        where: { id: dto.horseId, deletedAt: null },
        include: {
          stallAllocations: { where: { isActive: true }, include: { stall: true } },
          trainingPlans: LIVE_TRAINERS,
        },
      });
      if (!horse)
        throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Không tìm thấy hồ sơ ngựa.');
      if (horse.status === HorseStatus.RETIRED) {
        throw apiError(HttpStatus.BAD_REQUEST, 'HORSE_RETIRED', 'Ngựa đã ngừng quản lý.');
      }
      if (horse.status === HorseStatus.PENDING_ADMISSION)
        throw apiError(
          HttpStatus.CONFLICT,
          'HORSE_ADMISSION_REQUIRED',
          'Ngựa chưa được duyệt tiếp nhận. Hãy bố trí ô chuồng và Groom tại hồ sơ thẩm định.',
        );
      const current = horse.stallAllocations[0];
      if (current) {
        throw apiError(
          HttpStatus.CONFLICT,
          'HORSE_HAS_STALL',
          `Ngựa đang ở ô chuồng ${current.stall.code}. Vui lòng dùng chức năng Chuyển ô chuồng.`,
          { stallCode: current.stall.code },
        );
      }
      if (!dto.assignedGroomUserId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'GROOM_REQUIRED_FOR_STALL_ALLOCATION',
          'Bắt buộc phải phân công Groom phụ trách khi xếp ngựa vào ô chuồng.',
        );
      }
      await this.assertGroom(tx, stall.zoneId, dto.assignedGroomUserId);
      await assertTrainerZone(
        tx,
        horse.id,
        stall.zoneId,
        horse.trainingPlans.map((plan) => plan.trainerUserId),
      );

      const allocation = await tx.stallAllocation.create({
        data: {
          stallId,
          horseId: dto.horseId,
          assignedGroomUserId: dto.assignedGroomUserId,
          isActive: true,
        },
      });
      await tx.stall.update({ where: { id: stallId }, data: { status: StallStatus.OCCUPIED } });

      await this.auditService.record(
        this.actor(user),
        'ASSIGN_HORSE',
        `Assigned horse ${horse.name} to stall ${stall.code}`,
        allocation.id,
        { entityName: 'StallAllocation', newValues: { ...allocation, notes: dto.notes } },
        tx,
      );
      return { ...allocation, stallCode: stall.code, horseName: horse.name };
    });
    const notified = await this.alertGroomAssignment(result.id);
    return { ...result, assignmentNotificationFailed: !notified };
  }

  async transferHorse(allocationId: string, dto: TransferHorseDto, user: CurrentUserPayload) {
    const { handover, ...result } = await this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      await tx.$queryRaw`SELECT "id" FROM "StallAllocation" WHERE "id" = ${allocationId} FOR UPDATE`;
      const old = await tx.stallAllocation.findUnique({
        where: { id: allocationId },
        include: { stall: true, horse: { include: { trainingPlans: LIVE_TRAINERS } } },
      });
      if (!old || !old.isActive) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ALLOCATION_NOT_FOUND',
          'Ngựa không còn ở ô chuồng này. Vui lòng tải lại.',
        );
      }
      if (dto.newStallId === old.stallId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'SAME_STALL',
          'Vui lòng chọn ô chuồng khác ô hiện tại.',
        );
      }
      await tx.$queryRaw`SELECT "id" FROM "Stall" WHERE "id" = ${dto.newStallId} FOR UPDATE`;
      const target = await this.assertStallReady(tx, dto.newStallId);
      const sameZone = target.zoneId === old.stall.zoneId;
      const primaryId = dto.assignedGroomUserId ?? (sameZone ? old.assignedGroomUserId : null);
      if (!primaryId || !dto.receivingGroomUserId)
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'GROOM_REQUIRED',
          'Chọn Groom chính và người đang trực nhận bàn giao tại khu mới.',
        );
      if (!sameZone) {
        await assertTrainerZone(
          tx,
          old.horseId,
          target.zoneId,
          old.horse.trainingPlans.map((plan) => plan.trainerUserId),
        );
      }
      await assertPrimaryGroom(tx, target.zoneId, primaryId, old.id);
      const receiver = await assertReceivingGroom(
        tx,
        target.zoneId!,
        dto.receivingGroomUserId,
        old.horseId,
      );

      const now = effectiveNow();
      await tx.stallAllocation.update({
        where: { id: allocationId },
        data: { isActive: false, endDate: now },
      });
      await tx.stall.update({
        where: { id: old.stallId },
        data: { status: StallStatus.AVAILABLE },
      });
      const created = await tx.stallAllocation.create({
        data: {
          stallId: dto.newStallId,
          horseId: old.horseId,
          assignedGroomUserId: primaryId,
          startDate: now,
          isActive: true,
        },
      });
      await tx.stall.update({
        where: { id: dto.newStallId },
        data: { status: StallStatus.OCCUPIED },
      });

      await this.auditService.record(
        this.actor(user),
        'TRANSFER_HORSE',
        `Moved horse ${old.horse.name} from stall ${old.stall.code} to ${target.code}`,
        created.id,
        {
          entityName: 'StallAllocation',
          oldValues: { stallId: old.stallId, stallCode: old.stall.code },
          newValues: { stallId: target.id, stallCode: target.code, notes: dto.notes },
        },
        tx,
      );
      const date = receiver.date;
      const { hour, minute } = clubTime(now);
      const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      await transferPendingCare(
        tx,
        old.horseId,
        target.zoneId!,
        target.id,
        receiver.groomUserId,
        receiver.shiftId,
        receiver.date,
      );
      const handover = await tx.dailyCareTask.create({
        data: {
          taskCode: STALL_HANDOVER_PREFIX + created.id,
          taskType: 'OTHER',
          itemsSnapshotJson: {
            kind: 'STALL_HANDOVER',
            fromStallCode: old.stall.code,
            toStallCode: target.code,
          },
          title: 'Chuẩn bị và bàn giao ngựa chuyển chuồng',
          description: `Bàn giao ${old.horse.name} từ ô ${old.stall.code} sang ô ${target.code}.`,
          horseId: old.horseId,
          date,
          scheduledTime: time,
          stallId: target.id,
          stallZoneId: target.zoneId,
          shiftId: receiver.shiftId,
          assignedGroomUserId: receiver.groomUserId,
        },
      });
      return {
        ...created,
        fromStallCode: old.stall.code,
        stallCode: target.code,
        horseName: old.horse.name,
        handover,
      };
    });
    const careSyncFailed = await this.dailyTasks?.syncMedicalTasksForHorse(result.horseId).then(
      () => false,
      () => true,
    );
    const notificationSent = await this.notifications?.notifyUsers([handover.assignedGroomUserId], {
      type: 'STALL_HANDOVER_ASSIGNED',
      category: 'SYSTEM',
      title: 'Stall handover assigned',
      message: handover.description ?? handover.title,
      link: `/tasks?date=${handover.date.toISOString().slice(0, 10)}&highlight=${handover.id}`,
      dedupeKey: handover.taskCode ?? undefined,
      senderName: user.fullName,
    });
    await this.notifications?.notifyHorse(
      result.horseId,
      { roles: [Role.CLUB_MANAGER], owner: true, trainer: true, groom: true },
      {
        type: 'STALL_MOVED',
        category: 'SYSTEM',
        title: 'Đổi chuồng',
        message: handover.description ?? handover.title,
        link: '/stalls',
        dedupeKey: 'stall-moved:' + result.id,
        email: {
          eventCode: 'STALL_MOVED',
          body: {
            ...stallMove(
              { id: result.horseId, name: result.horseName },
              { code: result.fromStallCode },
              { code: result.stallCode },
              dto.notes ?? 'Điều phối chuồng',
              result.startDate,
              { name: user.fullName },
            ),
            refId: result.id,
          },
        },
      },
    );
    await this.notifications?.notifyUsers([handover.assignedGroomUserId], {
      type: 'STALL_MOVED',
      category: 'SYSTEM',
      title: 'Bàn giao chuyển chuồng',
      message: handover.description ?? handover.title,
      link: '/tasks',
      dedupeKey: 'stall-moved-source:' + result.id,
      email: {
        eventCode: 'STALL_MOVED',
        body: {
          ...stallMove(
            { id: result.horseId, name: result.horseName },
            { code: result.fromStallCode },
            { code: result.stallCode },
            dto.notes ?? 'Điều phối chuồng',
            result.startDate,
            { name: user.fullName },
          ),
          refId: result.id,
        },
      },
    });
    return {
      ...result,
      assignmentNotificationFailed: !(await this.alertGroomAssignment(result.id)),
      handoverTaskId: handover.id,
      handoverUnassigned: !handover.assignedGroomUserId,
      careSyncFailed,
      notificationFailed: notificationSent === false,
    };
  }

  async returnStall(allocationId: string, dto: ReturnStallDto, user: CurrentUserPayload) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      await tx.$queryRaw`SELECT "id" FROM "StallAllocation" WHERE "id" = ${allocationId} FOR UPDATE`;
      const old = await tx.stallAllocation.findUnique({
        where: { id: allocationId },
        include: { stall: true, horse: true },
      });
      if (!old || !old.isActive) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ALLOCATION_NOT_FOUND',
          'Ngựa không còn ở ô chuồng này. Vui lòng tải lại.',
        );
      }
      if (old.horse.isDebtImpounded) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'DEBT_IMPOUNDED',
          `Ngựa ${old.horse.name} đang bị lưu giữ do nợ phí. Không thể xuất chuồng / trả ô chuồng. Vui lòng chuyển sang Khu Lưu giữ nếu cần giải phóng ô chuồng hiện tại.`,
        );
      }
      const sourceGroomIds = await zoneGroomIds(tx, old.stall.zoneId);
      await tx.stallAllocation.update({
        where: { id: allocationId },
        data: { isActive: false, endDate: effectiveNow() },
      });
      await tx.stall.update({
        where: { id: old.stallId },
        data: { status: StallStatus.AVAILABLE },
      });

      await this.auditService.record(
        this.actor(user),
        'RETURN_STALL',
        `Horse ${old.horse.name} left stall ${old.stall.code}`,
        allocationId,
        {
          entityName: 'StallAllocation',
          oldValues: { isActive: true },
          newValues: { isActive: false, notes: dto?.notes },
        },
        tx,
      );
      return {
        success: true,
        stallCode: old.stall.code,
        horseName: old.horse.name,
        horseId: old.horseId,
        sourceGroomIds,
      };
    });
    await this.notifications?.notifyHorse(
      result.horseId,
      { roles: [Role.CLUB_MANAGER], owner: true, trainer: true },
      {
        type: 'STALL_RETURNED',
        category: 'SYSTEM',
        title: 'Trả ô chuồng',
        message: result.horseName + ' đã rời ô ' + result.stallCode,
        link: '/stalls',
        dedupeKey: 'stall-returned:' + allocationId,
        email: {
          eventCode: 'STALL_RETURNED',
          body: {
            ...stallMove(
              { id: result.horseId, name: result.horseName },
              { code: result.stallCode },
              { code: 'Đã trả ô' },
              dto.notes ?? 'Trả ô chuồng',
              effectiveNow(),
              { name: user.fullName },
            ),
            refId: allocationId,
          },
        },
      },
    );
    await this.notifications?.notifyUsers(result.sourceGroomIds, {
      type: 'STALL_RETURNED',
      category: 'SYSTEM',
      title: 'Trả ô chuồng',
      message: result.horseName + ' đã rời ô ' + result.stallCode,
      link: '/stalls',
      dedupeKey: 'stall-returned:' + allocationId,
      email: {
        eventCode: 'STALL_RETURNED',
        body: {
          ...stallMove(
            { id: result.horseId, name: result.horseName },
            { code: result.stallCode },
            { code: 'Đã trả ô' },
            dto.notes ?? 'Trả ô chuồng',
            effectiveNow(),
            { name: user.fullName },
          ),
          refId: allocationId,
        },
      },
    });
    return { success: result.success, stallCode: result.stallCode, horseName: result.horseName };
  }

  /** Groom đang hoạt động để chọn khi gán ô (DL-1.02), kèm số ngựa đang phụ trách. */
  async listGrooms() {
    const grooms = await this.prisma.user.findMany({
      where: { role: Role.GROOM, status: UserStatus.ACTIVE },
      select: {
        id: true,
        fullName: true,
        email: true,
        _count: { select: { stallAllocations: { where: { isActive: true } } } },
      },
      orderBy: { fullName: 'asc' },
    });
    return grooms.map(({ _count, ...g }) => ({ ...g, horseCount: _count.stallAllocations }));
  }

  // ------------------------------------------------------------------ Kiểm tra chung

  private async findZoneOrThrow(id: string) {
    const zone = await this.prisma.stallZone.findUnique({ where: { id } });
    if (!zone) throw apiError(HttpStatus.NOT_FOUND, 'ZONE_NOT_FOUND', 'Không tìm thấy khu chuồng.');
    return zone;
  }

  private async findStallOrThrow(id: string, tx: Tx) {
    const stall = await tx.stall.findUnique({ where: { id }, include: STALL_INCLUDE });
    if (!stall) throw apiError(HttpStatus.NOT_FOUND, 'STALL_NOT_FOUND', 'Không tìm thấy ô chuồng.');
    return stall;
  }

  private async assertZoneNameFree(name: string, exceptId: string) {
    if (
      await this.prisma.stallZone.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, id: { not: exceptId } },
      })
    ) {
      throw apiError(HttpStatus.CONFLICT, 'DUPLICATE_ZONE_NAME', 'Tên khu đã tồn tại.');
    }
  }

  private async assertStallCodeFree(code: string, tx: Tx = this.prisma) {
    if (await tx.stall.findUnique({ where: { code } })) {
      throw apiError(HttpStatus.CONFLICT, 'DUPLICATE_STALL_CODE', 'Mã ô đã tồn tại.');
    }
  }

  private async assertPositionFree(
    zone: { id: string; rows: number; cols: number },
    row: number,
    col: number,
    exceptId?: string,
    tx: Tx = this.prisma,
  ) {
    if (row > zone.rows) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ROW_OUT_OF_RANGE',
        `Hàng phải từ 1 đến ${zone.rows}.`,
        {
          max: zone.rows,
        },
      );
    }
    if (col > zone.cols) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'COL_OUT_OF_RANGE',
        `Cột phải từ 1 đến ${zone.cols}.`,
        {
          max: zone.cols,
        },
      );
    }
    const other = await tx.stall.findFirst({
      where: { zoneId: zone.id, row, col, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (other) {
      throw apiError(
        HttpStatus.CONFLICT,
        'POSITION_TAKEN',
        `Vị trí Hàng ${row} – Cột ${col} đã có ô ${other.code}.`,
        { stallCode: other.code },
      );
    }
  }
}
