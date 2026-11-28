import { prizeWon, raceRegistered } from '../business-mail/templates/health-templates';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  HorseStatus,
  PlanStatus,
  Prisma,
  RegistrationStatus,
  Role,
  TournamentStatus,
  TrackSurface,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { apiError } from '../common/exceptions/api-error';
import { effectiveNow, isDemoClockActive } from '../common/utils/demo-clock';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/role.enum';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { QueryTournamentDto } from './dto/query-tournament.dto';
import { ChangeTournamentStatusDto } from './dto/change-tournament-status.dto';
import { RegisterHorseDto } from './dto/register-horse.dto';
import { BatchRecordResultsDto } from './dto/record-result.dto';
import { clubDate } from '../training/training-rules';

export interface TournamentActor {
  id: string;
  name: string;
  role: string;
}

export interface PrizeSplit {
  grossPrize: number;
  entryFeeDeducted: number;
  trainerCut: number;
  jockeyCut: number;
  netOwnerPayout: number;
}

/**
 * BR-RAC-03: ngựa có đạt giới hạn cân nặng của giải không; null = đạt (hoặc giải không giới hạn).
 * range viết bằng ký hiệu (≥, ≤, –) để câu Việt/Anh của FE dịch được nguyên khoảng.
 */
export function weightLimitIssue(
  weightKg: number | null | undefined,
  minWeightKg: number | null | undefined,
  maxWeightKg: number | null | undefined,
): { range: string; missing: boolean } | null {
  if (minWeightKg == null && maxWeightKg == null) return null;
  const range =
    minWeightKg != null && maxWeightKg != null
      ? `${minWeightKg}–${maxWeightKg} kg`
      : minWeightKg != null
        ? `≥ ${minWeightKg} kg`
        : `≤ ${maxWeightKg} kg`;
  if (weightKg == null) return { range, missing: true };
  if (minWeightKg != null && weightKg < minWeightKg) return { range, missing: false };
  if (maxWeightKg != null && weightKg > maxWeightKg) return { range, missing: false };
  return null;
}

function assertWeightRange(min: number | null | undefined, max: number | null | undefined) {
  if (min != null && max != null && min > max) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_WEIGHT_RANGE',
      'Cân nặng tối thiểu phải nhỏ hơn hoặc bằng cân nặng tối đa.',
    );
  }
}

function ageAtRace(dob: Date | null | undefined, raceDate: Date): number {
  if (!dob || isNaN(new Date(dob).getTime())) return 4;
  return Math.floor((raceDate.getTime() - new Date(dob).getTime()) / (365.25 * 86400000));
}

/**
 * Công thức phân bổ giải thưởng chuẩn quốc tế 85/10/5:
 * Net Prize = Gross Prize - Entry Fee
 * Owner: 85% Net Prize
 * Trainer: 10% Net Prize
 * Jockey: 5% Net Prize (phần dư bảo đảm tổng các phần = Net Prize)
 */
export function calculatePrizeSplit(grossPrize: number, entryFee: number): PrizeSplit {
  const gross = Math.max(0, Number(grossPrize) || 0);
  const fee = Math.max(0, Number(entryFee) || 0);
  if (gross === 0) {
    return {
      grossPrize: 0,
      entryFeeDeducted: fee,
      trainerCut: 0,
      jockeyCut: 0,
      netOwnerPayout: 0,
    };
  }
  const netPrize = Math.max(0, gross - fee);
  const ownerShare = Math.round(netPrize * 0.85);
  const trainerCut = Math.round(netPrize * 0.1);
  const jockeyCut = netPrize - ownerShare - trainerCut;

  return {
    grossPrize: gross,
    entryFeeDeducted: fee,
    trainerCut,
    jockeyCut,
    netOwnerPayout: ownerShare,
  };
}

