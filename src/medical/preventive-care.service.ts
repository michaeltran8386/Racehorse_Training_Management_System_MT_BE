import { HttpStatus, Injectable } from '@nestjs/common';
import { apiError } from '../common/exceptions/api-error';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { Role, HorseStatus, PreventiveType, PreventiveStatus } from '@prisma/client';
import {
  CreatePreventiveTypeCatalogDto,
  UpdatePreventiveTypeCatalogDto,
} from './dto/preventive-catalog.dto';
import {
  RecordPreventiveCareDto,
  SetupHorsePreventiveDto,
  PreventiveQueryDto,
  CreatePreventiveScheduleDto,
} from './dto/preventive-care.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MedicalAccessService } from './medical-access.service';

export const CLUB_OFFSET_MS = 7 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Chuẩn hóa các mốc ngày theo múi giờ CLB (Asia/Ho_Chi_Minh: UTC+7).
 * Lịch chăm sóc chỉ bị coi là quá hạn (OVERDUE) sau khi hết ngày hôm nay theo giờ CLB.
 */
export function getClubDateBounds(now: Date = new Date()) {
  const startOfTodayClub = new Date(
    Math.floor((now.getTime() + CLUB_OFFSET_MS) / DAY_MS) * DAY_MS - CLUB_OFFSET_MS,
  );
  const endOfTodayClub = new Date(startOfTodayClub.getTime() + DAY_MS - 1);
  const endOf7Days = new Date(endOfTodayClub.getTime() + 7 * DAY_MS);
  const endOf30Days = new Date(endOfTodayClub.getTime() + 30 * DAY_MS);

  return {
    startOfTodayClub,
    endOfTodayClub,
    endOf7Days,
    endOf30Days,
  };
}

