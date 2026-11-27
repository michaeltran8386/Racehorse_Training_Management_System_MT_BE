import { WorkoutAvailabilityService, lockWorkoutSchedule } from './workout-availability.service';
import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { HorseStatus, PlanStatus, Prisma, Role, UserStatus, WorkoutStatus } from '@prisma/client';
import { DailyTasksService } from '../daily-tasks/daily-tasks.service';
import { assertTrainerZone } from './trainer-zones';
import { apiError } from '../common/exceptions/api-error';
import { effectiveNow } from '../common/utils/demo-clock';
import { UserRole } from '../common/enums/role.enum';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { CreateWorkoutSessionDto, RepeatWorkoutDto } from './dto/create-workout-session.dto';
import { UpdateWorkoutSessionDto } from './dto/update-workout-session.dto';
import { RecordWorkoutResultDto } from './dto/record-result.dto';
import { CancelWorkoutDto, RestoreWorkoutDto } from './dto/workout-actions.dto';
import {
  addDays,
  allowEarlyWorkoutStart,
  ALWAYS_HEAVY_TYPES,
  clubDate,
  clubTime,
  effectiveIntensity,
  effectiveSurface,
  isHeavy,
  isWithinPrimeTime,
  LATE_RESULT_DAYS,
  MAX_AVERAGE_SPEED_KMH,
  MAX_PRIME_HEAVY_SESSIONS_PER_TRAINER,
  MAX_SESSION_DISTANCE_METERS,
  MAX_WORKOUTS_PER_DAY,
  MAX_DAILY_WORKOUTS_PER_GROOM,
  MAX_DAILY_HEAVY_WORKOUTS_PER_GROOM,
  NO_TIME_TYPES,
  PENDING_WORKOUT_STATUSES,
  PRIME_TIME_END_HOUR,
  PRIME_TIME_END_MINUTE,
  PRIME_TIME_START_HOUR,
  PRIME_TIME_START_MINUTE,
  startOfClubDay,
  startOfClubWeek,
  TRACK_MAX_LIGHT_HORSES,
  TRAINER_BUFFER_MINUTES,
  TRIAL_SLOT_MINUTES,
  withinTrainingHours,
  GROOM_BUFFER_MINUTES,
  workoutDurationMinutes,
  TrackAvailabilityInfo,
} from './training-rules';
import {
  Tx,
  MEDICAL_STATUSES,
  CANCEL_REASON_LABEL,
  RESULT_EDIT_HOURS,
  MAX_REPEAT_WORKOUTS,
  HEAVY_GAP_HOURS,
  GROOM_OVERLAP_MINUTES,
  WORKOUT_INCLUDE,
  WorkoutDraft,
  PlanForCheck,
  phasesOf,
  hideScoreForGroom,
} from './training-shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrainingCommonService } from './training-common.service';

/** HLV phụ trách giáo án của buổi tập đang chiếm giờ (để câu báo trùng nói rõ là của ai). */
const TRAINER_OF_WORKOUT = {
  trainingPlan: { select: { trainer: { select: { fullName: true } } } },
} as const;

const SURFACE_LABEL: Record<string, string> = {
  TURF: 'Cỏ',
  DIRT: 'Cát',
  SYNTHETIC: 'Nhân tạo',
};

