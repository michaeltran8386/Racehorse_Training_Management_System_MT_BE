import { WorkoutsService } from './workouts.service';
import { lockWorkoutSchedule } from './workout-availability.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  HorseStatus,
  PlanStatus,
  Prisma,
  TrackSurface,
  TrainerAssignmentStatus,
  WorkoutStatus,
} from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';
import { effectiveNow } from '../common/utils/demo-clock';
import { UserRole } from '../common/enums/role.enum';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { CreateTrainingPlanDto } from './dto/create-training-plan.dto';
import { UpdateTrainingPlanDto } from './dto/update-training-plan.dto';
import { QueryTrainingPlanDto } from './dto/query-training-plan.dto';
import { ChangePlanStatusDto, ClonePlanDto, UnlockCooldownDto } from './dto/workout-actions.dto';
import {
  addDays,
  clubDate,
  GROOM_BUFFER_MINUTES,
  isHeavy,
  MAX_HORSES_PER_TRAINER,
  MAX_PLAN_WEEKS,
  PENDING_WORKOUT_STATUSES,
  PlanPhase,
  startOfClubDay,
  validatePhases,
  workoutDurationMinutes,
} from './training-rules';
import { Tx, MEDICAL_STATUSES, PLAN_INCLUDE, phasesOf } from './training-shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CounterService } from '../audit/counter.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrainingCommonService } from './training-common.service';
import { TRAINING_MONTHLY_RATE } from '../financial/financial.service';