/** P2-05: danh mục và lịch chăm sóc định kỳ — tiêm phòng, tẩy giun, móng (FR-3.13 → FR-3.16). */
@Injectable()
export class PreventiveCareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: MedicalAccessService,
  ) {}

  async getPreventiveCatalogs(query: { category?: PreventiveType; isActive?: string } = {}) {
    const where: any = {};
    if (query.category) where.category = query.category;
    if (query.isActive !== undefined) where.isActive = query.isActive === 'true';

    const catalogs = await this.prisma.preventiveTypeCatalog.findMany({
      where,
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
      include: {
        _count: {
          select: { schedules: true },
        },
      },
    });

    return catalogs.map((cat) => ({
      ...cat,
      monitoredHorsesCount: cat._count.schedules,
    }));
  }

  async createPreventiveCatalog(actor: CurrentUserPayload, dto: CreatePreventiveTypeCatalogDto) {
    this.access.assertVet(actor, 'create preventive care types');

    const codeUpper = dto.code.toUpperCase();
    const existingCode = await this.prisma.preventiveTypeCatalog.findUnique({
      where: { code: codeUpper },
    });
    if (existingCode) {
      throw apiError(HttpStatus.BAD_REQUEST, 'DUPLICATE_CODE', 'This type code already exists.');
    }

    const existingName = await this.prisma.preventiveTypeCatalog.findUnique({
      where: { name: dto.name },
    });
    if (existingName) {
      throw apiError(HttpStatus.BAD_REQUEST, 'DUPLICATE_NAME', 'This type name already exists.');
    }

    const noticeDays = dto.advanceNoticeDays || 7;
    if (noticeDays >= dto.intervalDays) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_NOTICE_DAYS',
        'The reminder days must be shorter than the repeat interval.',
      );
    }

    const catalog = await this.prisma.preventiveTypeCatalog.create({
      data: {
        code: codeUpper,
        name: dto.name,
        category: dto.category,
        intervalDays: dto.intervalDays,
        advanceNoticeDays: noticeDays,
        applyToNewHorses: dto.applyToNewHorses ?? true,
        description: dto.description || null,
        isActive: true,
      },
    });

    if (catalog.applyToNewHorses) {
      const activeHorses = await this.prisma.horse.findMany({
        where: { status: { not: HorseStatus.RETIRED }, deletedAt: null },
        select: { id: true, createdAt: true },
      });

      for (const horse of activeHorses) {
        const dueDate = new Date(horse.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        await this.prisma.preventiveSchedule
          .upsert({
            where: { id: `schedule-${horse.id}-${catalog.id}` },
            create: {
              id: `schedule-${horse.id}-${catalog.id}`,
              horseId: horse.id,
              typeCatalogId: catalog.id,
              scheduleType: catalog.category,
              dueDate,
              status: PreventiveStatus.PENDING,
            },
            update: {},
          })
          .catch(() => {});
      }
    }

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'CREATE_PREVENTIVE_CATALOG',
      `Preventive catalog ${codeUpper} created`,
      catalog.id,
      { entityName: 'PreventiveTypeCatalog' },
    );

    return catalog;
  }

  async updatePreventiveCatalog(
    id: string,
    actor: CurrentUserPayload,
    dto: UpdatePreventiveTypeCatalogDto,
  ) {
    this.access.assertVet(actor, 'edit preventive care types');

    const catalog = await this.prisma.preventiveTypeCatalog.findUnique({ where: { id } });
    if (!catalog)
      throw apiError(
        HttpStatus.NOT_FOUND,
        'PREVENTIVE_TYPE_NOT_FOUND',
        'Preventive care type not found.',
      );

    if (dto.name && dto.name !== catalog.name) {
      const existingName = await this.prisma.preventiveTypeCatalog.findUnique({
        where: { name: dto.name },
      });
      if (existingName)
        throw apiError(HttpStatus.BAD_REQUEST, 'DUPLICATE_NAME', 'This type name already exists.');
    }

    const newInterval = dto.intervalDays || catalog.intervalDays;
    const newNotice = dto.advanceNoticeDays || catalog.advanceNoticeDays;
    if (newNotice >= newInterval) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_NOTICE_DAYS',
        'The reminder days must be shorter than the repeat interval.',
      );
    }

    const updated = await this.prisma.preventiveTypeCatalog.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.intervalDays && { intervalDays: dto.intervalDays }),
        ...(dto.advanceNoticeDays && { advanceNoticeDays: dto.advanceNoticeDays }),
        ...(dto.applyToNewHorses !== undefined && { applyToNewHorses: dto.applyToNewHorses }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'UPDATE_PREVENTIVE_CATALOG',
      `Preventive catalog ${catalog.code} updated`,
      id,
      { entityName: 'PreventiveTypeCatalog' },
    );

    return updated;
  }

  async togglePreventiveCatalogStatus(id: string, actor: CurrentUserPayload) {
    this.access.assertVet(actor, 'change preventive care type status');

    const catalog = await this.prisma.preventiveTypeCatalog.findUnique({ where: { id } });
    if (!catalog)
      throw apiError(
        HttpStatus.NOT_FOUND,
        'PREVENTIVE_TYPE_NOT_FOUND',
        'Preventive care type not found.',
      );

    const updated = await this.prisma.preventiveTypeCatalog.update({
      where: { id },
      data: { isActive: !catalog.isActive },
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'TOGGLE_PREVENTIVE_CATALOG_STATUS',
      `Preventive catalog ${catalog.code} active status changed to ${updated.isActive}`,
      id,
      { entityName: 'PreventiveTypeCatalog' },
    );

    return {
      ...updated,
      message: updated.isActive
        ? `Đã kích hoạt lại loại chăm sóc '${catalog.name}'`
        : `Đã ngừng sử dụng loại chăm sóc '${catalog.name}'`,
    };
  }

  async getPreventiveSchedules(currentUser: CurrentUserPayload, query: PreventiveQueryDto) {
    const {
      horseId,
      category,
      typeCatalogId,
      status,
      zone,
      search,
      page = '1',
      limit = '10',
    } = query;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where: any = {};

    if (horseId) {
      await this.access.checkHorseAccess(horseId, currentUser);
      where.horseId = horseId;
    } else if (currentUser.role === Role.HORSE_OWNER) {
      where.horse = { ownerId: currentUser.userId };
    } else if (currentUser.role === Role.GROOM) {
      where.horse = {
        stallAllocations: {
          some: {
            assignedGroomUserId: currentUser.userId,
            isActive: true,
          },
        },
      };
    }

    const andConditions: any[] = [];

    if (typeCatalogId) {
      where.typeCatalogId = typeCatalogId;
    } else if (category) {
      andConditions.push({
        OR: [{ scheduleType: category }, { typeCatalog: { category } }],
      });
    }

    if (zone) {
      where.horse = {
        ...where.horse,
        stallAllocations: {
          some: {
            isActive: true,
            stall: { zone },
          },
        },
      };
    }

    if (search) {
      andConditions.push({
        OR: [
          { horse: { name: { contains: search, mode: 'insensitive' } } },
          { horse: { microchipRfid: { contains: search, mode: 'insensitive' } } },
          { typeCatalog: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    if (andConditions.length > 0) {
      where.AND = [...andConditions];
    }

    where.horse = {
      ...where.horse,
      status: { not: HorseStatus.RETIRED },
      deletedAt: null,
    };

    const baseWhere = { ...where };

    const now = new Date();
    const { startOfTodayClub, endOf7Days, endOf30Days } = getClubDateBounds(now);

    if (status) {
      if (status === 'OVERDUE') {
        where.dueDate = { lt: startOfTodayClub };
        where.status = { not: PreventiveStatus.COMPLETED };
      } else if (status === 'UPCOMING' || status === 'UPCOMING_7' || status === 'DUE_SOON') {
        where.dueDate = {
          gte: startOfTodayClub,
          lte: endOf7Days,
        };
        where.status = { not: PreventiveStatus.COMPLETED };
      } else if (status === 'UPCOMING_30') {
        where.dueDate = {
          gte: startOfTodayClub,
          lte: endOf30Days,
        };
        where.status = { not: PreventiveStatus.COMPLETED };
      } else if (status === 'COMPLETED') {
        where.status = PreventiveStatus.COMPLETED;
      } else if (status === 'UP_TO_DATE' || status === 'NORMAL') {
        where.status = { not: PreventiveStatus.COMPLETED };
        where.dueDate = { gt: endOf7Days };
        where.AND = [
          ...andConditions,
          { OR: [{ lastCompletedDate: { not: null } }, { completedDate: { not: null } }] },
        ];
      } else if (status === 'NODATA' || status === 'NO_DATA') {
        where.status = { not: PreventiveStatus.COMPLETED };
        where.dueDate = { gt: endOf7Days };
        where.lastCompletedDate = null;
        where.completedDate = null;
      }
    }

    const [
      total,
      totalCount,
      overdueCount,
      upcoming7DaysCount,
      upcoming30DaysCount,
      completedCount,
      noDataCount,
      upToDateCount,
      schedules,
    ] = await Promise.all([
      this.prisma.preventiveSchedule.count({ where }),
      this.prisma.preventiveSchedule.count({ where: baseWhere }),
      this.prisma.preventiveSchedule.count({
        where: {
          ...baseWhere,
          dueDate: { lt: startOfTodayClub },
          status: { not: PreventiveStatus.COMPLETED },
        },
      }),
      this.prisma.preventiveSchedule.count({
        where: {
          ...baseWhere,
          dueDate: {
            gte: startOfTodayClub,
            lte: endOf7Days,
          },
          status: { not: PreventiveStatus.COMPLETED },
        },
      }),
      this.prisma.preventiveSchedule.count({
        where: {
          ...baseWhere,
          dueDate: {
            gte: startOfTodayClub,
            lte: endOf30Days,
          },
          status: { not: PreventiveStatus.COMPLETED },
        },
      }),
      this.prisma.preventiveSchedule.count({
        where: {
          ...baseWhere,
          status: PreventiveStatus.COMPLETED,
        },
      }),
      this.prisma.preventiveSchedule.count({
        where: {
          ...baseWhere,
          status: { not: PreventiveStatus.COMPLETED },
          dueDate: { gt: endOf7Days },
          lastCompletedDate: null,
          completedDate: null,
        },
      }),
      this.prisma.preventiveSchedule.count({
        where: {
          ...baseWhere,
          status: { not: PreventiveStatus.COMPLETED },
          dueDate: { gt: endOf7Days },
          AND: [
            ...andConditions,
            { OR: [{ lastCompletedDate: { not: null } }, { completedDate: { not: null } }] },
          ],
        },
      }),
      this.prisma.preventiveSchedule.findMany({
        where,
        skip,
        take,
        orderBy:
          status === 'COMPLETED'
            ? [{ completedDate: 'desc' }, { dueDate: 'desc' }]
            : [{ completedDate: { sort: 'desc', nulls: 'first' } }, { dueDate: 'asc' }],
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              microchipRfid: true,
              status: true,
              stallAllocations: {
                where: { isActive: true },
                select: { stall: { select: { code: true, zone: true } } },
              },
            },
          },
          typeCatalog: true,
          veterinarian: { select: { id: true, fullName: true, email: true } },
        },
      }),
    ]);

    const mapped = schedules.map((sch) => {
      const dueDate = new Date(sch.dueDate);

      const isOverdue = sch.status !== PreventiveStatus.COMPLETED && dueDate < startOfTodayClub;
      const isNotice =
        !isOverdue && sch.status !== PreventiveStatus.COMPLETED && dueDate <= endOf7Days;

      let statusBadge = 'NORMAL';
      if (sch.status === PreventiveStatus.COMPLETED) {
        statusBadge = 'COMPLETED';
      } else if (isOverdue) {
        statusBadge = 'OVERDUE';
      } else if (isNotice) {
        statusBadge = 'UPCOMING';
      } else if (!sch.lastCompletedDate && !sch.completedDate) {
        statusBadge = 'NODATA';
      } else {
        statusBadge = 'NORMAL';
      }

      return {
        ...sch,
        stallCode: sch.horse?.stallAllocations[0]?.stall?.code || null,
        zone: sch.horse?.stallAllocations[0]?.stall?.zone || null,
        statusBadge,
        isOverdue,
        isUpcomingNotice: isNotice,
        daysUntilDue: Math.ceil((dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      };
    });

    return {
      counts: {
        overdue: overdueCount,
        upcoming7Days: upcoming7DaysCount,
        upcoming30Days: upcoming30DaysCount,
        upToDate: upToDateCount,
        completed: completedCount,
        noData: noDataCount,
        total: totalCount,
      },
      data: mapped,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(total / take),
    };
  }

  async recordPreventiveCare(actor: CurrentUserPayload, dto: RecordPreventiveCareDto) {
    this.access.assertVet(actor, 'record preventive care');

    let initialSchedule: any = null;
    let typeCatalogId = dto.typeCatalogId;
    let horseId = dto.horseId;

    if (dto.scheduleId) {
      initialSchedule = await this.prisma.preventiveSchedule.findUnique({
        where: { id: dto.scheduleId },
        include: { typeCatalog: true },
      });
      if (initialSchedule) {
        if (initialSchedule.status === PreventiveStatus.COMPLETED) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'SCHEDULE_ALREADY_COMPLETED',
            'Lịch chăm sóc định kỳ này đã hoàn thành trước đó.',
          );
        }
        if (!horseId) horseId = initialSchedule.horseId;
        if (!typeCatalogId) typeCatalogId = initialSchedule.typeCatalogId || undefined;
      }
    }

    let catalog = typeCatalogId
      ? await this.prisma.preventiveTypeCatalog.findUnique({
          where: { id: typeCatalogId },
        })
      : null;

    if (!catalog && initialSchedule) {
      catalog = await this.prisma.preventiveTypeCatalog.findFirst({
        where: {
          category: initialSchedule.scheduleType,
          isActive: true,
        },
      });

      if (!catalog) {
        const cleanSlug = (initialSchedule.productAdministered || initialSchedule.scheduleType)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '_')
          .slice(0, 15);
        const code = `CUSTOM_${cleanSlug}_${Date.now().toString().slice(-4)}`;
        catalog = await this.prisma.preventiveTypeCatalog.create({
          data: {
            code,
            name: initialSchedule.productAdministered || (initialSchedule.scheduleType as string),
            category: initialSchedule.scheduleType,
            intervalDays: 180,
            advanceNoticeDays: 7,
            applyToNewHorses: false,
            isActive: true,
          },
        });
      }
    }

    if (!catalog) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'PREVENTIVE_TYPE_NOT_FOUND',
        'Preventive care type not found.',
      );
    }

    const horseIds =
      dto.horseIds && dto.horseIds.length > 0 ? dto.horseIds : horseId ? [horseId] : [];

    if (horseIds.length === 0) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Choose at least one horse.');
    }

    if (
      dto.performedByMode === 'EXTERNAL' &&
      (!dto.performedByName || dto.performedByName.trim().length === 0)
    ) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Enter who performed the care.');
    }

    const resolvedProduct =
      dto.productAdministered || initialSchedule?.productAdministered || catalog.name;

    if (
      (catalog.category === PreventiveType.VACCINATION ||
        catalog.category === PreventiveType.DEWORMING) &&
      !resolvedProduct
    ) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Enter the product or vaccine used.');
    }

    const now = new Date();
    const performedDate = dto.performedDate ? new Date(dto.performedDate) : now;
    if (performedDate > now) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'DATE_IN_FUTURE',
        'The date performed cannot be in the future.',
      );
    }

    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    if (performedDate < ninetyDaysAgo) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'DATE_TOO_OLD',
        'The date performed cannot be more than 90 days ago.',
      );
    }

    let nextDueDate: Date;
    if (dto.customNextDueDate) {
      nextDueDate = new Date(dto.customNextDueDate);
      if (nextDueDate <= performedDate) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_DATE_RANGE',
          'The next due date must be after the date performed.',
        );
      }
    } else {
      nextDueDate = new Date(performedDate.getTime() + catalog.intervalDays * 24 * 60 * 60 * 1000);
    }

    const performedByName =
      dto.performedByMode === 'EXTERNAL' ? dto.performedByName! : actor.fullName;

    const runTx =
      typeof this.prisma.$transaction === 'function'
        ? (cb: any) => this.prisma.$transaction(cb)
        : (cb: any) => cb(this.prisma);

    await runTx(async (tx: any) => {
      for (const hId of horseIds) {
        const horse = await tx.horse.findUnique({ where: { id: hId, deletedAt: null } });
        if (!horse || horse.status === HorseStatus.RETIRED) continue;

        let schedule = dto.scheduleId
          ? await tx.preventiveSchedule.findUnique({ where: { id: dto.scheduleId } })
          : null;

        if (schedule && schedule.status === PreventiveStatus.COMPLETED) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'SCHEDULE_ALREADY_COMPLETED',
            'Lịch chăm sóc định kỳ này đã hoàn thành trước đó.',
          );
        }

        if (!schedule) {
          schedule = await tx.preventiveSchedule.findFirst({
            where: {
              horseId: hId,
              typeCatalogId: catalog.id,
              status: { not: PreventiveStatus.COMPLETED },
            },
          });
        }

        let history: any[] = [];
        if (schedule?.historyLogs) {
          try {
            history =
              typeof schedule.historyLogs === 'string'
                ? JSON.parse(schedule.historyLogs)
                : (schedule.historyLogs as any[]);
          } catch {
            /* ignore invalid JSON */
            history = [];
          }
        }

        const logEntry = {
          id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          performedDate: performedDate.toISOString(),
          performedByMode: dto.performedByMode || 'SELF',
          performedByName,
          productAdministered: resolvedProduct || null,
          batchNumber: dto.batchNumber || null,
          nextDueDate: nextDueDate.toISOString(),
          notes: dto.notes || null,
          createdAt: now.toISOString(),
        };
        history.push(logEntry);

        if (schedule) {
          // 1. Chốt kỳ chăm sóc hiện tại thành COMPLETED
          await tx.preventiveSchedule.update({
            where: { id: schedule.id },
            data: {
              veterinarianUserId: actor.userId,
              lastCompletedDate: performedDate,
              completedDate: performedDate,
              productAdministered: resolvedProduct || schedule.productAdministered || null,
              batchNumber: dto.batchNumber || null,
              performedByMode: dto.performedByMode || 'SELF',
              performedByName,
              notes: dto.notes || null,
              status: PreventiveStatus.COMPLETED,
              historyLogs: history,
              typeCatalogId: schedule.typeCatalogId || catalog.id,
            },
          });

          // 2. Tạo bản ghi mới PENDING cho kỳ tiếp theo (giữ thông tin lần thực hiện gần nhất cho cột Last given)
          await tx.preventiveSchedule.create({
            data: {
              horseId: hId,
              typeCatalogId: schedule.typeCatalogId || catalog.id,
              scheduleType: catalog.category,
              veterinarianUserId: actor.userId,
              dueDate: nextDueDate,
              lastCompletedDate: performedDate,
              productAdministered: null,
              batchNumber: null,
              performedByMode: dto.performedByMode || 'SELF',
              performedByName,
              notes: null,
              status: PreventiveStatus.PENDING,
              historyLogs: [],
            },
          });
        } else {
          // Tạo dòng COMPLETED cho đợt chăm sóc vừa ghi nhận
          await tx.preventiveSchedule.create({
            data: {
              horseId: hId,
              typeCatalogId: catalog.id,
              scheduleType: catalog.category,
              veterinarianUserId: actor.userId,
              lastCompletedDate: performedDate,
              completedDate: performedDate,
              dueDate: performedDate,
              productAdministered: resolvedProduct || null,
              batchNumber: dto.batchNumber || null,
              performedByMode: dto.performedByMode || 'SELF',
              performedByName,
              notes: dto.notes || null,
              status: PreventiveStatus.COMPLETED,
              historyLogs: history,
            },
          });

          // Tạo dòng PENDING cho kỳ kế tiếp (giữ thông tin lần thực hiện gần nhất cho cột Last given)
          await tx.preventiveSchedule.create({
            data: {
              horseId: hId,
              typeCatalogId: catalog.id,
              scheduleType: catalog.category,
              veterinarianUserId: actor.userId,
              dueDate: nextDueDate,
              lastCompletedDate: performedDate,
              productAdministered: null,
              batchNumber: null,
              performedByMode: dto.performedByMode || 'SELF',
              performedByName,
              notes: null,
              status: PreventiveStatus.PENDING,
              historyLogs: [],
            },
          });
        }
      }
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'RECORD_PREVENTIVE_CARE',
      `Recorded ${catalog.name} for ${horseIds.length} horse(s)`,
      catalog.id,
      { entityName: 'PreventiveTypeCatalog' },
    );

    return {
      message: `Đã ghi nhận ${catalog.name} cho ${horseIds.length} chiến mã thành công`,
      count: horseIds.length,
      nextDueDate: nextDueDate.toLocaleDateString(),
    };
  }

  async setupHorsePreventive(actor: CurrentUserPayload, dto: SetupHorsePreventiveDto) {
    this.access.assertVet(actor, 'set up preventive schedules');

    const horse = await this.prisma.horse.findUnique({
      where: { id: dto.horseId, deletedAt: null },
    });
    if (!horse) throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Horse not found.');

    const now = new Date();
    for (const item of dto.schedules) {
      const catalog = await this.prisma.preventiveTypeCatalog.findUnique({
        where: { id: item.typeCatalogId },
      });
      if (!catalog) continue;

      const schedule = await this.prisma.preventiveSchedule.findFirst({
        where: {
          horseId: dto.horseId,
          typeCatalogId: item.typeCatalogId,
          status: { not: PreventiveStatus.COMPLETED },
        },
      });

      if (item.enabled) {
        let dueDate: Date;
        if (item.initialDueDate) {
          dueDate = new Date(item.initialDueDate);
        } else if (schedule?.dueDate) {
          dueDate = schedule.dueDate;
        } else {
          dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        }

        if (schedule) {
          await this.prisma.preventiveSchedule.update({
            where: { id: schedule.id },
            data: { dueDate, status: PreventiveStatus.PENDING },
          });
        } else {
          await this.prisma.preventiveSchedule.create({
            data: {
              horseId: dto.horseId,
              typeCatalogId: catalog.id,
              scheduleType: catalog.category,
              dueDate,
              status: PreventiveStatus.PENDING,
            },
          });
        }
      }
    }

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'SETUP_HORSE_PREVENTIVE',
      `Setup preventive schedules for horse ${dto.horseId}`,
      dto.horseId,
      { entityName: 'Horse' },
    );

    return { message: 'Đã thiết lập lịch chăm sóc định kỳ cho chiến mã thành công' };
  }

  async createPreventiveSchedule(actor: CurrentUserPayload, dto: CreatePreventiveScheduleDto) {
    this.access.assertVet(actor, 'create preventive care schedules');

    const horse = await this.prisma.horse.findUnique({
      where: { id: dto.horseId, deletedAt: null },
    });
    if (!horse) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Horse not found.');
    }

    if (horse.status === HorseStatus.RETIRED) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'HORSE_RETIRED',
        'The horse has retired; preventive care schedules cannot be created.',
      );
    }

    let scheduleType: PreventiveType = PreventiveType.VACCINATION;
    const catUpper = (dto.category || '').toUpperCase();
    if (catUpper === 'DEWORMING') {
      scheduleType = PreventiveType.DEWORMING;
    } else if (catUpper === 'FARRIER' || catUpper === 'FARRIER_HOOF_CARE') {
      scheduleType = PreventiveType.FARRIER_HOOF_CARE;
    } else if (catUpper === 'DENTAL') {
      scheduleType = PreventiveType.DENTAL;
    } else {
      scheduleType = PreventiveType.VACCINATION;
    }

    let typeCatalogId = dto.typeCatalogId;
    if (typeCatalogId) {
      const catalog = await this.prisma.preventiveTypeCatalog.findUnique({
        where: { id: typeCatalogId },
      });
      if (!catalog) {
        typeCatalogId = undefined;
      }
    }

    if (!typeCatalogId) {
      // Find catalog with matching name
      let catalog = await this.prisma.preventiveTypeCatalog.findFirst({
        where: {
          name: { equals: dto.type.trim(), mode: 'insensitive' },
        },
      });

      if (!catalog) {
        // Try matching by category
        catalog = await this.prisma.preventiveTypeCatalog.findFirst({
          where: { category: scheduleType, isActive: true },
        });
      }

      if (!catalog) {
        // Create catalog entry for this type
        const cleanSlug = dto.type
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '_')
          .slice(0, 15);
        const code = `CUSTOM_${cleanSlug}_${Date.now().toString().slice(-4)}`;
        catalog = await this.prisma.preventiveTypeCatalog.create({
          data: {
            code,
            name: dto.type.trim(),
            category: scheduleType,
            intervalDays:
              scheduleType === PreventiveType.FARRIER_HOOF_CARE
                ? 35
                : scheduleType === PreventiveType.DEWORMING
                  ? 90
                  : scheduleType === PreventiveType.DENTAL
                    ? 365
                    : 180,
            advanceNoticeDays: 7,
            applyToNewHorses: false,
            isActive: true,
          },
        });
      }

      typeCatalogId = catalog.id;
    }

    const dueDate = new Date(dto.dueDate);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (dueDate < todayStart) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_DUE_DATE',
        'The due date must be today or in the future.',
      );
    }

    const schedule = await this.prisma.preventiveSchedule.create({
      data: {
        horseId: dto.horseId,
        typeCatalogId,
        scheduleType,
        dueDate,
        veterinarianUserId: actor.userId,
        productAdministered: dto.type.trim(),
        notes: dto.notes?.trim() || null,
        status: PreventiveStatus.PENDING,
      },
      include: {
        horse: {
          select: {
            id: true,
            name: true,
            microchipRfid: true,
            stallAllocations: {
              where: { isActive: true },
              select: { stall: { select: { code: true, zone: true } } },
            },
          },
        },
        typeCatalog: true,
        veterinarian: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'CREATE_PREVENTIVE_SCHEDULE',
      `Created preventive care schedule (${dto.type}) for horse ${horse.name}`,
      schedule.id,
      { entityName: 'PreventiveSchedule' },
    );

    return schedule;
  }
}
