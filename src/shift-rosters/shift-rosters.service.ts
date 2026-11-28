import { effectiveNow } from '../common/utils/demo-clock';
import { assertRosterSlot } from './roster-validation';
import { lockCareAssignments } from '../stalls/groom-care.rules';
import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { apiError } from '../common/exceptions/api-error';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { DailyTasksService } from '../daily-tasks/daily-tasks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rosterDay, shiftInterval } from './groom-zones';
import {
  AssignShiftRosterDto,
  CopyWeekRosterDto,
  QueryShiftRosterDto,
  QueryCareTeamDto,
  RequestShiftSwapDto,
} from './dto/shift-roster.dto';

function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return date;
}

function getMondayOfDate(d: Date): Date {
  const date = new Date(d);
  const day = date.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

@Injectable()
export class ShiftRostersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Optional() private readonly dailyTasks?: DailyTasksService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async careTeam(query: QueryCareTeamDto, actor: CurrentUserPayload) {
    if (actor.role !== Role.HEAD_TRAINER)
      throw apiError(HttpStatus.FORBIDDEN, 'TRAINER_REQUIRED', 'Trainer scope required.');
    const start = query.startDate ? parseDateOnly(query.startDate) : getMondayOfDate(rosterDay());
    const end = query.endDate
      ? parseDateOnly(query.endDate)
      : new Date(start.getTime() + 6 * 86400000);
    if (
      !Number.isFinite(+start) ||
      !Number.isFinite(+end) ||
      end < start ||
      +end - +start > 30 * 86400000
    )
      throw apiError(HttpStatus.BAD_REQUEST, 'INVALID_ROSTER_RANGE', 'Select at most 31 days.');
    const plans = await this.prisma.trainingPlan.findMany({
      where: {
        trainerUserId: actor.userId,
        status: 'ACTIVE',
        horse: { deletedAt: null, status: { not: 'RETIRED' } },
      },
      select: {
        horseId: true,
        horse: {
          select: {
            id: true,
            name: true,
            stallAllocations: {
              where: { isActive: true },
              select: { stall: { select: { zoneId: true } } },
            },
          },
        },
      },
    });
    const horseIds = [...new Set(plans.map((plan) => plan.horseId))];
    const zoneIds = [
      ...new Set(
        plans.flatMap((plan) =>
          plan.horse.stallAllocations.map((a) => a.stall.zoneId).filter((id): id is string => !!id),
        ),
      ),
    ];
    const groomRosters =
      query.scope === 'club' || zoneIds.length
        ? await this.prisma.shiftRoster.findMany({
            where: {
              date: { gte: start, lte: end },
              ...(query.scope === 'club' ? {} : { zoneId: { in: zoneIds } }),
            },
            include: {
              shift: true,
              zone: true,
              groom: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  phoneNumber: true,
                  role: true,
                  status: true,
                },
              },
            },
            orderBy: [{ date: 'asc' }, { shiftId: 'asc' }, { id: 'asc' }],
          })
        : [];
    const records = horseIds.length
      ? await this.prisma.medicalRecord.findMany({
          where: {
            horseId: { in: horseIds },
            status: 'OPEN',
            veterinarian: { role: 'VETERINARIAN', status: 'ACTIVE' },
          },
          select: {
            horse: { select: { id: true, name: true } },
            veterinarian: { select: { id: true, fullName: true } },
          },
        })
      : [];
    const vets = new Map<
      string,
      { id: string; fullName: string; horses: Array<{ id: string; name: string }> }
    >();
    for (const record of records) {
      const current = vets.get(record.veterinarian.id) ?? { ...record.veterinarian, horses: [] };
      if (!current.horses.some((h) => h.id === record.horse.id)) current.horses.push(record.horse);
      vets.set(current.id, current);
    }
    return {
      groomRosters,
      responsibleVeterinarians: [...vets.values()].sort((a, b) =>
        a.fullName.localeCompare(b.fullName),
      ),
    };
  }

  private async swappableRoster(
    id: string,
    actor: CurrentUserPayload,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    if (actor.role !== Role.GROOM)
      throw apiError(
        HttpStatus.FORBIDDEN,
        'GROOM_REQUIRED',
        'Chỉ nhân viên chăm sóc được xin đổi ca.',
      );
    const roster = await db.shiftRoster.findUnique({
      where: { id },
      include: { shift: true, zone: true },
    });
    if (!roster)
      throw apiError(HttpStatus.NOT_FOUND, 'ROSTER_NOT_FOUND', 'Bản ghi phân ca không tồn tại.');
    if (roster.groomUserId !== actor.userId)
      throw apiError(HttpStatus.FORBIDDEN, 'ROSTER_NOT_OWNED', 'Chỉ được xin đổi ca của mình.');
    if (
      !roster.shift.isActive ||
      !roster.zone.isActive ||
      shiftInterval(roster.date, roster.shift).start <= effectiveNow().getTime()
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'SHIFT_NOT_AVAILABLE',
        'Ca đã bắt đầu hoặc ngừng hoạt động.',
      );
    }
    return roster;
  }

  private async availableGrooms(
    roster: Awaited<ReturnType<ShiftRostersService['swappableRoster']>>,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const [grooms, assignments] = await Promise.all([
      db.user.findMany({
        where: { role: Role.GROOM, status: UserStatus.ACTIVE, id: { not: roster.groomUserId } },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
      db.shiftRoster.findMany({
        where: {
          date: {
            gte: new Date(roster.date.getTime() - 86400000),
            lte: new Date(roster.date.getTime() + 86400000),
          },
          shift: { isActive: true },
        },
        include: { shift: true },
      }),
    ]);
    const requested = shiftInterval(roster.date, roster.shift);
    const busy = new Set(
      assignments
        .filter((row) => {
          const assigned = shiftInterval(row.date, row.shift);
          return assigned.start < requested.end && requested.start < assigned.end;
        })
        .map((row) => row.groomUserId),
    );
    return grooms
      .filter((groom) => !busy.has(groom.id))
      .map(({ id, fullName }) => ({ id, fullName }));
  }

  async getSwapCandidates(id: string, actor: CurrentUserPayload) {
    return this.availableGrooms(await this.swappableRoster(id, actor));
  }

  async requestSwap(id: string, dto: RequestShiftSwapDto, actor: CurrentUserPayload) {
    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (!reason || reason.length > 1000 || !!dto.targetRosterId === !!dto.targetGroomUserId)
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_SWAP_REQUEST',
        'Select exactly one target and enter a reason.',
      );
    if (actor.role !== Role.GROOM)
      throw apiError(HttpStatus.FORBIDDEN, 'GROOM_REQUIRED', 'Only Groom can request a swap.');
    const proposal = await this.prisma.$transaction(async (tx) => {
      const ids = [id, ...(dto.targetRosterId ? [dto.targetRosterId] : [])].sort();
      await tx.$queryRaw`SELECT "id" FROM "ShiftRoster" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
      const roster = await this.swappableRoster(id, actor, tx);
      let target: { id: string; fullName: string };
      if (dto.targetRosterId) {
        const other = await tx.shiftRoster.findUnique({
          where: { id: dto.targetRosterId },
          include: { shift: true, zone: true, groom: true },
        });
        if (
          !other ||
          other.id === id ||
          other.groomUserId === actor.userId ||
          !other.shift.isActive ||
          !other.zone.isActive ||
          other.groom.role !== Role.GROOM ||
          other.groom.status !== UserStatus.ACTIVE ||
          shiftInterval(other.date, other.shift).start <= effectiveNow().getTime()
        )
          throw apiError(
            HttpStatus.CONFLICT,
            'SWAP_TARGET_UNAVAILABLE',
            'The colleague shift is no longer available.',
          );
        for (const [groomUserId, slot] of [
          [actor.userId, other],
          [other.groomUserId, roster],
        ] as const) {
          const assignments = await tx.shiftRoster.findMany({
            where: {
              groomUserId,
              id: { notIn: ids },
              date: {
                gte: new Date(slot.date.getTime() - 86400000),
                lte: new Date(slot.date.getTime() + 86400000),
              },
              shift: { isActive: true },
            },
            include: { shift: true },
          });
          const range = shiftInterval(slot.date, slot.shift);
          if (
            assignments.some((row) => {
              const busy = shiftInterval(row.date, row.shift);
              return busy.start < range.end && range.start < busy.end;
            })
          )
            throw apiError(
              HttpStatus.CONFLICT,
              'SWAP_TARGET_UNAVAILABLE',
              'Proposed exchange overlaps another shift.',
            );
        }
        target = { id: other.groomUserId, fullName: other.groom.fullName };
      } else {
        const candidates = await this.availableGrooms(roster, tx);
        const candidate = candidates.find((person) => person.id === dto.targetGroomUserId);
        if (!candidate)
          throw apiError(
            HttpStatus.CONFLICT,
            'SWAP_TARGET_UNAVAILABLE',
            'Colleague is not active or is busy.',
          );
        target = candidate;
      }
      const date = roster.date.toISOString().slice(0, 10);
      await this.auditService.record(
        { id: actor.userId, name: actor.fullName },
        'SHIFT_SWAP_REQUESTED',
        `Xin đổi ca ${roster.shift.name} ngày ${date} với ${target.fullName}: ${reason}`,
        id,
        {
          entityName: 'ShiftRoster',
          newValues: {
            sourceGroomUserId: actor.userId,
            targetGroomUserId: target.id,
            targetRosterId: dto.targetRosterId ?? null,
            date,
            shiftId: roster.shiftId,
            zoneId: roster.zoneId,
            reason,
          },
        },
        tx,
      );
      return { roster, target, date };
    });
    const { roster, target, date } = proposal;
    await this.notifications?.notifyRoles([Role.CLUB_MANAGER], {
      type: 'SHIFT_SWAP_REQUESTED',
      category: 'SYSTEM',
      title: 'Yêu cầu đổi ca cần xem xét',
      message: `${actor.fullName} đề nghị đổi ca ${roster.shift.name} ngày ${date} với ${target.fullName}. ${reason}. Chưa thay đổi phân công.`,
      link: '/stable/shifts',
      senderName: actor.fullName,
      dedupeKey: `shift-swap:${id}:${actor.userId}:${dto.targetRosterId ?? target.id}:${date}`,
      params: {
        rosterId: id,
        targetGroomUserId: target.id,
        targetRosterId: dto.targetRosterId ?? '',
        date,
        reason,
      },
    });
    return { requested: true };
  }

  /**
   * #2: Tổng quan ca trực trong ngày cho Club Manager: mỗi khu × ca có ai trực,
   * bao nhiêu ngựa, việc chăm sóc xong bao nhiêu và còn bao nhiêu sự cố chưa xử lý.
   */
  async overview(date?: string) {
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseDateOnly(date) : rosterDay();
    const [zones, shifts, rosters, horses, tasks, incidents] = await Promise.all([
      this.prisma.stallZone.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: { id: true, code: true, name: true },
      }),
      this.prisma.shiftCatalog.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { startTime: 'asc' }],
        select: { id: true, name: true, startTime: true, endTime: true },
      }),
      this.prisma.shiftRoster.findMany({
        where: { date: day },
        select: {
          zoneId: true,
          shiftId: true,
          groom: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        },
      }),
      this.prisma.stall.groupBy({
        by: ['zoneId'],
        where: { status: 'OCCUPIED' },
        _count: { _all: true },
      }),
      this.prisma.dailyCareTask.groupBy({
        by: ['stallZoneId', 'shiftId', 'isCompleted'],
        where: { date: day },
        _count: { _all: true },
      }),
      this.prisma.incidentReport.groupBy({
        by: ['stallZoneId'],
        where: { status: { in: ['REPORTED', 'UNDER_REVIEW'] } },
        _count: { _all: true },
      }),
    ]);
    const count = (rows: { _count: { _all: number } }[]) =>
      rows.reduce((sum, r) => sum + r._count._all, 0);
    return {
      date: day.toISOString().slice(0, 10),
      zones: zones.map((z) => ({
        ...z,
        horses: count(horses.filter((h) => h.zoneId === z.id)),
        openIncidents: count(incidents.filter((i) => i.stallZoneId === z.id)),
        shifts: shifts.map((s) => {
          const mine = tasks.filter((t) => t.stallZoneId === z.id && t.shiftId === s.id);
          return {
            ...s,
            grooms: rosters
              .filter((r) => r.zoneId === z.id && r.shiftId === s.id)
              .map((r) => r.groom),
            tasksDone: count(mine.filter((t) => t.isCompleted)),
            tasksTotal: count(mine),
          };
        }),
      })),
    };
  }

  /**
   * SC-4.01 Danh sách phân ca theo khoảng ngày và khu.
   */
  async findAll(query: QueryShiftRosterDto) {
    const where: Prisma.ShiftRosterWhereInput = {};

    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = parseDateOnly(query.startDate);
      if (query.endDate) where.date.lte = parseDateOnly(query.endDate);
    }

    if (query.zoneId) where.zoneId = query.zoneId;
    if (query.groomUserId) where.groomUserId = query.groomUserId;

    return this.prisma.shiftRoster.findMany({
      where,
      include: {
        shift: true,
        zone: true,
        groom: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            status: true,
            role: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: [{ date: 'asc' }, { shift: { sortOrder: 'asc' } }],
    });
  }

  /**
   * SC-4.01 / SC-4.05 View Mobile: Ca trực của tôi (Groom).
   */
  async getMyShifts(currentUser: CurrentUserPayload, query: QueryShiftRosterDto) {
    const where: Prisma.ShiftRosterWhereInput = {
      groomUserId: currentUser.userId,
    };

    if (query.zoneId) {
      where.zoneId = query.zoneId;
    }

    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = parseDateOnly(query.startDate);
      if (query.endDate) where.date.lte = parseDateOnly(query.endDate);
    }

    const rosters = await this.prisma.shiftRoster.findMany({
      where,
      include: {
        shift: true,
        zone: {
          include: {
            stalls: {
              where: { status: { not: 'INACTIVE' } },
              include: {
                allocations: {
                  where: { isActive: true },
                  include: {
                    horse: {
                      select: {
                        id: true,
                        name: true,
                        horseCode: true,
                        status: true,
                        isMedicalLocked: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ date: 'asc' }, { shift: { sortOrder: 'asc' } }],
    });

    const work = await this.prisma.dailyCareTask.findMany({
      where: {
        assignedGroomUserId: currentUser.userId,
        cancelledAt: null,
        date: where?.date as any,
      },
      select: { date: true, shiftId: true, horseId: true },
    });
    return rosters.map((r) => {
      const ids = new Set(
        work
          .filter((t) => t.shiftId === r.shiftId && t.date.getTime() === r.date.getTime())
          .map((t) => t.horseId),
      );
      const assignedHorses = r.zone.stalls.flatMap((s) =>
        s.allocations
          .filter((a) => ids.has(a.horseId))
          .map((a) => ({ ...a.horse, stallId: s.id, stallCode: s.code })),
      );

      return {
        id: r.id,
        date: r.date,
        shift: r.shift,
        zone: {
          id: r.zone.id,
          code: r.zone.code,
          name: r.zone.name,
        },
        notes: r.notes,
        dutyTypes: r.dutyTypes,
        assignedHorsesCount: assignedHorses.length,
        assignedHorses,
      };
    });
  }

  /**
   * BTN-4.04 / DL-4.01 Phân ca cho một ô (Ngày x Ca x Khu).
   */
  async assignSlot(dto: AssignShiftRosterDto, currentUser: CurrentUserPayload) {
    const shift = await this.prisma.shiftCatalog.findUnique({
      where: { id: dto.shiftId },
    });
    if (!shift || !shift.isActive) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'SHIFT_NOT_AVAILABLE',
        'Ca trực không tồn tại hoặc đã ngừng dùng.',
      );
    }

    const zone = await this.prisma.stallZone.findUnique({
      where: { id: dto.zoneId },
    });
    if (!zone || !zone.isActive) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'ZONE_NOT_AVAILABLE',
        'Khu chuồng không tồn tại hoặc đã ngừng dùng.',
      );
    }

    // Kiểm tra nhân viên Groom hợp lệ
    const uniqueGroomIds = Array.from(new Set(dto.groomUserIds));
    if (uniqueGroomIds.length > 0) {
      const grooms = await this.prisma.user.findMany({
        where: {
          id: { in: uniqueGroomIds },
          role: Role.GROOM,
          status: UserStatus.ACTIVE,
        },
      });

      if (grooms.length !== uniqueGroomIds.length) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_GROOMS_SELECTED',
          'Một hoặc nhiều nhân viên không hợp lệ hoặc không ở trạng thái hoạt động.',
        );
      }
    }

    // Tính toán các ngày cần phân công dựa trên applyScope
    const baseDate = parseDateOnly(dto.date);
    const targetDates: Date[] = [];

    const scope = dto.applyScope || 'ONLY_THIS_DAY';
    if (scope === 'ONLY_THIS_DAY') {
      targetDates.push(baseDate);
    } else if (scope === 'REST_OF_WEEK') {
      const currentDay = baseDate.getUTCDay(); // 0 is Sunday, 1 is Monday
      const daysToSunday = currentDay === 0 ? 0 : 7 - currentDay;
      for (let i = 0; i <= daysToSunday; i++) {
        const nextDate = new Date(baseDate);
        nextDate.setUTCDate(baseDate.getUTCDate() + i);
        targetDates.push(nextDate);
      }
    } else if (scope === 'SAME_DAY_4_WEEKS') {
      for (let w = 0; w < 4; w++) {
        const nextDate = new Date(baseDate);
        nextDate.setUTCDate(baseDate.getUTCDate() + w * 7);
        targetDates.push(nextDate);
      }
    }

    // Kiểm tra ràng buộc: trong 1 ca trực, 1 Groom chỉ được phân công làm việc tại 1 khu chuồng duy nhất
    if (uniqueGroomIds.length > 0) {
      const conflict = await this.prisma.shiftRoster.findFirst({
        where: {
          date: { in: targetDates },
          shiftId: dto.shiftId,
          zoneId: { not: dto.zoneId },
          groomUserId: { in: uniqueGroomIds },
        },
        include: {
          groom: { select: { fullName: true } },
          zone: { select: { name: true, code: true } },
          shift: { select: { name: true } },
        },
      });

      if (conflict) {
        const conflictDateStr = conflict.date.toISOString().slice(0, 10);
        throw apiError(
          HttpStatus.CONFLICT,
          'GROOM_ALREADY_ASSIGNED_IN_SHIFT',
          `Nhân viên ${conflict.groom?.fullName || 'Nhân viên chăm sóc'} đã được phân công trực tại ${conflict.zone.name} (${conflict.zone.code}) trong ${conflict.shift.name} ngày ${conflictDateStr}. Trong một ca trực, mỗi nhân viên chăm sóc chỉ được phân công trực tại 1 khu chuồng.`,
          {
            groomName: conflict.groom?.fullName,
            zoneName: conflict.zone.name,
            shiftName: conflict.shift.name,
            date: conflictDateStr,
          },
        );
      }
    }

    // Thực hiện trong transaction
    await this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      for (const tDate of targetDates) {
        await assertRosterSlot(tx, tDate, dto.shiftId, dto.zoneId, uniqueGroomIds);
        // Xóa phân công cũ của ô này (tDate, shiftId, zoneId)
        await tx.shiftRoster.deleteMany({
          where: {
            date: tDate,
            shiftId: dto.shiftId,
            zoneId: dto.zoneId,
          },
        });

        // Tạo mới phân công cho danh sách groom
        if (uniqueGroomIds.length > 0) {
          await tx.shiftRoster.createMany({
            data: uniqueGroomIds.map((gId) => ({
              date: tDate,
              shiftId: dto.shiftId,
              zoneId: dto.zoneId,
              groomUserId: gId,
              dutyTypes: dto.dutyTypes ?? ['CLEANING', 'HORSE_CARE'],
              notes: dto.notes?.trim() || null,
              createdById: currentUser.userId,
            })),
          });
        }
      }
    });

    await this.auditService.record(
      { id: currentUser.userId, name: currentUser.fullName },
      'SHIFT_ROSTER_ASSIGNED',
      `Phân ca trực ${shift.name} tại ${zone.name} ngày ${dto.date}`,
      null,
      {
        entityName: 'ShiftRoster',
        newValues: {
          date: dto.date,
          shiftCode: shift.code,
          zoneCode: zone.code,
          scope,
          groomCount: uniqueGroomIds.length,
        },
      },
    );

    if (this.dailyTasks?.syncTasksForDateZones) {
      await this.dailyTasks
        .syncTasksForDateZones(targetDates.map((date) => ({ date, zoneId: dto.zoneId })))
        .catch(() => {});
    }

    return {
      success: true,
      affectedDatesCount: targetDates.length,
      groomCount: uniqueGroomIds.length,
    };
  }

  /**
   * Xóa một dòng phân công.
   */
  async delete(id: string, currentUser: CurrentUserPayload) {
    const existing = await this.prisma.shiftRoster.findUnique({
      where: { id },
    });
    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'ROSTER_NOT_FOUND', 'Bản ghi phân ca không tồn tại.');
    }

    await this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      const current = await tx.shiftRoster.findUniqueOrThrow({ where: { id } });
      await assertRosterSlot(tx, current.date, current.shiftId, current.zoneId, []);
      await tx.shiftRoster.delete({ where: { id } });
    });

    await this.auditService.record(
      { id: currentUser.userId, name: currentUser.fullName },
      'SHIFT_ROSTER_REMOVED',
      `Xóa phân công ca trực ID ${id}`,
      id,
      { entityName: 'ShiftRoster' },
    );

    if (this.dailyTasks?.syncTasksForDateZones) {
      await this.dailyTasks
        .syncTasksForDateZones([{ date: existing.date, zoneId: existing.zoneId }])
        .catch(() => {});
    }

    return { success: true };
  }

  /**
   * BTN-4.05 / DL-4.02 Sao chép phân ca tuần.
   */
  async copyWeek(dto: CopyWeekRosterDto, currentUser: CurrentUserPayload) {
    const sourceMonday = parseDateOnly(dto.sourceWeekStart);
    const targetMonday = parseDateOnly(dto.targetWeekStart);

    // Không thể sao chép vào tuần đã qua
    const currentMonday = getMondayOfDate(effectiveNow());
    if (targetMonday < currentMonday) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'COPY_TARGET_WEEK_IN_PAST',
        'Không thể sao chép vào tuần đã qua.',
      );
    }

    const sourceSunday = new Date(sourceMonday);
    sourceSunday.setUTCDate(sourceMonday.getUTCDate() + 6);

    const targetSunday = new Date(targetMonday);
    targetSunday.setUTCDate(targetMonday.getUTCDate() + 6);

    // Lấy toàn bộ phân ca của tuần nguồn
    const sourceRosters = await this.prisma.shiftRoster.findMany({
      where: {
        date: {
          gte: sourceMonday,
          lte: sourceSunday,
        },
      },
    });

    if (sourceRosters.length === 0) {
      return { copiedCount: 0, skippedInactiveGrooms: 0 };
    }

    // Danh sách Groom ACTIVE hiện tại
    const activeGrooms = await this.prisma.user.findMany({
      where: {
        role: Role.GROOM,
        status: UserStatus.ACTIVE,
      },
      select: { id: true },
    });
    const activeGroomIds = new Set(activeGrooms.map((g) => g.id));

    let copiedCount = 0;
    let skippedInactiveGrooms = 0;

    const diffDays = Math.round(
      (targetMonday.getTime() - sourceMonday.getTime()) / (1000 * 60 * 60 * 24),
    );
    const syncTargets: Array<{ date: Date; zoneId?: string }> = [];

    await this.prisma.$transaction(async (tx) => {
      await lockCareAssignments(tx);
      if (dto.overwrite) {
        const rows = await tx.shiftRoster.findMany({
          where: { date: { gte: targetMonday, lte: targetSunday } },
        });
        for (const row of rows) await assertRosterSlot(tx, row.date, row.shiftId, row.zoneId, []);
      }
      // Nếu chọn ghi đè: xóa toàn bộ phân ca của tuần đích
      if (dto.overwrite) {
        await tx.shiftRoster.deleteMany({
          where: {
            date: {
              gte: targetMonday,
              lte: targetSunday,
            },
          },
        });
        for (let i = 0; i < 7; i++) {
          const d = new Date(targetMonday);
          d.setUTCDate(targetMonday.getUTCDate() + i);
          syncTargets.push({ date: d });
        }
      }

      for (const s of sourceRosters) {
        if (!activeGroomIds.has(s.groomUserId)) {
          skippedInactiveGrooms++;
          continue;
        }

        const newDate = new Date(s.date);
        newDate.setUTCDate(s.date.getUTCDate() + diffDays);

        const existing = await tx.shiftRoster.findFirst({
          where: { date: newDate, shiftId: s.shiftId, groomUserId: s.groomUserId },
          select: { zoneId: true },
        });
        if (existing?.zoneId === s.zoneId) continue;
        if (existing) {
          throw apiError(
            HttpStatus.CONFLICT,
            'GROOM_ALREADY_ASSIGNED_IN_SHIFT',
            'Không thể sao chép ca trực vì nhân viên đã được phân công ở khu chuồng khác trong cùng ca.',
          );
        }
        await assertRosterSlot(tx, newDate, s.shiftId, s.zoneId, [s.groomUserId]);
        if (!dto.overwrite) syncTargets.push({ date: newDate, zoneId: s.zoneId });

        await tx.shiftRoster.create({
          data: {
            date: newDate,
            shiftId: s.shiftId,
            zoneId: s.zoneId,
            groomUserId: s.groomUserId,
            notes: s.notes,
            dutyTypes: s.dutyTypes,
            createdById: currentUser.userId,
          },
        });
        copiedCount++;
      }
    });

    await this.auditService.record(
      { id: currentUser.userId, name: currentUser.fullName },
      'SHIFT_ROSTER_WEEK_COPIED',
      `Sao chép phân ca từ tuần ${dto.sourceWeekStart} sang tuần ${dto.targetWeekStart}`,
      null,
      {
        entityName: 'ShiftRoster',
        newValues: {
          sourceWeekStart: dto.sourceWeekStart,
          targetWeekStart: dto.targetWeekStart,
          copiedCount,
          skippedInactiveGrooms,
          overwrite: dto.overwrite,
        },
      },
    );

    if (syncTargets.length > 0 && this.dailyTasks?.syncTasksForDateZones) {
      await this.dailyTasks.syncTasksForDateZones(syncTargets).catch(() => {});
    }

    return {
      copiedCount,
      skippedInactiveGrooms,
    };
  }
}