/** P2-06: giáo án — danh sách, tạo, sửa, kích hoạt / hoàn thành / hủy, nhân bản, xóa (FR-2.02 → FR-2.08, FR-2.18, FR-2.19). */
@Injectable()
export class TrainingPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly counter: CounterService,
    private readonly notifications: NotificationsService,
    private readonly common: TrainingCommonService,
  ) {}

  /** SC-2.02 Danh sách giáo án (CM, HT, VET tất cả; OWNER ngựa sở hữu). */
  async findAllPlans(query: QueryTrainingPlanDto, user: CurrentUserPayload) {
    await this.common.sweepOverdue();
    const { horseId, status, search, page = 1, pageSize = 20 } = query;

    const where: Prisma.TrainingPlanWhereInput = { horse: { deletedAt: null } };
    if (horseId) where.horseId = horseId;
    if (status) {
      const parts = status
        .split(',')
        .map((s) => s.trim())
        .filter((s) => Object.values(PlanStatus).includes(s as PlanStatus)) as PlanStatus[];
      if (parts.length === 1) {
        where.status = parts[0];
      } else if (parts.length > 1) {
        where.status = { in: parts };
      }
    }
    if (user.role === UserRole.HORSE_OWNER) {
      where.horse = { deletedAt: null, ownerId: user.userId };
    } else if (user.role === UserRole.HEAD_TRAINER) {
      where.trainerUserId = user.userId;
    }
    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { phaseName: { contains: term, mode: 'insensitive' } },
        { planCode: { contains: term, mode: 'insensitive' } },
        { horse: { name: { contains: term, mode: 'insensitive' } } },
        { horse: { horseCode: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.trainingPlan.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { startDate: 'desc' },
        include: PLAN_INCLUDE,
      }),
      this.prisma.trainingPlan.count({ where }),
    ]);
    const progress = await this.common.progressOf(items.map((p) => p.id));

    return {
      items: items.map((p) => ({
        ...p,
        progress: progress.get(p.id) ?? { completed: 0, total: 0, due: 0, overdue: 0 },
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /** SC-2.04 Chi tiết giáo án kèm buổi tập và người ghi kết quả. Ngoài phạm vi -> 404. */
  async findPlanById(id: string, user: CurrentUserPayload) {
    const plan = await this.prisma.trainingPlan.findUnique({
      where: { id },
      include: {
        ...PLAN_INCLUDE,
        horse: {
          select: {
            ...PLAN_INCLUDE.horse.select,
            dob: true,
            weightKg: true,
            medicalLocks: {
              where: { isLocked: true },
              take: 1,
              select: { lockedAt: true, lockReason: true },
            },
          },
        },
        workoutSessions: {
          orderBy: { scheduledDate: 'asc' },
          include: {
            assignedStaff: { select: { id: true, fullName: true } },
            resultRecordedBy: { select: { id: true, fullName: true } },
            resultUpdatedBy: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    const outOfScope =
      !plan || (user.role === UserRole.HORSE_OWNER && plan.horse.ownerId !== user.userId);
    // HT được xem giáo án của HLV khác (mở từ Lịch tuần toàn CLB); mọi thao tác ghi vẫn kiểm tra chủ giáo án.
    if (outOfScope) {
      throw apiError(HttpStatus.NOT_FOUND, 'PLAN_NOT_FOUND', 'Training plan not found.');
    }
    const progress = (await this.common.progressOf([plan.id])).get(plan.id) ?? {
      completed: 0,
      total: 0,
      due: 0,
      overdue: 0,
    };
    // needFix #8: chủ ngựa thấy trước chi phí — phí huấn luyện tính theo tháng có tập (xem bảng kê).
    const s = plan.startDate;
    const e = plan.endDate;
    const billedMonths = Math.max(
      1,
      (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth() + 1,
    );
    return {
      ...plan,
      progress,
      cost: {
        monthlyTrainingRate: TRAINING_MONTHLY_RATE,
        billedMonths,
        estimatedTrainingFee: billedMonths * TRAINING_MONTHLY_RATE,
      },
    };
  }

  /** Ngày bắt đầu / kết thúc hợp lệ (SC-2.03): kết thúc ≥ bắt đầu, tối thiểu 7 ngày, tối đa 52 tuần. */
  private assertPlanDates(startDate: Date, endDate: Date) {
    if (startDate > endDate) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_DATE_RANGE',
        'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.',
      );
    }
    const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays < 7) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'PLAN_TOO_SHORT',
        'Giáo án phải kéo dài ít nhất 1 tuần (7 ngày) giữa thời điểm bắt đầu và thời điểm kết thúc.',
      );
    }
    if (endDate.getTime() - startDate.getTime() > MAX_PLAN_WEEKS * 7 * 24 * 60 * 60 * 1000) {
      throw apiError(HttpStatus.BAD_REQUEST, 'PLAN_TOO_LONG', 'Giáo án tối đa 52 tuần.');
    }
  }

  /** Giáo án chỉ được bắt đầu từ ngày mai (hôm nay tạo thì ngày mai mới áp dụng). */
  private assertStartsFromTomorrow(startDate: Date) {
    if (startDate < addDays(startOfClubDay(effectiveNow()), 1)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'START_DATE_TOO_EARLY',
        'Ngày bắt đầu giáo án phải từ ngày mai trở đi.',
      );
    }
  }

  private checkedPhases(raw: unknown, startDate: Date, endDate: Date): PlanPhase[] {
    const result = validatePhases(raw, clubDate(startDate), clubDate(endDate));
    if ('code' in result) {
      throw apiError(HttpStatus.BAD_REQUEST, result.code, result.message);
    }
    return result.phases;
  }

  /** SC-2.03 Tạo giáo án: luôn ở Nháp; mã GA-xxxxxx; giai đoạn hợp lệ; ngựa không Ngừng quản lý. */
  async createPlan(dto: CreateTrainingPlanDto, user: CurrentUserPayload) {
    const horse = await this.prisma.horse.findUnique({
      where: { id: dto.horseId, deletedAt: null },
    });
    if (!horse) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Target horse not found.');
    }
    if (horse.status === HorseStatus.RETIRED) {
      throw apiError(HttpStatus.BAD_REQUEST, 'HORSE_RETIRED', 'Ngựa đã ngừng quản lý.');
    }
    if (horse.isMedicalLocked) {
      throw apiError(
        HttpStatus.CONFLICT,
        'HORSE_MEDICAL_LOCKED',
        'Ngựa đang bị Khóa huấn luyện y tế. Không thể tạo giáo án mới cho đến khi Bác sĩ thú y gỡ khóa.',
      );
    }
    if (horse.isDebtImpounded) {
      throw apiError(
        HttpStatus.CONFLICT,
        'HORSE_DEBT_IMPOUNDED',
        'Ngựa đang bị lưu giữ do nợ phí lưu chuồng. Không thể tạo giáo án mới cho đến khi chủ sở hữu hoàn tất thanh toán công nợ.',
      );
    }
    await this.assertNoOtherTrainer(horse.id, horse.name, user.userId);

    // BR-TRN-CAPACITY: Mỗi HLV chỉ được phụ trách tối đa 8 chiến mã đồng thời
    const activePlanCount = await this.prisma.trainingPlan.count({
      where: {
        trainerUserId: user.userId,
        status: { in: [PlanStatus.DRAFT, PlanStatus.ACTIVE] },
        horse: { deletedAt: null },
      },
    });
    if (activePlanCount >= MAX_HORSES_PER_TRAINER) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TRAINER_CAPACITY_EXCEEDED',
        `Mỗi Huấn luyện viên chỉ được quản lý tối đa ${MAX_HORSES_PER_TRAINER} chiến mã đồng thời. Vui lòng hoàn thành hoặc hủy bớt giáo án hiện có trước khi tạo mới.`,
      );
    }

    if (
      dto.phaseName &&
      (/^\d+$/.test(dto.phaseName.trim()) || !/[\p{L}]/u.test(dto.phaseName.trim()))
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PLAN_NAME',
        'Tên giáo án không được đặt hoàn toàn bằng số và phải chứa chữ cái.',
      );
    }
    if (dto.objective && !/^[\p{L}]/u.test(dto.objective.trim())) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_OBJECTIVE',
        'Mục tiêu phải bắt đầu bằng chữ cái, không được bắt đầu bằng số hay ký tự đặc biệt.',
      );
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    this.assertStartsFromTomorrow(startDate);
    this.assertPlanDates(startDate, endDate);
    const phases = this.checkedPhases(dto.phases, startDate, endDate);

    // Seed ghi sẵn mã GA-xxxxxx mà không tăng bộ đếm: bỏ qua mã đã có để không vỡ @unique (HTTP 500).
    let planCode: string;
    do {
      planCode = `GA-${String(await this.counter.next('training_plan')).padStart(6, '0')}`;
    } while (
      await this.prisma.trainingPlan.findUnique({ where: { planCode }, select: { id: true } })
    );
    // Không tự đổi trạng thái ngựa ở đây: chỉ khi Kích hoạt và HT chọn (DL-2.02).
    const plan = await this.createAssignedPlan(horse, user.userId, {
      planCode,
      horseId: dto.horseId,
      trainerUserId: user.userId,
      phaseName: dto.phaseName.trim(),
      objective: dto.objective.trim(),
      notes: dto.notes?.trim() || null,
      phases: phases as unknown as Prisma.InputJsonValue,
      targetSpeed: dto.targetSpeed,
      targetDistance: dto.targetDistance,
      trackSurface: dto.trackSurface ?? TrackSurface.TURF,
      startDate,
      endDate,
      status: PlanStatus.DRAFT,
    });

    await this.auditService.record(
      { id: user.userId, name: user.fullName || user.email },
      'CREATE_TRAINING_PLAN',
      `Created training plan ${plan.planCode} "${plan.phaseName}" for horse ${plan.horse.name}`,
      plan.id,
      {
        entityName: 'TrainingPlan',
        newValues: { phaseName: plan.phaseName, horseId: dto.horseId },
      },
    );

    return plan;
  }

  /**
   * Sửa giáo án Nháp hoặc Đang áp dụng (FR-2.04). Giai đoạn đã có buổi Hoàn thành không xóa được
   * và không đổi được Từ ngày; xóa giai đoạn thì xóa luôn các buổi chưa diễn ra trong đó (BTN-2.10).
   */
  async updatePlan(id: string, dto: UpdateTrainingPlanDto, user: CurrentUserPayload) {
    const existing = await this.prisma.trainingPlan.findUnique({ where: { id } });
    if (!existing) {
      throw apiError(HttpStatus.NOT_FOUND, 'PLAN_NOT_FOUND', 'Training plan not found.');
    }
    if (user.role === UserRole.HEAD_TRAINER && existing.trainerUserId !== user.userId) {
      throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This plan belongs to another trainer.');
    }
    if (existing.status !== PlanStatus.DRAFT && existing.status !== PlanStatus.ACTIVE) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'PLAN_CLOSED',
        'Giáo án đã hoàn thành hoặc đã hủy nên không sửa được.',
      );
    }

    if (
      dto.phaseName !== undefined &&
      (/^\d+$/.test(dto.phaseName.trim()) || !/[\p{L}]/u.test(dto.phaseName.trim()))
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_PLAN_NAME',
        'Tên giáo án không được đặt hoàn toàn bằng số và phải chứa chữ cái.',
      );
    }
    if (dto.objective !== undefined && !/^[\p{L}]/u.test(dto.objective.trim())) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_OBJECTIVE',
        'Mục tiêu phải bắt đầu bằng chữ cái, không được bắt đầu bằng số hay ký tự đặc biệt.',
      );
    }
    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    // Chỉ kiểm khi đổi ngày bắt đầu: giáo án đã chạy vẫn phải sửa được ghi chú, giai đoạn...
    if (clubDate(startDate) !== clubDate(existing.startDate)) {
      this.assertStartsFromTomorrow(startDate);
    }
    this.assertPlanDates(startDate, endDate);
    const phases = this.checkedPhases(dto.phases ?? existing.phases, startDate, endDate);

    // H-14: Không cho phép thu hẹp thời gian giáo án nếu có buổi tập ĐÃ HOÀN THÀNH nằm ngoài khoảng ngày mới.
    const outOfBoundsCompleted = await this.prisma.workoutSession.findFirst({
      where: {
        trainingPlanId: id,
        status: WorkoutStatus.COMPLETED,
        OR: [{ scheduledDate: { lt: startDate } }, { scheduledDate: { gt: endDate } }],
      },
    });
    if (outOfBoundsCompleted) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'CANNOT_EXCLUDE_COMPLETED_WORKOUTS',
        'Không thể thu hẹp thời gian giáo án vì có buổi tập đã hoàn thành nằm ngoài khoảng ngày mới.',
      );
    }

    // Giai đoạn đã có buổi Hoàn thành phải còn và giữ nguyên Từ ngày.
    const done = await this.prisma.workoutSession.findMany({
      where: { trainingPlanId: id, status: WorkoutStatus.COMPLETED, phaseId: { not: null } },
      select: { phaseId: true },
      distinct: ['phaseId'],
    });
    const oldPhases = phasesOf(existing);
    for (const { phaseId } of done) {
      const before = oldPhases.find((p) => p.id === phaseId);
      const after = phases.find((p) => p.id === phaseId);
      if (before && (!after || after.startDate !== before.startDate)) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'PHASE_HAS_COMPLETED_WORKOUTS',
          `Giai đoạn ${before.name} đã có buổi tập hoàn thành.`,
        );
      }
    }
    const removed = oldPhases.filter((p) => !phases.some((n) => n.id === p.id)).map((p) => p.id);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (removed.length > 0) {
        await tx.workoutSession.deleteMany({
          where: {
            trainingPlanId: id,
            phaseId: { in: removed },
            status: { in: PENDING_WORKOUT_STATUSES },
          },
        });
      }
      // H-14: Xóa các buổi tập chờ nằm ngoài khoảng thời gian [startDate, endDate] mới sau khi cập nhật
      await tx.workoutSession.deleteMany({
        where: {
          trainingPlanId: id,
          status: { in: PENDING_WORKOUT_STATUSES },
          OR: [{ scheduledDate: { lt: startDate } }, { scheduledDate: { gt: endDate } }],
        },
      });
      return tx.trainingPlan.update({
        where: { id },
        data: {
          ...(dto.phaseName && { phaseName: dto.phaseName.trim() }),
          ...(dto.objective !== undefined && { objective: dto.objective.trim() }),
          ...(dto.notes !== undefined && { notes: dto.notes.trim() || null }),
          phases: phases as unknown as Prisma.InputJsonValue,
          ...(dto.targetSpeed !== undefined && { targetSpeed: dto.targetSpeed }),
          ...(dto.targetDistance !== undefined && { targetDistance: dto.targetDistance }),
          ...(dto.trackSurface && { trackSurface: dto.trackSurface }),
          startDate,
          endDate,
        },
        include: PLAN_INCLUDE,
      });
    });

    await this.auditService.record(
      { id: user.userId, name: user.fullName || user.email },
      'UPDATE_TRAINING_PLAN',
      `Updated training plan "${updated.phaseName}" (${updated.id})`,
      updated.id,
      {
        entityName: 'TrainingPlan',
        oldValues: {
          phaseName: existing.phaseName,
          startDate: existing.startDate,
          endDate: existing.endDate,
        },
        newValues: { phaseName: updated.phaseName, startDate, endDate, removedPhases: removed },
      },
    );
    return updated;
  }

  /**
   * DL-2.02 Kích hoạt (Nháp -> Đang áp dụng), DL-2.04 Hoàn thành, DL-2.03 Hủy.
   * Khóa dòng giáo án và dòng ngựa: Khóa y tế đặt cùng lúc sẽ phải chờ, không lọt qua kiểm tra.
   */
  async changePlanStatus(id: string, dto: ChangePlanStatusDto, user: CurrentUserPayload) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "TrainingPlan" WHERE "id" = ${id} FOR UPDATE`;
      const plan = await tx.trainingPlan.findUnique({ where: { id } });
      if (!plan) {
        throw apiError(HttpStatus.NOT_FOUND, 'PLAN_NOT_FOUND', 'Training plan not found.');
      }
      if (user.role === UserRole.HEAD_TRAINER && plan.trainerUserId !== user.userId) {
        throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This plan belongs to another trainer.');
      }
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${plan.horseId} FOR UPDATE`;
      const horse = await tx.horse.findUnique({ where: { id: plan.horseId } });

      let cancelledWorkouts = 0;
      const data: Prisma.TrainingPlanUpdateInput = { status: dto.status };

      if (dto.status === PlanStatus.ACTIVE) {
        if (plan.status !== PlanStatus.DRAFT) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'INVALID_PLAN_TRANSITION',
            'Chỉ kích hoạt được giáo án đang ở Nháp.',
          );
        }

        // Tịnh tiến đồng bộ lịch tập nếu có effectiveStartDate
        if (dto.effectiveStartDate) {
          const targetStartDate = new Date(dto.effectiveStartDate);
          const shiftMs = targetStartDate.getTime() - plan.startDate.getTime();

          if (shiftMs !== 0) {
            await this.assertCanActivate(tx, plan, horse, dto);

            const newPlanStartDate = targetStartDate;
            const newPlanEndDate = new Date(plan.endDate.getTime() + shiftMs);

            const currentPhases = phasesOf(plan);
            const shiftedPhases = currentPhases.map((phase) => ({
              ...phase,
              startDate: new Date(new Date(phase.startDate).getTime() + shiftMs).toISOString(),
              endDate: new Date(new Date(phase.endDate).getTime() + shiftMs).toISOString(),
            }));

            await tx.trainingPlan.update({
              where: { id: plan.id },
              data: {
                startDate: newPlanStartDate,
                endDate: newPlanEndDate,
                phases: shiftedPhases,
              },
            });

            const sessions = await tx.workoutSession.findMany({
              where: { trainingPlanId: plan.id },
              select: { id: true, scheduledDate: true },
            });

            for (const session of sessions) {
              const newDate = new Date(session.scheduledDate.getTime() + shiftMs);
              await tx.workoutSession.update({
                where: { id: session.id },
                data: { scheduledDate: newDate },
              });
            }
          } else {
            await this.assertCanActivate(tx, plan, horse, dto);
          }
        } else {
          await this.assertCanActivate(tx, plan, horse, dto);
        }
        if (horse!.status === HorseStatus.RESTING) {
          await tx.horse.update({
            where: { id: horse!.id },
            data: { status: HorseStatus.IN_TRAINING },
          });
          await this.auditService.record(
            { id: user.userId, name: user.fullName || user.email },
            'HORSE_STATUS_CHANGED',
            `Changed status of horse ${horse!.name} from RESTING to IN_TRAINING. Reason: Kích hoạt giáo án ${plan.phaseName}`,
            horse!.id,
            {
              entityName: 'Horse',
              newValues: {
                oldStatus: 'RESTING',
                newStatus: 'IN_TRAINING',
                reason: 'Kích hoạt giáo án',
              },
            },
            tx,
          );
        }
      } else {
        const allowedFrom: PlanStatus[] =
          dto.status === PlanStatus.COMPLETED
            ? [PlanStatus.ACTIVE]
            : [PlanStatus.DRAFT, PlanStatus.ACTIVE];
        if (!allowedFrom.includes(plan.status)) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'INVALID_PLAN_TRANSITION',
            dto.status === PlanStatus.COMPLETED
              ? 'Chỉ hoàn thành được giáo án Đang áp dụng.'
              : 'Giáo án đã kết thúc.',
          );
        }
        if (dto.status === PlanStatus.COMPLETED) {
          if (!dto.summary) {
            throw apiError(
              HttpStatus.BAD_REQUEST,
              'SUMMARY_REQUIRED',
              'Nhận xét phải từ 10 đến 2000 ký tự.',
            );
          }
          const unfinished = await tx.workoutSession.findMany({
            where: {
              trainingPlanId: id,
              OR: [
                { status: { notIn: [WorkoutStatus.COMPLETED, WorkoutStatus.CANCELLED] } },
                { status: WorkoutStatus.COMPLETED, resultRecordedAt: null },
              ],
            },
            select: { scheduledDate: true },
            orderBy: { scheduledDate: 'asc' },
          });
          if (unfinished.length > 0) {
            const formatter = new Intl.DateTimeFormat('vi-VN', {
              dateStyle: 'short',
              timeStyle: 'short',
              timeZone: 'Asia/Ho_Chi_Minh',
            });
            const dates = unfinished
              .slice(0, 5)
              .map(({ scheduledDate }) => formatter.format(scheduledDate))
              .join(', ');
            throw apiError(
              HttpStatus.CONFLICT,
              'PLAN_WORKOUT_RESULTS_REQUIRED',
              `Còn ${unfinished.length} buổi tập chưa ghi kết quả: ${dates}.`,
            );
          }
          data.completionSummary = dto.summary.trim();
        } else {
          if (!dto.reason) {
            throw apiError(
              HttpStatus.BAD_REQUEST,
              'REASON_REQUIRED',
              'Lý do phải từ 10 đến 500 ký tự.',
            );
          }
          data.cancelReason = dto.reason.trim();
        }
        const res = await tx.workoutSession.updateMany({
          where: { trainingPlanId: id, status: { in: PENDING_WORKOUT_STATUSES } },
          data: { status: WorkoutStatus.CANCELLED, statusReason: 'Giáo án đã kết thúc' },
        });
        cancelledWorkouts = res.count;

        // Tự động chuyển ngựa về RESTING nếu không còn giáo án nào khác đang chạy và ngựa đang ở IN_TRAINING
        const otherActivePlans = await tx.trainingPlan.count({
          where: { horseId: plan.horseId, id: { not: id }, status: PlanStatus.ACTIVE },
        });
        if (otherActivePlans === 0 && horse!.status === HorseStatus.IN_TRAINING) {
          await tx.horse.update({
            where: { id: horse!.id },
            data: { status: HorseStatus.RESTING },
          });
          await this.auditService.record(
            { id: user.userId, name: user.fullName || user.email },
            'HORSE_STATUS_CHANGED',
            `Changed status of horse ${horse!.name} from IN_TRAINING to RESTING. Reason: Giáo án kết thúc, chuyển về nghỉ ngơi hồi phục`,
            horse!.id,
            {
              entityName: 'Horse',
              newValues: {
                oldStatus: 'IN_TRAINING',
                newStatus: 'RESTING',
                reason: 'Giáo án kết thúc',
              },
            },
            tx,
          );
        }
      }

      const updated = await tx.trainingPlan.update({ where: { id }, data, include: PLAN_INCLUDE });

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        `TRAINING_PLAN_${dto.status}`,
        `Training plan "${plan.phaseName}" ${plan.status} -> ${dto.status}`,
        id,
        {
          entityName: 'TrainingPlan',
          oldValues: { status: plan.status },
          newValues: { status: dto.status, reason: dto.reason, cancelledWorkouts },
        },
        tx,
      );

      return { ...updated, cancelledWorkouts };
    });

    if (dto.status === PlanStatus.CANCELLED) {
      // Theo chỉ đạo người dùng (V39): Hủy hoặc xóa bản nháp KHÔNG áp dụng cooldown 48h,
      // chiến mã lập tức quay về trạng thái sẵn sàng để HLV tạo lại được ngay.
      const isManagerCancel =
        user.role === UserRole.CLUB_MANAGER && result.trainerUserId !== user.userId;
      if (isManagerCancel) {
        await this.notifications.notifyUsers([result.trainerUserId], {
          type: 'PLAN_CANCELLED_BY_MANAGER',
          category: 'TRAINING',
          title: 'Giáo án bị Quản lý CLB hủy',
          message: `Quản lý CLB (${user.fullName || 'Manager'}) đã hủy giáo án "${result.phaseName}" của bạn cho ngựa ${result.horse?.name ?? ''}. Lý do: ${dto.reason}`,
          link: `/training/plans/${result.id}`,
          senderName: user.fullName,
        });
      }
    }

    if (dto.status === PlanStatus.ACTIVE) {
      await this.notifications.notifyHorse(
        result.horseId,
        { owner: true },
        {
          type: 'PLAN_ACTIVATED',
          category: 'TRAINING',
          title: 'Training plan started',
          message: `Training plan "${result.phaseName}" is now active for ${result.horse?.name ?? 'your horse'}.`,
          params: { plan: result.phaseName, horse: result.horse?.name ?? '' },
          link: `/training/plans/${result.id}`,
          senderName: user.fullName,
        },
        user.userId,
      );
      await this.notifyGroomsOnActivate(result.id, result.horse?.name ?? '', user);
    }
    return result;
  }

  /**
   * Buổi tập của giáo án Nháp chưa báo groom; khi kích hoạt mới báo, mỗi groom 1 tin
   * (số buổi được giao và ngày buổi đầu), giống thông báo khi xếp buổi trên giáo án đang áp dụng.
   */
  private async notifyGroomsOnActivate(
    planId: string,
    horseName: string,
    user: CurrentUserPayload,
  ) {
    const rows = await this.prisma.workoutSession.findMany({
      where: {
        trainingPlanId: planId,
        status: WorkoutStatus.SCHEDULED,
        assignedStaffUserId: { not: null },
      },
      orderBy: { scheduledDate: 'asc' },
      select: { assignedStaffUserId: true, scheduledDate: true },
    });
    const byGroom = new Map<string, { count: number; first: Date }>();
    for (const r of rows) {
      const id = r.assignedStaffUserId as string;
      const cur = byGroom.get(id);
      if (cur) cur.count++;
      else byGroom.set(id, { count: 1, first: r.scheduledDate });
    }
    for (const [groomId, { count, first }] of byGroom) {
      await this.notifications.notifyUsers(
        [groomId],
        {
          type: 'WORKOUT_ASSIGNED',
          category: 'TRAINING',
          title: 'New workout assigned to you',
          message: `${count} workout(s) for ${horseName}, first on ${clubDate(first)}.`,
          params: { horse: horseName, count, date: clubDate(first) },
          link: '/my-training',
          senderName: user.fullName,
        },
        user.userId,
      );
    }
  }

  private async createAssignedPlan(
    horse: { id: string; name: string },
    trainerId: string,
    data: Prisma.TrainingPlanUncheckedCreateInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockWorkoutSchedule(tx);
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${horse.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${trainerId} FOR UPDATE`;
      const current = await tx.horse.findUnique({
        where: { id: horse.id },
        include: {
          medicalLocks: { where: { isLocked: true }, select: { id: true }, take: 1 },
          stallAllocations: {
            where: { isActive: true },
            take: 1,
            select: { stall: { select: { zoneId: true, zoneRef: { select: { name: true } } } } },
          },
        },
      });
      if (
        !current ||
        current.deletedAt ||
        current.status === 'RETIRED' ||
        current.isMedicalLocked ||
        (current.medicalLocks?.length ?? 0) > 0
      )
        throw apiError(
          HttpStatus.CONFLICT,
          'HORSE_MEDICAL_LOCKED',
          'Horse is no longer eligible for a new plan.',
        );
      await this.assertNoOtherTrainer(horse.id, horse.name, trainerId, tx);
      await this.assertTrainerCapacity(horse.id, horse.name, trainerId, tx);
      const trainer = tx.user?.findUnique
        ? await tx.user.findUnique({
            where: { id: trainerId },
            select: { assignedBarnId: true },
          })
        : null;
      const horseStall = current.stallAllocations?.[0]?.stall;
      if (
        trainer?.assignedBarnId &&
        horseStall?.zoneId &&
        trainer.assignedBarnId !== horseStall.zoneId
      ) {
        throw apiError(
          HttpStatus.CONFLICT,
          'TRAINER_ZONE_MISMATCH',
          `${horse.name} đang ở ${horseStall.zoneRef?.name ?? 'khu chuồng khác'}. HLV chỉ được lập giáo án cho chiến mã trong cùng khu chuồng.`,
        );
      }
      const created = await tx.trainingPlan.create({ data, include: PLAN_INCLUDE });
      if (current.assignedTrainerId === null && tx.horse?.update) {
        const now = effectiveNow();
        await tx.horse.update({
          where: { id: horse.id },
          data: {
            assignedTrainerId: trainerId,
            trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
            trainerAssignedAt: now,
            trainerRespondedAt: now,
          },
        });
      }
      if (data.workoutSessions?.create) {
        const copies = await tx.workoutSession.findMany({
          where: { trainingPlanId: created.id, status: 'SCHEDULED' },
        });
        for (const row of copies)
          await new WorkoutsService(
            this.prisma,
            this.auditService,
            this.notifications,
            this.common,
          ).validateAdmission(
            tx,
            created,
            {
              scheduledDate: row.scheduledDate,
              phaseId: row.phaseId,
              workoutType: row.workoutType ?? 'TROT',
              intensity: row.intensity ?? 'MEDIUM',
              trackId: row.trackId,
              trackSurface: row.trackSurface ?? 'TURF',
              distanceMeters: row.distanceMeters,
              repetitions: row.repetitions,
              targetSpeedKmh: row.targetSpeedKmh,
            },
            row.id,
          );
      }
      return created;
    });
  }

  /**
   * Ghi nhận thời gian chờ (cooldown 48h) khi HLV hủy hoặc để hết hạn bản nháp trên một chiến mã
   */
  private async recordHorseCooldown(
    horseId: string,
    trainerUserId: string,
    reason: string,
    action = 'TRAINER_HORSE_COOLDOWN',
  ) {
    if (!this.prisma.auditLog?.create) return;
    const cooldownUntil = new Date(effectiveNow().getTime() + 48 * 60 * 60 * 1000);
    await this.prisma.auditLog.create({
      data: {
        action,
        entityName: 'Horse',
        entityId: horseId,
        userId: trainerUserId,
        newValuesJson: JSON.stringify({
          horseId,
          trainerUserId,
          cooldownUntil: cooldownUntil.toISOString(),
          reason,
        }),
      },
    });
  }

  /**
   * Kiểm tra xem HLV có đang bị cooldown trên con ngựa này không
   */
  private async getTrainerHorseCooldown(
    horseId: string,
    trainerUserId: string,
  ): Promise<Date | null> {
    if (!this.prisma.auditLog?.findFirst) return null;
    const since = new Date(effectiveNow().getTime() - 48 * 60 * 60 * 1000);
    const latestCooldown = await this.prisma.auditLog.findFirst({
      where: {
        action: {
          in: [
            'TRAINER_HORSE_COOLDOWN',
            'DRAFT_EXPIRED',
            'PLAN_CANCELLED_COOLDOWN',
            'DELETE_PLAN_COOLDOWN',
          ],
        },
        entityName: 'Horse',
        entityId: horseId,
        userId: trainerUserId,
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
    });

    if (!latestCooldown) return null;

    let cooldownUntil = new Date(latestCooldown.timestamp.getTime() + 48 * 60 * 60 * 1000);
    if (latestCooldown.newValuesJson) {
      try {
        const parsed = JSON.parse(latestCooldown.newValuesJson);
        if (parsed.cooldownUntil) {
          cooldownUntil = new Date(parsed.cooldownUntil);
        }
      } catch (_e) {
        void _e;
      }
    }

    if (cooldownUntil <= effectiveNow()) return null;

    // Kiểm tra xem Quản lý CLB có mở khóa sau thời điểm cooldown này không
    const unlock = await this.prisma.auditLog.findFirst({
      where: {
        action: 'UNLOCK_HORSE_COOLDOWN',
        entityName: 'Horse',
        entityId: horseId,
        timestamp: { gte: latestCooldown.timestamp },
      },
      orderBy: { timestamp: 'desc' },
    });

    if (unlock && unlock.newValuesJson) {
      try {
        const parsed = JSON.parse(unlock.newValuesJson);
        if (parsed.trainerUserId === trainerUserId) {
          return null; // Đã được Quản lý mở khóa
        }
      } catch (_e) {
        void _e;
      }
    }

    return cooldownUntil;
  }

  /**
   * Quản lý CLB xem cooldown mới nhất của bất kỳ HLV nào trên con ngựa này
   */
  private async getLatestHorseCooldownForManager(
    horseId: string,
  ): Promise<{ remainingHours: number; trainerUserId: string; trainerName: string } | null> {
    if (!this.prisma.auditLog?.findFirst) return null;
    const since = new Date(effectiveNow().getTime() - 48 * 60 * 60 * 1000);
    const latest = await this.prisma.auditLog.findFirst({
      where: {
        action: {
          in: [
            'TRAINER_HORSE_COOLDOWN',
            'DRAFT_EXPIRED',
            'PLAN_CANCELLED_COOLDOWN',
            'DELETE_PLAN_COOLDOWN',
          ],
        },
        entityName: 'Horse',
        entityId: horseId,
        timestamp: { gte: since },
      },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { timestamp: 'desc' },
    });

    if (!latest || !latest.userId) return null;

    const cooldownUntil = await this.getTrainerHorseCooldown(horseId, latest.userId);
    if (!cooldownUntil || cooldownUntil <= effectiveNow()) return null;

    const remainingHours = Math.ceil(
      (cooldownUntil.getTime() - effectiveNow().getTime()) / (3600 * 1000),
    );
    return {
      remainingHours,
      trainerUserId: latest.userId,
      trainerName: latest.user?.fullName || latest.user?.email || 'Huấn luyện viên',
    };
  }

  /**
   * Quản lý CLB mở khóa thời gian chờ (cooldown) cho HLV trên chiến mã
   */
  async unlockCooldown(horseId: string, dto: UnlockCooldownDto, user: CurrentUserPayload) {
    if (user.role !== UserRole.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Chỉ Quản lý CLB mới có quyền mở khóa thời gian chờ.',
      );
    }
    const horse = await this.prisma.horse.findUnique({
      where: { id: horseId },
      select: { id: true, name: true },
    });
    if (!horse) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Không tìm thấy chiến mã.');
    }

    await this.prisma.auditLog.create({
      data: {
        action: 'UNLOCK_HORSE_COOLDOWN',
        entityName: 'Horse',
        entityId: horseId,
        userId: user.userId,
        newValuesJson: JSON.stringify({
          horseId,
          trainerUserId: dto.trainerUserId,
          unlockedBy: user.fullName || user.email,
          reason: dto.reason.trim(),
          unlockedAt: effectiveNow().toISOString(),
        }),
      },
    });

    await this.notifications.notifyUsers([dto.trainerUserId], {
      type: 'COOLDOWN_UNLOCKED',
      category: 'TRAINING',
      title: 'Đã mở khóa thời gian chờ tạo giáo án',
      message: `Quản lý ${user.fullName || 'CLB'} đã mở khóa thời gian chờ cho bạn đối với chiến mã ${horse.name}. Lý do: ${dto.reason.trim()}`,
      link: '/training/plans/new',
      senderName: user.fullName,
    });

    return {
      success: true,
      message: `Đã mở khóa thời gian chờ thành công cho chiến mã ${horse.name}.`,
    };
  }

  /**
   * Mỗi ngựa một HLV phụ trách tại một thời điểm: ngựa đang có giáo án Nháp / Đang áp dụng của
   * HLV khác thì không lập thêm (buổi nháp của người khác sẽ chiếm giờ ngựa mà HLV này không thấy).
   * Cùng một HLV vẫn được chuẩn bị giáo án tiếp theo cho ngựa của mình.
   */
  private async assertNoOtherTrainer(horseId: string, horseName: string, userId: string, tx?: Tx) {
    const client = tx || this.prisma;
    // Kiểm tra Cooldown: nếu HLV này đang trong thời gian chờ (48h) do hủy / hết hạn
    const cooldownUntil = await this.getTrainerHorseCooldown(horseId, userId);
    if (cooldownUntil && cooldownUntil > effectiveNow()) {
      const remainingHours = Math.ceil(
        (cooldownUntil.getTime() - effectiveNow().getTime()) / (3600 * 1000),
      );
      throw apiError(
        HttpStatus.CONFLICT,
        'TRAINER_IN_COOLDOWN',
        `Bạn đang trong thời gian chờ (${remainingHours} giờ còn lại) đối với chiến mã "${horseName}" do vừa hủy hoặc để hết hạn bản nháp. Vui lòng liên hệ Quản lý CLB nếu cần mở khóa sớm.`,
      );
    }

    const other = await client.trainingPlan.findFirst({
      where: {
        horseId,
        status: { in: [PlanStatus.DRAFT, PlanStatus.ACTIVE] },
        trainerUserId: { not: userId },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      select: { id: true, planCode: true, trainer: { select: { fullName: true } } },
    });
    if (other) {
      const trainer = other.trainer.fullName;
      const planCode = other.planCode ?? '';
      throw apiError(
        HttpStatus.CONFLICT,
        'HORSE_HAS_OTHER_TRAINER',
        `${horseName} đang do HLV ${trainer} phụ trách (giáo án ${planCode}). Liên hệ HLV này hoặc Quản lý CLB.`,
        { planId: other.id, planCode, trainer, horse: horseName },
      );
    }
  }

  /**
   * #5: một HLV phụ trách tối đa 8 ngựa (giáo án Nháp / Đang áp dụng).
   * #6: các ngựa đó phải ở cùng một khu chuồng.
   */
  private async assertTrainerCapacity(horseId: string, horseName: string, userId: string, tx: Tx) {
    const plans = await tx.trainingPlan.findMany({
      where: {
        trainerUserId: userId,
        status: { in: [PlanStatus.DRAFT, PlanStatus.ACTIVE] },
        horseId: { not: horseId },
        horse: { deletedAt: null },
      },
      select: { horseId: true, horse: { select: { name: true } } },
    });
    const others = [...new Map(plans.map((p) => [p.horseId, p.horse.name])).entries()];
    if (others.length >= MAX_HORSES_PER_TRAINER) {
      const horses = others.map(([, name]) => name).join(', ');
      throw apiError(
        HttpStatus.CONFLICT,
        'TRAINER_HORSE_LIMIT',
        `Mỗi HLV chỉ phụ trách tối đa ${MAX_HORSES_PER_TRAINER} ngựa. Bạn đang phụ trách: ${horses}.`,
        { max: MAX_HORSES_PER_TRAINER, horses },
      );
    }
    if (others.length === 0) return;
    const allocs = await tx.stallAllocation.findMany({
      where: { isActive: true, horseId: { in: [horseId, ...others.map(([id]) => id)] } },
      select: {
        horseId: true,
        stall: { select: { zoneId: true, zoneRef: { select: { name: true } } } },
      },
    });
    const zoneOf = new Map(allocs.map((a) => [a.horseId, a.stall]));
    const mine = zoneOf.get(horseId);
    // shortcut: ngựa chưa có ô chuồng thì chưa so được khu -> cho qua, khi xếp chuồng mới biết.
    if (!mine?.zoneId) return;
    const other = others
      .map(([id, name]) => ({ name, stall: zoneOf.get(id) }))
      .find((o) => o.stall?.zoneId && o.stall.zoneId !== mine.zoneId);
    if (other) {
      throw apiError(
        HttpStatus.CONFLICT,
        'TRAINER_ZONE_MISMATCH',
        `${horseName} ở khu ${mine.zoneRef?.name ?? ''}, còn ${other.name} bạn đang phụ trách ở khu ${other.stall?.zoneRef?.name ?? ''}. Một HLV chỉ phụ trách ngựa trong cùng một khu chuồng.`,
        {
          horse: horseName,
          zone: mine.zoneRef?.name,
          otherHorse: other.name,
          otherZone: other.stall?.zoneRef?.name,
        },
      );
    }
  }

  /** Các dòng ✖ của DL-2.02 (chặn) và dòng ⚠ (cần xác nhận đã trao đổi với VET). */
  private async assertCanActivate(
    tx: Tx,
    plan: { id: string; horseId: string; endDate: Date },
    horse: {
      id: string;
      isMedicalLocked: boolean;
      status: HorseStatus;
      deletedAt: Date | null;
    } | null,
    dto: ChangePlanStatusDto,
  ) {
    if (!horse || horse.deletedAt) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Target horse not found.');
    }
    if (horse.isMedicalLocked) {
      throw apiError(
        HttpStatus.CONFLICT,
        'MEDICAL_LOCK_ACTIVE',
        'Ngựa đang bị Khóa huấn luyện y tế. Không thể kích hoạt giáo án.',
      );
    }
    if (horse.status === HorseStatus.RETIRED) {
      throw apiError(HttpStatus.BAD_REQUEST, 'HORSE_RETIRED', 'Ngựa đã ngừng quản lý.');
    }
    const other = await tx.trainingPlan.findFirst({
      where: { horseId: horse.id, status: PlanStatus.ACTIVE, id: { not: plan.id } },
    });
    if (other) {
      throw apiError(
        HttpStatus.CONFLICT,
        'HORSE_HAS_ACTIVE_PLAN',
        `Ngựa đang áp dụng giáo án ${other.phaseName}. Hãy hoàn thành hoặc hủy giáo án đó trước.`,
        { planId: other.id },
      );
    }
    const workouts = await tx.workoutSession.count({
      where: { trainingPlanId: plan.id, status: { not: WorkoutStatus.CANCELLED } },
    });
    if (workouts === 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'PLAN_HAS_NO_WORKOUTS',
        'Giáo án phải có ít nhất 1 buổi tập trước khi kích hoạt.',
      );
    }
    // H-13: Giáo án phải có ít nhất 1 buổi tập khả thi trong tương lai (từ hôm nay trở đi)
    const validUpcomingWorkouts = await tx.workoutSession.count({
      where: {
        trainingPlanId: plan.id,
        status: WorkoutStatus.SCHEDULED,
        scheduledDate: { gte: startOfClubDay(effectiveNow()) },
      },
    });
    if (validUpcomingWorkouts === 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'NO_UPCOMING_SCHEDULED_WORKOUTS',
        'Giáo án phải có ít nhất 1 buổi tập khả thi trong tương lai (từ hôm nay trở đi) trước khi kích hoạt.',
      );
    }
    if (plan.endDate < startOfClubDay(effectiveNow())) {
      throw apiError(HttpStatus.BAD_REQUEST, 'PLAN_ENDED', 'Ngày kết thúc của giáo án đã qua.');
    }
    if (MEDICAL_STATUSES.includes(horse.status) && !dto.vetConsulted) {
      throw apiError(
        HttpStatus.CONFLICT,
        'VET_CONFIRMATION_REQUIRED',
        `Ngựa đang ở trạng thái ${horse.status}. Hãy xác nhận đã trao đổi với Bác sĩ thú y.`,
        { horseStatus: horse.status },
      );
    }
  }

  /** Xóa giáo án: chỉ giáo án Nháp chưa có buổi hoàn thành. Còn lại dùng Hủy giáo án. */
  async deletePlan(id: string, user: CurrentUserPayload) {
    const plan = await this.prisma.trainingPlan.findUnique({
      where: { id },
      include: {
        horse: { select: { id: true, name: true } },
        workoutSessions: { where: { status: WorkoutStatus.COMPLETED }, take: 1 },
      },
    });
    if (!plan) {
      throw apiError(HttpStatus.NOT_FOUND, 'PLAN_NOT_FOUND', 'Training plan not found.');
    }
    if (user.role === UserRole.HEAD_TRAINER && plan.trainerUserId !== user.userId) {
      throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This plan belongs to another trainer.');
    }
    if (plan.status !== PlanStatus.DRAFT || plan.workoutSessions.length > 0) {
      throw apiError(
        HttpStatus.CONFLICT,
        'PLAN_NOT_DELETABLE',
        'Chỉ xóa được giáo án Nháp chưa có buổi tập hoàn thành. Hãy dùng Hủy giáo án.',
      );
    }

    // Theo quyết định người dùng (V39): HLV tự xóa bản nháp của mình KHÔNG áp dụng cooldown 48h,
    // chiến mã lập tức quay về trạng thái Sẵn sàng lập giáo án để HLV tạo lại được ngay.

    await this.prisma.$transaction([
      this.prisma.workoutSession.deleteMany({ where: { trainingPlanId: id } }),
      this.prisma.trainingPlan.delete({ where: { id } }),
    ]);

    const isManagerOverride =
      user.role === UserRole.CLUB_MANAGER && plan.trainerUserId !== user.userId;
    await this.auditService.record(
      { id: user.userId, name: user.fullName || user.email },
      isManagerOverride ? 'DELETE_TRAINING_PLAN_BY_MANAGER' : 'DELETE_TRAINING_PLAN',
      isManagerOverride
        ? `Quản lý CLB (${user.fullName || user.email}) đã xóa bản nháp giáo án "${plan.phaseName}" (${id}) của HLV ${plan.trainerUserId}`
        : `Deleted draft training plan "${plan.phaseName}" (${id})`,
      id,
      { entityName: 'TrainingPlan', newValues: { horseId: plan.horseId } },
    );

    if (isManagerOverride) {
      await this.notifications.notifyUsers([plan.trainerUserId], {
        type: 'PLAN_DELETED_BY_MANAGER',
        category: 'TRAINING',
        title: 'Bản nháp giáo án bị Quản lý xóa',
        message: `Quản lý CLB (${user.fullName || 'Manager'}) đã xóa bản nháp giáo án "${plan.phaseName}" cho ngựa ${plan.horse?.name ?? ''} để giải phóng vị trí.`,
        link: '/training/plans',
      });
    }

    return { message: 'Training plan deleted successfully.' };
  }

  /**
   * DL-2.08 Nhân bản giáo án sang ngựa khác: bản mới luôn Nháp; buổi tập dời theo độ lệch ngày
   * bắt đầu, không chép kết quả. Ngựa đích đang khóa thì buổi nặng được tạo ở trạng thái Bị chặn.
   */
  async clonePlan(id: string, dto: ClonePlanDto, user: CurrentUserPayload) {
    const source = await this.prisma.trainingPlan.findUnique({
      where: { id },
      include: { workoutSessions: { where: { status: { not: WorkoutStatus.CANCELLED } } } },
    });
    if (!source) {
      throw apiError(HttpStatus.NOT_FOUND, 'PLAN_NOT_FOUND', 'Training plan not found.');
    }
    if (user.role === UserRole.HEAD_TRAINER && source.trainerUserId !== user.userId) {
      throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'This plan belongs to another trainer.');
    }
    const horse = await this.prisma.horse.findUnique({
      where: { id: dto.targetHorseId, deletedAt: null },
    });
    if (!horse) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Target horse not found.');
    }
    if (horse.status === HorseStatus.RETIRED) {
      throw apiError(HttpStatus.BAD_REQUEST, 'HORSE_RETIRED', 'Ngựa đã ngừng quản lý.');
    }
    if (horse.isMedicalLocked) {
      throw apiError(
        HttpStatus.CONFLICT,
        'HORSE_MEDICAL_LOCKED',
        'Ngựa đang bị Khóa huấn luyện y tế. Không thể tạo giáo án mới cho đến khi Bác sĩ thú y gỡ khóa.',
      );
    }
    if (horse.isDebtImpounded) {
      throw apiError(
        HttpStatus.CONFLICT,
        'HORSE_DEBT_IMPOUNDED',
        'Ngựa đang bị lưu giữ do nợ phí lưu chuồng. Không thể tạo giáo án mới cho đến khi chủ sở hữu hoàn tất thanh toán công nợ.',
      );
    }
    await this.assertNoOtherTrainer(horse.id, horse.name, user.userId);

    // BR-TRN-CAPACITY: Mỗi HLV chỉ được phụ trách tối đa 8 chiến mã đồng thời
    const activePlanCount = await this.prisma.trainingPlan.count({
      where: {
        trainerUserId: user.userId,
        status: { in: [PlanStatus.DRAFT, PlanStatus.ACTIVE] },
        horse: { deletedAt: null },
      },
    });
    if (activePlanCount >= MAX_HORSES_PER_TRAINER) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TRAINER_CAPACITY_EXCEEDED',
        `Mỗi Huấn luyện viên chỉ được quản lý tối đa ${MAX_HORSES_PER_TRAINER} chiến mã đồng thời. Vui lòng hoàn thành hoặc hủy bớt giáo án hiện có trước khi tạo mới.`,
      );
    }

    const now = effectiveNow();
    const startDate = dto.startDate ? new Date(dto.startDate) : addDays(startOfClubDay(now), 1);
    this.assertStartsFromTomorrow(startDate);
    const shift = startDate.getTime() - source.startDate.getTime();
    const copyWorkouts = dto.copyWorkouts !== false;

    // Bản sao do HLV đang thao tác dẫn + cưỡi -> phải bỏ các buổi trùng lịch HLV (thời lượng + 15 phút đệm)
    // hoặc trùng giờ của ngựa đích, như kiểm tra khi tạo buổi tập lẻ.
    const MIN = 60 * 1000;
    const span = (start: number, type?: string | null) =>
      [start, start + (workoutDurationMinutes(type) + GROOM_BUFFER_MINUTES) * MIN] as const;
    const candidates = copyWorkouts
      ? source.workoutSessions
          .map((w) => ({ w, date: new Date(w.scheduledDate.getTime() + shift) }))
          .filter(({ date }) => date >= now)
      : [];
    const copies: typeof candidates = [];
    if (candidates.length > 0) {
      const times = candidates.map(({ date }) => date.getTime());
      const taken = await this.prisma.workoutSession.findMany({
        where: {
          status: { not: WorkoutStatus.CANCELLED },
          OR: [{ trainingPlan: { trainerUserId: user.userId } }, { horseId: horse.id }],
          scheduledDate: {
            gte: new Date(Math.min(...times) - 120 * MIN),
            lte: new Date(Math.max(...times) + 120 * MIN),
          },
        },
        select: {
          horseId: true,
          trainingPlan: { select: { trainerUserId: true } },
          scheduledDate: true,
          workoutType: true,
        },
      });
      const busy = (taken ?? []).map((t) => ({
        horseId: t.horseId,
        trainer: t.trainingPlan?.trainerUserId,
        start: t.scheduledDate.getTime(),
        type: t.workoutType,
      }));
      for (const c of candidates) {
        const start = c.date.getTime();
        const [aStart, aEnd] = span(start, c.w.workoutType);
        const clash = busy.some((b) => {
          if (b.horseId === horse.id && Math.abs(b.start - start) < 30 * MIN) return true;
          if (b.trainer !== user.userId) return false;
          const [bStart, bEnd] = span(b.start, b.type);
          return aStart < bEnd && bStart < aEnd;
        });
        if (clash) continue;
        copies.push(c);
        busy.push({
          horseId: horse.id,
          trainer: user.userId,
          start,
          type: c.w.workoutType,
        });
      }
    }

    const plan = await this.createAssignedPlan(horse, user.userId, {
      horseId: horse.id,
      trainerUserId: user.userId,
      planCode: `GA-${String(await this.counter.next('training_plan')).padStart(6, '0')}`,
      phaseName: dto.name ?? `${source.phaseName} (bản sao)`,
      objective: source.objective,
      notes: source.notes,
      // Giai đoạn dời ngày theo độ lệch ngày bắt đầu, giữ id để buổi tập vẫn thuộc đúng giai đoạn.
      phases: phasesOf(source).map((ph) => ({
        ...ph,
        startDate: clubDate(new Date(Date.parse(`${ph.startDate}T00:00:00+07:00`) + shift)),
        endDate: clubDate(new Date(Date.parse(`${ph.endDate}T00:00:00+07:00`) + shift)),
      })) as unknown as Prisma.InputJsonValue,
      targetSpeed: source.targetSpeed,
      targetDistance: source.targetDistance,
      trackSurface: source.trackSurface,
      startDate,
      endDate: new Date(source.endDate.getTime() + shift),
      status: PlanStatus.DRAFT,
      ...(copyWorkouts && {
        workoutSessions: {
          create: copies.map(({ w, date }) => {
            const blocked = horse.isMedicalLocked && isHeavy(w.workoutType, w.intensity);
            return {
              horseId: horse.id,
              assignedStaffUserId: user.userId,
              phaseId: w.phaseId,
              scheduledDate: date,
              distanceMeters: w.distanceMeters,
              repetitions: w.repetitions,
              targetSpeedKmh: w.targetSpeedKmh,
              targetDurationSeconds: w.targetDurationSeconds,
              workoutType: w.workoutType,
              intensity: w.intensity,
              trackSurface: w.trackSurface,
              trackId: w.trackId,
              jockeyName: user.fullName,
              trainerNotes: w.trainerNotes,
              status: blocked ? WorkoutStatus.BLOCKED : WorkoutStatus.SCHEDULED,
              statusReason: blocked ? 'Ngựa đang bị Khóa huấn luyện y tế' : null,
            };
          }),
        },
      }),
    });

    await this.auditService.record(
      { id: user.userId, name: user.fullName || user.email },
      'CLONE_TRAINING_PLAN',
      `Cloned training plan "${source.phaseName}" to horse ${horse.name}`,
      plan.id,
      {
        entityName: 'TrainingPlan',
        newValues: {
          sourcePlanId: source.id,
          horseId: horse.id,
          skippedWorkouts: candidates.length - copies.length,
        },
      },
    );
    return { ...plan, skippedWorkouts: candidates.length - copies.length };
  }

  /**
   * UI/UX tối ưu tạo/sao chép giáo án: Lấy danh sách toàn bộ chiến mã kèm trạng thái giáo án thời gian thực.
   * Giúp HLV phân biệt tức thì:
   * - Ngựa chưa có giáo án (Sẵn sàng)
   * - Ngựa đang có giáo án hoạt động do mình quản lý
   * - Ngựa do HLV khác phụ trách (bị khóa chọn)
   * - Ngựa đang bị Khóa y tế
   */
  async getAssignableHorses(user: CurrentUserPayload) {
    await this.common.sweepOverdue();
    const whereCondition: Prisma.HorseWhereInput = {
      deletedAt: null,
      status: { not: HorseStatus.RETIRED },
    };
    let trainerBarnId: string | null = null;
    if (user.role === UserRole.HEAD_TRAINER) {
      const me = this.prisma.user?.findUnique
        ? await this.prisma.user.findUnique({
            where: { id: user.userId },
            select: { assignedBarnId: true },
          })
        : null;
      trainerBarnId = me?.assignedBarnId ?? null;
      whereCondition.OR = [
        { assignedTrainerId: user.userId },
        ...(trainerBarnId
          ? [
              {
                assignedTrainerId: null,
                stallAllocations: {
                  some: {
                    isActive: true,
                    stall: { zoneId: trainerBarnId },
                  },
                },
              },
            ]
          : []),
      ];
    }
    const horses = await this.prisma.horse.findMany({
      where: whereCondition,
      select: {
        id: true,
        name: true,
        horseCode: true,
        breed: true,
        dob: true,
        gender: true,
        color: true,
        status: true,
        isMedicalLocked: true,
        isDebtImpounded: true,
        avatarUrl: true,
        assignedTrainerId: true,
        trainerAssignmentStatus: true,
        assignedTrainer: { select: { id: true, fullName: true } },
        handoverRequests: {
          where: { status: 'ACCEPTED' },
          orderBy: { acceptedAt: 'desc' },
          take: 1,
          select: { planDeadlineAt: true, acceptedAt: true },
        },
        owner: { select: { id: true, fullName: true } },
        stallAllocations: {
          where: { isActive: true },
          take: 1,
          select: {
            stall: {
              select: {
                id: true,
                code: true,
                zone: true,
                zoneRef: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const activeOrDraftPlans = await this.prisma.trainingPlan.findMany({
      where: {
        status: {
          in: [PlanStatus.DRAFT, PlanStatus.ACTIVE, PlanStatus.COMPLETED, PlanStatus.CANCELLED],
        },
        horse: { deletedAt: null },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        planCode: true,
        phaseName: true,
        status: true,
        horseId: true,
        trainerUserId: true,
        trainer: { select: { id: true, fullName: true } },
        startDate: true,
        endDate: true,
        updatedAt: true,
      },
    });

    const horsePlanMap = new Map<string, typeof activeOrDraftPlans>();
    for (const p of activeOrDraftPlans) {
      const list = horsePlanMap.get(p.horseId) || [];
      list.push(p);
      horsePlanMap.set(p.horseId, list);
    }

    const items = await Promise.all(
      horses.map(async (h) => {
        const plans = horsePlanMap.get(h.id) || [];
        const activePlan = plans.find((p) => p.status === PlanStatus.ACTIVE) || null;
        const draftPlan = plans.find((p) => p.status === PlanStatus.DRAFT) || null;
        const completedPlans = plans.filter((p) => p.status === PlanStatus.COMPLETED);
        const lastCompletedPlan = completedPlans[0]
          ? {
              id: completedPlans[0].id,
              planCode: completedPlans[0].planCode ?? '',
              phaseName: completedPlans[0].phaseName,
              completedAt: completedPlans[0].endDate
                ? completedPlans[0].endDate.toISOString()
                : null,
            }
          : null;
        const cancelledPlans = plans.filter((p) => p.status === PlanStatus.CANCELLED);
        const lastCancelledPlan = cancelledPlans[0]
          ? {
              id: cancelledPlans[0].id,
              planCode: cancelledPlans[0].planCode ?? '',
              phaseName: cancelledPlans[0].phaseName,
              cancelledAt: cancelledPlans[0].updatedAt
                ? cancelledPlans[0].updatedAt.toISOString()
                : null,
            }
          : null;

        let planState:
          | 'READY'
          | 'ACTIVE_SELF'
          | 'ACTIVE_OTHER'
          | 'DRAFT_SELF'
          | 'DRAFT_OTHER'
          | 'MEDICAL_LOCKED'
          | 'DEBT_IMPOUNDED'
          | 'COOLDOWN_SELF'
          | 'PENDING_ACCEPTANCE'
          | 'UNASSIGNED_TRAINER' = 'READY';
        let canAssign = true;
        let badge = 'Sẵn sàng';
        let explanation = 'Chiến mã sẵn sàng để tạo giáo án mới.';
        let activePlanInfo: {
          id: string;
          planCode: string;
          name: string;
          trainerName: string;
        } | null = null;

        if (h.isMedicalLocked) {
          planState = 'MEDICAL_LOCKED';
          canAssign = false;
          badge = 'Khóa y tế';
          explanation = 'Ngựa đang bị Khóa huấn luyện y tế bởi Bác sĩ thú y.';
        } else if (h.isDebtImpounded) {
          planState = 'DEBT_IMPOUNDED';
          canAssign = false;
          badge = 'Lưu giữ nợ phí';
          explanation =
            'Ngựa đang bị lưu giữ do nợ chi phí nuôi chuồng. Khóa quyền tạo giáo án cho đến khi thanh toán nợ.';
        } else if (activePlan) {
          activePlanInfo = {
            id: activePlan.id,
            planCode: activePlan.planCode ?? '',
            name: activePlan.phaseName,
            trainerName: activePlan.trainer.fullName,
          };
          if (activePlan.trainerUserId === user.userId) {
            planState = 'ACTIVE_SELF';
            canAssign = false;
            badge = `Đang tập (${activePlan.planCode ?? 'Của bạn'})`;
            explanation = `Bạn đã có giáo án ${activePlan.planCode ?? ''} đang áp dụng cho ngựa này. Mỗi ngựa chỉ áp dụng 1 giáo án tại một thời điểm.`;
          } else {
            planState = 'ACTIVE_OTHER';
            canAssign = false;
            badge = `Đang tập · HLV ${activePlan.trainer.fullName}`;
            explanation = `Ngựa đang do HLV ${activePlan.trainer.fullName} phụ trách (${activePlan.planCode ?? ''}). Bạn không thể can thiệp hoặc tạo đè giáo án.`;
          }
        } else if (draftPlan) {
          if (draftPlan.trainerUserId === user.userId) {
            planState = 'DRAFT_SELF';
            canAssign = true;
            badge = `Bản nháp của bạn (${draftPlan.planCode ?? ''})`;
            explanation = `Bạn đang có bản nháp ${draftPlan.planCode ?? ''} cho ngựa này. Có thể mở bản nháp để tiếp tục hoàn thiện hoặc tạo thêm.`;
          } else {
            planState = 'DRAFT_OTHER';
            canAssign = false;
            badge = `Bản nháp · HLV ${draftPlan.trainer.fullName}`;
            explanation = `HLV ${draftPlan.trainer.fullName} đang soạn bản nháp cho ngựa này (${draftPlan.planCode ?? ''}).`;
          }
        }

        if (!h.isMedicalLocked && !h.isDebtImpounded && !activePlan && !draftPlan) {
          if (user.role === UserRole.HEAD_TRAINER) {
            if (h.assignedTrainerId && h.assignedTrainerId !== user.userId) {
              planState = 'ACTIVE_OTHER';
              canAssign = false;
              badge = `HLV ${h.assignedTrainer?.fullName || 'khác'} phụ trách`;
              explanation = `Chiến mã đã được Quản lý phân công cho HLV ${h.assignedTrainer?.fullName || 'khác'}.`;
            } else if (h.assignedTrainerId === user.userId) {
              if (
                h.trainerAssignmentStatus === 'PENDING_ACCEPTANCE' ||
                (h.trainerAssignmentStatus as string) === 'PENDING'
              ) {
                planState = 'PENDING_ACCEPTANCE';
                canAssign = false;
                badge = 'Chờ bạn tiếp nhận';
                explanation = 'Chiến mã đang chờ bạn xác nhận tiếp nhận trước khi lập giáo án.';
              } else if (
                h.trainerAssignmentStatus === 'ASSIGNED' ||
                (h.trainerAssignmentStatus as string) === 'ACCEPTED'
              ) {
                planState = 'READY';
                canAssign = true;
                badge = 'Đã phân công cho bạn';
                explanation = 'Chiến mã sẵn sàng để bạn lập giáo án mới.';
              } else {
                planState = 'READY';
                canAssign = true;
                badge = 'Đã phân công cho bạn';
                explanation = 'Chiến mã sẵn sàng để bạn lập giáo án mới.';
              }
            } else if (trainerBarnId) {
              planState = 'READY';
              canAssign = true;
              badge = 'Ngựa mới trong khu · Sẵn sàng';
              explanation =
                'Chiến mã thuộc khu chuồng bạn phụ trách và chưa có HLV, sẵn sàng lập giáo án ngay.';
            } else {
              planState = 'UNASSIGNED_TRAINER';
              canAssign = false;
              badge = 'Chưa phân công HLV';
              explanation = 'Chiến mã chưa được phân công cho bạn.';
            }
          }
        }

        let activeCooldown: {
          remainingHours: number;
          trainerUserId: string;
          trainerName: string;
        } | null = null;
        if (user.role === UserRole.HEAD_TRAINER) {
          const cd = await this.getTrainerHorseCooldown(h.id, user.userId);
          if (cd && cd > effectiveNow()) {
            const remainingHours = Math.ceil(
              (cd.getTime() - effectiveNow().getTime()) / (3600 * 1000),
            );
            activeCooldown = {
              remainingHours,
              trainerUserId: user.userId,
              trainerName: user.fullName || user.email || 'Bạn',
            };
            if (!activePlan && !draftPlan && !h.isMedicalLocked && !h.isDebtImpounded) {
              planState = 'COOLDOWN_SELF';
              canAssign = false;
              badge = `Thời gian chờ (${remainingHours}h)`;
              explanation = `Bạn vừa hủy hoặc để hết hạn bản nháp cho ngựa này. Cần chờ ${remainingHours} giờ hoặc liên hệ Quản lý CLB để mở khóa sớm.`;
            }
          }
        } else if (user.role === UserRole.CLUB_MANAGER) {
          const mgrCd = await this.getLatestHorseCooldownForManager(h.id);
          if (mgrCd) {
            activeCooldown = mgrCd;
            if (!activePlan && !draftPlan && !h.isMedicalLocked && !h.isDebtImpounded) {
              badge = `Đang chờ (${mgrCd.trainerName} · ${mgrCd.remainingHours}h)`;
              explanation = `HLV ${mgrCd.trainerName} đang trong thời gian chờ sau khi hủy/hết hạn bản nháp. Quản lý có thể mở khóa sớm.`;
            }
          }
        }

        const stallInfo = h.stallAllocations[0]?.stall;
        const stallName = stallInfo
          ? `${stallInfo.code} (${stallInfo.zoneRef?.name || stallInfo.zone})`
          : null;
        const stallCode = stallInfo?.code ?? null;
        const zoneName =
          stallInfo?.zoneRef?.name ?? (stallInfo?.zone ? `Barn ${stallInfo.zone}` : null);

        let unplannedCategory: 'NEW_ADMISSION' | 'RESTING_CYCLE' | 'MEDICAL_LOCKED' | null = null;
        let isSlaExempt = false;

        if (!activePlan && !draftPlan) {
          if (h.isMedicalLocked || planState === 'MEDICAL_LOCKED') {
            unplannedCategory = 'MEDICAL_LOCKED';
            isSlaExempt = true;
          } else if (lastCompletedPlan || lastCancelledPlan || h.status === HorseStatus.RESTING) {
            unplannedCategory = 'RESTING_CYCLE';
            isSlaExempt = true;
            if (lastCompletedPlan) {
              badge = 'Nghỉ ngơi hồi phục (Không tính SLA)';
              explanation = `Chiến mã đã hoàn thành giáo án ${lastCompletedPlan.planCode}, đang trong chu kỳ nghỉ ngơi phục hồi thể lực.`;
            } else if (lastCancelledPlan) {
              badge = 'Nghỉ ngơi hồi phục (Không tính SLA)';
              explanation = `Giáo án ${lastCancelledPlan.planCode} đã hủy, chiến mã đang nghỉ ngơi và sẵn sàng cho giáo án mới.`;
            } else {
              badge = 'Nghỉ ngơi hồi phục (Không tính SLA)';
              explanation =
                'Chiến mã đang trong chu kỳ nghỉ ngơi phục hồi thể lực, sẵn sàng cho giáo án mới.';
            }
          } else {
            unplannedCategory = 'NEW_ADMISSION';
            isSlaExempt = false;
          }
        }

        return {
          id: h.id,
          name: h.name,
          horseCode: h.horseCode,
          breed: h.breed,
          dob: h.dob,
          gender: h.gender,
          color: h.color,
          status: h.status,
          isMedicalLocked: h.isMedicalLocked,
          isDebtImpounded: Boolean(h.isDebtImpounded),
          avatarUrl: h.avatarUrl,
          ownerName: h.owner?.fullName ?? null,
          stallName,
          stallCode,
          zoneName,
          planState,
          canAssign,
          badge,
          explanation,
          assignedTrainer: h.assignedTrainer ?? null,
          trainerAssignmentStatus: h.trainerAssignmentStatus,
          planDeadlineAt: h.handoverRequests[0]?.planDeadlineAt ?? null,
          activePlan: activePlanInfo,
          activeCooldown,
          existingPlanId: activePlan?.id || draftPlan?.id || null,
          lastCompletedPlan,
          unplannedCategory,
          isSlaExempt,
        };
      }),
    );

    // Bậc thang 6 cấp độ ưu tiên sẵn sàng thi đấu
    const rankOf = (h: {
      status?: string;
      isMedicalLocked?: boolean;
      isDebtImpounded?: boolean;
      planState?: string;
    }) => {
      if (h.isDebtImpounded || h.status === 'RETIRED') return 6;
      if (
        h.isMedicalLocked ||
        h.status === 'INJURED' ||
        h.status === 'ISOLATED' ||
        h.planState === 'MEDICAL_LOCKED'
      )
        return 5;
      if (h.status === 'UNDER_OBSERVATION') return 4;
      if (h.status === 'ACTIVE') return 1;
      if (
        h.status === 'IN_TRAINING' ||
        h.planState === 'ACTIVE_SELF' ||
        h.planState === 'ACTIVE_OTHER'
      )
        return 2;
      if (h.status === 'RESTING' || h.planState === 'READY') return 3;
      return 3;
    };
    items.sort((a, b) => rankOf(a) - rankOf(b) || a.name.localeCompare(b.name, 'vi'));

    const summary = {
      total: items.length,
      readyCount: items.filter((x) => x.planState === 'READY').length,
      unplannedCount: items.filter((x) => x.unplannedCategory !== null).length,
      unplannedNewAdmissionCount: items.filter((x) => x.unplannedCategory === 'NEW_ADMISSION')
        .length,
      unplannedRestingCount: items.filter((x) => x.unplannedCategory === 'RESTING_CYCLE').length,
      myActiveCount: items.filter((x) => x.planState === 'ACTIVE_SELF').length,
      myDraftCount: items.filter((x) => x.planState === 'DRAFT_SELF').length,
      otherTrainerCount: items.filter(
        (x) => x.planState === 'ACTIVE_OTHER' || x.planState === 'DRAFT_OTHER',
      ).length,
      medicalLockedCount: items.filter((x) => x.planState === 'MEDICAL_LOCKED').length,
      cooldownCount: items.filter((x) => x.planState === 'COOLDOWN_SELF').length,
    };

    return { items, summary };
  }
}