@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Lấy danh sách giải đua với bộ lọc, tìm kiếm và phân trang
   */
  private async publishPrizeMails(tournamentId: string): Promise<void> {
    try {
      const results = await this.prisma.tournamentResult.findMany({
        where: {
          registration: { tournamentId },
          settledAt: { not: null },
          prizeMoneyWon: { gt: 0 },
        },
        include: { registration: { include: { horse: true, tournament: true } } },
      });
      for (const result of results) {
        await this.notifications.notifyHorse(
          result.registration.horseId,
          { roles: [Role.CLUB_MANAGER], owner: true, trainer: true },
          {
            type: 'RACE_RESULTS_PUBLISHED',
            category: 'TRAINING',
            title: 'Thành tích đã được xác nhận',
            message: result.registration.horse.name + ' có kết quả giải đã chốt.',
            link: '/races/results',
            dedupeKey: 'prize-won:' + result.id,
            email: {
              eventCode: 'PRIZE_WON',
              body: {
                ...prizeWon(
                  {
                    finalRank: result.finalRank,
                    prizeMoneyWon: Number(result.prizeMoneyWon),
                    netOwnerPayout: Number(result.netOwnerPayout),
                    settledAt: result.settledAt,
                  },
                  result.registration.tournament,
                  result.registration.horse,
                ),
                refId: result.id,
              },
            },
          },
        );
      }
    } catch (error) {
      this.logger.warn('Could not publish prize emails: ' + (error as Error).message);
    }
  }

  async findAll(query: QueryTournamentDto) {
    const { page = 1, limit = 20, status, trackType, search, from, to } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.TournamentWhereInput = {
      ...(status && { status }),
      ...(trackType && { trackType }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...((from || to) && {
        raceDate: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.tournament.findMany({
        where,
        skip,
        take: limit,
        orderBy: { raceDate: 'desc' },
        include: {
          _count: {
            select: { registrations: true },
          },
        },
      }),
      this.prisma.tournament.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        ...t,
        prizePool: Number(t.prizePool),
        registeredCount: t._count.registrations,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Lấy chi tiết một giải đua kèm danh sách ngựa đăng ký và kết quả
   * Đối với HORSE_OWNER: chỉ trả về các lượt đăng ký và kết quả của ngựa thuộc quyền sở hữu
   * (lọc ở mức truy vấn Prisma để ngăn rò rỉ dữ liệu giải đua và PII của chủ khác).
   */
  async findOne(id: string, user: CurrentUserPayload) {
    const isOwner = user.role === UserRole.HORSE_OWNER;

    const registrationWhere: Prisma.TournamentRegistrationWhereInput | undefined = isOwner
      ? {
          horse: {
            ownerId: user.userId,
          },
        }
      : undefined;

    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: {
        registrations: {
          where: registrationWhere,
          include: {
            horse: {
              select: {
                id: true,
                name: true,
                horseCode: true,
                breed: true,
                avatarUrl: true,
                status: true,
                isMedicalLocked: true,
                ownerId: true,
                owner: { select: { id: true, fullName: true, email: true } },
              },
            },
            registeredByTrainer: {
              select: { id: true, fullName: true, email: true },
            },
            result: true,
          },
          orderBy: [{ result: { finalRank: 'asc' } }, { registrationDate: 'asc' }],
        },
      },
    });

    if (!tournament) {
      throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Không tìm thấy giải đấu.');
    }

    return {
      ...tournament,
      prizePool: Number(tournament.prizePool),
      registrations: tournament.registrations.map((r) => ({
        ...r,
        result: r.result
          ? {
              ...r.result,
              prizeMoneyWon: Number(r.result.prizeMoneyWon),
            }
          : null,
      })),
    };
  }

  /**
   * Tạo mới giải đua (Club Manager only)
   */
  async create(dto: CreateTournamentDto, actor: TournamentActor) {
    const raceDate = new Date(dto.raceDate);
    const deadline = new Date(dto.registrationDeadline);
    assertWeightRange(dto.minWeightKg, dto.maxWeightKg);

    if (deadline > raceDate) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_DEADLINE',
        'Hạn đăng ký phải trước hoặc trùng ngày thi đấu.',
      );
    }

    const now = effectiveNow();
    let initialStatus = dto.status;
    if (!initialStatus) {
      initialStatus =
        deadline >= now ? TournamentStatus.OPEN_REGISTRATION : TournamentStatus.UPCOMING;
    } else {
      if (initialStatus === TournamentStatus.COMPLETED) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION',
          'Không thể tạo giải ở trạng thái COMPLETED. Hãy ghi đủ kết quả rồi chốt kết quả.',
        );
      }
      if (initialStatus === TournamentStatus.CANCELLED) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION',
          'Không thể tạo giải ở trạng thái CANCELLED.',
        );
      }
      if (initialStatus === TournamentStatus.CLOSED_REGISTRATION) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION',
          'Không thể tạo giải ở trạng thái CLOSED_REGISTRATION.',
        );
      }
      if (initialStatus === TournamentStatus.OPEN_REGISTRATION && deadline < now) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_DEADLINE',
          'Không thể mở đăng ký khi hạn đăng ký đã qua.',
        );
      }
    }

    const tournament = await this.prisma.tournament.create({
      data: {
        name: dto.name,
        raceDate,
        location: dto.location,
        distanceMeters: dto.distanceMeters,
        trackType: dto.trackType ?? TrackSurface.TURF,
        prizePool: dto.prizePool ?? 0,
        minWeightKg: dto.minWeightKg ?? null,
        maxWeightKg: dto.maxWeightKg ?? null,
        registrationDeadline: deadline,
        status: initialStatus,
      },
    });

    await this.audit.record(
      { id: actor.id, name: actor.name },
      'TOURNAMENT_CREATED',
      `Created tournament ${tournament.name} (${tournament.distanceMeters}m)`,
      tournament.id,
      { entityName: 'Tournament', newValues: tournament },
    );

    return {
      ...tournament,
      prizePool: Number(tournament.prizePool),
    };
  }

  /**
   * Helper kiểm tra tính hợp lệ của việc chuyển đổi trạng thái giải đua (Allow-list)
   */
  private validateStatusTransition(
    currentStatus: TournamentStatus,
    targetStatus: TournamentStatus,
    registrationDeadline?: Date,
  ) {
    if (currentStatus === targetStatus) {
      return;
    }

    if (currentStatus === TournamentStatus.COMPLETED) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_CHANGE_COMPLETED',
        'Không thể đổi trạng thái của giải đã hoàn thành.',
      );
    }

    if (targetStatus === TournamentStatus.COMPLETED) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_STATUS_TRANSITION',
        'Không thể chuyển thẳng sang COMPLETED. Hãy ghi đủ kết quả rồi chốt kết quả.',
      );
    }

    const ALLOWED_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
      [TournamentStatus.UPCOMING]: [TournamentStatus.OPEN_REGISTRATION, TournamentStatus.CANCELLED],
      [TournamentStatus.OPEN_REGISTRATION]: [
        TournamentStatus.CLOSED_REGISTRATION,
        TournamentStatus.CANCELLED,
      ],
      [TournamentStatus.CLOSED_REGISTRATION]: [TournamentStatus.CANCELLED],
      [TournamentStatus.CANCELLED]: [],
      [TournamentStatus.COMPLETED]: [],
    };

    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_STATUS_TRANSITION',
        `Không thể chuyển trạng thái giải từ ${currentStatus} sang ${targetStatus}.`,
      );
    }

    if (
      targetStatus === TournamentStatus.OPEN_REGISTRATION &&
      registrationDeadline &&
      new Date(registrationDeadline) < effectiveNow()
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_DEADLINE',
        'Không thể mở đăng ký khi hạn đăng ký đã qua.',
      );
    }
  }

  /**
   * Cập nhật thông tin giải đua (Club Manager only)
   */
  async update(id: string, dto: UpdateTournamentDto, actor: TournamentActor) {
    const existing = await this.prisma.tournament.findUnique({ where: { id } });
    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Không tìm thấy giải đấu.');
    }

    if (
      existing.status === TournamentStatus.COMPLETED ||
      existing.status === TournamentStatus.CANCELLED
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TOURNAMENT_LOCKED',
        `Không thể sửa giải ở trạng thái ${existing.status}.`,
      );
    }

    const raceDate = dto.raceDate ? new Date(dto.raceDate) : existing.raceDate;
    const deadline = dto.registrationDeadline
      ? new Date(dto.registrationDeadline)
      : existing.registrationDeadline;

    if (deadline > raceDate) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_DEADLINE',
        'Hạn đăng ký phải trước hoặc trùng ngày thi đấu.',
      );
    }

    assertWeightRange(
      dto.minWeightKg !== undefined ? dto.minWeightKg : existing.minWeightKg,
      dto.maxWeightKg !== undefined ? dto.maxWeightKg : existing.maxWeightKg,
    );

    if (dto.status) {
      this.validateStatusTransition(existing.status, dto.status, deadline);
    }

    const updated = await this.prisma.tournament.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.raceDate && { raceDate }),
        ...(dto.location && { location: dto.location }),
        ...(dto.distanceMeters && { distanceMeters: dto.distanceMeters }),
        ...(dto.trackType && { trackType: dto.trackType }),
        ...(dto.prizePool !== undefined && { prizePool: dto.prizePool }),
        ...(dto.registrationDeadline && { registrationDeadline: deadline }),
        ...(dto.minWeightKg !== undefined && { minWeightKg: dto.minWeightKg }),
        ...(dto.maxWeightKg !== undefined && { maxWeightKg: dto.maxWeightKg }),
        ...(dto.status && { status: dto.status }),
      },
    });

    await this.audit.record(
      { id: actor.id, name: actor.name },
      'TOURNAMENT_UPDATED',
      `Updated tournament ${updated.name}`,
      updated.id,
      { entityName: 'Tournament', oldValues: existing, newValues: updated },
    );

    return {
      ...updated,
      prizePool: Number(updated.prizePool),
    };
  }

  /**
   * Thay đổi trạng thái giải đua theo vòng đời
   */
  async changeStatus(id: string, dto: ChangeTournamentStatusDto, actor: TournamentActor) {
    const existing = await this.prisma.tournament.findUnique({ where: { id } });
    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Không tìm thấy giải đấu.');
    }

    if (existing.status === dto.status) {
      return existing;
    }

    this.validateStatusTransition(existing.status, dto.status, existing.registrationDeadline);

    const updated = await this.prisma.tournament.update({
      where: { id },
      data: { status: dto.status },
    });

    await this.audit.record(
      { id: actor.id, name: actor.name },
      'TOURNAMENT_STATUS_CHANGED',
      `Changed tournament ${existing.name} status from ${existing.status} to ${dto.status}${dto.reason ? ` (${dto.reason})` : ''}`,
      id,
      {
        entityName: 'Tournament',
        oldValues: { status: existing.status },
        newValues: { status: dto.status },
      },
    );

    return {
      ...updated,
      prizePool: Number(updated.prizePool),
    };
  }

  /**
   * Xóa giải đua (chỉ khi chưa có ngựa đăng ký và chưa diễn ra)
   */
  async delete(id: string, actor: TournamentActor) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      include: { _count: { select: { registrations: true } } },
    });

    if (!tournament) {
      throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Không tìm thấy giải đấu.');
    }

    if (tournament._count.registrations > 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'HAS_REGISTRATIONS',
        'Không thể xóa giải đã có ngựa đăng ký. Hãy hủy giải thay vì xóa.',
      );
    }

    if (tournament.status === TournamentStatus.COMPLETED) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_DELETE_COMPLETED',
        'Không thể xóa giải đã hoàn thành.',
      );
    }

    if (tournament.status === TournamentStatus.CANCELLED) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_DELETE_CANCELLED',
        'Không thể xóa giải đã hủy. Giải đã hủy được giữ lại để tra cứu lịch sử.',
      );
    }

    if (tournament.status === TournamentStatus.CLOSED_REGISTRATION) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_DELETE_CLOSED',
        'Không thể xóa giải đã đóng đăng ký. Hãy hủy giải nếu không tổ chức.',
      );
    }

    await this.prisma.tournament.delete({ where: { id } });

    await this.audit.record(
      { id: actor.id, name: actor.name },
      'TOURNAMENT_DELETED',
      `Deleted tournament ${tournament.name}`,
      id,
      { entityName: 'Tournament', oldValues: tournament },
    );

    return { success: true };
  }

  /**
   * Rà soát điều kiện tham gia giải của toàn bộ đàn ngựa trong CLB
   * Phục vụ SC-5.02 (Race Eligibility Check)
   */
  /**
   * BR-RAC-04: ngựa đã có lượt đăng ký còn hiệu lực ở giải khác (chưa hủy) diễn ra cùng ngày (giờ CLB).
   * Trả về Map horseId -> tên giải trùng ngày.
   */
  private async sameDayRaces(
    tournament: { id: string; raceDate: Date },
    horseIds: string[],
  ): Promise<Map<string, string>> {
    if (horseIds.length === 0 || !this.prisma.tournamentRegistration?.findMany) return new Map();
    const day = clubDate(tournament.raceDate);
    const t = tournament.raceDate.getTime();
    const regs = await this.prisma.tournamentRegistration.findMany({
      where: {
        horseId: { in: horseIds },
        tournamentId: { not: tournament.id },
        status: { in: [RegistrationStatus.REGISTERED, RegistrationStatus.CONFIRMED] },
        tournament: {
          status: { not: TournamentStatus.CANCELLED },
          raceDate: { gte: new Date(t - 86400000), lte: new Date(t + 86400000) },
        },
      },
      select: { horseId: true, tournament: { select: { name: true, raceDate: true } } },
    });
    return new Map(
      (regs ?? [])
        .filter((r) => clubDate(r.tournament.raceDate) === day)
        .map((r) => [r.horseId, r.tournament.name]),
    );
  }

  async getEligibility(tournamentId: string, actor?: CurrentUserPayload) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: { registrations: { select: { horseId: true, id: true } } },
    });

    if (!tournament) {
      throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Không tìm thấy giải đấu.');
    }

    const registeredHorseMap = new Map(tournament.registrations.map((r) => [r.horseId, r.id]));
    const isOwner = actor?.role === UserRole.HORSE_OWNER;

    // Lấy tất cả ngựa không bị xóa mềm và chưa nghỉ hưu
    const horses = await this.prisma.horse.findMany({
      where: {
        deletedAt: null,
        status: { not: HorseStatus.RETIRED },
        ...(isOwner && actor ? { ownerId: actor.userId } : {}),
      },
      include: {
        owner: { select: { id: true, fullName: true, email: true } },
        medicalLocks: {
          where: { unlockedAt: null },
          orderBy: { lockedAt: 'desc' },
          take: 1,
        },
        workoutSessions: {
          where: {
            status: 'COMPLETED',
            scheduledDate: {
              gte: new Date(effectiveNow().getTime() - 30 * 24 * 60 * 60 * 1000), // 30 ngày qua
            },
          },
          select: { id: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const eligible: any[] = [];
    const ineligible: any[] = [];
    const raceDate = new Date(tournament.raceDate);
    const minAge = tournament.minAgeYears ?? 2;
    const sameDay = await this.sameDayRaces(
      { id: tournament.id, raceDate },
      horses.map((h) => h.id),
    );

    for (const h of horses) {
      const isRegistered = registeredHorseMap.has(h.id);
      const registrationId = registeredHorseMap.get(h.id);
      const reasons: string[] = [];

      // Điều kiện 1: Khóa y tế
      if (h.isMedicalLocked || (h.medicalLocks && h.medicalLocks.length > 0)) {
        reasons.push('Horse is currently under Veterinary Medical Lock');
      }

      // Điều kiện 1b: Lưu giữ do nợ phí
      if (h.isDebtImpounded) {
        reasons.push('Horse is currently under Debt Impoundment due to overdue payment');
      }

      // Điều kiện 2: Trạng thái ngựa
      if (
        h.status === HorseStatus.UNDER_OBSERVATION ||
        h.status === HorseStatus.INJURED ||
        h.status === HorseStatus.ISOLATED
      ) {
        reasons.push(`Horse health status is currently ${h.status}`);
      }

      // Đánh giá thể lực (số buổi tập gần đây)
      const completedWorkouts = h.workoutSessions ? h.workoutSessions.length : 0;
      if (completedWorkouts < 4) {
        reasons.push(
          `Insufficient recent training sessions (${completedWorkouts}/4 required in past 30 days)`,
        );
      }

      // BR-RAC-03: tuổi và cân nặng theo quy định của giải
      const age = ageAtRace(h.dob, raceDate);
      if (age < minAge) reasons.push(`Mới ${age} tuổi, giải yêu cầu tối thiểu ${minAge} tuổi`);
      const weightIssue = weightLimitIssue(
        h.weightKg,
        tournament.minWeightKg,
        tournament.maxWeightKg,
      );
      if (weightIssue)
        reasons.push(
          weightIssue.missing
            ? `Chưa cập nhật cân nặng, giải yêu cầu ${weightIssue.range}`
            : `Nặng ${h.weightKg} kg, giải yêu cầu ${weightIssue.range}`,
        );

      // BR-RAC-04: không đăng ký hai giải cùng ngày
      const clash = sameDay.get(h.id);
      if (clash) reasons.push(`Đã đăng ký giải "${clash}" cùng ngày thi đấu`);

      const horseData = {
        id: h.id,
        name: h.name,
        horseCode: h.horseCode,
        breed: h.breed,
        avatarUrl: h.avatarUrl,
        status: h.status,
        isMedicalLocked: h.isMedicalLocked,
        isDebtImpounded: h.isDebtImpounded,
        completedWorkouts,
        owner: h.owner,
        isRegistered,
        registrationId,
      };

      if (reasons.length === 0) {
        eligible.push(horseData);
      } else {
        ineligible.push({
          ...horseData,
          ineligibleReasons: reasons,
        });
      }
    }

    return {
      tournament: {
        id: tournament.id,
        name: tournament.name,
        raceDate: tournament.raceDate,
        distanceMeters: tournament.distanceMeters,
        trackType: tournament.trackType,
        status: tournament.status,
        registrationDeadline: tournament.registrationDeadline,
        minAgeYears: minAge,
        minWeightKg: tournament.minWeightKg,
        maxWeightKg: tournament.maxWeightKg,
      },
      eligible,
      ineligible,
      totalEligible: eligible.length,
      totalIneligible: ineligible.length,
    };
  }

  /**
   * Đăng ký ngựa tham gia giải đua (Head Trainer / Club Manager)
   */
  /**
   * Kiểm tra điều kiện tham gia giải đua của một chiến mã cụ thể
   * Cung cấp danh mục kiểm tra 6 tiêu chuẩn rõ ràng, minh bạch
   */
  async checkHorseEligibility(tournamentId: string, horseId: string, actor: TournamentActor) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        registrations: { select: { horseId: true, id: true, status: true } },
      },
    });

    if (!tournament) {
      throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Không tìm thấy giải đấu.');
    }

    const horse = await this.prisma.horse.findUnique({
      where: { id: horseId },
      include: {
        owner: { select: { id: true, fullName: true, email: true } },
        medicalLocks: {
          where: { unlockedAt: null },
          take: 1,
        },
        workoutSessions: {
          where: {
            status: 'COMPLETED',
            scheduledDate: {
              gte: new Date(effectiveNow().getTime() - 30 * 24 * 60 * 60 * 1000),
            },
          },
          select: { id: true },
        },
      },
    });

    if (!horse || horse.deletedAt) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Không tìm thấy ngựa.');
    }

    if (actor.role === 'HORSE_OWNER' && horse.ownerId !== actor.id) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn chỉ được kiểm tra điều kiện cho ngựa của mình.',
      );
    }

    const checks: Array<{
      key:
        | 'STATUS'
        | 'AGE'
        | 'WEIGHT'
        | 'SAME_DAY_RACE'
        | 'MEDICAL_LOCK'
        | 'DEBT_IMPOUND'
        | 'WITHDRAWAL_PERIOD'
        | 'TRAINING_FITNESS';
      label: string;
      passed: boolean;
      details?: string;
    }> = [];
    const blockingReasons: string[] = [];

    // 1. Trạng thái ngựa
    const isRetired = horse.status === HorseStatus.RETIRED;
    const isUnfitStatus =
      horse.status === HorseStatus.UNDER_OBSERVATION ||
      horse.status === HorseStatus.INJURED ||
      horse.status === HorseStatus.ISOLATED;
    const statusPassed = !isRetired && !isUnfitStatus;
    checks.push({
      key: 'STATUS',
      label: 'Trạng thái hoạt động',
      passed: statusPassed,
      details: statusPassed
        ? 'Chiến mã đang ở trạng thái hoạt động bình thường'
        : `Trạng thái hiện tại: ${horse.status}`,
    });
    if (!statusPassed) {
      blockingReasons.push(
        isRetired
          ? `Chiến mã ${horse.name} đã nghỉ hưu, không thể đăng ký thi đấu.`
          : `Chiến mã ${horse.name} đang ở trạng thái ${horse.status}, cần phục hồi trước khi thi đấu.`,
      );
    }

    // 2. Độ tuổi tối thiểu
    const raceDate = tournament.raceDate ? new Date(tournament.raceDate) : effectiveNow();
    const dob = horse.dob
      ? new Date(horse.dob)
      : new Date(raceDate.getTime() - 4 * 365.25 * 86400000);
    const ageYears =
      !isNaN(raceDate.getTime()) && !isNaN(dob.getTime())
        ? Math.floor((raceDate.getTime() - dob.getTime()) / (365.25 * 86400000))
        : 4;
    const minAge = tournament.minAgeYears ?? 2;
    const agePassed = ageYears >= minAge;
    checks.push({
      key: 'AGE',
      label: 'Độ tuổi tham gia',
      passed: agePassed,
      details: agePassed
        ? `${ageYears} tuổi (đạt tiêu chuẩn tối thiểu ${minAge} tuổi)`
        : `${ageYears} tuổi (chưa đủ tối thiểu ${minAge} tuổi quy định của giải)`,
    });
    if (!agePassed) {
      blockingReasons.push(
        `Chiến mã ${horse.name} hiện ${ageYears} tuổi, chưa đạt độ tuổi tối thiểu ${minAge} tuổi của giải đấu.`,
      );
    }

    // 2b. Cân nặng theo giới hạn của giải (BR-RAC-03)
    const weightIssue = weightLimitIssue(
      horse.weightKg,
      tournament.minWeightKg,
      tournament.maxWeightKg,
    );
    checks.push({
      key: 'WEIGHT',
      label: 'Cân nặng theo quy định giải',
      passed: !weightIssue,
      details: weightIssue ? `Giải yêu cầu ${weightIssue.range}` : 'Đạt giới hạn cân nặng của giải',
    });
    if (weightIssue) {
      blockingReasons.push(
        weightIssue.missing
          ? `Chiến mã ${horse.name} chưa cập nhật cân nặng, giải yêu cầu ${weightIssue.range}.`
          : `Chiến mã ${horse.name} nặng ${horse.weightKg} kg, giải yêu cầu ${weightIssue.range}.`,
      );
    }

    // 2c. Không đăng ký hai giải cùng ngày (BR-RAC-04)
    const clash = (await this.sameDayRaces({ id: tournament.id, raceDate }, [horse.id])).get(
      horse.id,
    );
    checks.push({
      key: 'SAME_DAY_RACE',
      label: 'Không trùng ngày thi đấu',
      passed: !clash,
      details: clash ? `Đã đăng ký giải "${clash}" cùng ngày` : 'Không có giải khác cùng ngày',
    });
    if (clash) {
      blockingReasons.push(
        `Chiến mã ${horse.name} đã đăng ký giải "${clash}" diễn ra cùng ngày thi đấu.`,
      );
    }

    // 3. Khóa y tế
    const hasMedLock =
      horse.isMedicalLocked || (horse.medicalLocks && horse.medicalLocks.length > 0);
    checks.push({
      key: 'MEDICAL_LOCK',
      label: 'Không bị khóa y tế',
      passed: !hasMedLock,
      details: hasMedLock ? 'Đang có lệnh khóa y tế từ Bác sĩ thú y' : 'Không có lệnh khóa y tế',
    });
    if (hasMedLock) {
      blockingReasons.push(
        `Chiến mã ${horse.name} đang bị khóa y tế bởi Bác sĩ thú y để theo dõi điều trị.`,
      );
    }

    // 4. Lưu giữ công nợ
    checks.push({
      key: 'DEBT_IMPOUND',
      label: 'Không bị lưu giữ do nợ phí',
      passed: !horse.isDebtImpounded,
      details: horse.isDebtImpounded
        ? 'Đang bị tạm giữ quyền thi đấu do nợ phí quá hạn'
        : 'Công nợ dịch vụ bình thường',
    });
    if (horse.isDebtImpounded) {
      blockingReasons.push(
        `Chiến mã ${horse.name} đang bị tạm giữ quyền thi đấu do chủ sở hữu có hóa đơn quá hạn chưa thanh toán.`,
      );
    }

    // 5. Thời gian ngưng thuốc thú y (Withdrawal Period)
    const medicalRecords = this.prisma.medicalRecord?.findMany
      ? await this.prisma.medicalRecord.findMany({
          where: {
            horseId,
            status: { not: 'DRAFT' },
            createdAt: { gte: new Date(effectiveNow().getTime() - 90 * 86400000) },
          },
          select: {
            examinationDate: true,
            prescriptions: true,
            prescriptionDetails: true,
          },
          orderBy: { examinationDate: 'desc' },
        })
      : [];

    const withdrawalViolations: string[] = [];
    for (const rec of medicalRecords) {
      const rxSource = rec.prescriptions || rec.prescriptionDetails;
      if (!rxSource) continue;
      try {
        const parsed = JSON.parse(rxSource);
        const rxList = Array.isArray(parsed) ? parsed : [parsed];
        for (const rx of rxList) {
          if (!rx || typeof rx !== 'object') continue;
          const wDays = Number(rx.withdrawalDays) || 0;
          if (wDays <= 0) continue;
          const rxDate = rx.endDate
            ? new Date(rx.endDate)
            : rx.startDate
              ? new Date(rx.startDate)
              : new Date(rec.examinationDate);
          const clearDate = new Date(rxDate.getTime() + wDays * 86400000);
          if (clearDate > raceDate && (!isDemoClockActive() || clearDate > effectiveNow())) {
            const clearDateStr = clearDate.toISOString().slice(0, 10);
            withdrawalViolations.push(
              `${rx.medicationName || 'Thuốc điều trị'} (ngưng ${wDays} ngày, hết hạn ${clearDateStr})`,
            );
          }
        }
      } catch {
        /* ignore invalid json */
      }
    }

    const withdrawalPassed = withdrawalViolations.length === 0;
    checks.push({
      key: 'WITHDRAWAL_PERIOD',
      label: 'Tuân thủ thời gian ngưng thuốc',
      passed: withdrawalPassed,
      details: withdrawalPassed
        ? 'Không có thuốc điều trị vi phạm thời gian ngưng thi đấu'
        : `Thuốc còn thời gian ngưng: ${withdrawalViolations.join(', ')}`,
    });
    if (!withdrawalPassed) {
      blockingReasons.push(
        `Chiến mã ${horse.name} đang trong thời gian ngưng thuốc thú y: ${withdrawalViolations.join('; ')}. Bắt buộc tuân thủ quy định phòng chống doping.`,
      );
    }

    // 6. Thể lực luyện tập gần đây
    const completedWorkouts =
      horse.workoutSessions && Array.isArray(horse.workoutSessions)
        ? horse.workoutSessions.length
        : 4;
    const fitnessPassed = completedWorkouts >= 4;
    checks.push({
      key: 'TRAINING_FITNESS',
      label: 'Thể lực luyện tập gần đây',
      passed: fitnessPassed,
      details: `${completedWorkouts}/4 buổi tập hoàn thành trong 30 ngày qua`,
    });
    if (!fitnessPassed) {
      blockingReasons.push(
        `Chiến mã ${horse.name} mới hoàn thành ${completedWorkouts}/4 buổi tập luyện trong 30 ngày qua, chưa đạt thể lực thi đấu.`,
      );
    }

    const isRegistered = Array.isArray(tournament.registrations)
      ? tournament.registrations.some((r) => r.horseId === horseId)
      : false;

    const isEligible = blockingReasons.length === 0;

    return {
      eligible: isEligible,
      isEligible,
      isRegistered,
      horseId: horse.id,
      horseName: horse.name,
      reasons: blockingReasons,
      horse: {
        id: horse.id,
        name: horse.name,
        horseCode: horse.horseCode,
        ageYears,
        status: horse.status,
      },
      tournament: {
        id: tournament.id,
        name: tournament.name,
        raceDate: tournament.raceDate,
        minAgeYears: minAge,
        entryFee: Number(tournament.entryFee) || 0,
        prizePool: Number(tournament.prizePool) || 0,
      },
      checks,
      checklist: {
        statusCheck: {
          pass: statusPassed,
          value: horse.status,
          required: 'ACTIVE',
        },
        ageCheck: {
          pass: agePassed,
          ageYears,
          minRequired: minAge,
        },
        medicalLockCheck: {
          pass: !hasMedLock,
          locked: hasMedLock,
          details: hasMedLock ? 'Đang có lệnh khóa y tế từ Bác sĩ thú y' : undefined,
        },
        debtCheck: {
          pass: !horse.isDebtImpounded,
          impounded: horse.isDebtImpounded,
        },
        withdrawalCheck: {
          pass: withdrawalPassed,
          activeMeds: withdrawalViolations,
        },
        fitnessCheck: {
          pass: fitnessPassed,
          completedWorkouts,
          required: 4,
        },
      },
      blockingReasons,
    };
  }

  async registerHorse(tournamentId: string, dto: RegisterHorseDto, actor: TournamentActor) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
    });

    if (!tournament) {
      throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Không tìm thấy giải đấu.');
    }

    if (tournament.status !== TournamentStatus.OPEN_REGISTRATION) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'REGISTRATION_NOT_OPEN',
        'Giải không ở trạng thái mở đăng ký.',
      );
    }

    if (effectiveNow() > tournament.registrationDeadline) {
      throw apiError(HttpStatus.BAD_REQUEST, 'DEADLINE_EXPIRED', 'Đã quá hạn đăng ký giải này.');
    }

    const horse = await this.prisma.horse.findUnique({
      where: { id: dto.horseId },
      include: {
        owner: { select: { id: true, fullName: true } },
      },
    });

    if (!horse || horse.deletedAt) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Không tìm thấy ngựa.');
    }

    if (actor.role === 'HORSE_OWNER') {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'OWNER_DIRECT_REGISTRATION_DISALLOWED',
        'Chủ ngựa không được đăng ký thi đấu trực tiếp. Vui lòng liên hệ Huấn luyện viên trưởng hoặc Quản lý CLB để đăng ký thi đấu cho chiến mã.',
      );
    }

    if (actor.role === 'HEAD_TRAINER' && this.prisma.trainingPlan?.findFirst) {
      const activePlan = await this.prisma.trainingPlan.findFirst({
        where: { horseId: horse.id, status: PlanStatus.ACTIVE },
      });
      if (activePlan && activePlan.trainerUserId !== actor.id) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          `Chiến mã ${horse.name} đang thuộc giáo án do Huấn luyện viên khác quản lý. Chỉ HLV phụ trách mới có quyền đăng ký thi đấu.`,
        );
      }
    }

    // Xác định Trainer ID ghi nhận lượt đăng ký (nếu CM đăng ký hộ thì ưu tiên lấy HLV phụ trách của ngựa)
    let registeredTrainerId = actor.id;
    if (actor.role === 'CLUB_MANAGER' && this.prisma.trainingPlan?.findFirst) {
      const activePlan = await this.prisma.trainingPlan.findFirst({
        where: { horseId: horse.id, status: { in: [PlanStatus.ACTIVE, PlanStatus.DRAFT] } },
        orderBy: { updatedAt: 'desc' },
      });
      if (activePlan) {
        registeredTrainerId = activePlan.trainerUserId;
      }
    }

    // Chặn cứng: Khóa y tế
    if (horse.isMedicalLocked) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'MEDICAL_LOCK_ACTIVE',
        `Không thể đăng ký ngựa ${horse.name}: ngựa đang bị bác sĩ thú y khóa y tế.`,
      );
    }

    // Chặn cứng: Lưu giữ do nợ phí
    if (horse.isDebtImpounded) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'DEBT_IMPOUNDED',
        `Không thể đăng ký ngựa ${horse.name}: ngựa đang bị lưu giữ do chủ còn hóa đơn quá hạn.`,
      );
    }

    if (horse.status === HorseStatus.RETIRED) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'HORSE_RETIRED',
        `Không thể đăng ký ngựa đã nghỉ hưu ${horse.name}.`,
      );
    }

    const eligibility = await this.checkHorseEligibility(tournamentId, dto.horseId, actor);
    if (!eligibility.eligible) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INELIGIBLE_FOR_TOURNAMENT',
        `Không thể đăng ký chiến mã: ${eligibility.blockingReasons.join('; ')}`,
        {
          blockingReasons: eligibility.blockingReasons,
          checks: eligibility.checks,
        },
      );
    }

    const duplicate = () =>
      apiError(
        HttpStatus.CONFLICT,
        'ALREADY_REGISTERED',
        `Ngựa ${horse.name} đã được đăng ký giải này.`,
      );

    // RULE-CONC-01: kiểm tra trùng + tạo trong một transaction; ràng buộc unique (tournamentId, horseId)
    // chặn lượt đăng ký đồng thời lọt qua bước kiểm tra, khi đó trả 409 thay vì 500.
    const registration = await this.prisma
      .$transaction(async (tx) => {
        const existing = await tx.tournamentRegistration.findUnique({
          where: { tournamentId_horseId: { tournamentId, horseId: dto.horseId } },
        });
        if (existing) throw duplicate();
        return tx.tournamentRegistration.create({
          data: {
            tournamentId,
            horseId: dto.horseId,
            registeredByTrainerId: registeredTrainerId,
            status: RegistrationStatus.REGISTERED,
            entryFeeBilled: Number(tournament.entryFee) || 0,
            notes: dto.notes,
          },
          include: {
            horse: { select: { id: true, name: true, horseCode: true } },
          },
        });
      })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
          throw duplicate();
        throw err;
      });

    await this.audit.record(
      { id: actor.id, name: actor.name },
      'TOURNAMENT_REGISTERED',
      `Registered horse ${horse.name} for tournament ${tournament.name}`,
      registration.id,
      { entityName: 'TournamentRegistration', newValues: registration },
    );

    // Gửi thông báo cho Chủ ngựa nếu có
    if (horse.ownerId) {
      await this.notifications.notifyUsers(
        [horse.ownerId],
        {
          type: 'RACE_REGISTRATION',
          category: 'TRAINING',
          title: 'Chiến mã đã được đăng ký thi đấu',
          message: `Ngựa ${horse.name} của bạn đã được đăng ký tham gia giải đua ${tournament.name}.`,
          link: `/races`,
          params: { horseName: horse.name, tournamentName: tournament.name },
          email: {
            eventCode: 'RACE_REGISTRATION',
            body: raceRegistered(
              { id: horse.id, name: horse.name, status: horse.status },
              { name: tournament.name, startDate: tournament.raceDate },
              {
                name:
                  (actor as { fullName?: string; name?: string }).fullName ||
                  (actor as { name?: string }).name ||
                  'CLB EquiFlow',
              },
            ),
          },
        },
        actor.id,
      );
    }

    return registration;
  }

  /**
   * Hủy đăng ký hoặc rút ngựa khỏi giải (Scratch)
   */
  async cancelRegistration(
    tournamentId: string,
    registrationId: string,
    reason: string,
    actor: TournamentActor,
  ) {
    const registration = await this.prisma.tournamentRegistration.findUnique({
      where: { id: registrationId },
      include: {
        tournament: true,
        horse: true,
      },
    });

    if (!registration || registration.tournamentId !== tournamentId) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'REGISTRATION_NOT_FOUND',
        'Không tìm thấy lượt đăng ký trong giải này.',
      );
    }

    if (!reason || !reason.trim()) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'REASON_REQUIRED',
        'Cần nhập lý do khi rút ngựa khỏi giải.',
      );
    }

    if (
      registration.tournament.status === TournamentStatus.COMPLETED ||
      registration.tournament.status === TournamentStatus.CANCELLED
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_SCRATCH_TERMINAL',
        'Không thể rút ngựa khỏi giải đã hủy hoặc đã hoàn thành.',
      );
    }

    if (registration.tournament.status === TournamentStatus.UPCOMING) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_SCRATCH_UPCOMING',
        'Không thể rút ngựa khỏi giải chưa mở đăng ký.',
      );
    }

    if (
      registration.status !== RegistrationStatus.REGISTERED &&
      registration.status !== RegistrationStatus.CONFIRMED
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_SCRATCH',
        `Không thể rút lượt đăng ký ${registrationId} ở trạng thái ${registration.status}. Chỉ rút được lượt đăng ký còn hiệu lực.`,
      );
    }

    const updated = await this.prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: {
        status: RegistrationStatus.SCRATCHED_MEDICAL,
        notes: registration.notes
          ? `${registration.notes} | Scratched: ${reason}`
          : `Scratched: ${reason}`,
      },
    });

    await this.audit.record(
      { id: actor.id, name: actor.name },
      'TOURNAMENT_SCRATCHED',
      `Scratched horse ${registration.horse.name} from tournament ${registration.tournament.name} (${reason})`,
      registrationId,
      { entityName: 'TournamentRegistration', oldValues: registration, newValues: updated },
    );

    return updated;
  }

  /**
   * Ghi nhận kết quả thi đấu (Trainer hoặc CM)
   */
  async recordResults(tournamentId: string, dto: BatchRecordResultsDto, actor: TournamentActor) {
    const { tournament, savedResults } = await this.prisma.$transaction(async (tx) => {
      // Serialize both finalization APIs and drafts before reading authoritative state.
      await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
      const tournament = await tx.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          registrations: {
            include: {
              horse: true,
              result: true,
            },
          },
        },
      });

      if (!tournament) {
        throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Không tìm thấy giải đấu.');
      }

      if (actor.role !== 'CLUB_MANAGER') {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'PERMISSION_DENIED',
          'Chỉ Quản lý CLB được ghi hoặc sửa kết quả giải.',
        );
      }

      if (tournament.status === TournamentStatus.COMPLETED) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'ALREADY_LOCKED',
          'Kết quả giải này đã được Quản lý CLB chốt.',
        );
      }

      if (tournament.status === TournamentStatus.CANCELLED) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION',
          'Không thể ghi kết quả cho giải đã hủy.',
        );
      }

      if (tournament.status !== TournamentStatus.CLOSED_REGISTRATION) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'REGISTRATION_NOT_CLOSED',
          'Chỉ ghi kết quả sau khi giải đã đóng đăng ký.',
        );
      }

      const hasSimResults = tournament.registrations.some((r) => r.result !== null);
      if (
        effectiveNow() < new Date(tournament.raceDate) &&
        !hasSimResults &&
        (!dto.results || dto.results.length === 0)
      ) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'RACE_NOT_FINISHED',
          'Không thể ghi kết quả trước khi giải diễn ra.',
        );
      }

      const regMap = new Map(tournament.registrations.map((r) => [r.id, r]));

      // R-3: Reject registrations that are not active (SCRATCHED_MEDICAL, DISQUALIFIED, etc.) before any upsert/audit
      for (const item of dto.results) {
        const reg = regMap.get(item.registrationId);
        if (!reg) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'INVALID_REGISTRATION_ID',
            `Lượt đăng ký ${item.registrationId} không thuộc giải này.`,
          );
        }

        if (
          reg.status === RegistrationStatus.SCRATCHED_MEDICAL ||
          reg.status === RegistrationStatus.DISQUALIFIED ||
          (reg.status !== RegistrationStatus.REGISTERED &&
            reg.status !== RegistrationStatus.CONFIRMED)
        ) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'CANNOT_RECORD_RESULT',
            `Không thể ghi kết quả cho lượt đăng ký ${item.registrationId} ở trạng thái ${reg.status}. Chỉ ghi kết quả cho lượt đăng ký còn hiệu lực.`,
          );
        }

        if (reg.horse?.isMedicalLocked) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'HORSE_MEDICAL_LOCKED',
            `Không thể ghi kết quả cho ngựa ${reg.horse.name}: ngựa đang bị khóa y tế.`,
          );
        }
      }

      const activeRegs = tournament.registrations.filter(
        (r) =>
          r.status === RegistrationStatus.REGISTERED || r.status === RegistrationStatus.CONFIRMED,
      );

      // R-4: If locking results, validate BEFORE any writes that every active registration has a result
      if (dto.lockResults) {
        if (activeRegs.length === 0) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'NO_REGISTRATIONS',
            'Không thể chốt giải khi chưa có ngựa đăng ký.',
          );
        }

        const dtoRegIds = new Set(dto.results.map((r) => r.registrationId));
        const missingResults = activeRegs.filter((r) => !dtoRegIds.has(r.id) && !r.result);
        if (missingResults.length > 0) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'RESULTS_INCOMPLETE',
            `Không thể chốt kết quả: còn ${missingResults.length} ngựa chưa có kết quả.`,
          );
        }
      }

      const savedResults: any[] = [];
      if (dto.lockResults) {
        const now = effectiveNow();
        // 1. Upsert results from dto
        for (const item of dto.results) {
          const calculatedSpeed =
            item.avgSpeedKmh && item.avgSpeedKmh > 0
              ? item.avgSpeedKmh
              : Math.round((tournament.distanceMeters / item.finishTimeSeconds) * 3.6 * 100) / 100;

          const split = calculatePrizeSplit(
            item.prizeMoneyWon ?? 0,
            Number(tournament.entryFee) || 0,
          );

          const res = await tx.tournamentResult.upsert({
            where: { registrationId: item.registrationId },
            create: {
              registrationId: item.registrationId,
              finalRank: item.finalRank,
              finishTimeSeconds: item.finishTimeSeconds,
              avgSpeedKmh: calculatedSpeed,
              prizeMoneyWon: item.prizeMoneyWon ?? 0,
              grossPrize: split.grossPrize,
              trainerCut: split.trainerCut,
              jockeyCut: split.jockeyCut,
              entryFeeDeducted: split.entryFeeDeducted,
              netOwnerPayout: split.netOwnerPayout,
              settledAt: now,
              officialNotes: item.officialNotes,
            },
            update: {
              finalRank: item.finalRank,
              finishTimeSeconds: item.finishTimeSeconds,
              avgSpeedKmh: calculatedSpeed,
              prizeMoneyWon: item.prizeMoneyWon ?? 0,
              grossPrize: split.grossPrize,
              trainerCut: split.trainerCut,
              jockeyCut: split.jockeyCut,
              entryFeeDeducted: split.entryFeeDeducted,
              netOwnerPayout: split.netOwnerPayout,
              settledAt: now,
              officialNotes: item.officialNotes,
            },
          });

          savedResults.push({
            ...res,
            prizeMoneyWon: Number(res.prizeMoneyWon),
          });
        }

        // 2. Chốt giải đấu sang COMPLETED
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: TournamentStatus.COMPLETED },
        });

        // 3. Map all final results for active registrations
        const resultMap = new Map<string, any>();
        for (const reg of activeRegs) {
          if (reg.result) {
            resultMap.set(reg.id, reg.result);
          }
        }
        for (const res of savedResults) {
          resultMap.set(res.registrationId, res);
        }

        // 4. Cập nhật từng con ngựa & phân bổ giải thưởng
        for (const reg of activeRegs) {
          const res = resultMap.get(reg.id);
          if (!res) continue;

          // Chuyển ngựa về RESTING
          await tx.horse.update({
            where: { id: reg.horseId },
            data: { status: HorseStatus.RESTING },
          });

          // Tiền thưởng vào hóa đơn khi chốt tháng (generateMonthlyDrafts tính theo settledAt), không tạo hóa đơn kỳ chưa kết thúc.
        }
      } else {
        for (const item of dto.results) {
          const calculatedSpeed =
            item.avgSpeedKmh && item.avgSpeedKmh > 0
              ? item.avgSpeedKmh
              : Math.round((tournament.distanceMeters / item.finishTimeSeconds) * 3.6 * 100) / 100;

          const split = calculatePrizeSplit(
            item.prizeMoneyWon ?? 0,
            Number(tournament.entryFee) || 0,
          );

          const res = await tx.tournamentResult.upsert({
            where: { registrationId: item.registrationId },
            create: {
              registrationId: item.registrationId,
              finalRank: item.finalRank,
              finishTimeSeconds: item.finishTimeSeconds,
              avgSpeedKmh: calculatedSpeed,
              prizeMoneyWon: item.prizeMoneyWon ?? 0,
              grossPrize: split.grossPrize,
              trainerCut: split.trainerCut,
              jockeyCut: split.jockeyCut,
              entryFeeDeducted: split.entryFeeDeducted,
              netOwnerPayout: split.netOwnerPayout,
              officialNotes: item.officialNotes,
            },
            update: {
              finalRank: item.finalRank,
              finishTimeSeconds: item.finishTimeSeconds,
              avgSpeedKmh: calculatedSpeed,
              prizeMoneyWon: item.prizeMoneyWon ?? 0,
              grossPrize: split.grossPrize,
              trainerCut: split.trainerCut,
              jockeyCut: split.jockeyCut,
              entryFeeDeducted: split.entryFeeDeducted,
              netOwnerPayout: split.netOwnerPayout,
              officialNotes: item.officialNotes,
            },
          });

          savedResults.push({
            ...res,
            prizeMoneyWon: Number(res.prizeMoneyWon),
          });
        }
      }
      return { tournament, savedResults };
    });

    if (dto.lockResults) {
      if (savedResults.length > 0) {
        await this.audit.record(
          { id: actor.id, name: actor.name },
          'TOURNAMENT_RESULTS_RECORDED',
          `Recorded ${savedResults.length} results for tournament ${tournament.name}`,
          tournamentId,
          { entityName: 'TournamentResult', newValues: savedResults },
        );
      }

      await this.audit.record(
        { id: actor.id, name: actor.name },
        'TOURNAMENT_RESULTS_LOCKED',
        `Locked official results for tournament ${tournament.name}. Horses returned to RESTING and prize splits calculated.`,
        tournamentId,
        { entityName: 'Tournament', newValues: { status: TournamentStatus.COMPLETED } },
      );

      await this.notifications.notifyRoles(
        [Role.HEAD_TRAINER, Role.CLUB_MANAGER],
        {
          type: 'TOURNAMENT_COMPLETED',
          category: 'TRAINING',
          title: 'Kết quả giải đua đã được chốt chính thức',
          message: `Giải đua ${tournament.name} đã được chốt kết quả và hạch toán thành công.`,
          link: `/races`,
          params: { tournamentName: tournament.name },
        },
        actor.id,
      );

      await this.publishPrizeMails(tournamentId);
      return this.findOne(tournamentId, {
        userId: actor.id,
        email: actor.name,
        role: (actor.role as UserRole) || UserRole.CLUB_MANAGER,
        fullName: actor.name,
      });
    }

    if (savedResults.length > 0) {
      await this.audit.record(
        { id: actor.id, name: actor.name },
        'TOURNAMENT_RESULTS_RECORDED',
        `Recorded ${dto.results.length} results for tournament ${tournament.name}`,
        tournamentId,
        { entityName: 'TournamentResult', newValues: savedResults },
      );
    }

    return {
      success: true,
      results: savedResults,
    };
  }

  /**
   * Chốt kết quả thi đấu (Club Manager only)
   * 1. Khóa trạng thái giải sang COMPLETED.
   * 2. Tự động chuyển ngựa về trạng thái RESTING (nghỉ ngơi hồi phục).
   * 3. Tự động phân bổ tiền thưởng: Owner 85%, Trainer 10%, Jockey 5% (chuẩn quốc tế sau trừ phí tham gia giải).
   */
  async lockResults(tournamentId: string, actor: TournamentActor) {
    if (actor.role !== 'CLUB_MANAGER') {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'PERMISSION_DENIED',
        'Chỉ Quản lý CLB được chốt kết quả giải.',
      );
    }

    const tournament = await this.prisma.$transaction(async (tx) => {
      // Serialize both finalization APIs and drafts before reading authoritative state.
      await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE`;
      const tournament = await tx.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          registrations: {
            include: {
              horse: true,
              result: true,
            },
          },
        },
      });

      if (!tournament) {
        throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Không tìm thấy giải đấu.');
      }

      if (tournament.status === TournamentStatus.COMPLETED) {
        throw apiError(HttpStatus.BAD_REQUEST, 'ALREADY_COMPLETED', 'Kết quả giải đã được chốt.');
      }

      if (tournament.status === TournamentStatus.CANCELLED) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_STATUS_TRANSITION',
          'Không thể chốt kết quả của giải đã hủy.',
        );
      }

      if (tournament.status !== TournamentStatus.CLOSED_REGISTRATION) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'REGISTRATION_NOT_CLOSED',
          'Chỉ chốt kết quả khi giải đã đóng đăng ký.',
        );
      }

      const hasResults = tournament.registrations.some((r) => r.result !== null);
      if (effectiveNow() < new Date(tournament.raceDate) && !hasResults) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'RACE_NOT_FINISHED',
          'Không thể chốt kết quả trước ngày thi đấu.',
        );
      }

      const activeRegs = tournament.registrations.filter(
        (r) =>
          r.status === RegistrationStatus.REGISTERED || r.status === RegistrationStatus.CONFIRMED,
      );

      if (activeRegs.length === 0) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'NO_REGISTRATIONS',
          'Không thể chốt giải khi chưa có ngựa đăng ký.',
        );
      }

      const missingResults = activeRegs.filter((r) => !r.result);
      if (missingResults.length > 0) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'RESULTS_INCOMPLETE',
          `Không thể chốt kết quả: còn ${missingResults.length} ngựa chưa có kết quả.`,
        );
      }

      // Xử lý trong transaction
      const now = effectiveNow();

      // 1. Chốt giải đấu
      await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: TournamentStatus.COMPLETED },
      });

      // 2. Cập nhật từng con ngựa & phân bổ giải thưởng
      for (const reg of activeRegs) {
        if (!reg.result) continue;

        // Chuyển ngựa về RESTING
        await tx.horse.update({
          where: { id: reg.horseId },
          data: { status: HorseStatus.RESTING },
        });

        const prizeWon = Number(reg.result.prizeMoneyWon || 0);
        const split = calculatePrizeSplit(prizeWon, Number(tournament.entryFee) || 0);

        await tx.tournamentResult.update({
          where: { registrationId: reg.id },
          data: {
            grossPrize: split.grossPrize,
            trainerCut: split.trainerCut,
            jockeyCut: split.jockeyCut,
            entryFeeDeducted: split.entryFeeDeducted,
            netOwnerPayout: split.netOwnerPayout,
            settledAt: now,
          },
        });

        // Tiền thưởng vào hóa đơn khi chốt tháng (generateMonthlyDrafts tính theo settledAt), không tạo hóa đơn kỳ chưa kết thúc.
      }
      return tournament;
    });

    await this.audit.record(
      { id: actor.id, name: actor.name },
      'TOURNAMENT_RESULTS_LOCKED',
      `Locked official results for tournament ${tournament.name}. Horses returned to RESTING and prize splits calculated.`,
      tournamentId,
      { entityName: 'Tournament', newValues: { status: TournamentStatus.COMPLETED } },
    );

    // Gửi thông báo kết quả cho tất cả Huấn luyện viên
    await this.notifications.notifyRoles(
      [Role.HEAD_TRAINER, Role.CLUB_MANAGER],
      {
        type: 'TOURNAMENT_COMPLETED',
        category: 'TRAINING',
        title: 'Kết quả giải đua đã được chốt chính thức',
        message: `Giải đua ${tournament.name} đã được chốt kết quả và hạch toán thành công.`,
        link: `/races`,
        params: { tournamentName: tournament.name },
      },
      actor.id,
    );

    await this.publishPrizeMails(tournamentId);
    return this.findOne(tournamentId, {
      userId: actor.id,
      email: actor.name,
      role: (actor.role as UserRole) || UserRole.CLUB_MANAGER,
      fullName: actor.name,
    });
  }
}
