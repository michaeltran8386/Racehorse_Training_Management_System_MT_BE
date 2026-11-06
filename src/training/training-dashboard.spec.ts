import { TrainingInsightsService } from './training-insights.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TrainingCommonService } from './training-common.service';

describe('Trainer actionable overview', () => {
  let db: any;
  let service: TrainingInsightsService;
  const now = new Date('2026-11-05T09:00:00Z');
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    db = {
      horse: { findMany: jest.fn().mockResolvedValue([{ id: 'horse', name: 'Thunder' }]) },
      trainingPlan: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      workoutSession: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new TrainingInsightsService(
      db as PrismaService,
      {} as AuditService,
      {
        sweepOverdue: jest.fn(),
        sumLoad: jest.fn().mockReturnValue(0),
        progressOf: jest.fn().mockResolvedValue(new Map()),
      } as unknown as TrainingCommonService,
    );
  });
  afterEach(() => jest.useRealTimers());
  it('returns safe nulls when no upcoming workout or active plan exists', async () => {
    const result = await service.getOverview();
    expect(result.nextWorkout).toBeNull();
    expect(result.latestPlan).toBeNull();
  });
  it.each(['2026-11-05T10:00:00Z', '2026-11-06T01:00:00Z'])(
    'returns the nearest future workout at %s even on a later day',
    async (scheduledDate) => {
      db.workoutSession.findFirst.mockResolvedValue({
        id: 'workout',
        trainingPlanId: 'plan',
        horseId: 'horse',
        horse: { name: 'Thunder', horseCode: 'HR-001' },
        workoutType: 'BREEZE',
        trackSurface: 'TURF',
        intensity: 'HEAVY',
        status: 'SCHEDULED',
        scheduledDate: new Date(scheduledDate),
      });
      const result = await service.getOverview();
      expect(result.nextWorkout).toMatchObject({
        id: 'workout',
        horseName: 'Thunder',
        horseCode: 'HR-001',
        surface: 'TURF',
        scheduledDate: new Date(scheduledDate).toISOString(),
      });
      expect(db.workoutSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'SCHEDULED', scheduledDate: { gt: now } }),
          orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }],
        }),
      );
    },
  );
  it('returns the most recently updated ACTIVE plan with its current club-date phase', async () => {
    db.trainingPlan.findFirst.mockResolvedValue({
      id: 'plan',
      planCode: 'GA-001',
      phaseName: 'Race prep',
      horseId: 'horse',
      horse: { name: 'Thunder' },
      status: 'ACTIVE',
      startDate: new Date('2026-11-01'),
      endDate: new Date('2026-12-01'),
      phases: [{ id: 'phase', name: 'Speed', startDate: '2026-11-05', endDate: '2026-11-10' }],
    });
    const result = await service.getOverview();
    expect(result.latestPlan).toMatchObject({
      id: 'plan',
      planCode: 'GA-001',
      horseName: 'Thunder',
      currentPhaseName: 'Speed',
    });
    expect(db.trainingPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { horseId: { in: ['horse'] }, status: 'ACTIVE' },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });
});
