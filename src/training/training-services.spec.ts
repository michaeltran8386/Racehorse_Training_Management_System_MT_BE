import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { HorseStatus, PlanStatus, TrackSurface, WorkoutStatus } from '@prisma/client';
import { TrainingCommonService } from './training-common.service';
import { TrainingPlansService } from './training-plans.service';
import { WorkoutsService } from './workouts.service';
import { TrainingInsightsService } from './training-insights.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CounterService } from '../audit/counter.service';
import { UserRole } from '../common/enums/role.enum';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { CreateWorkoutSessionDto } from './dto/create-workout-session.dto';
import {
  addDays,
  clubDate,
  clubTime,
  isHeavy,
  startOfClubDay,
  validatePhases,
  withinTrainingHours,
  workoutLoad,
} from './training-rules';
import { notificationsMock } from '../notifications/notifications.testing';
import { NotificationsService } from '../notifications/notifications.service';

/** Mã lỗi (code) của lời hứa bị từ chối. */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e: any) {
    return e.getResponse?.().code ?? e.message;
  }
}

describe('TrainingService (Flow 2 & RULE-MED-01)', () => {
  let common: TrainingCommonService;
  let plans: TrainingPlansService;
  let workouts: WorkoutsService;
  let insights: TrainingInsightsService;
  let prisma: any;
  let audit: any;
  let notifications: any;

  const trainer: CurrentUserPayload = {
    userId: 'trainer-1',
    email: 'trainer@gmail.com',
    fullName: 'Head Trainer David',
    role: UserRole.HEAD_TRAINER,
  };
  const owner: CurrentUserPayload = {
    userId: 'owner-1',
    email: 'owner@gmail.com',
    fullName: 'Robert Sterling',
    role: UserRole.HORSE_OWNER,
  };

  const today = startOfClubDay(new Date());
  // 06:30 sáng mai theo giờ câu lạc bộ
  const tomorrow0630 = new Date(addDays(today, 1).getTime() + 6.5 * 60 * 60 * 1000);

  const healthyHorse = {
    id: 'horse-1',
    name: 'Thunder',
    horseCode: 'HR-000001',
    status: HorseStatus.RESTING,
    isMedicalLocked: false,
    deletedAt: null,
  };
  const phase = {
    id: 'ph-1',
    name: 'Base',
    type: 'BASE',
    startDate: clubDate(addDays(today, -1)),
    endDate: clubDate(addDays(today, 30)),
    sessionsPerWeek: 5,
    maxWeeklyDistance: 9000,
    surface: 'TURF',
  };
  const draftPlan = {
    id: 'plan-1',
    phases: [phase],
    horseId: 'horse-1',
    phaseName: 'Base phase',
    status: PlanStatus.DRAFT,
    startDate: addDays(today, -1),
    endDate: addDays(today, 30),
    trainerUserId: 'trainer-1',
  };
  const workoutDto: CreateWorkoutSessionDto = {
    scheduledDate: tomorrow0630.toISOString(),
    phaseId: 'ph-1',
    workoutType: 'CANTER',
    intensity: 'MEDIUM',
    distanceMeters: 1200,
    trackSurface: 'TURF',
    assignedStaffUserId: 'groom-1',
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn((arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
      $queryRaw: jest.fn().mockResolvedValue([]),
      horse: { findUnique: jest.fn(), update: jest.fn() },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'groom-1', role: 'GROOM', status: 'ACTIVE' }),
        findMany: jest.fn(),
      },
      trainingPlan: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn().mockImplementation(({ data }: any) => ({ ...draftPlan, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      workoutSession: {
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'w-new', ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'w-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      medicalLock: { findMany: jest.fn().mockResolvedValue([]) },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrainingCommonService,
        TrainingPlansService,
        WorkoutsService,
        TrainingInsightsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: CounterService, useValue: { next: jest.fn().mockResolvedValue(45) } },
        notificationsMock(),
      ],
    }).compile();
    common = module.get(TrainingCommonService);
    plans = module.get(TrainingPlansService);
    workouts = module.get(WorkoutsService);
    insights = module.get(TrainingInsightsService);
    notifications = module.get(NotificationsService);
  });

  describe('training-rules', () => {
    it('BREEZE and TRIAL are always heavy; LIGHT walk is not', () => {
      expect(isHeavy('BREEZE', 'LIGHT')).toBe(true);
      expect(isHeavy('TRIAL', 'MEDIUM')).toBe(true);
      expect(isHeavy('CANTER', 'HEAVY')).toBe(true);
      expect(isHeavy('WALK', 'LIGHT')).toBe(false);
    });

    it('uses club time (UTC+7) for the 04:00-20:00 window', () => {
      expect(clubTime(new Date('2026-10-15T00:00:00Z'))).toEqual({ hour: 7, minute: 0 });
      expect(withinTrainingHours(new Date('2026-10-14T21:00:00Z'))).toBe(true); // 04:00
      expect(withinTrainingHours(new Date('2026-10-14T20:59:00Z'))).toBe(false); // 03:59
      expect(withinTrainingHours(new Date('2026-10-15T13:00:00Z'))).toBe(true); // 20:00
      expect(withinTrainingHours(new Date('2026-10-15T13:15:00Z'))).toBe(false); // 20:15
      expect(startOfClubDay(new Date('2026-10-15T18:00:00Z')).toISOString()).toBe(
        '2026-10-15T17:00:00.000Z',
      );
    });
  });

  describe('phase rules (SC-2.03)', () => {
    const base = {
      name: 'Base',
      type: 'BASE',
      startDate: '2026-11-01',
      endDate: '2026-11-14',
      sessionsPerWeek: 5,
      maxWeeklyDistance: 9000,
      surface: 'TURF',
    };

    it('sorts phases and rejects overlap, out-of-plan dates and bad quotas', () => {
      const ok = validatePhases(
        [{ ...base, name: 'Speed', startDate: '2026-11-15', endDate: '2026-11-30' }, base],
        '2026-11-01',
        '2026-11-30',
      );
      expect('phases' in ok && ok.phases.map((p) => p.name)).toEqual(['Base', 'Speed']);
      const overlap = validatePhases(
        [base, { ...base, name: 'Speed', startDate: '2026-11-10' }],
        '2026-11-01',
        '2026-11-30',
      );
      expect('code' in overlap && overlap.code).toBe('PHASE_OVERLAP');
      const outside = validatePhases([base], '2026-11-05', '2026-11-30');
      expect('code' in outside && outside.code).toBe('INVALID_PHASE');
      const quota = validatePhases([{ ...base, sessionsPerWeek: 20 }], '2026-11-01', '2026-11-30');
      expect('code' in quota && quota.message).toContain('Số buổi mỗi tuần');
    });

    it('workout load = km × reps × intensity factor', () => {
      expect(workoutLoad({ distanceMeters: 1200, repetitions: 2, intensity: 'HEAVY' })).toBe(7.2);
      expect(
        workoutLoad({
          distanceMeters: 1200,
          repetitions: 2,
          actualDistanceMeters: 2000,
          intensity: 'LIGHT',
        }),
      ).toBe(2);
    });
  });

  describe('createPlan', () => {
    const dto = {
      horseId: 'horse-1',
      phaseName: 'Base phase',
      objective: 'Build the aerobic base before speed work',
      trackSurface: TrackSurface.TURF,
      startDate: clubDate(addDays(today, 1)),
      endDate: clubDate(addDays(today, 30)),
      phases: [{ ...phase, id: undefined, startDate: clubDate(addDays(today, 1)) }],
    };

    it('refuses a horse that another trainer already has a draft or active plan for', async () => {
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      prisma.trainingPlan.findFirst.mockResolvedValue({
        id: 'plan-9',
        planCode: 'GA-000012',
        trainer: { fullName: 'Lê Hoàng Nam' },
      });
      const error = await plans.createPlan(dto, trainer).catch((e) => e);
      expect(error.getResponse().code).toBe('HORSE_HAS_OTHER_TRAINER');
      expect(error.getResponse().data).toMatchObject({
        trainer: 'Lê Hoàng Nam',
        planCode: 'GA-000012',
      });
      expect(prisma.trainingPlan.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            horseId: 'horse-1',
            status: { in: [PlanStatus.DRAFT, PlanStatus.ACTIVE] },
            trainerUserId: { not: 'trainer-1' },
          },
        }),
      );
      expect(prisma.trainingPlan.create).not.toHaveBeenCalled();
    });

    it('gives the plan a GA- code from the counter', async () => {
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      prisma.trainingPlan.create.mockResolvedValue({ ...draftPlan, horse: healthyHorse });
      await plans.createPlan(dto, trainer);
      expect(prisma.trainingPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ planCode: 'GA-000045' }) }),
      );
    });

    it('only accepts a start date from tomorrow and rejects plans longer than 52 weeks', async () => {
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      expect(await codeOf(plans.createPlan({ ...dto, startDate: clubDate(today) }, trainer))).toBe(
        'START_DATE_TOO_EARLY',
      );
      expect(
        await codeOf(plans.createPlan({ ...dto, endDate: clubDate(addDays(today, 400)) }, trainer)),
      ).toBe('PLAN_TOO_LONG');
    });

    it('lets the trainer edit a running plan that started long ago without changing its start date', async () => {
      const oldPlan = {
        ...draftPlan,
        status: PlanStatus.ACTIVE,
        startDate: addDays(today, -20),
        endDate: addDays(today, 30),
        phases: [{ ...phase, startDate: clubDate(addDays(today, -20)) }],
      };
      prisma.trainingPlan.findUnique.mockResolvedValue(oldPlan);
      prisma.trainingPlan.update.mockResolvedValue(oldPlan);
      await expect(
        plans.updatePlan('plan-1', { notes: 'Updated note only' }, trainer),
      ).resolves.toBeDefined();
      expect(
        await codeOf(plans.updatePlan('plan-1', { startDate: clubDate(today) }, trainer)),
      ).toBe('START_DATE_TOO_EARLY');
    });

    it('rejects plans shorter than 1 week (7 days)', async () => {
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      expect(
        await codeOf(plans.createPlan({ ...dto, endDate: clubDate(addDays(today, 5)) }, trainer)),
      ).toBe('PLAN_TOO_SHORT');
    });

    it('always creates a DRAFT and does not touch the horse status', async () => {
      prisma.horse.findUnique.mockResolvedValue({ ...healthyHorse, isMedicalLocked: false });
      prisma.trainingPlan.create.mockResolvedValue({ ...draftPlan, horse: healthyHorse });

      await plans.createPlan(dto, trainer);

      expect(prisma.trainingPlan.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: PlanStatus.DRAFT }) }),
      );
      expect(prisma.horse.update).not.toHaveBeenCalled();
    });

    it('rejects plan creation when the horse is under medical lock', async () => {
      prisma.horse.findUnique.mockResolvedValue({ ...healthyHorse, isMedicalLocked: true });
      expect(await codeOf(plans.createPlan(dto, trainer))).toBe('HORSE_MEDICAL_LOCKED');
    });

    it('rejects a retired horse and a plan without phases', async () => {
      prisma.horse.findUnique.mockResolvedValue({ ...healthyHorse, status: HorseStatus.RETIRED });
      expect(await codeOf(plans.createPlan(dto, trainer))).toBe('HORSE_RETIRED');

      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      expect(await codeOf(plans.createPlan({ ...dto, phases: [] }, trainer))).toBe(
        'PHASES_REQUIRED',
      );
    });

    it('rejects start date after end date', async () => {
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      const error = await plans
        .createPlan({ ...dto, startDate: clubDate(addDays(today, 40)) }, trainer)
        .catch((e) => e);
      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(error.getResponse().code).toBe('INVALID_DATE_RANGE');
    });
  });

  describe('changePlanStatus - activate (DL-2.02)', () => {
    beforeEach(() => {
      prisma.trainingPlan.findUnique.mockResolvedValue(draftPlan);
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      prisma.workoutSession.count.mockResolvedValue(2);
    });

    it('blocks activation while the horse is under a training lock', async () => {
      prisma.horse.findUnique.mockResolvedValue({ ...healthyHorse, isMedicalLocked: true });
      expect(await codeOf(plans.changePlanStatus('plan-1', { status: 'ACTIVE' }, trainer))).toBe(
        'MEDICAL_LOCK_ACTIVE',
      );
      expect(prisma.trainingPlan.update).not.toHaveBeenCalled();
    });

    it('needs at least one workout', async () => {
      prisma.workoutSession.count.mockResolvedValue(0);
      expect(await codeOf(plans.changePlanStatus('plan-1', { status: 'ACTIVE' }, trainer))).toBe(
        'PLAN_HAS_NO_WORKOUTS',
      );
    });

    it('allows only one active plan per horse', async () => {
      prisma.trainingPlan.findFirst.mockResolvedValue({ id: 'plan-2', phaseName: 'Other' });
      expect(await codeOf(plans.changePlanStatus('plan-1', { status: 'ACTIVE' }, trainer))).toBe(
        'HORSE_HAS_ACTIVE_PLAN',
      );
    });

    it('asks for VET confirmation when the horse is in a medical status', async () => {
      prisma.horse.findUnique.mockResolvedValue({ ...healthyHorse, status: HorseStatus.INJURED });
      expect(await codeOf(plans.changePlanStatus('plan-1', { status: 'ACTIVE' }, trainer))).toBe(
        'VET_CONFIRMATION_REQUIRED',
      );
      expect(
        await codeOf(
          plans.changePlanStatus('plan-1', { status: 'ACTIVE', vetConsulted: true }, trainer),
        ),
      ).toBe('OK');
    });

    it('activates and optionally moves a resting horse to IN_TRAINING', async () => {
      await plans.changePlanStatus(
        'plan-1',
        { status: 'ACTIVE', moveHorseToTraining: true },
        trainer,
      );
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2); // khóa dòng giáo án + ngựa
      expect(prisma.trainingPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ACTIVE' } }),
      );
      expect(prisma.horse.update).toHaveBeenCalledWith({
        where: { id: 'horse-1' },
        data: { status: HorseStatus.IN_TRAINING },
      });
    });

    it('tells each groom about their workouts only when the plan is activated', async () => {
      prisma.workoutSession.findMany.mockResolvedValueOnce([
        { assignedStaffUserId: 'groom-1', scheduledDate: tomorrow0630 },
        { assignedStaffUserId: 'groom-1', scheduledDate: addDays(tomorrow0630, 2) },
        { assignedStaffUserId: 'groom-2', scheduledDate: addDays(tomorrow0630, 1) },
      ]);
      await plans.changePlanStatus('plan-1', { status: 'ACTIVE' }, trainer);
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        ['groom-1'],
        expect.objectContaining({
          type: 'WORKOUT_ASSIGNED',
          params: expect.objectContaining({ count: 2, date: clubDate(tomorrow0630) }),
        }),
        'trainer-1',
      );
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        ['groom-2'],
        expect.objectContaining({ params: expect.objectContaining({ count: 1 }) }),
        'trainer-1',
      );
    });
  });

  describe('changePlanStatus - cancel / complete', () => {
    it('cancel needs a reason and cancels pending workouts', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue({ ...draftPlan, status: PlanStatus.ACTIVE });
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      expect(await codeOf(plans.changePlanStatus('plan-1', { status: 'CANCELLED' }, trainer))).toBe(
        'REASON_REQUIRED',
      );

      prisma.workoutSession.updateMany.mockResolvedValue({ count: 3 });
      const res = await plans.changePlanStatus(
        'plan-1',
        { status: 'CANCELLED', reason: 'Ngựa chuyển sang giáo án khác' },
        trainer,
      );
      expect(res.cancelledWorkouts).toBe(3);
      expect(prisma.workoutSession.updateMany).toHaveBeenCalledWith({
        where: {
          trainingPlanId: 'plan-1',
          status: { in: [WorkoutStatus.SCHEDULED, WorkoutStatus.BLOCKED, WorkoutStatus.MISSED] },
        },
        data: { status: WorkoutStatus.CANCELLED, statusReason: 'Giáo án đã kết thúc' },
      });
    });

    it('only an ACTIVE plan can be completed', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(draftPlan);
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      expect(
        await codeOf(
          plans.changePlanStatus(
            'plan-1',
            { status: 'COMPLETED', summary: 'Hoàn thành tốt mục tiêu' },
            trainer,
          ),
        ),
      ).toBe('INVALID_PLAN_TRANSITION');
    });
  });

  describe('createWorkout (DL-2.01, RULE-MED-01)', () => {
    beforeEach(() => {
      prisma.trainingPlan.findUnique.mockResolvedValue(draftPlan);
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
    });

    it('rejects a session longer than 10 000 m in total and a jockey name with digits', async () => {
      expect(
        await codeOf(
          workouts.createWorkout(
            'plan-1',
            { ...workoutDto, distanceMeters: 2000, repetitions: 6 },
            trainer,
          ),
        ),
      ).toBe('SESSION_DISTANCE_TOO_LONG');
      expect(
        await codeOf(
          workouts.createWorkout(
            'plan-1',
            { ...workoutDto, workoutType: 'BREEZE', targetSpeedKmh: 55, jockeyName: '12345' },
            trainer,
          ),
        ),
      ).toBe('INVALID_JOCKEY_NAME');
    });

    it('blocks a heavy workout while locked, but allows a light walk', async () => {
      prisma.horse.findUnique.mockResolvedValue({ ...healthyHorse, isMedicalLocked: true });
      expect(
        await codeOf(
          workouts.createWorkout(
            'plan-1',
            { ...workoutDto, workoutType: 'BREEZE', targetSpeedKmh: 55, jockeyName: 'An' },
            trainer,
          ),
        ),
      ).toBe('MEDICAL_LOCK_ACTIVE');

      prisma.horse.findUnique.mockResolvedValue({ ...healthyHorse, isDebtImpounded: true });
      expect(
        await codeOf(
          workouts.createWorkout(
            'plan-1',
            { ...workoutDto, workoutType: 'BREEZE', targetSpeedKmh: 55, jockeyName: 'An' },
            trainer,
          ),
        ),
      ).toBe('DEBT_IMPOUNDED');

      const ok = await workouts.createWorkout(
        'plan-1',
        { ...workoutDto, workoutType: 'WALK', intensity: 'LIGHT' },
        trainer,
      );
      expect(ok.status).toBe(WorkoutStatus.SCHEDULED);
      expect(prisma.$queryRaw).toHaveBeenCalled(); // khóa dòng ngựa trước khi kiểm
    });

    it('forces BREEZE / TRIAL to HEAVY and needs speed + jockey', async () => {
      expect(
        await codeOf(
          workouts.createWorkout('plan-1', { ...workoutDto, workoutType: 'TRIAL' }, trainer),
        ),
      ).toBe('TARGET_SPEED_REQUIRED');

      const w = await workouts.createWorkout(
        'plan-1',
        {
          ...workoutDto,
          workoutType: 'BREEZE',
          intensity: 'LIGHT',
          targetSpeedKmh: 55,
          jockeyName: 'An',
        },
        trainer,
      );
      expect(w.intensity).toBe('HEAVY');
    });

    it('rejects times outside 04:00-20:00 and past dates', async () => {
      const night = new Date(addDays(today, 1).getTime() + 22 * 60 * 60 * 1000).toISOString();
      expect(
        await codeOf(
          workouts.createWorkout('plan-1', { ...workoutDto, scheduledDate: night }, trainer),
        ),
      ).toBe('OUTSIDE_TRAINING_HOURS');

      const past = new Date(addDays(today, -1).getTime() + 7 * 60 * 60 * 1000).toISOString();
      expect(
        await codeOf(
          workouts.createWorkout('plan-1', { ...workoutDto, scheduledDate: past }, trainer),
        ),
      ).toBe('DATE_IN_PAST');
    });

    it('allows at most 3 workouts per horse per day', async () => {
      prisma.workoutSession.count.mockResolvedValue(3);
      expect(await codeOf(workouts.createWorkout('plan-1', workoutDto, trainer))).toBe(
        'MAX_WORKOUTS_PER_DAY',
      );
    });

    it('rejects a trial on the same surface within 15 minutes', async () => {
      prisma.workoutSession.findFirst.mockImplementation(async (args: any) => {
        if (args?.where?.workoutType === 'TRIAL') {
          return {
            id: 'w-x',
            scheduledDate: new Date('2026-11-07T03:00:00.000Z'), // 10:00 giờ CLB
            horse: { name: 'Bolt' },
            trainingPlan: { trainer: { fullName: 'Lê Hoàng Nam' } },
          };
        }
        return null;
      });
      const error = await workouts
        .createWorkout(
          'plan-1',
          { ...workoutDto, workoutType: 'TRIAL', targetSpeedKmh: 60, jockeyName: 'An' },
          trainer,
        )
        .catch((e) => e);
      expect(error.getResponse().code).toBe('TRIAL_SLOT_TAKEN');
      // Nói rõ buổi kia lúc mấy giờ, của HLV nào và khung giờ còn chọn được (cách ≥ 15 phút).
      expect(error.getResponse().data).toMatchObject({
        horse: 'Bolt',
        time: '10:00',
        trainer: 'Lê Hoàng Nam',
        before: '09:45',
        after: '10:15',
      });
      expect(error.getResponse().message).toContain('Mặt sân Cỏ');
    });

    it('needs VET confirmation for a heavy workout when the horse is in a medical status', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        ...healthyHorse,
        status: HorseStatus.UNDER_OBSERVATION,
      });
      const heavy = { ...workoutDto, intensity: 'HEAVY' };
      expect(await codeOf(workouts.createWorkout('plan-1', heavy, trainer))).toBe(
        'VET_CONFIRMATION_REQUIRED',
      );
      const w = await workouts.createWorkout('plan-1', { ...heavy, vetConsulted: true }, trainer);
      expect(w.medicalOverride).toBe(true);
    });

    it('rejects a closed plan and a non-groom assignee', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue({
        ...draftPlan,
        status: PlanStatus.COMPLETED,
      });
      expect(await codeOf(workouts.createWorkout('plan-1', workoutDto, trainer))).toBe(
        'PLAN_CLOSED',
      );

      prisma.trainingPlan.findUnique.mockResolvedValue(draftPlan);
      prisma.user.findUnique.mockResolvedValue({ id: 'x', role: 'VETERINARIAN', status: 'ACTIVE' });
      expect(await codeOf(workouts.createWorkout('plan-1', workoutDto, trainer))).toBe(
        'INVALID_GROOM',
      );
    });

    it('rejects workout creation when horse is in ISOLATED status (STT 14)', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(draftPlan);
      prisma.horse.findUnique.mockResolvedValue({ ...healthyHorse, status: HorseStatus.ISOLATED });
      expect(await codeOf(workouts.createWorkout('plan-1', workoutDto, trainer))).toBe(
        'HORSE_ISOLATED',
      );
    });
  });

  describe('phases, warnings and weekly repeat (DL-2.01)', () => {
    beforeEach(() => {
      prisma.trainingPlan.findUnique.mockResolvedValue(draftPlan);
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
    });

    it('requires a phase and a date inside it', async () => {
      expect(
        await codeOf(workouts.createWorkout('plan-1', { ...workoutDto, phaseId: 'nope' }, trainer)),
      ).toBe('PHASE_REQUIRED');
      prisma.trainingPlan.findUnique.mockResolvedValue({
        ...draftPlan,
        phases: [{ ...phase, endDate: clubDate(today) }],
      });
      expect(await codeOf(workouts.createWorkout('plan-1', workoutDto, trainer))).toBe(
        'OUTSIDE_PHASE_DATES',
      );
    });

    it('asks to confirm warnings (weekly quota exceeded), then saves on the second click', async () => {
      prisma.workoutSession.findMany.mockResolvedValue([{ distanceMeters: 8500, repetitions: 1 }]);
      const error = await workouts.createWorkout('plan-1', workoutDto, trainer).catch((e) => e);
      expect(error.getResponse().code).toBe('WARNINGS_NEED_CONFIRMATION');
      expect(error.getResponse().data.warnings[0]).toContain('vượt định mức 9000 m');
      expect(prisma.workoutSession.create).not.toHaveBeenCalled();

      await workouts.createWorkout('plan-1', { ...workoutDto, acknowledgeWarnings: true }, trainer);
      expect(prisma.workoutSession.create).toHaveBeenCalled();
    });

    it('blocks when the groom already has a workout within 30 minutes', async () => {
      prisma.workoutSession.findFirst.mockImplementation(async (args: any) => {
        if (args?.where?.assignedStaffUserId) {
          return {
            id: 'w-other',
            scheduledDate: new Date('2026-11-07T08:30:00.000Z'),
            horse: { name: 'Red Velvet' },
            trainingPlan: { trainer: { fullName: 'Lê Hoàng Nam' } },
          };
        }
        return null;
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'groom-1',
        fullName: 'John',
        role: 'GROOM',
        status: 'ACTIVE',
      });
      const error = await workouts
        .createWorkout('plan-1', { ...workoutDto, acknowledgeWarnings: true }, trainer)
        .catch((e) => e);
      expect(error.getResponse().code).toBe('GROOM_TIME_CONFLICT');
      // 08:30 UTC = 15:30 giờ CLB; 2 buổi của 1 groom phải cách nhau ≥ 30 phút.
      expect(error.getResponse().data).toMatchObject({
        groom: 'John',
        horse: 'Red Velvet',
        time: '15:30',
        date: '07/11/2026',
        trainer: 'Lê Hoàng Nam',
        before: '15:00',
        after: '16:00',
      });
      expect(error.getResponse().message).toContain('(HLV Lê Hoàng Nam)');
      expect(prisma.workoutSession.create).not.toHaveBeenCalled();
    });

    it('tells which workout, trainer and free window when the horse already trains at that time', async () => {
      prisma.workoutSession.findFirst.mockImplementation(async (args: any) => {
        if (args?.where?.horseId && args?.where?.scheduledDate?.gte) {
          return {
            id: 'w-same-horse',
            scheduledDate: new Date('2026-11-07T00:30:00.000Z'), // 07:30 giờ CLB
            trainingPlan: { trainer: { fullName: 'Nguyễn Văn Tuấn' } },
          };
        }
        return null;
      });
      const error = await workouts.createWorkout('plan-1', workoutDto, trainer).catch((e) => e);
      expect(error.getResponse().code).toBe('HORSE_WORKOUT_TIME_CONFLICT');
      expect(error.getResponse().data).toMatchObject({
        time: '07:30',
        trainer: 'Nguyễn Văn Tuấn',
        before: '07:00',
        after: '08:00',
      });
    });

    it('does not notify the groom while the plan is still a draft, but does once it is active', async () => {
      await workouts.createWorkout('plan-1', workoutDto, trainer);
      expect(notifications.notifyUsers).not.toHaveBeenCalled();

      prisma.trainingPlan.findUnique.mockResolvedValue({ ...draftPlan, status: PlanStatus.ACTIVE });
      await workouts.createWorkout('plan-1', workoutDto, trainer);
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        ['groom-1'],
        expect.objectContaining({ type: 'WORKOUT_ASSIGNED' }),
        'trainer-1',
      );
    });

    it('weekly repeat creates the matching days and reports skipped ones', async () => {
      // Ngày đầu đã có 3 buổi -> bị bỏ qua, các ngày còn lại tạo được
      prisma.workoutSession.count.mockResolvedValueOnce(3).mockResolvedValue(0);
      const res = await workouts.createRepeatWorkouts(
        'plan-1',
        { ...workoutDto, weekdays: [1, 2, 3, 4, 5, 6, 7], until: clubDate(addDays(today, 3)) },
        trainer,
      );
      expect(res.created).toBe(2);
      expect(res.skipped).toEqual([
        { date: clubDate(addDays(today, 1)), reason: 'Mỗi ngựa tối đa 3 buổi tập mỗi ngày.' },
      ]);
    });

    it('weekly repeat refuses more than 60 workouts', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue({
        ...draftPlan,
        endDate: addDays(today, 200),
        phases: [{ ...phase, endDate: clubDate(addDays(today, 200)) }],
      });
      expect(
        await codeOf(
          workouts.createRepeatWorkouts(
            'plan-1',
            {
              ...workoutDto,
              weekdays: [1, 2, 3, 4, 5, 6, 7],
              until: clubDate(addDays(today, 100)),
            },
            trainer,
          ),
        ),
      ).toBe('TOO_MANY_REPEATS');
    });

    it('warns when the assigned groom has no shift roster on the workout date (STT 34)', async () => {
      prisma.trainingPlan.findUnique.mockResolvedValue(draftPlan);
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      prisma.workoutSession.findMany.mockResolvedValue([]);
      (prisma as any).shiftRoster = {
        findMany: jest.fn().mockResolvedValue([]),
      };

      const error = await workouts.createWorkout('plan-1', workoutDto, trainer).catch((e) => e);
      expect(error.getResponse().code).toBe('WARNINGS_NEED_CONFIRMATION');
      expect(error.getResponse().data.warnings[0]).toContain('không có ca trực trong ngày');
    });
  });

  describe('findGrooms (STT 34)', () => {
    it('returns all active grooms and prioritizes assigned groom and shifts when horseId and date are provided', async () => {
      const g1 = { id: 'groom-1', fullName: 'Alice', email: 'alice@club.vn' };
      const g2 = { id: 'groom-2', fullName: 'Bob', email: 'bob@club.vn' };
      prisma.user.findMany.mockResolvedValue([g1, g2]);
      (prisma as any).stallAllocation = {
        findFirst: jest.fn().mockResolvedValue({ assignedGroomUserId: 'groom-2' }),
      };
      (prisma as any).shiftRoster = {
        findMany: jest.fn().mockResolvedValue([{ groomUserId: 'groom-1' }]),
      };

      const result = await workouts.findGrooms('horse-1', '2026-11-15');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('groom-2');
      expect(result[0].isAssignedToHorse).toBe(true);
      expect(result[1].id).toBe('groom-1');
      expect(result[1].hasShift).toBe(true);
    });
  });

  describe('restoreWorkout (DL-2.07)', () => {
    it('cannot restore a heavy workout while the lock is still on', async () => {
      prisma.workoutSession.findUnique.mockResolvedValue({
        id: 'w-1',
        horseId: 'horse-1',
        status: WorkoutStatus.BLOCKED,
        scheduledDate: tomorrow0630,
        workoutType: 'BREEZE',
        intensity: 'HEAVY',
        trackSurface: 'TURF',
        targetSpeedKmh: 55,
        jockeyName: 'An',
        assignedStaffUserId: 'groom-1',
        medicalOverride: false,
        phaseId: 'ph-1',
        distanceMeters: 1000,
        repetitions: 1,
        trainingPlan: { ...draftPlan, status: PlanStatus.ACTIVE },
      });
      prisma.horse.findUnique.mockResolvedValue({ ...healthyHorse, isMedicalLocked: true });
      expect(await codeOf(workouts.restoreWorkout('w-1', {}, trainer))).toBe('MEDICAL_LOCK_ACTIVE');

      prisma.horse.findUnique.mockResolvedValue({ ...healthyHorse, medicalLocks: [] });
      const restored = await workouts.restoreWorkout('w-1', {}, trainer);
      expect(restored.status).toBe(WorkoutStatus.SCHEDULED);
    });
  });

  describe('recordResult (SC-2.06)', () => {
    // Không phụ thuộc .env trên máy: mặc định cờ dev tắt, test nào cần thì tự bật.
    const savedEnv = { ...process.env };
    beforeEach(() => {
      process.env.SIMULATOR_ALLOW_EARLY = 'false';
    });
    afterEach(() => {
      process.env = { ...savedEnv };
    });
    const result = {
      actualDistanceMeters: 1200,
      actualTimeSeconds: 80,
      performanceScore: 8,
      completionLevel: 'ACHIEVED',
      trainerNotes: 'Strong finish, relaxed in the turn.',
    };
    const started = {
      id: 'w-1',
      status: WorkoutStatus.SCHEDULED,
      workoutType: 'CANTER',
      trackSurface: 'TURF',
      scheduledDate: new Date(Date.now() - 60 * 60 * 1000),
      resultRecordedAt: null,
      abnormalSigns: false,
      trainingPlan: { ...draftPlan, status: PlanStatus.ACTIVE },
    };

    it('rejects an unrealistic average speed and a top speed below the average', async () => {
      prisma.workoutSession.findUnique.mockResolvedValue(started);
      expect(
        await codeOf(
          workouts.recordResult(
            'w-1',
            { ...result, actualDistanceMeters: 10000, actualTimeSeconds: 5 },
            trainer,
          ),
        ),
      ).toBe('IMPLAUSIBLE_SPEED');
      // 1200 m / 80 s = 54 km/h trung bình
      expect(
        await codeOf(workouts.recordResult('w-1', { ...result, topSpeedKmh: 40 }, trainer)),
      ).toBe('TOP_SPEED_BELOW_AVERAGE');
    });

    it('only after the workout has started', async () => {
      prisma.workoutSession.findUnique.mockResolvedValue({
        ...started,
        scheduledDate: tomorrow0630,
      });
      expect(await codeOf(workouts.recordResult('w-1', result, trainer))).toBe(
        'WORKOUT_NOT_STARTED',
      );
    });

    it('records before start time when SIMULATOR_ALLOW_EARLY=true outside production', async () => {
      process.env.SIMULATOR_ALLOW_EARLY = 'true';
      process.env.NODE_ENV = 'development';
      prisma.workoutSession.findUnique.mockResolvedValue({
        ...started,
        scheduledDate: tomorrow0630,
      });
      await workouts.recordResult('w-1', result, trainer);
      expect(prisma.workoutSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WorkoutStatus.COMPLETED }),
        }),
      );
    });

    it('computes average speed and records who saved the result', async () => {
      prisma.workoutSession.findUnique.mockResolvedValue(started);
      await workouts.recordResult('w-1', result, trainer);
      expect(prisma.workoutSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WorkoutStatus.COMPLETED,
            averageSpeedKmh: 54, // 1200 m / 80 s × 3.6
            resultNotes: 'Strong finish, relaxed in the turn.',
            resultRecordedById: 'trainer-1',
            resultRecordedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('needs a running time except for walk / swim / treadmill', async () => {
      prisma.workoutSession.findUnique.mockResolvedValue(started);
      const noTime = { ...result, actualTimeSeconds: undefined };
      expect(await codeOf(workouts.recordResult('w-1', noTime, trainer))).toBe('TIME_REQUIRED');
      prisma.workoutSession.findUnique.mockResolvedValue({ ...started, workoutType: 'WALK' });
      expect(await codeOf(workouts.recordResult('w-1', noTime, trainer))).toBe('OK');
    });

    it('recovery heart rate cannot exceed peak heart rate', async () => {
      prisma.workoutSession.findUnique.mockResolvedValue(started);
      expect(
        await codeOf(
          workouts.recordResult(
            'w-1',
            { ...result, heartRatePeak: 150, heartRateRecovery: 160 },
            trainer,
          ),
        ),
      ).toBe('RECOVERY_ABOVE_PEAK');
    });

    it('abnormal signs need a description and become a VET alert', async () => {
      prisma.workoutSession.findUnique.mockResolvedValue(started);
      expect(
        await codeOf(
          workouts.recordResult('w-1', { ...result, abnormalSignTypes: ['LAMENESS'] }, trainer),
        ),
      ).toBe('ABNORMAL_NOTES_REQUIRED');
      await workouts.recordResult(
        'w-1',
        {
          ...result,
          abnormalSignTypes: ['LAMENESS'],
          abnormalNotes: 'Đi khập khiễng chân trước trái',
        },
        trainer,
      );
      expect(prisma.workoutSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ abnormalSigns: true, abnormalSignTypes: ['LAMENESS'] }),
        }),
      );
    });

    it('editing within 48 hours stores who edited; after 48 hours it is refused', async () => {
      prisma.workoutSession.findUnique.mockResolvedValue({
        ...started,
        status: WorkoutStatus.COMPLETED,
        resultRecordedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
      await workouts.recordResult('w-1', result, trainer);
      expect(prisma.workoutSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ resultUpdatedById: 'trainer-1' }),
        }),
      );
      prisma.workoutSession.findUnique.mockResolvedValue({
        ...started,
        status: WorkoutStatus.COMPLETED,
        resultRecordedAt: new Date(Date.now() - 50 * 60 * 60 * 1000),
      });
      expect(await codeOf(workouts.recordResult('w-1', result, trainer))).toBe(
        'RESULT_EDIT_EXPIRED',
      );
    });

    it('a MISSED workout can be recorded late within 7 days only', async () => {
      prisma.workoutSession.findUnique.mockResolvedValue({
        ...started,
        status: WorkoutStatus.MISSED,
        scheduledDate: addDays(today, -10),
      });
      expect(await codeOf(workouts.recordResult('w-1', result, trainer))).toBe(
        'LATE_RESULT_EXPIRED',
      );
    });
  });

  describe('scoping and automatic jobs', () => {
    it('scopes plans to owned horses for a HORSE_OWNER', async () => {
      await plans.findAllPlans({}, owner);
      expect(prisma.trainingPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ horse: { deletedAt: null, ownerId: 'owner-1' } }),
        }),
      );
    });

    it('marks scheduled workouts of non-draft plans as MISSED once their day has ended', async () => {
      await common.sweepOverdue();
      // Buổi của giáo án Nháp chưa phải lịch thật nên không bị tính Bỏ lỡ.
      expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: WorkoutStatus.SCHEDULED,
            scheduledDate: { lt: today },
            trainingPlan: { status: { not: PlanStatus.DRAFT } },
          },
        }),
      );
      // Không có buổi nào quá hạn -> không cập nhật, không báo.
      expect(notifications.notifyUsers).not.toHaveBeenCalled();
      expect(notifications.notifyRoles).not.toHaveBeenCalled();
    });

    it('notifies each trainer about their missed workouts and the Club Manager with a summary', async () => {
      const missed = (id: string, trainerId: string, trainerName: string, planId: string) => ({
        id,
        scheduledDate: new Date('2026-11-10T02:00:00.000Z'), // 10/11 09:00 giờ CLB
        horse: { name: 'Bạch Long Mã' },
        trainingPlan: { id: planId, trainer: { id: trainerId, fullName: trainerName } },
      });
      prisma.workoutSession.findMany.mockResolvedValueOnce([
        missed('w-1', 'trainer-1', 'Nguyễn Văn Tuấn', 'plan-1'),
        missed('w-2', 'trainer-1', 'Nguyễn Văn Tuấn', 'plan-1'),
        missed('w-3', 'trainer-2', 'Lê Hoàng Nam', 'plan-9'),
      ]);
      prisma.workoutSession.updateMany.mockResolvedValueOnce({ count: 3 });

      await common.sweepOverdue();

      expect(prisma.workoutSession.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['w-1', 'w-2', 'w-3'] }, status: WorkoutStatus.SCHEDULED },
        data: { status: WorkoutStatus.MISSED },
      });
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        ['trainer-1'],
        expect.objectContaining({
          type: 'WORKOUT_MISSED',
          message:
            '2 workout(s) missed: Bạch Long Mã 10/11 09:00, Bạch Long Mã 10/11 09:00. Record late results by 17/11.',
          link: '/training/plans/plan-1?status=OVERDUE',
          dedupeKey: 'WORKOUT_MISSED:w-1',
        }),
      );
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        ['trainer-2'],
        expect.objectContaining({ type: 'WORKOUT_MISSED', dedupeKey: 'WORKOUT_MISSED:w-3' }),
      );
      expect(notifications.notifyRoles).toHaveBeenCalledWith(
        ['CLUB_MANAGER'],
        expect.objectContaining({
          type: 'WORKOUT_MISSED_SUMMARY',
          message: '3 workout(s) missed by trainer: Nguyễn Văn Tuấn: 2, Lê Hoàng Nam: 1.',
          link: '/training/calendar?status=MISSED&date=2026-11-10',
        }),
      );
    });

    it('does not notify again when another sweep already marked the workouts', async () => {
      prisma.workoutSession.findMany.mockResolvedValueOnce([
        {
          id: 'w-1',
          scheduledDate: new Date('2026-11-10T02:00:00.000Z'),
          horse: { name: 'Bạch Long Mã' },
          trainingPlan: { id: 'plan-1', trainer: { id: 'trainer-1', fullName: 'Tuấn' } },
        },
      ]);
      prisma.workoutSession.updateMany.mockResolvedValueOnce({ count: 0 });
      await common.sweepOverdue();
      expect(notifications.notifyUsers).not.toHaveBeenCalled();
      expect(notifications.notifyRoles).not.toHaveBeenCalled();
    });

    it('auto-completing a plan keeps MISSED workouts so they can still be recorded late', async () => {
      prisma.trainingPlan.findMany.mockResolvedValue([{ id: 'plan-1' }]);
      await common.sweepOverdue();
      expect(prisma.workoutSession.updateMany).toHaveBeenCalledWith({
        where: {
          trainingPlanId: 'plan-1',
          status: { in: [WorkoutStatus.SCHEDULED, WorkoutStatus.BLOCKED] },
        },
        data: { status: WorkoutStatus.CANCELLED, statusReason: 'Giáo án đã kết thúc' },
      });
    });

    it('calculates progressOf with total, completed, due, and overdue counts (Task T1: 4/10 = 40%)', async () => {
      prisma.workoutSession.groupBy
        .mockResolvedValueOnce([
          { trainingPlanId: 'plan-1', status: WorkoutStatus.COMPLETED, _count: { _all: 4 } },
          { trainingPlanId: 'plan-1', status: WorkoutStatus.SCHEDULED, _count: { _all: 6 } },
        ])
        .mockResolvedValueOnce([
          { trainingPlanId: 'plan-1', status: WorkoutStatus.COMPLETED, _count: { _all: 4 } },
          { trainingPlanId: 'plan-1', status: WorkoutStatus.SCHEDULED, _count: { _all: 2 } },
        ]);

      const progressMap = await common.progressOf(['plan-1']);
      const planProgress = progressMap.get('plan-1');

      expect(planProgress).toEqual({
        total: 10,
        completed: 4,
        due: 6,
        overdue: 2,
      });
      expect(planProgress!.completed / planProgress!.total).toBe(0.4);
      expect(planProgress!.overdue).toBe(2);
    });

    it('returns no fitness points (instead of made-up data) when nothing is completed', async () => {
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      prisma.workoutSession.findMany.mockResolvedValue([]);
      const res = await insights.getFitnessMetrics('horse-1', trainer);
      expect(res.points).toEqual([]);
      expect(res.summary.bestAvgSpeed).toBeNull();
    });

    it('fitness: speed only for running workouts, load per workout and lock bands', async () => {
      prisma.horse.findUnique.mockResolvedValue(healthyHorse);
      prisma.workoutSession.findMany.mockResolvedValue([
        {
          id: 'w-a',
          scheduledDate: addDays(today, -3),
          workoutType: 'WALK',
          intensity: 'LIGHT',
          distanceMeters: 2000,
          repetitions: 1,
          actualDistanceMeters: 2000,
          averageSpeedKmh: 7,
          performanceScore: 7,
          abnormalSigns: false,
        },
        {
          id: 'w-b',
          scheduledDate: addDays(today, -2),
          workoutType: 'BREEZE',
          intensity: 'HEAVY',
          distanceMeters: 800,
          repetitions: 2,
          actualDistanceMeters: null,
          averageSpeedKmh: 55.2,
          performanceScore: 9,
          abnormalSigns: false,
        },
      ]);
      prisma.medicalLock.findMany.mockResolvedValue([
        { lockedAt: addDays(today, -20), unlockedAt: addDays(today, -15) },
      ]);
      const res = await insights.getFitnessMetrics('horse-1', trainer, 4);
      expect(res.points.map((p: any) => p.avgSpeedKmh)).toEqual([null, 55.2]);
      expect(res.points.map((p: any) => p.load)).toEqual([2, 4.8]); // 2 km × 1; 0.8 km × 2 × 3
      expect(res.summary.bestAvgSpeed?.value).toBe(55.2);
      expect(res.lockPeriods).toHaveLength(1);
    });

    it('overview flags a sudden load increase (> 130% of the 4-week weekly average)', async () => {
      prisma.horse.findMany = jest.fn().mockResolvedValue([healthyHorse]);
      prisma.trainingPlan.findMany.mockResolvedValue([
        {
          id: 'plan-1',
          horseId: 'horse-1',
          planCode: 'GA-000001',
          phaseName: 'Base',
          phases: [phase],
        },
      ]);
      const done = (days: number, km: number) => ({
        horseId: 'horse-1',
        scheduledDate: addDays(new Date(), -days),
        distanceMeters: km * 1000,
        repetitions: 1,
        actualDistanceMeters: null,
        intensity: 'MEDIUM',
        performanceScore: 8,
      });
      // 4 tuần trước: mỗi tuần 2 km × 2 = 4 điểm; 7 ngày gần nhất: 10 km × 2 = 20 điểm
      prisma.workoutSession.findMany
        .mockResolvedValueOnce([]) // lần quét Bỏ lỡ đầu getOverview
        .mockResolvedValueOnce([done(30, 2), done(23, 2), done(16, 2), done(9, 2), done(2, 10)])
        .mockResolvedValueOnce([]);
      const res = await insights.getOverview();
      expect(res.rows[0].load7d).toBe(20);
      expect(res.rows[0].loadSpike).toBe(true);
      expect(res.rows[0].currentPhase?.name).toBe('Base');
      expect(res.kpis.loadSpikeHorses).toBe(1);
    });
  });

  describe('CR-023 Head Trainer ownership scoping and fail-closed security', () => {
    const trainerA: CurrentUserPayload = {
      userId: 'trainer-a',
      email: 'trainer-a@gmail.com',
      fullName: 'Trainer Alice',
      role: UserRole.HEAD_TRAINER,
    };
    const trainerB: CurrentUserPayload = {
      userId: 'trainer-b',
      email: 'trainer-b@gmail.com',
      fullName: 'Trainer Bob',
      role: UserRole.HEAD_TRAINER,
    };
    const clubManager: CurrentUserPayload = {
      userId: 'cm-1',
      email: 'cm@gmail.com',
      fullName: 'Manager Mike',
      role: UserRole.CLUB_MANAGER,
    };
    const vet: CurrentUserPayload = {
      userId: 'vet-1',
      email: 'vet@gmail.com',
      fullName: 'Dr. Sarah',
      role: UserRole.VETERINARIAN,
    };

    const planA = {
      id: 'plan-a',
      horseId: 'horse-1',
      trainerUserId: 'trainer-a',
      phaseName: 'Plan A',
      status: PlanStatus.ACTIVE,
      startDate: addDays(today, -1),
      endDate: addDays(today, 30),
      phases: [phase],
      horse: healthyHorse,
    };
    const planB = {
      id: 'plan-b',
      horseId: 'horse-1',
      trainerUserId: 'trainer-b',
      phaseName: 'Plan B',
      status: PlanStatus.ACTIVE,
      startDate: addDays(today, -1),
      endDate: addDays(today, 30),
      phases: [phase],
      horse: healthyHorse,
    };

    const workoutA = {
      id: 'w-a',
      trainingPlanId: 'plan-a',
      horseId: 'horse-1',
      workoutType: 'TRIAL',
      status: WorkoutStatus.SCHEDULED,
      scheduledDate: tomorrow0630,
      intensity: 'HEAVY',
      trackSurface: 'TURF',
      distanceMeters: 1000,
      repetitions: 1,
      targetSpeedKmh: 55,
      jockeyName: 'An',
      assignedStaffUserId: 'groom-1',
      medicalOverride: false,
      phaseId: 'ph-1',
      trainingPlan: planA,
      horse: healthyHorse,
    };
    const workoutB = {
      id: 'w-b',
      trainingPlanId: 'plan-b',
      horseId: 'horse-1',
      workoutType: 'TRIAL',
      status: WorkoutStatus.SCHEDULED,
      scheduledDate: tomorrow0630,
      intensity: 'HEAVY',
      trackSurface: 'TURF',
      distanceMeters: 1000,
      repetitions: 1,
      targetSpeedKmh: 55,
      jockeyName: 'Bob',
      assignedStaffUserId: 'groom-1',
      medicalOverride: false,
      phaseId: 'ph-1',
      trainingPlan: planB,
      horse: healthyHorse,
    };

    describe('TrainingPlansService scoping', () => {
      it('scopes findAllPlans to current trainer for HEAD_TRAINER', async () => {
        prisma.trainingPlan.findMany.mockResolvedValue([planA]);
        prisma.trainingPlan.count.mockResolvedValue(1);
        await plans.findAllPlans({}, trainerA);
        expect(prisma.trainingPlan.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ trainerUserId: 'trainer-a' }),
          }),
        );
      });

      it('does not scope findAllPlans by trainerUserId for CLUB_MANAGER or VETERINARIAN', async () => {
        prisma.trainingPlan.findMany.mockResolvedValue([planA, planB]);
        prisma.trainingPlan.count.mockResolvedValue(2);
        await plans.findAllPlans({}, clubManager);
        expect(prisma.trainingPlan.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.not.objectContaining({ trainerUserId: expect.anything() }),
          }),
        );

        await plans.findAllPlans({}, vet);
        expect(prisma.trainingPlan.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.not.objectContaining({ trainerUserId: expect.anything() }),
          }),
        );
      });

      it('findPlanById returns 404 PLAN_NOT_FOUND when HEAD_TRAINER accesses another trainer plan', async () => {
        prisma.trainingPlan.findUnique.mockResolvedValue(planB);
        expect(await codeOf(plans.findPlanById('plan-b', trainerA))).toBe('PLAN_NOT_FOUND');
      });

      it('findPlanById succeeds when accessing own plan or as CLUB_MANAGER', async () => {
        prisma.trainingPlan.findUnique.mockResolvedValue(planA);
        const resA = await plans.findPlanById('plan-a', trainerA);
        expect(resA.id).toBe('plan-a');

        prisma.trainingPlan.findUnique.mockResolvedValue(planB);
        const resCM = await plans.findPlanById('plan-b', clubManager);
        expect(resCM.id).toBe('plan-b');
      });

      it('mutating another trainer plan fails closed (403 FORBIDDEN)', async () => {
        prisma.trainingPlan.findUnique.mockResolvedValue(planB);
        expect(await codeOf(plans.updatePlan('plan-b', { phaseName: 'Hacked' }, trainerA))).toBe(
          'FORBIDDEN',
        );

        expect(
          await codeOf(
            plans.changePlanStatus(
              'plan-b',
              { status: PlanStatus.CANCELLED, reason: 'cancel reason 123' },
              trainerA,
            ),
          ),
        ).toBe('FORBIDDEN');

        expect(await codeOf(plans.deletePlan('plan-b', trainerA))).toBe('FORBIDDEN');

        expect(
          await codeOf(plans.clonePlan('plan-b', { targetHorseId: 'horse-1' }, trainerA)),
        ).toBe('FORBIDDEN');
      });
    });

    describe('WorkoutsService scoping & mutations', () => {
      it('scopes findAllWorkouts and findTrialRuns to current trainer for HEAD_TRAINER', async () => {
        prisma.workoutSession.findMany.mockResolvedValue([workoutA]);
        await workouts.findAllWorkouts({}, trainerA);
        expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ trainingPlan: { trainerUserId: 'trainer-a' } }),
          }),
        );

        await workouts.findTrialRuns({}, trainerA);
        expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              workoutType: 'TRIAL',
              trainingPlan: { trainerUserId: 'trainer-a' },
            }),
          }),
        );
      });

      it('shows a groom only workouts of plans that are no longer drafts', async () => {
        const groomUser: CurrentUserPayload = {
          userId: 'groom-1',
          email: 'groom@gmail.com',
          fullName: 'Lê Văn Bình',
          role: UserRole.GROOM,
        };
        await workouts.findAllWorkouts({}, groomUser);
        expect(prisma.workoutSession.findMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              assignedStaffUserId: 'groom-1',
              trainingPlan: { status: { not: PlanStatus.DRAFT } },
            }),
          }),
        );

        prisma.workoutSession.findUnique.mockResolvedValue({
          ...workoutA,
          assignedStaffUserId: 'groom-1',
          performanceScore: null,
          trainingPlan: { status: PlanStatus.DRAFT, trainerUserId: 'trainer-a' },
        });
        expect(await codeOf(workouts.findWorkoutById('w-a', groomUser))).toBe('WORKOUT_NOT_FOUND');
      });

      it('does not scope findAllWorkouts by trainingPlan.trainerUserId for CLUB_MANAGER or VETERINARIAN', async () => {
        prisma.workoutSession.findMany.mockResolvedValue([workoutA, workoutB]);
        await workouts.findAllWorkouts({}, clubManager);
        expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.not.objectContaining({ trainingPlan: expect.anything() }),
          }),
        );

        await workouts.findAllWorkouts({}, vet);
        expect(prisma.workoutSession.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.not.objectContaining({ trainingPlan: expect.anything() }),
          }),
        );
      });

      it('createWorkout rejects another trainer plan with 403 FORBIDDEN and allows own plan', async () => {
        prisma.trainingPlan.findUnique.mockResolvedValue(planB);
        prisma.horse.findUnique.mockResolvedValue(healthyHorse);
        expect(await codeOf(workouts.createWorkout('plan-b', workoutDto, trainerA))).toBe(
          'FORBIDDEN',
        );
        const created = await workouts.createWorkout('plan-b', workoutDto, trainerB);
        expect(created.id).toBe('w-new');
      });

      it('createRepeatWorkouts rejects another trainer plan with 403 FORBIDDEN', async () => {
        prisma.trainingPlan.findUnique.mockResolvedValue(planB);
        expect(
          await codeOf(
            workouts.createRepeatWorkouts(
              'plan-b',
              { ...workoutDto, weekdays: [1], until: clubDate(addDays(today, 2)) },
              trainerA,
            ),
          ),
        ).toBe('FORBIDDEN');
      });

      it('updateWorkout rejects modifying another trainer workout with 403 FORBIDDEN', async () => {
        prisma.workoutSession.findUnique.mockResolvedValue(workoutB);
        expect(await codeOf(workouts.updateWorkout('w-b', {}, trainerA))).toBe('FORBIDDEN');
      });

      it('recordResult rejects recording another trainer workout with 403 FORBIDDEN', async () => {
        prisma.workoutSession.findUnique.mockResolvedValue({
          ...workoutB,
          scheduledDate: new Date(Date.now() - 3600_000),
        });
        expect(
          await codeOf(
            workouts.recordResult(
              'w-b',
              {
                actualDistanceMeters: 1000,
                actualTimeSeconds: 60,
                performanceScore: 8,
                completionLevel: 'ACHIEVED',
                trainerNotes: 'Nice trial run.',
              },
              trainerA,
            ),
          ),
        ).toBe('FORBIDDEN');
      });

      it('cancelWorkout and restoreWorkout reject another trainer workout with 403 FORBIDDEN', async () => {
        prisma.workoutSession.findUnique.mockResolvedValue(workoutB);
        expect(await codeOf(workouts.cancelWorkout('w-b', { reason: 'WEATHER' }, trainerA))).toBe(
          'FORBIDDEN',
        );

        prisma.workoutSession.findUnique.mockResolvedValue({
          ...workoutB,
          status: WorkoutStatus.BLOCKED,
        });
        expect(await codeOf(workouts.restoreWorkout('w-b', {}, trainerA))).toBe('FORBIDDEN');
      });

      it('findWorkoutById returns 404 WORKOUT_NOT_FOUND when HEAD_TRAINER accesses another trainer workout', async () => {
        prisma.workoutSession.findUnique.mockResolvedValue(workoutB);
        expect(await codeOf(workouts.findWorkoutById('w-b', trainerA))).toBe('WORKOUT_NOT_FOUND');
      });

      it('findWorkoutById succeeds for own workout and for CLUB_MANAGER', async () => {
        prisma.workoutSession.findUnique.mockResolvedValue(workoutA);
        const resA = await workouts.findWorkoutById('w-a', trainerA);
        expect(resA.id).toBe('w-a');

        prisma.workoutSession.findUnique.mockResolvedValue(workoutB);
        const resCM = await workouts.findWorkoutById('w-b', clubManager);
        expect(resCM.id).toBe('w-b');
      });
    });
  });
});