function hhmm(d: Date): string {
  const { hour, minute } = clubTime(d);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Thông tin cho câu báo trùng giờ: buổi kia lúc mấy giờ, của HLV nào, và khung giờ còn chọn được
 * (luật hiện tại: 2 buổi phải cách nhau ít nhất `gapMinutes` phút).
 */
function conflictInfo(
  other: Date,
  gapMinutes: number,
  row: { trainingPlan?: { trainer?: { fullName?: string } } | null } | any,
) {
  const [y, m, d] = clubDate(other).split('-');
  return {
    time: hhmm(other),
    date: `${d}/${m}/${y}`,
    trainer: row?.trainingPlan?.trainer?.fullName ?? '—',
    before: hhmm(new Date(other.getTime() - gapMinutes * 60 * 1000)),
    after: hhmm(new Date(other.getTime() + gapMinutes * 60 * 1000)),
  };
}

/** P2-07, P2-08: buổi tập — xếp lịch, lặp hằng tuần, ghi kết quả, hủy / khôi phục, lịch của groom (FR-2.05, FR-2.09 → FR-2.13, FR-2.17, FR-2.20). */
@Injectable()
export class WorkoutsService {
  private readonly logger = new Logger(WorkoutsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly common: TrainingCommonService,
    @Optional() private readonly dailyTasks?: DailyTasksService,
  ) {}

  async checkWorkout(
    planId: string,
    dto: CreateWorkoutSessionDto & { excludeWorkoutId?: string },
    user: CurrentUserPayload,
  ) {
    if (user.role !== UserRole.HEAD_TRAINER)
      throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Trainer scheduling permission required.');
    return this.prisma.$transaction(
      async (tx) => {
        const plan = await tx.trainingPlan.findUnique({ where: { id: planId } });
        if (!plan) throw apiError(HttpStatus.NOT_FOUND, 'PLAN_NOT_FOUND', 'Plan not found.');
        if (plan.trainerUserId !== user.userId)
          throw apiError(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            'This plan belongs to another trainer.',
          );
        if (dto.excludeWorkoutId) {
          const existing = await tx.workoutSession.findUnique({
            where: { id: dto.excludeWorkoutId },
          });
          if (!existing || existing.trainingPlanId !== plan.id)
            throw apiError(
              HttpStatus.FORBIDDEN,
              'FORBIDDEN',
              'The edited workout does not belong to this plan.',
            );
        }
        return {
          available: true,
          ...(await this.validateAdmission(tx, plan, this.draftFrom(dto), dto.excludeWorkoutId)),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async syncCareDates(dates: Date[]) {
    if (!this.dailyTasks) return;
    const days = new Set(dates.map(clubDate));
    for (const day of days) {
      try {
        await this.dailyTasks.generateDailyTasksForDate(new Date(`${day}T00:00:00.000Z`));
      } catch (error) {
        this.logger.warn(`Could not refresh workout preparation for ${day}: ${String(error)}`);
      }
    }
  }

  /**
   * Kiểm tra DL-2.01 theo thứ tự ưu tiên của đặc tả. Gọi trong transaction đã khóa dòng ngựa.
   * - Ném lỗi khi bị chặn (1-5).
   * - Trả về medicalOverride (HT xếp bài nặng lúc ngựa ở trạng thái y tế, đã xác nhận)
   *   và warnings (6: chỉ cảnh báo, HT bấm Lưu lần 2 để xác nhận).
   */
  async validateAdmission(
    tx: Tx,
    plan: PlanForCheck,
    w: WorkoutDraft,
    excludeWorkoutId?: string,
  ): Promise<{ medicalOverride: boolean; warnings: string[] }> {
    if (plan.status !== PlanStatus.DRAFT && plan.status !== PlanStatus.ACTIVE) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'PLAN_CLOSED',
        'Giáo án đã hoàn thành hoặc đã hủy nên không xếp thêm buổi tập.',
      );
    }
    const horse = await tx.horse.findUnique({
      where: { id: plan.horseId },
      include: {
        medicalLocks: { where: { isLocked: true }, select: { id: true }, take: 1 },
        stallAllocations: {
          where: { isActive: true },
          select: { stall: { select: { zoneId: true } } },
        },
      },
    });
    if (!horse || horse.deletedAt) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Target horse not found.');
    }
    const heavy = isHeavy(w.workoutType, w.intensity);

    // 1. Khóa y tế + bài nặng: chặn, không vai trò nào vượt qua (RULE-MED-01).
    if (horse.isMedicalLocked || (horse.medicalLocks?.length ?? 0) > 0) {
      throw apiError(
        HttpStatus.CONFLICT,
        'MEDICAL_LOCK_ACTIVE',
        'Ngựa đang bị Khóa huấn luyện y tế. Không thể xếp buổi tập mới cho đến khi bác sĩ giải trừ khóa.',
      );
    }
    // 1b. Lưu giữ do nợ phí + bài nặng: chặn, chỉ cho phép đi bộ / vận động nhẹ (WALK)
    if (horse.isDebtImpounded && heavy) {
      throw apiError(
        HttpStatus.CONFLICT,
        'DEBT_IMPOUNDED',
        'Ngựa đang bị lưu giữ do nợ phí. Chỉ được phép đi bộ / vận động nhẹ (WALK), không được xếp bài tập nặng.',
      );
    }
    // 2. Ngựa ngừng quản lý hoặc cách ly.
    if (horse.status === HorseStatus.RETIRED) {
      throw apiError(HttpStatus.BAD_REQUEST, 'HORSE_RETIRED', 'Ngựa đã ngừng quản lý.');
    }
    if (horse.status === HorseStatus.ISOLATED) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'HORSE_ISOLATED',
        'Ngựa đang ở trạng thái Cách ly kiểm dịch, không được xếp lịch tập luyện ra sân chung.',
      );
    }

    // Kiểm tra ô nhập phụ thuộc nhau (DTO không tự kiểm được).
    const now = effectiveNow();
    if (w.scheduledDate < startOfClubDay(now)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'DATE_IN_PAST',
        'Không thể xếp buổi tập vào ngày đã qua.',
      );
    }
    if (
      clubDate(w.scheduledDate) === clubDate(now) &&
      w.scheduledDate.getTime() < now.getTime() + 29 * 60 * 1000
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TIME_TOO_SOON',
        'Thời gian bắt đầu buổi tập trong ngày hôm nay phải sau thời gian hiện tại ít nhất 30 phút.',
      );
    }
    if (!withinTrainingHours(w.scheduledDate)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'OUTSIDE_TRAINING_HOURS',
        'Giờ bắt đầu phải từ 04:00 đến 20:00.',
      );
    }
    const { hour, minute } = clubTime(w.scheduledDate);
    const startMins = hour * 60 + minute;
    const durMins = workoutDurationMinutes(w.workoutType);
    if (startMins + durMins > 17 * 60) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'EXCEEDS_AFTERNOON_LIMIT',
        'Buổi tập phải kết thúc trước hoặc đúng 17:00 chiều để đảm bảo giờ nghỉ ngơi và ăn tối của ngựa. Giờ bắt đầu muộn nhất là 16:00.',
      );
    }
    if (
      w.scheduledDate < startOfClubDay(plan.startDate) ||
      w.scheduledDate >= addDays(startOfClubDay(plan.endDate), 1)
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'OUTSIDE_PLAN_DATES',
        'Ngày tập phải nằm trong thời gian của giáo án.',
      );
    }
    // Giai đoạn: giáo án có giai đoạn thì buổi tập phải thuộc một giai đoạn và nằm trong ngày của nó.
    const phases = phasesOf(plan);
    const phase = phases.find((p) => p.id === w.phaseId);
    if (phases.length > 0) {
      if (!phase) {
        throw apiError(HttpStatus.BAD_REQUEST, 'PHASE_REQUIRED', 'Vui lòng chọn giai đoạn.');
      }
      const day = clubDate(w.scheduledDate);
      if (day < phase.startDate || day > phase.endDate) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'OUTSIDE_PHASE_DATES',
          `Ngày tập phải nằm trong giai đoạn ${phase.name} (${phase.startDate} – ${phase.endDate}).`,
        );
      }
    }
    if (['BREEZE', 'TRIAL'].includes(w.workoutType)) {
      if (w.targetSpeedKmh == null) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'TARGET_SPEED_REQUIRED',
          'Tốc độ mục tiêu là bắt buộc với bài chạy tốc độ và chạy thử.',
        );
      }
    }
    if (w.distanceMeters * w.repetitions > MAX_SESSION_DISTANCE_METERS) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'SESSION_DISTANCE_TOO_LONG',
        'Tổng cự ly (cự ly mỗi hiệp × số hiệp) không được vượt quá 10 000 m.',
      );
    }
    // #4, #7: HLV của giáo án tự dẫn buổi tập và cưỡi luôn (kiêm nài), không giao cho Groom nữa.
    const trainer = plan.trainerUserId
      ? await tx.user.findUnique({ where: { id: plan.trainerUserId } })
      : null;
    if (!trainer || trainer.role !== Role.HEAD_TRAINER || trainer.status !== UserStatus.ACTIVE) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_TRAINER',
        'HLV phụ trách giáo án không còn hoạt động.',
      );
    }
    await assertTrainerZone(tx, horse.id, horse.stallAllocations?.[0]?.stall.zoneId, [trainer.id]);
    w.assignedStaffUserId = trainer.id;
    w.jockeyName = trainer.fullName;

    const notSelf = excludeWorkoutId ? { id: { not: excludeWorkoutId } } : {};
    const live = { ...notSelf, status: { not: WorkoutStatus.CANCELLED } };

    const newStart = w.scheduledDate.getTime();
    const newDur = workoutDurationMinutes(w.workoutType);
    const newEnd = newStart + (newDur + GROOM_BUFFER_MINUTES) * 60 * 1000;
    const trainerEnd = newStart + (newDur + TRAINER_BUFFER_MINUTES) * 60 * 1000;
    const maxPreWindow = 120 * 60 * 1000;

    // 2b. Ngựa không thể có 2 buổi tập trùng thời điểm (cách nhau dưới 30 phút).
    const timeOverlap = await tx.workoutSession.findFirst({
      where: {
        ...live,
        horseId: plan.horseId || '',
        scheduledDate: {
          gte: new Date(w.scheduledDate.getTime() - 29 * 60 * 1000),
          lte: new Date(w.scheduledDate.getTime() + 29 * 60 * 1000),
        },
      },
      select: { id: true, scheduledDate: true, ...TRAINER_OF_WORKOUT },
    });
    if (timeOverlap) {
      const c = conflictInfo(timeOverlap.scheduledDate, 30, timeOverlap);
      throw apiError(
        HttpStatus.CONFLICT,
        'HORSE_WORKOUT_TIME_CONFLICT',
        `Ngựa đã có buổi tập khác lúc ${c.time} ngày ${c.date} (HLV ${c.trainer}). Chọn giờ bắt đầu từ ${c.before} trở về trước, hoặc từ ${c.after} trở đi.`,
        { workoutId: timeOverlap.id, ...c },
      );
    }

    // BR-TRN-SLOT-HT: Một HLV chỉ điều hành 1 buổi tập tại một thời điểm (không thể phân thân)
    if (plan.trainerUserId) {
      const trainerWorkouts = await tx.workoutSession.findMany({
        where: {
          ...live,
          trainingPlan: { trainerUserId: plan.trainerUserId },
          scheduledDate: {
            gte: new Date(newStart - maxPreWindow),
            lte: new Date(trainerEnd),
          },
        },
        select: {
          id: true,
          scheduledDate: true,
          workoutType: true,
          horse: { select: { name: true } },
          ...TRAINER_OF_WORKOUT,
        },
      });
      const busyTrainer = trainerWorkouts.find((other) => {
        if (!other?.scheduledDate || typeof other.scheduledDate.getTime !== 'function')
          return false;
        const otherStart = other.scheduledDate.getTime();
        const otherDur = workoutDurationMinutes(other.workoutType);
        const otherEnd = otherStart + (otherDur + TRAINER_BUFFER_MINUTES) * 60 * 1000;
        return newStart < otherEnd && otherStart < trainerEnd;
      });
      if (busyTrainer) {
        const c = conflictInfo(busyTrainer.scheduledDate, TRAINER_BUFFER_MINUTES, busyTrainer);
        throw apiError(
          HttpStatus.CONFLICT,
          'TRAINER_TIME_CONFLICT',
          `Huấn luyện viên ${busyTrainer.trainingPlan?.trainer?.fullName ?? 'này'} đã có buổi tập của ngựa ${busyTrainer.horse.name} lúc ${c.time} ngày ${c.date}. HLV chỉ có thể điều hành 1 buổi tập tại một thời điểm. Chọn giờ bắt đầu từ ${c.before} trở về trước hoặc từ ${c.after} trở đi.`,
          { workoutId: busyTrainer.id, horse: busyTrainer.horse.name, ...c },
        );
      }
    }

    // 3. Chạy thử trùng mặt sân trong cùng khung 15 phút (DL-2.01)
    if (w.workoutType === 'TRIAL') {
      const slot = TRIAL_SLOT_MINUTES * 60 * 1000;
      const clash = await tx.workoutSession.findFirst({
        where: {
          ...live,
          workoutType: 'TRIAL',
          trackSurface: w.trackSurface,
          scheduledDate: {
            gt: new Date(w.scheduledDate.getTime() - slot),
            lt: new Date(w.scheduledDate.getTime() + slot),
          },
        },
        select: {
          id: true,
          scheduledDate: true,
          horse: { select: { name: true } },
          ...TRAINER_OF_WORKOUT,
        },
      });
      if (clash) {
        const c = conflictInfo(clash.scheduledDate, TRIAL_SLOT_MINUTES, clash);
        const surface = SURFACE_LABEL[w.trackSurface] ?? w.trackSurface;
        throw apiError(
          HttpStatus.CONFLICT,
          'TRIAL_SLOT_TAKEN',
          `Mặt sân ${surface} đã có lượt chạy thử của ${clash.horse.name} lúc ${c.time} ngày ${c.date} (HLV ${c.trainer}). Chọn giờ bắt đầu từ ${c.before} trở về trước, hoặc từ ${c.after} trở đi.`,
          { workoutId: clash.id, horse: clash.horse.name, surface: w.trackSurface, ...c },
        );
      }
    }

    // BR-TRN-TRACK-CAPACITY: Kiểm tra sức chứa mặt sân & bài tập nặng độc quyền sân
    if (w.trackSurface && w.trackSurface !== 'NONE') {
      const trackWorkouts = await tx.workoutSession.findMany({
        where: {
          ...live,
          trackSurface: w.trackSurface,
          scheduledDate: {
            gte: new Date(newStart - maxPreWindow),
            lte: new Date(newEnd),
          },
        },
        select: {
          id: true,
          scheduledDate: true,
          workoutType: true,
          intensity: true,
          horse: { select: { name: true } },
          ...TRAINER_OF_WORKOUT,
        },
      });
      const activeOnTrack = trackWorkouts.filter((other) => {
        if (!other?.scheduledDate || typeof other.scheduledDate.getTime !== 'function')
          return false;
        const otherStart = other.scheduledDate.getTime();
        const otherDur = workoutDurationMinutes(other.workoutType);
        const otherEnd = otherStart + (otherDur + 15) * 60 * 1000;
        return newStart < otherEnd && otherStart < newEnd;
      });

      const surfaceName = SURFACE_LABEL[w.trackSurface] ?? w.trackSurface;

      // 1. Bài tập nặng (BREEZE, HEAVY) độc quyền toàn bộ mặt sân
      if (heavy && activeOnTrack.length > 0 && w.workoutType !== 'TRIAL') {
        const clash = activeOnTrack[0];
        const c = conflictInfo(clash.scheduledDate, 20, clash);
        throw apiError(
          HttpStatus.CONFLICT,
          'TRACK_HEAVY_COLLISION',
          `Mặt sân ${surfaceName} đang có buổi tập của ngựa ${clash.horse.name} lúc ${c.time} ngày ${c.date} (HLV ${c.trainer}). Bài tập tốc độ cao (${w.workoutType}) yêu cầu độc quyền đường chạy để tránh va chạm.`,
          { workoutId: clash.id, horse: clash.horse.name, surface: w.trackSurface, ...c },
        );
      }

      // 2. Nếu mặt sân đang có bài tập nặng của ngựa khác -> Chặn ngựa khác vào sân
      const heavyOnTrack = activeOnTrack.find((x) => isHeavy(x.workoutType, x.intensity));
      if (heavyOnTrack) {
        const c = conflictInfo(heavyOnTrack.scheduledDate, 20, heavyOnTrack);
        throw apiError(
          HttpStatus.CONFLICT,
          'TRACK_HEAVY_OCCUPIED',
          `Mặt sân ${surfaceName} đang có lượt chạy tốc độ cao của ngựa ${heavyOnTrack.horse.name} lúc ${c.time} ngày ${c.date}. Không thể cho ngựa khác vào sân trong thời gian này.`,
          {
            workoutId: heavyOnTrack.id,
            horse: heavyOnTrack.horse.name,
            surface: w.trackSurface,
            ...c,
          },
        );
      }

      // 3. Bài nhẹ: Tối đa TRACK_MAX_LIGHT_HORSES (3) ngựa cùng lúc
      if (activeOnTrack.length >= TRACK_MAX_LIGHT_HORSES) {
        const c = conflictInfo(activeOnTrack[0].scheduledDate, 30, activeOnTrack[0]);
        throw apiError(
          HttpStatus.CONFLICT,
          'TRACK_CAPACITY_EXCEEDED',
          `Mặt sân ${surfaceName} đã đạt sức chứa tối đa (${TRACK_MAX_LIGHT_HORSES} chiến mã cùng lúc) lúc ${c.time} ngày ${c.date}. Vui lòng chọn khung giờ khác để đảm bảo khoảng cách an toàn.`,
          { surface: w.trackSurface, ...c },
        );
      }
    }

    // BR-TRN-PRIME-QUOTA: Hạn ngạch giờ vàng (06:15 - 08:00) tối đa 2 bài nặng / HLV mỗi sáng
    if (plan.trainerUserId && heavy && isWithinPrimeTime(w.scheduledDate)) {
      const dStart = startOfClubDay(w.scheduledDate);
      const primeStart = new Date(
        dStart.getTime() + (PRIME_TIME_START_HOUR * 60 + PRIME_TIME_START_MINUTE) * 60 * 1000,
      );
      const primeEnd = new Date(
        dStart.getTime() + (PRIME_TIME_END_HOUR * 60 + PRIME_TIME_END_MINUTE) * 60 * 1000,
      );

      const primeHeavyCount = await tx.workoutSession.count({
        where: {
          ...live,
          trainingPlan: { trainerUserId: plan.trainerUserId },
          scheduledDate: { gte: primeStart, lt: primeEnd },
          OR: [{ intensity: 'HEAVY' }, { workoutType: { in: ALWAYS_HEAVY_TYPES } }],
        },
      });

      if (primeHeavyCount >= MAX_PRIME_HEAVY_SESSIONS_PER_TRAINER) {
        throw apiError(
          HttpStatus.CONFLICT,
          'PRIME_TIME_QUOTA_EXCEEDED',
          `Mỗi Huấn luyện viên chỉ được đăng ký tối đa ${MAX_PRIME_HEAVY_SESSIONS_PER_TRAINER} buổi tập nặng trong Khung giờ vàng (06:15 - 08:00) mỗi sáng để đảm bảo công bằng cho các HLV khác.`,
        );
      }
    }

    // BR-TRN-JOCKEY-CONCURRENCY: Một nài ngựa không thể cưỡi 2 ngựa cùng lúc
    if (w.jockeyName && w.jockeyName.trim()) {
      const jockeyTrimmed = w.jockeyName.trim();
      const jockeyWorkouts = await tx.workoutSession.findMany({
        where: {
          ...live,
          jockeyName: { equals: jockeyTrimmed, mode: 'insensitive' },
          scheduledDate: {
            gte: new Date(newStart - maxPreWindow),
            lte: new Date(newEnd),
          },
        },
        select: {
          id: true,
          scheduledDate: true,
          workoutType: true,
          horse: { select: { name: true } },
          ...TRAINER_OF_WORKOUT,
        },
      });
      const busyJockey = jockeyWorkouts.find((other) => {
        if (!other?.scheduledDate || typeof other.scheduledDate.getTime !== 'function')
          return false;
        const otherStart = other.scheduledDate.getTime();
        const otherDur = workoutDurationMinutes(other.workoutType);
        const otherEnd = otherStart + (otherDur + 15) * 60 * 1000;
        return newStart < otherEnd && otherStart < newEnd;
      });
      if (busyJockey) {
        const c = conflictInfo(busyJockey.scheduledDate, 30, busyJockey);
        throw apiError(
          HttpStatus.CONFLICT,
          'JOCKEY_TIME_CONFLICT',
          `Nài ngựa ${jockeyTrimmed} đã được xếp cưỡi ngựa ${busyJockey.horse.name} lúc ${c.time} ngày ${c.date} (HLV ${c.trainer}). Một nài ngựa không thể cưỡi 2 chiến mã cùng một lúc.`,
          { workoutId: busyJockey.id, horse: busyJockey.horse.name, ...c },
        );
      }
    }

    // 4. Tối đa 3 buổi mỗi ngày cho 1 ngựa.
    const dayStart = startOfClubDay(w.scheduledDate);
    const sameDay = await tx.workoutSession.count({
      where: {
        ...live,
        horseId: plan.horseId || '',
        scheduledDate: { gte: dayStart, lt: addDays(dayStart, 1) },
      },
    });
    if (sameDay >= MAX_WORKOUTS_PER_DAY) {
      throw apiError(
        HttpStatus.CONFLICT,
        'MAX_WORKOUTS_PER_DAY',
        'Mỗi ngựa tối đa 3 buổi tập mỗi ngày.',
      );
    }

    // 5. Ngựa ở trạng thái y tế (không khóa) + bài nặng: HT phải xác nhận (DL-2.06).
    const medical = MEDICAL_STATUSES.includes(horse.status) && heavy;
    if (medical && !w.vetConsulted) {
      throw apiError(
        HttpStatus.CONFLICT,
        'VET_CONFIRMATION_REQUIRED',
        `Ngựa đang ở trạng thái ${horse.status}. Bài tập nặng có thể ảnh hưởng tới hồi phục.`,
        { horseStatus: horse.status },
      );
    }

    // 6. Cảnh báo (không chặn).
    const warnings: string[] = [];
    if (phase) {
      const weekStart = startOfClubWeek(w.scheduledDate);
      const week = await tx.workoutSession.findMany({
        where: {
          ...live,
          trainingPlanId: plan.id,
          phaseId: phase.id,
          scheduledDate: { gte: weekStart, lt: addDays(weekStart, 7) },
        },
        select: { distanceMeters: true, repetitions: true },
      });
      const total =
        week.reduce((sum, x) => sum + x.distanceMeters * x.repetitions, 0) +
        w.distanceMeters * w.repetitions;
      if (total > phase.maxWeeklyDistance) {
        warnings.push(`Tổng cự ly tuần ${total} m vượt định mức ${phase.maxWeeklyDistance} m.`);
      }
      if (week.length + 1 > phase.sessionsPerWeek) {
        warnings.push(
          `Số buổi trong tuần (${week.length + 1}) vượt định mức ${phase.sessionsPerWeek} buổi/tuần của giai đoạn ${phase.name}.`,
        );
      }
    }
    if (heavy) {
      const gap = HEAVY_GAP_HOURS * 60 * 60 * 1000;
      const near = await tx.workoutSession.findMany({
        where: {
          ...live,
          horseId: plan.horseId || '',
          scheduledDate: {
            gt: new Date(w.scheduledDate.getTime() - gap),
            lt: new Date(w.scheduledDate.getTime() + gap),
          },
        },
        select: { scheduledDate: true, workoutType: true, intensity: true },
      });
      const other = near.find((x) => isHeavy(x.workoutType, x.intensity));
      if (other) {
        warnings.push(
          `Ngựa có bài tập nặng khác lúc ${clubDate(other.scheduledDate)}, cách chưa đủ 48 giờ.`,
        );
      }
    }
    await new WorkoutAvailabilityService().validate(
      tx,
      { ...w, horseId: plan.horseId || '', trainerUserId: plan.trainerUserId || '' },
      excludeWorkoutId,
    );

    // 8. #6: mỗi ngày một HLV chỉ làm việc trên một mặt sân (Bơi / Máy đi bộ không tính).
    if (w.trackSurface !== 'NONE' && tx.workoutSession?.findFirst) {
      const day = startOfClubDay(w.scheduledDate);
      const otherTrack = await tx.workoutSession.findFirst({
        where: {
          ...live,
          trainingPlan: { trainerUserId: trainer.id },
          scheduledDate: { gte: day, lt: addDays(day, 1) },
          trackSurface: { notIn: ['NONE', w.trackSurface] },
        },
        select: { id: true, trackSurface: true, horse: { select: { name: true } } },
      });
      if (otherTrack) {
        const surface = SURFACE_LABEL[otherTrack.trackSurface ?? ''] ?? otherTrack.trackSurface;
        throw apiError(
          HttpStatus.CONFLICT,
          'TRAINER_TRACK_CONFLICT',
          `Ngày ${clubDate(w.scheduledDate).split('-').reverse().join('/')} HLV ${trainer.fullName} đã tập ${otherTrack.horse.name} trên mặt sân ${surface}. Mỗi ngày một HLV chỉ làm việc trên một mặt sân.`,
          {
            workoutId: otherTrack.id,
            surface: otherTrack.trackSurface,
            horse: otherTrack.horse.name,
          },
        );
      }
    }

    if (w.assignedStaffUserId) {
      const groom = await tx.user.findUnique({ where: { id: w.assignedStaffUserId } });
      if (groom) {
        // BR-TRN-GROOM-ZONE: Kiểm tra ca trực và phân khu chuồng của Groom
        if (tx.shiftRoster?.findMany) {
          const dayStart = startOfClubDay(w.scheduledDate);
          const rosters = await tx.shiftRoster.findMany({
            where: {
              groomUserId: w.assignedStaffUserId,
              date: { gte: dayStart, lt: addDays(dayStart, 1) },
            },
            include: { shift: true, zone: true },
          });
          if (rosters.length === 0) {
            warnings.push(
              `Nhân viên ${groom.fullName} không có ca trực trong ngày ${clubDate(w.scheduledDate)}.`,
            );
          } else {
            // Kiểm tra giờ tập có nằm trong khung giờ ca trực không
            const { hour, minute } = clubTime(w.scheduledDate);
            const targetMins = hour * 60 + minute;
            const withinShift = rosters.some((r) => {
              if (!r.shift) return true;
              const [sh, sm] = (r.shift.startTime || '00:00').split(':').map(Number);
              const [eh, em] = (r.shift.endTime || '23:59').split(':').map(Number);
              const sM = sh * 60 + (sm || 0);
              const eM = eh * 60 + (em || 0);
              return r.shift.isOvernight
                ? targetMins >= sM || targetMins <= eM
                : targetMins >= sM && targetMins <= eM;
            });
            if (!withinShift) {
              warnings.push(
                `Giờ bắt đầu buổi tập (${hhmm(w.scheduledDate)}) không nằm trong khung giờ ca trực của nhân viên ${groom.fullName}.`,
              );
            }

            // Kiểm tra ô chuồng của ngựa: nếu khác phân khu trực của groom thì phát cảnh báo mượn nhân sự
            if (tx.stallAllocation?.findFirst) {
              const alloc = await tx.stallAllocation.findFirst({
                where: { horseId: plan.horseId || '', isActive: true },
              });
              let horseZoneId: string | null = null;
              let horseZoneName: string | null = null;
              if (alloc?.stallId && tx.stall?.findUnique) {
                const stall = await tx.stall.findUnique({
                  where: { id: alloc.stallId },
                  include: { zoneRef: true },
                });
                horseZoneId = stall?.zoneId ?? null;
                horseZoneName = stall?.zoneRef?.name || stall?.zone || null;
              }
              if (horseZoneId && !rosters.some((r) => r.zoneId === horseZoneId)) {
                const groomZones = rosters.map((r) => r.zone?.name || r.zoneId).join(', ');
                warnings.push(
                  `Nhân viên ${groom.fullName} đang trực tại khu ${groomZones}, trong khi ngựa ${horse.name} ở khu ${horseZoneName || horseZoneId}. Đây là điều động mượn nhân sự liên khu chuồng.`,
                );
              }
            }
          }
        }

        // BR-TRN-GROOM-DAILY-LIMIT: Kiểm tra định mức tải công việc tối đa trong ngày của Groom
        if (tx.workoutSession?.findMany) {
          const dayStart = startOfClubDay(w.scheduledDate);
          const sameDayGroomWorkouts = await tx.workoutSession.findMany({
            where: {
              ...live,
              assignedStaffUserId: w.assignedStaffUserId,
              scheduledDate: { gte: dayStart, lt: addDays(dayStart, 1) },
              ...(excludeWorkoutId ? { id: { not: excludeWorkoutId } } : {}),
            },
            select: { id: true, workoutType: true, intensity: true },
          });
          if (Array.isArray(sameDayGroomWorkouts)) {
            if (sameDayGroomWorkouts.length >= MAX_DAILY_WORKOUTS_PER_GROOM) {
              warnings.push(
                `Nhân viên ${groom.fullName} đã được giao ${sameDayGroomWorkouts.length} ca tập trong ngày ${clubDate(w.scheduledDate)} (đạt định mức tối đa ${MAX_DAILY_WORKOUTS_PER_GROOM} ca/ngày). Cần xác nhận nếu tiếp tục phân công.`,
              );
            }
            if (heavy) {
              const heavyCount = sameDayGroomWorkouts.filter((sw) =>
                isHeavy(sw.workoutType, sw.intensity),
              ).length;
              if (heavyCount >= MAX_DAILY_HEAVY_WORKOUTS_PER_GROOM) {
                warnings.push(
                  `Nhân viên ${groom.fullName} đã phụ trách ${heavyCount} bài tập nặng trong ngày (đạt định mức tối đa ${MAX_DAILY_HEAVY_WORKOUTS_PER_GROOM} bài nặng/ngày). Cần lưu ý thể lực nhân sự.`,
                );
              }
            }
          }
        }

        // 7. Một người chăm sóc không thể kèm 2 ngựa cùng lúc (phải cách nhau thời lượng + 15 phút đệm chuyển tiếp theo BR-TRN-24).
      }
    }

    let busy: {
      id: string;
      scheduledDate: Date;
      workoutType?: string | null;
      horse: { name: string };
      trainingPlan: { trainer: { fullName: string } } | null;
    } | null = null;

    if (tx.workoutSession?.findMany) {
      const candidates = await tx.workoutSession.findMany({
        where: {
          ...live,
          assignedStaffUserId: w.assignedStaffUserId,
          scheduledDate: {
            gte: new Date(newStart - maxPreWindow),
            lte: new Date(newEnd),
          },
        },
        select: {
          id: true,
          scheduledDate: true,
          workoutType: true,
          horse: { select: { name: true } },
          ...TRAINER_OF_WORKOUT,
        },
        orderBy: { scheduledDate: 'asc' },
      });
      if (Array.isArray(candidates) && candidates.length > 0) {
        busy =
          candidates.find((other) => {
            if (!other?.scheduledDate || typeof other.scheduledDate.getTime !== 'function')
              return false;
            const otherStart = other.scheduledDate.getTime();
            const otherDur = workoutDurationMinutes(other.workoutType);
            const otherEnd = otherStart + (otherDur + GROOM_BUFFER_MINUTES) * 60 * 1000;
            return newStart < otherEnd && otherStart < newEnd;
          }) ?? null;
      }
    }

    // Fallback cho findFirst (hỗ trợ cả mock trong unit test)
    if (!busy && tx.workoutSession?.findFirst) {
      const fallbackOverlap = (newDur + GROOM_BUFFER_MINUTES) * 60 * 1000;
      busy = await tx.workoutSession.findFirst({
        where: {
          ...live,
          assignedStaffUserId: w.assignedStaffUserId,
          scheduledDate: {
            gt: new Date(newStart - fallbackOverlap),
            lt: new Date(newStart + fallbackOverlap),
          },
        },
        select: {
          id: true,
          scheduledDate: true,
          workoutType: true,
          horse: { select: { name: true } },
          ...TRAINER_OF_WORKOUT,
        },
      });
    }

    if (busy) {
      const c = conflictInfo(busy.scheduledDate, GROOM_OVERLAP_MINUTES, busy);
      throw apiError(
        HttpStatus.CONFLICT,
        'GROOM_TIME_CONFLICT',
        `Nhân viên ${busy.trainingPlan?.trainer.fullName || 'này'} đã được giao buổi tập của ${busy.horse.name} lúc ${c.time} ngày ${c.date} (HLV ${c.trainer}). Chọn người chăm sóc khác, hoặc chọn giờ bắt đầu từ ${c.before} trở về trước hoặc từ ${c.after} trở đi.`,
        { workoutId: busy.id, horse: busy.horse.name, ...c },
      );
    }

    return { medicalOverride: medical, warnings };
  }

  /** Cảnh báo chưa được HT xác nhận -> trả 409 kèm danh sách để FE hiện khung vàng. */
  private assertWarningsAcknowledged(warnings: string[], acknowledged?: boolean) {
    if (warnings.length > 0 && !acknowledged) {
      throw apiError(HttpStatus.CONFLICT, 'WARNINGS_NEED_CONFIRMATION', warnings.join(' '), {
        warnings,
      });
    }
  }

  private draftFrom(dto: CreateWorkoutSessionDto, scheduledDate = new Date(dto.scheduledDate)) {
    return {
      scheduledDate,
      trackId: effectiveSurface(dto.workoutType, dto.trackSurface) === 'NONE' ? null : dto.trackId,
      phaseId: dto.phaseId,
      workoutType: dto.workoutType,
      intensity: effectiveIntensity(dto.workoutType, dto.intensity),
      trackSurface: effectiveSurface(dto.workoutType, dto.trackSurface),
      distanceMeters: dto.distanceMeters,
      repetitions: dto.repetitions ?? 1,
      targetSpeedKmh: dto.targetSpeedKmh,
      jockeyName: dto.jockeyName,
      assignedStaffUserId: dto.assignedStaffUserId,
      vetConsulted: dto.vetConsulted,
    } satisfies WorkoutDraft;
  }

  private createData(
    plan: { id: string; horseId: string },
    draft: WorkoutDraft,
    dto: CreateWorkoutSessionDto,
    medicalOverride: boolean,
  ): Prisma.WorkoutSessionUncheckedCreateInput {
    return {
      trainingPlanId: plan.id,
      horseId: plan.horseId || '',
      phaseId: draft.phaseId,
      scheduledDate: draft.scheduledDate,
      workoutType: draft.workoutType,
      intensity: draft.intensity,
      trackSurface: draft.trackSurface,
      trackId: draft.trackSurface === 'NONE' ? null : draft.trackId,
      distanceMeters: draft.distanceMeters,
      repetitions: draft.repetitions,
      targetSpeedKmh: draft.targetSpeedKmh,
      jockeyName: draft.jockeyName,
      assignedStaffUserId: draft.assignedStaffUserId,
      trainerNotes: dto.trainerNotes,
      status: WorkoutStatus.SCHEDULED,
      medicalOverride,
    };
  }

  /** DL-2.01 Thêm buổi tập vào giáo án Nháp / Đang áp dụng (HT). */
  async createWorkout(planId: string, dto: CreateWorkoutSessionDto, user: CurrentUserPayload) {
    const session = await this.prisma.$transaction(async (tx) => {
      await lockWorkoutSchedule(tx);
      const plan = await tx.trainingPlan.findUnique({ where: { id: planId } });
      if (!plan) {
        throw apiError(HttpStatus.NOT_FOUND, 'PLAN_NOT_FOUND', 'Training plan not found.');
      }
      if (user.role === UserRole.HEAD_TRAINER && plan.trainerUserId !== user.userId) {
        throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This plan belongs to another trainer.');
      }
      await tx.$queryRaw`SELECT "id" FROM "TrainingPlan" WHERE "id" = ${planId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${plan.horseId} FOR UPDATE`;

      const draft = this.draftFrom(dto);
      const { medicalOverride, warnings } = await this.validateAdmission(tx, plan, draft);
      this.assertWarningsAcknowledged(warnings, dto.acknowledgeWarnings);

      const session = await tx.workoutSession.create({
        data: this.createData(plan, draft, dto, medicalOverride),
        include: WORKOUT_INCLUDE,
      });

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'CREATE_WORKOUT_SESSION',
        `Scheduled ${session.workoutType} (${session.distanceMeters}m) for plan "${plan.phaseName}"`,
        session.id,
        { entityName: 'WorkoutSession', newValues: { medicalOverride, warnings } },
        tx,
      );
      return session;
    });
    await this.syncCareDates([session.scheduledDate]);
    return session;
  }

  /**
   * DL-2.01 "Lặp lại hằng tuần": tạo buổi cùng giờ vào các thứ đã chọn tới ngày "Lặp đến".
   * Ngày vướng kiểm tra 1-4 thì bỏ qua và báo lại; cảnh báo (6) không chặn khi lặp.
   */
  async createRepeatWorkouts(planId: string, dto: RepeatWorkoutDto, user: CurrentUserPayload) {
    const careDates: Date[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      await lockWorkoutSchedule(tx);
      const plan = await tx.trainingPlan.findUnique({ where: { id: planId } });
      if (!plan) {
        throw apiError(HttpStatus.NOT_FOUND, 'PLAN_NOT_FOUND', 'Training plan not found.');
      }
      if (user.role === UserRole.HEAD_TRAINER && plan.trainerUserId !== user.userId) {
        throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This plan belongs to another trainer.');
      }
      await tx.$queryRaw`SELECT "id" FROM "TrainingPlan" WHERE "id" = ${planId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${plan.horseId} FOR UPDATE`;

      const first = new Date(dto.scheduledDate);
      const timeOfDay = first.getTime() - startOfClubDay(first).getTime();
      const until = dto.until.slice(0, 10);
      const phase = phasesOf(plan).find((p) => p.id === dto.phaseId);
      if (phase && until > phase.endDate) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'REPEAT_BEYOND_PHASE',
          'Lặp đến ngày không được sau ngày kết thúc giai đoạn.',
        );
      }

      const dates: Date[] = [];
      for (let day = startOfClubDay(first); clubDate(day) <= until; day = addDays(day, 1)) {
        const weekday = new Date(day.getTime() + 7 * 60 * 60 * 1000).getUTCDay() || 7; // 1..7
        if (dto.weekdays.includes(weekday)) dates.push(new Date(day.getTime() + timeOfDay));
      }
      if (dates.length === 0) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'NO_REPEAT_DATES',
          'Không có ngày nào khớp các thứ đã chọn.',
        );
      }
      if (dates.length > MAX_REPEAT_WORKOUTS) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'TOO_MANY_REPEATS',
          'Mỗi lần chỉ tạo tối đa 60 buổi tập.',
        );
      }

      const skippable = [
        'MEDICAL_LOCK_ACTIVE',
        'HORSE_RETIRED',
        'TRIAL_SLOT_TAKEN',
        'TRACK_CAPACITY_EXCEEDED',
        'TRAINER_BUSY_SLOT',
        'WORKOUT_REST_REQUIRED',
        'MAX_WORKOUTS_PER_DAY',
        'HORSE_WORKOUT_TIME_CONFLICT',
        'TRAINER_TIME_CONFLICT',
        'TRAINER_TRACK_CONFLICT',
        'DATE_IN_PAST',
        'TIME_TOO_SOON',
        'OUTSIDE_PHASE_DATES',
        'OUTSIDE_PLAN_DATES',
        'TRACK_HEAVY_OCCUPIED',
        'TRACK_HEAVY_COLLISION',
        'TRACK_CAPACITY_EXCEEDED',
        'GROOM_TIME_CONFLICT',
        'TRAINER_TIME_CONFLICT',
        'PRIME_TIME_QUOTA_EXCEEDED',
        'JOCKEY_TIME_CONFLICT',
        'EXCEEDS_AFTERNOON_LIMIT',
        'DEBT_IMPOUNDED',
      ];
      const created: string[] = [];
      const skipped: { date: string; reason: string }[] = [];
      const allWarnings: { date: string; warnings: string[] }[] = [];
      for (const date of dates) {
        const draft = this.draftFrom(dto, date);
        try {
          const { medicalOverride, warnings } = await this.validateAdmission(tx, plan, draft);
          if (warnings && warnings.length > 0) {
            allWarnings.push({ date: clubDate(date), warnings });
          }
          const row = await tx.workoutSession.create({
            data: this.createData(plan, draft, dto, medicalOverride),
          });
          created.push(row.id);
          careDates.push(date);
        } catch (e: any) {
          const body = typeof e?.getResponse === 'function' ? e.getResponse() : null;
          if (!body || !skippable.includes(body.code)) throw e;
          skipped.push({ date: clubDate(date), reason: body.message });
        }
      }

      // H-12: Bắt buộc xác nhận cảnh báo nếu chuỗi lặp tạo ra cảnh báo an toàn
      if (allWarnings.length > 0 && !dto.acknowledgeWarnings) {
        throw apiError(
          HttpStatus.CONFLICT,
          'WARNINGS_NEED_CONFIRMATION',
          `Phát hiện cảnh báo an toàn cho chuỗi buổi tập: ${allWarnings.map((w) => `${w.date}: ${w.warnings.join('; ')}`).join(' | ')}`,
          { warnings: allWarnings },
        );
      }

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'CREATE_WORKOUT_SERIES',
        `Scheduled ${created.length} weekly workouts for plan "${plan.phaseName}" (${skipped.length} skipped)`,
        plan.id,
        {
          entityName: 'TrainingPlan',
          newValues: { created: created.length, skipped, warnings: allWarnings },
        },
        tx,
      );
      return {
        created: created.length,
        workoutIds: created,
        skipped,
        warnings: allWarnings,
      };
    });
    await this.syncCareDates(careDates);
    return result;
  }

  /** Sửa buổi tập Đã lên lịch chưa tới giờ (BTN-2.20): gộp với dữ liệu cũ rồi kiểm lại DL-2.01. */
  async updateWorkout(workoutId: string, dto: UpdateWorkoutSessionDto, user: CurrentUserPayload) {
    let previousDate: Date | undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockWorkoutSchedule(tx);
      const existing = await tx.workoutSession.findUnique({
        where: { id: workoutId },
        include: { trainingPlan: true },
      });
      if (!existing) {
        throw apiError(HttpStatus.NOT_FOUND, 'WORKOUT_NOT_FOUND', 'Workout session not found.');
      }
      if (
        user.role === UserRole.HEAD_TRAINER &&
        existing.trainingPlan?.trainerUserId !== user.userId
      ) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'This workout belongs to another trainer.',
        );
      }
      previousDate = existing.scheduledDate;
      if (existing.status !== WorkoutStatus.SCHEDULED || existing.scheduledDate <= effectiveNow()) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'WORKOUT_NOT_EDITABLE',
          'Chỉ sửa được buổi tập Đã lên lịch và chưa tới giờ bắt đầu.',
        );
      }
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${existing.horseId} FOR UPDATE`;

      const workoutType = dto.workoutType ?? existing.workoutType ?? 'CANTER';
      const draft: WorkoutDraft = {
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : existing.scheduledDate,
        phaseId: dto.phaseId ?? existing.phaseId,
        workoutType,
        trackId: dto.trackId ?? existing.trackId,
        intensity: effectiveIntensity(workoutType, dto.intensity ?? existing.intensity ?? 'MEDIUM'),
        trackSurface: effectiveSurface(
          workoutType,
          dto.trackSurface ?? existing.trackSurface ?? 'TURF',
        ),
        distanceMeters: dto.distanceMeters ?? existing.distanceMeters,
        repetitions: dto.repetitions ?? existing.repetitions,
        targetSpeedKmh: dto.targetSpeedKmh ?? existing.targetSpeedKmh,
        jockeyName: dto.jockeyName ?? existing.jockeyName,
        assignedStaffUserId: dto.assignedStaffUserId ?? existing.assignedStaffUserId ?? '',
        vetConsulted: dto.vetConsulted ?? existing.medicalOverride,
      };
      const { medicalOverride, warnings } = await this.validateAdmission(
        tx,
        existing.trainingPlan,
        draft,
        workoutId,
      );
      this.assertWarningsAcknowledged(warnings, dto.acknowledgeWarnings);

      const updated = await tx.workoutSession.update({
        where: { id: workoutId },
        data: {
          scheduledDate: draft.scheduledDate,
          phaseId: draft.phaseId,
          workoutType: draft.workoutType,
          intensity: draft.intensity,
          trackSurface: draft.trackSurface,
          trackId: draft.trackSurface === 'NONE' ? null : draft.trackId,
          distanceMeters: draft.distanceMeters,
          repetitions: draft.repetitions,
          targetSpeedKmh: draft.targetSpeedKmh,
          jockeyName: draft.jockeyName,
          assignedStaffUserId: draft.assignedStaffUserId,
          medicalOverride,
          ...(dto.trainerNotes !== undefined && { trainerNotes: dto.trainerNotes }),
        },
        include: WORKOUT_INCLUDE,
      });

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'UPDATE_WORKOUT_SESSION',
        `Updated workout session (${workoutId})`,
        workoutId,
        { entityName: 'WorkoutSession' },
        tx,
      );
      return updated;
    });
    await this.syncCareDates(
      previousDate ? [previousDate, updated.scheduledDate] : [updated.scheduledDate],
    );
    return updated;
  }

  /**
   * SC-2.06 Ghi kết quả (HT): buổi Đã lên lịch đã tới giờ, buổi Bỏ lỡ trong 7 ngày,
   * hoặc sửa kết quả trong 48 giờ sau lần lưu đầu. Có dấu hiệu bất thường -> cảnh báo cho VET.
   */
  async recordResult(workoutId: string, dto: RecordWorkoutResultDto, user: CurrentUserPayload) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.workoutSession.findUnique({
        where: { id: workoutId },
        include: { trainingPlan: true },
      });
      if (!existing) {
        throw apiError(HttpStatus.NOT_FOUND, 'WORKOUT_NOT_FOUND', 'Workout session not found.');
      }
      if (
        user.role === UserRole.HEAD_TRAINER &&
        existing.trainingPlan?.trainerUserId !== user.userId
      ) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'This workout belongs to another trainer.',
        );
      }
      await tx.$queryRaw`SELECT "id" FROM "WorkoutSession" WHERE "id" = ${workoutId} FOR UPDATE`;
      const now = effectiveNow();
      const editing = existing.status === WorkoutStatus.COMPLETED;

      if (existing.status === WorkoutStatus.SCHEDULED) {
        if (existing.scheduledDate > now && !allowEarlyWorkoutStart()) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'WORKOUT_NOT_STARTED',
            'Buổi tập chưa đến giờ bắt đầu.',
          );
        }
      } else if (existing.status === WorkoutStatus.MISSED) {
        const deadline = addDays(startOfClubDay(existing.scheduledDate), LATE_RESULT_DAYS + 1);
        if (now >= deadline) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'LATE_RESULT_EXPIRED',
            'Đã quá 7 ngày, không thể ghi kết quả cho buổi tập bỏ lỡ.',
          );
        }
      } else if (editing) {
        const first = existing.resultRecordedAt ?? existing.updatedAt;
        if (now.getTime() - first.getTime() > RESULT_EDIT_HOURS * 60 * 60 * 1000) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'RESULT_EDIT_EXPIRED',
            'Chỉ sửa được kết quả trong 48 giờ sau khi ghi.',
          );
        }
      } else {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'WORKOUT_NOT_RECORDABLE',
          'Buổi tập bị chặn hoặc đã hủy nên không ghi kết quả.',
        );
      }

      if (dto.actualTimeSeconds == null && !NO_TIME_TYPES.includes(existing.workoutType ?? '')) {
        throw apiError(HttpStatus.BAD_REQUEST, 'TIME_REQUIRED', 'Thời gian chạy là bắt buộc.');
      }
      if (
        dto.heartRatePeak != null &&
        dto.heartRateRecovery != null &&
        dto.heartRateRecovery > dto.heartRatePeak
      ) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'RECOVERY_ABOVE_PEAK',
          'Nhịp tim sau 10 phút không được lớn hơn nhịp tim tối đa.',
        );
      }
      const signs = [...new Set(dto.abnormalSignTypes ?? [])];
      if (signs.length > 0 && !dto.abnormalNotes) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'ABNORMAL_NOTES_REQUIRED',
          'Vui lòng mô tả dấu hiệu bất thường.',
        );
      }
      const averageSpeedKmh = dto.actualTimeSeconds
        ? Math.round((dto.actualDistanceMeters / dto.actualTimeSeconds) * 3.6 * 10) / 10
        : null;
      // Kỷ lục ngựa đua ≈ 70 km/h: tốc độ tính ra vượt 75 km/h là cự ly hoặc thời gian bị nhập sai.
      if (averageSpeedKmh != null && averageSpeedKmh > MAX_AVERAGE_SPEED_KMH) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'IMPLAUSIBLE_SPEED',
          `Tốc độ trung bình tính ra ${averageSpeedKmh} km/h là không thực tế. Kiểm tra lại cự ly và thời gian chạy.`,
        );
      }
      if (averageSpeedKmh != null && dto.topSpeedKmh != null && dto.topSpeedKmh < averageSpeedKmh) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'TOP_SPEED_BELOW_AVERAGE',
          `Tốc độ cao nhất không được nhỏ hơn tốc độ trung bình (${averageSpeedKmh} km/h).`,
        );
      }
      const abnormal = signs.length > 0;

      const updated = await tx.workoutSession.update({
        where: { id: workoutId },
        data: {
          status: WorkoutStatus.COMPLETED,
          actualDistanceMeters: dto.actualDistanceMeters,
          actualTimeSeconds: dto.actualTimeSeconds ?? null,
          averageSpeedKmh,
          actualSurface: dto.actualSurface ?? existing.trackSurface,
          trackCondition: dto.trackCondition ?? null,
          heartRatePeak: dto.heartRatePeak ?? null,
          heartRateRecovery: dto.heartRateRecovery ?? null,
          topSpeedKmh: dto.topSpeedKmh ?? null,
          performanceScore: dto.performanceScore,
          completionLevel: dto.completionLevel,
          resultNotes: dto.trainerNotes.trim(),
          abnormalSignTypes: signs,
          abnormalSigns: abnormal,
          abnormalNotes: abnormal ? dto.abnormalNotes : null,
          // Dấu hiệu mới xuất hiện hoặc thay đổi khi sửa -> VET phải xem lại (Bug #60).
          ...(abnormal &&
            (!existing.abnormalSigns ||
              JSON.stringify(signs.slice().sort()) !==
                JSON.stringify(
                  ((existing.abnormalSignTypes as string[]) || []).slice().sort(),
                )) && {
              vetAcknowledgedAt: null,
              vetNotes: null,
            }),
          ...(editing
            ? { resultUpdatedAt: now, resultUpdatedById: user.userId }
            : { resultRecordedAt: now, resultRecordedById: user.userId }),
        },
        include: WORKOUT_INCLUDE,
      });

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        editing ? 'UPDATE_WORKOUT_RESULT' : 'RECORD_WORKOUT_RESULT',
        `${editing ? 'Edited' : 'Recorded'} result for workout ${workoutId}${abnormal ? ' (abnormal signs reported)' : ''}`,
        workoutId,
        { entityName: 'WorkoutSession', newValues: { abnormalSigns: abnormal, signs } },
        tx,
      );
      return updated;
    });

    // BR-2.19: dấu hiệu bất thường mới (VET chưa xem) -> báo VET. Cùng bộ dấu hiệu chỉ báo 1 lần.
    if (updated.abnormalSigns && !updated.vetAcknowledgedAt) {
      const signs = ((updated.abnormalSignTypes as string[]) || []).slice().sort();
      await this.notifications.notifyRoles(
        [Role.VETERINARIAN],
        {
          type: 'WORKOUT_ABNORMAL',
          category: 'TRAINING',
          title: 'Abnormal signs after a workout',
          message: `${updated.horse?.name ?? 'A horse'}: ${signs.join(', ')}. Please review.`,
          params: { horse: updated.horse?.name ?? '', signs: signs.join(', ') },
          link: '/alerts',
          senderName: user.fullName,
          dedupeKey: `WORKOUT_ABNORMAL:${workoutId}:${signs.join('+')}`,
        },
        user.userId,
      );
    }
    return updated;
  }

  /** DL-2.05 Hủy buổi tập Đã lên lịch / Bị chặn / Bỏ lỡ (HT). */
  async cancelWorkout(workoutId: string, dto: CancelWorkoutDto, user: CurrentUserPayload) {
    const existing = await this.prisma.workoutSession.findUnique({
      where: { id: workoutId },
      include: { trainingPlan: true },
    });
    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'WORKOUT_NOT_FOUND', 'Workout session not found.');
    }
    if (
      user.role === UserRole.HEAD_TRAINER &&
      existing.trainingPlan?.trainerUserId !== user.userId
    ) {
      throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This workout belongs to another trainer.');
    }
    if (!PENDING_WORKOUT_STATUSES.includes(existing.status)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'WORKOUT_NOT_CANCELLABLE',
        'Buổi tập đã hoàn thành hoặc đã hủy.',
      );
    }
    if (dto.reason === 'OTHER' && !dto.note) {
      throw apiError(HttpStatus.BAD_REQUEST, 'NOTE_REQUIRED', 'Ghi chú phải từ 10 đến 500 ký tự.');
    }
    const reason = [CANCEL_REASON_LABEL[dto.reason], dto.note].filter(Boolean).join(': ');

    const updated = await this.prisma.workoutSession.update({
      where: { id: workoutId },
      data: { status: WorkoutStatus.CANCELLED, statusReason: reason },
      include: WORKOUT_INCLUDE,
    });
    await this.auditService.record(
      { id: user.userId, name: user.fullName || user.email },
      'CANCEL_WORKOUT_SESSION',
      `Cancelled workout session ${workoutId} of horse ${updated.horse.name} (${reason})`,
      workoutId,
      {
        entityName: 'WorkoutSession',
        newValues: { status: WorkoutStatus.CANCELLED, statusReason: reason },
      },
    );
    await this.syncCareDates([existing.scheduledDate]);
    return updated;
  }

  /**
   * Xóa buổi tập (HT, CM): Cho phép xóa dọn dẹp các buổi tập chưa diễn ra hoặc thuộc giáo án Nháp.
   * Tối ưu hóa trải nghiệm người dùng trong việc thêm - sửa - xóa linh hoạt.
   */
  async deleteWorkout(workoutId: string, user: CurrentUserPayload) {
    const existing = await this.prisma.workoutSession.findUnique({
      where: { id: workoutId },
      include: { trainingPlan: true, horse: { select: { name: true } } },
    });
    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'WORKOUT_NOT_FOUND', 'Workout session not found.');
    }
    if (
      user.role === UserRole.HEAD_TRAINER &&
      existing.trainingPlan?.trainerUserId !== user.userId
    ) {
      throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This workout belongs to another trainer.');
    }
    if (existing.status === WorkoutStatus.COMPLETED) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_DELETE_COMPLETED',
        'Không thể xóa buổi tập đã hoàn thành với đầy đủ dữ liệu đo đạc thực tế.',
      );
    }
    await this.prisma.workoutSession.delete({ where: { id: workoutId } });
    await this.auditService.record(
      { id: user.userId, name: user.fullName || user.email },
      'DELETE_WORKOUT_SESSION',
      `Deleted workout session ${existing.id} of horse ${existing.horse.name} (${existing.workoutType} on ${clubDate(existing.scheduledDate)})`,
      existing.id,
      { entityName: 'WorkoutSession', oldValues: { id: existing.id, status: existing.status } },
    );
    return { message: 'Workout session deleted successfully.' };
  }

  /** DL-2.07 Khôi phục buổi bị chặn sau khi gỡ Khóa y tế (HT), áp lại toàn bộ kiểm tra DL-2.01. */
  async restoreWorkout(workoutId: string, dto: RestoreWorkoutDto, user: CurrentUserPayload) {
    const restored = await this.prisma.$transaction(async (tx) => {
      await lockWorkoutSchedule(tx);
      const existing = await tx.workoutSession.findUnique({
        where: { id: workoutId },
        include: { trainingPlan: true },
      });
      if (!existing) {
        throw apiError(HttpStatus.NOT_FOUND, 'WORKOUT_NOT_FOUND', 'Workout session not found.');
      }
      if (
        user.role === UserRole.HEAD_TRAINER &&
        existing.trainingPlan?.trainerUserId !== user.userId
      ) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'This workout belongs to another trainer.',
        );
      }
      if (existing.status !== WorkoutStatus.BLOCKED) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'WORKOUT_NOT_BLOCKED',
          'Chỉ khôi phục được buổi tập Bị chặn.',
        );
      }
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${existing.horseId} FOR UPDATE`;

      const horse = await tx.horse.findUnique({
        where: { id: existing.horseId },
        select: {
          isMedicalLocked: true,
          medicalLocks: { where: { isLocked: true }, take: 1, select: { id: true } },
        },
      });
      if (horse && (horse.isMedicalLocked || horse.medicalLocks.length > 0)) {
        throw apiError(
          HttpStatus.CONFLICT,
          'MEDICAL_LOCK_ACTIVE',
          'Ngựa đang bị khóa y tế nên chưa thể khôi phục buổi tập.',
        );
      }

      const workoutType = existing.workoutType ?? 'CANTER';
      const draft: WorkoutDraft = {
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : existing.scheduledDate,
        phaseId: existing.phaseId,
        workoutType,
        trackId: existing.trackId,
        intensity: existing.intensity ?? 'MEDIUM',
        trackSurface: existing.trackSurface ?? 'TURF',
        distanceMeters: existing.distanceMeters,
        repetitions: existing.repetitions,
        targetSpeedKmh: existing.targetSpeedKmh,
        jockeyName: existing.jockeyName,
        assignedStaffUserId: existing.assignedStaffUserId ?? '',
        vetConsulted: existing.medicalOverride,
      };
      await this.validateAdmission(tx, existing.trainingPlan, draft, workoutId);

      const restored = await tx.workoutSession.update({
        where: { id: workoutId },
        data: {
          status: WorkoutStatus.SCHEDULED,
          scheduledDate: draft.scheduledDate,
          statusReason: null,
        },
        include: WORKOUT_INCLUDE,
      });
      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'RESTORE_WORKOUT_SESSION',
        `Restored blocked workout ${workoutId}`,
        workoutId,
        { entityName: 'WorkoutSession' },
        tx,
      );
      return restored;
    });
    await this.syncCareDates([restored.scheduledDate]);
    return restored;
  }

  /**
   * Lịch tập (SC-2.05) và các danh sách buổi tập. OWNER: ngựa sở hữu; GROOM: buổi được giao
   * và không thấy điểm phong độ (Q-2.09).
   */
  async findAllWorkouts(
    query: {
      planId?: string;
      horseId?: string;
      date?: string;
      from?: string;
      to?: string;
      status?: WorkoutStatus;
      workoutType?: string;
      scope?: string;
    },
    user: CurrentUserPayload,
  ) {
    await this.common.sweepOverdue();
    const where: Prisma.WorkoutSessionWhereInput = { horse: { deletedAt: null } };

    if (query.planId) where.trainingPlanId = query.planId;
    if (query.horseId) where.horseId = query.horseId;
    if (query.status) where.status = query.status;
    if (query.workoutType) where.workoutType = query.workoutType;
    if (query.date && !isNaN(new Date(query.date).getTime())) {
      const start = startOfClubDay(new Date(query.date));
      where.scheduledDate = { gte: start, lt: addDays(start, 1) };
    } else if (query.from || query.to) {
      where.scheduledDate = {
        ...(query.from &&
          !isNaN(new Date(query.from).getTime()) && { gte: startOfClubDay(new Date(query.from)) }),
        ...(query.to &&
          !isNaN(new Date(query.to).getTime()) && {
            lt: addDays(startOfClubDay(new Date(query.to)), 1),
          }),
      };
    }

    if (user.role === UserRole.HORSE_OWNER) {
      where.horse = { deletedAt: null, ownerId: user.userId };
    } else if (user.role === UserRole.GROOM) {
      // Giáo án còn Nháp chưa phải lịch thật: groom chỉ thấy khi HT đã kích hoạt.
      where.assignedStaffUserId = user.userId;
      where.trainingPlan = { status: { not: PlanStatus.DRAFT } };
    } else if (user.role === UserRole.HEAD_TRAINER) {
      // HLV chỉ xem lịch các ngựa mình phụ trách (kể cả Lịch tuần).
      where.trainingPlan = { trainerUserId: user.userId };
    }

    const rows = await this.prisma.workoutSession.findMany({
      where,
      orderBy: { scheduledDate: 'asc' },
      take: 200,
      include: WORKOUT_INCLUDE,
    });
    return rows.map((r) => hideScoreForGroom(r, user));
  }

  /** Chi tiết buổi tập; ngoài phạm vi -> 404. */
  async findWorkoutById(id: string, user: CurrentUserPayload) {
    const workout = await this.prisma.workoutSession.findUnique({
      where: { id },
      include: {
        ...WORKOUT_INCLUDE,
        trainingPlan: { select: { ...WORKOUT_INCLUDE.trainingPlan.select, trainerUserId: true } },
      },
    });
    const outOfScope =
      !workout ||
      (user.role === UserRole.HORSE_OWNER && workout.horse.ownerId !== user.userId) ||
      (user.role === UserRole.GROOM &&
        (workout.assignedStaffUserId !== user.userId ||
          workout.trainingPlan?.status === PlanStatus.DRAFT)) ||
      (user.role === UserRole.HEAD_TRAINER &&
        (workout.trainingPlan as any)?.trainerUserId !== user.userId);
    if (outOfScope) {
      throw apiError(HttpStatus.NOT_FOUND, 'WORKOUT_NOT_FOUND', 'Workout session not found.');
    }
    return hideScoreForGroom(workout, user);
  }

  /** Lượt chạy thử (tab của SC-2.05): buổi tập loại TRIAL, sắp theo giờ. */
  async findTrialRuns(query: { from?: string; to?: string }, user: CurrentUserPayload) {
    return this.findAllWorkouts({ ...query, workoutType: 'TRIAL' }, user);
  }

  /** Nhân viên chăm sóc đang hoạt động, lọc theo thời gian rảnh nếu có date & time. */
  async findGrooms(
    horseId?: string,
    dateStr?: string,
    timeStr?: string,
    excludeWorkoutId?: string,
    workoutType?: string,
  ): Promise<
    Array<{
      id: string;
      fullName: string;
      email: string;
      isAssignedToHorse?: boolean;
      hasShift?: boolean;
      isAvailable?: boolean;
      shiftInfo?: string;
      zoneName?: string;
      isSameZone?: boolean;
    }>
  > {
    const grooms = await this.prisma.user.findMany({
      where: { role: Role.GROOM, status: UserStatus.ACTIVE },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
    });

    if (!horseId && !dateStr) {
      return grooms;
    }

    let assignedGroomId: string | null = null;
    let horseZoneId: string | null = null;
    if (horseId && this.prisma.stallAllocation?.findFirst) {
      const alloc = await this.prisma.stallAllocation.findFirst({
        where: { horseId, isActive: true },
        include: { stall: { include: { zoneRef: true } } },
      });
      assignedGroomId = alloc?.assignedGroomUserId ?? null;
      horseZoneId = alloc?.stall?.zoneId ?? null;
    }

    let groomsWithShift: Set<string> | null = null;
    const groomZoneMap = new Map<string, { zoneId: string; zoneName: string }>();
    const shiftMap = new Map<
      string,
      Array<{ startTime: string; endTime: string; isOvernight: boolean; name: string }>
    >();

    if (dateStr && this.prisma.shiftRoster?.findMany) {
      const d = new Date(dateStr);
      const dayStart = startOfClubDay(isNaN(d.getTime()) ? new Date() : d);
      const rosters = await this.prisma.shiftRoster.findMany({
        where: {
          date: { gte: dayStart, lt: addDays(dayStart, 1) },
        },
        include: { shift: true, zone: true },
      });
      groomsWithShift = new Set(rosters.map((r) => r.groomUserId));
      for (const r of rosters) {
        if (r.shift) {
          const list = shiftMap.get(r.groomUserId) || [];
          list.push({
            startTime: r.shift.startTime,
            endTime: r.shift.endTime,
            isOvernight: Boolean(r.shift.isOvernight),
            name: r.shift.name,
          });
          shiftMap.set(r.groomUserId, list);
        }
        if (r.zone) {
          groomZoneMap.set(r.groomUserId, { zoneId: r.zoneId, zoneName: r.zone.name });
        }
      }
    }

    // BR-TRN-GROOM-CAPACITY: Đếm số ca tập trong ngày của từng Groom để chống quá tải
    const groomDailySessionCountMap = new Map<string, number>();
    if (dateStr && this.prisma.workoutSession?.findMany) {
      const d = new Date(dateStr);
      const dayStart = startOfClubDay(isNaN(d.getTime()) ? new Date() : d);
      const daySessions = await this.prisma.workoutSession.findMany({
        where: {
          status: { not: WorkoutStatus.CANCELLED },
          ...(excludeWorkoutId ? { id: { not: excludeWorkoutId } } : {}),
          scheduledDate: { gte: dayStart, lt: addDays(dayStart, 1) },
        },
        select: { assignedStaffUserId: true },
      });
      for (const ds of daySessions) {
        if (ds.assignedStaffUserId) {
          const cur = groomDailySessionCountMap.get(ds.assignedStaffUserId) || 0;
          groomDailySessionCountMap.set(ds.assignedStaffUserId, cur + 1);
        }
      }
    }

    // Xác định target date-time nếu có truyền timeStr hoặc dateStr dạng ISO
    let targetDateTime: Date | null = null;
    if (dateStr) {
      if (timeStr) {
        const dateOnly = dateStr.slice(0, 10);
        targetDateTime = new Date(
          `${dateOnly}T${timeStr.length === 5 ? timeStr + ':00' : timeStr}+07:00`,
        );
      } else if (dateStr.includes('T')) {
        targetDateTime = new Date(dateStr);
      }
    }

    const busyGroomIds = new Set<string>();
    if (
      targetDateTime &&
      !isNaN(targetDateTime.getTime()) &&
      this.prisma.workoutSession?.findMany
    ) {
      // 1. Tìm các groom bị trùng buổi tập khác trong khung giờ (thời lượng + 15 phút đệm chuyển tiếp theo BR-TRN-24)
      const targetDuration = workoutDurationMinutes(workoutType);
      const targetStart = targetDateTime.getTime();
      const targetEnd = targetStart + (targetDuration + GROOM_BUFFER_MINUTES) * 60 * 1000;
      const maxPreWindow = 120 * 60 * 1000;

      const workouts = await this.prisma.workoutSession.findMany({
        where: {
          status: { not: WorkoutStatus.CANCELLED },
          ...(excludeWorkoutId ? { id: { not: excludeWorkoutId } } : {}),
          scheduledDate: {
            gte: new Date(targetStart - maxPreWindow),
            lte: new Date(targetEnd),
          },
        },
        select: { assignedStaffUserId: true, scheduledDate: true, workoutType: true },
      });
      for (const w of workouts) {
        if (
          !w.assignedStaffUserId ||
          !w.scheduledDate ||
          typeof w.scheduledDate.getTime !== 'function'
        )
          continue;
        const otherStart = w.scheduledDate.getTime();
        const otherDur = workoutDurationMinutes(w.workoutType);
        const otherEnd = otherStart + (otherDur + GROOM_BUFFER_MINUTES) * 60 * 1000;
        if (targetStart < otherEnd && otherStart < targetEnd) {
          busyGroomIds.add(w.assignedStaffUserId);
        }
      }
    }

    // Kiểm tra giờ tập có nằm trong khung giờ của ca trực không
    const isWithinShift = (
      shifts: Array<{ startTime: string; endTime: string; isOvernight: boolean }>,
      targetDt: Date,
    ): boolean => {
      const { hour, minute } = clubTime(targetDt);
      const targetMins = hour * 60 + minute;
      for (const s of shifts) {
        const [sh, sm] = (s.startTime || '00:00').split(':').map(Number);
        const [eh, em] = (s.endTime || '23:59').split(':').map(Number);
        const startMins = sh * 60 + (sm || 0);
        const endMins = eh * 60 + (em || 0);
        if (s.isOvernight) {
          if (targetMins >= startMins || targetMins <= endMins) return true;
        } else {
          if (targetMins >= startMins && targetMins <= endMins) return true;
        }
      }
      return false;
    };

    const mapped = grooms.map((g) => {
      const shifts = shiftMap.get(g.id);
      const hasRoster = Boolean(shifts && shifts.length > 0);
      let isAvailable = true;
      let shiftInfo: string | undefined = undefined;

      if (hasRoster && shifts) {
        shiftInfo = shifts.map((s) => `${s.name} (${s.startTime}-${s.endTime})`).join(', ');
      }

      if (targetDateTime && !isNaN(targetDateTime.getTime())) {
        // Nếu bị trùng buổi tập khác trong 30 phút -> BẬN
        if (busyGroomIds.has(g.id)) {
          isAvailable = false;
        }
        // Nếu có ca trực mà giờ tập KHÔNG nằm trong ca trực (ví dụ ca tối mà tập sáng) -> BẬN
        else if (hasRoster && shifts && !isWithinShift(shifts, targetDateTime)) {
          isAvailable = false;
        }
      }

      const gz = groomZoneMap.get(g.id);
      const isSameZone = Boolean(horseZoneId && gz && gz.zoneId === horseZoneId);
      const zoneName = gz?.zoneName;
      const dailyCount = groomDailySessionCountMap.get(g.id) || 0;
      const isOverloaded = dailyCount >= MAX_DAILY_WORKOUTS_PER_GROOM;

      if (isOverloaded && targetDateTime && !isNaN(targetDateTime.getTime())) {
        isAvailable = false;
      }

      return {
        ...g,
        isAssignedToHorse: assignedGroomId ? g.id === assignedGroomId : undefined,
        hasShift: groomsWithShift ? groomsWithShift.has(g.id) : undefined,
        isAvailable,
        shiftInfo,
        zoneName,
        isSameZone,
        dailySessionCount: dailyCount,
        isOverloaded,
      };
    });

    // Nếu có truyền giờ cụ thể (timeStr hoặc dateStr ISO): CHỈ LẤY NHỮNG GROOM RẢNH
    const result =
      targetDateTime && !isNaN(targetDateTime.getTime())
        ? mapped.filter((g) => g.isAvailable)
        : mapped;

    return result.sort((a, b) => {
      if (a.isSameZone && !b.isSameZone) return -1;
      if (!a.isSameZone && b.isSameZone) return 1;
      if (a.isAssignedToHorse && !b.isAssignedToHorse) return -1;
      if (!a.isAssignedToHorse && b.isAssignedToHorse) return 1;
      if (a.hasShift && !b.hasShift) return -1;
      if (!a.hasShift && b.hasShift) return 1;
      return a.fullName.localeCompare(b.fullName);
    });
  }

  /**
   * BR-TRN-TRACK-CAPACITY: Kiểm tra tình trạng sức chứa và xung đột sân bãi theo thời gian thực.
   * Giúp Huấn luyện viên biết chính xác sân nào trống, sân nào đang có ngựa tập,
   * và sân nào bị chiếm độc quyền bởi bài tập tốc độ cao.
   */
  async getTrackAvailability(
    dateStr?: string,
    timeStr?: string,
    workoutType?: string,
    excludeWorkoutId?: string,
  ): Promise<TrackAvailabilityInfo[]> {
    const surfaces: Array<'TURF' | 'DIRT' | 'SYNTHETIC'> = ['TURF', 'DIRT', 'SYNTHETIC'];
    const surfaceNames: Record<string, string> = {
      TURF: 'Sân cỏ tự nhiên (Turf)',
      DIRT: 'Sân cát / đất nén (Dirt)',
      SYNTHETIC: 'Sân tổng hợp All-weather (Synthetic)',
    };

    let allTracks: any[] = [];
    if (this.prisma.trainingTrack?.findMany) {
      allTracks = await this.prisma.trainingTrack.findMany({
        where: { isActive: true },
      });
    }

    const getSurfaceMaxCapacity = (s: string) => {
      const surfaceTracks = allTracks.filter((t: any) => t.surface === s);
      return surfaceTracks.length > 0 ? Math.max(...surfaceTracks.map((t: any) => t.capacity)) : 6;
    };

    if (!dateStr || !timeStr) {
      return surfaces.map((s) => ({
        surface: s,
        surfaceName: surfaceNames[s],
        currentCount: 0,
        maxCapacity: getSurfaceMaxCapacity(s),
        isAvailable: true,
        status: 'EMPTY',
        statusText: 'Sẵn sàng xếp lịch',
        activeHorses: [],
      }));
    }

    const dateOnly = dateStr.slice(0, 10);
    const targetDt = new Date(
      `${dateOnly}T${timeStr.length === 5 ? timeStr + ':00' : timeStr}+07:00`,
    );
    if (isNaN(targetDt.getTime())) {
      return surfaces.map((s) => ({
        surface: s,
        surfaceName: surfaceNames[s],
        currentCount: 0,
        maxCapacity: getSurfaceMaxCapacity(s),
        isAvailable: true,
        status: 'EMPTY',
        statusText: 'Sẵn sàng xếp lịch',
        activeHorses: [],
      }));
    }

    const targetStart = targetDt.getTime();
    const targetDur = workoutDurationMinutes(workoutType);
    const targetEnd = targetStart + targetDur * 60 * 1000;
    const isTargetHeavy = isHeavy(workoutType, 'MEDIUM');

    const maxPreWindow = 120 * 60 * 1000;
    const live = { status: { not: WorkoutStatus.CANCELLED } };

    let activeSessions: any[] = [];
    if (this.prisma.workoutSession?.findMany) {
      activeSessions = await this.prisma.workoutSession.findMany({
        where: {
          ...live,
          ...(excludeWorkoutId ? { id: { not: excludeWorkoutId } } : {}),
          trackSurface: { in: surfaces },
          scheduledDate: {
            gte: new Date(targetStart - maxPreWindow),
            lte: new Date(targetEnd),
          },
        },
        select: {
          id: true,
          scheduledDate: true,
          workoutType: true,
          intensity: true,
          trackSurface: true,
          horse: { select: { name: true } },
          trainingPlan: { select: { trainer: { select: { fullName: true } } } },
        },
      });
    }

    return surfaces.map((s) => {
      const surfaceWorkouts = activeSessions.filter((w) => {
        if (w.trackSurface !== s) return false;
        if (!w.scheduledDate || typeof w.scheduledDate.getTime !== 'function') return false;
        const wStart = w.scheduledDate.getTime();
        const wDur = workoutDurationMinutes(w.workoutType);
        const wEnd = wStart + (wDur + 15) * 60 * 1000;
        return targetStart < wEnd && wStart < targetEnd;
      });

      const activeHorses = surfaceWorkouts.map((w) => {
        const wStart = w.scheduledDate;
        const wDur = workoutDurationMinutes(w.workoutType);
        const endDt = new Date(wStart.getTime() + wDur * 60 * 1000);
        return {
          workoutId: w.id,
          horseName: w.horse?.name || 'Chiến mã',
          trainerName: w.trainingPlan?.trainer?.fullName || 'HLV',
          workoutType: w.workoutType || 'Bài tập',
          timeRange: `${hhmm(wStart)} - ${hhmm(endDt)}`,
          isHeavy: isHeavy(w.workoutType, w.intensity),
        };
      });

      const maxTrackCapacity = getSurfaceMaxCapacity(s);
      const targetCapacity = isTargetHeavy ? 1 : maxTrackCapacity;
      const hasHeavyOnTrack = activeHorses.some((h) => h.isHeavy);
      const count = activeHorses.length;

      let isAvailable = true;
      let status: 'EMPTY' | 'AVAILABLE' | 'FULL' | 'HEAVY_OCCUPIED' = 'EMPTY';
      let statusText = `Đang trống hoàn toàn (0/${targetCapacity})`;

      if (count === 0) {
        status = 'EMPTY';
        statusText = isTargetHeavy
          ? 'Đang trống (Đạt chuẩn chạy tốc độ độc quyền)'
          : `Đang trống (0/${targetCapacity} chiến mã)`;
        isAvailable = true;
      } else if (hasHeavyOnTrack) {
        status = 'HEAVY_OCCUPIED';
        const heavyHorse = activeHorses.find((h) => h.isHeavy);
        statusText = `Đang có bài chạy tốc độ của ${heavyHorse?.horseName} (${heavyHorse?.timeRange}) - Độc quyền toàn sân`;
        isAvailable = false;
      } else if (isTargetHeavy) {
        status = 'HEAVY_OCCUPIED';
        statusText = `Đang có ${count} ngựa tập nhẹ. Bài tập tốc độ (${workoutType}) yêu cầu độc quyền đường chạy`;
        isAvailable = false;
      } else if (count >= targetCapacity) {
        status = 'FULL';
        statusText = `Đã đạt sức chứa tối đa (${count}/${targetCapacity} chiến mã)`;
        isAvailable = false;
      } else {
        status = 'AVAILABLE';
        statusText = `Đang có ${count}/${targetCapacity} chiến mã (Còn ${targetCapacity - count} chỗ an toàn)`;
        isAvailable = true;
      }

      return {
        surface: s,
        surfaceName: surfaceNames[s],
        currentCount: count,
        maxCapacity: targetCapacity,
        isAvailable,
        status,
        statusText,
        activeHorses,
      };
    });
  }
}
