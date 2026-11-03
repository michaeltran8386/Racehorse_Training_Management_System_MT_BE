import { PlanStatus, WorkoutStatus } from '@prisma/client';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { UserRole } from '../common/enums/role.enum';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingPlansService } from './training-plans.service';
import { WorkoutsService } from './workouts.service';

const actor = { userId: 'trainer', role: UserRole.HEAD_TRAINER } as CurrentUserPayload;
const prismaWith = (tx: object) =>
  ({ $transaction: (run: (arg: object) => unknown) => run(tx) }) as unknown as PrismaService;

describe('approved training rules', () => {
  it('blocks completion while sessions still need results', async () => {
    const update = jest.fn();
    const findMany = jest
      .fn()
      .mockResolvedValue([{ scheduledDate: new Date('2026-11-03T04:00Z') }]);
    const service = new TrainingPlansService(
      prismaWith({
        $queryRaw: jest.fn(),
        trainingPlan: {
          findUnique: jest.fn().mockResolvedValue({
            horseId: 'horse',
            trainerUserId: 'trainer',
            status: PlanStatus.ACTIVE,
          }),
          update,
        },
        horse: { findUnique: jest.fn() },
        workoutSession: { findMany },
      }),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.changePlanStatus(
        'plan',
        { status: PlanStatus.COMPLETED, summary: 'Hoàn thành giáo án' },
        actor,
      ),
    ).rejects.toMatchObject({ response: { code: 'PLAN_WORKOUT_RESULTS_REQUIRED' } });
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks restoring a light session when an active lock exists', async () => {
    const update = jest.fn();
    const service = new WorkoutsService(
      prismaWith({
        $queryRaw: jest.fn(),
        horse: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ isMedicalLocked: false, medicalLocks: [{ id: 'lock' }] }),
        },
        workoutSession: {
          findUnique: jest.fn().mockResolvedValue({
            horseId: 'horse',
            trainingPlan: { trainerUserId: 'trainer' },
            status: WorkoutStatus.BLOCKED,
            intensity: 'LIGHT',
          }),
          update,
        },
      }),
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.restoreWorkout('workout', {}, actor)).rejects.toMatchObject({
      response: { code: 'MEDICAL_LOCK_ACTIVE' },
    });
    expect(update).not.toHaveBeenCalled();
  });
});
