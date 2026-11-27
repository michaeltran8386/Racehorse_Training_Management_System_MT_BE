import { demoClockMiddleware } from '../common/utils/demo-clock';
import {
  rankWorkoutSlots,
  WorkoutSlotSuggestionsService,
} from './workout-slot-suggestions.service';

describe('workout slot recommendations', () => {
  const track = { id: 'track', surface: 'TURF', capacity: 6, isActive: true };
  const input = {
    horseId: 'horse',
    trainerUserId: 'trainer',
    workoutType: 'CANTER',
    intensity: 'MEDIUM',
    trackSurface: 'TURF',
  };
  const from = '2026-11-24',
    to = '2026-11-25';
  it('ranks morning first and keeps the entire session in the preferred window', () => {
    const slots = rankWorkoutSlots(input, [track], [], from, to, new Date('2026-11-23T00:00Z'));
    expect(slots).toHaveLength(3);
    expect(slots[0].startAt).toBe('2026-11-23T23:15:00.000Z');
    for (const slot of slots) expect(new Date(slot.endAt).getUTCHours()).toBeLessThan(2);
  });
  it('suggests this afternoon before a later morning when the morning window has passed', () => {
    const slots = rankWorkoutSlots(input, [track], [], from, to, new Date('2026-11-24T06:00:00Z'));
    expect(slots).toHaveLength(3);
    expect(slots[0].startAt).toBe('2026-11-24T07:15:00.000Z');
  });
  it('fits long sessions before meals and does not duplicate times on different tracks', () => {
    const slots = rankWorkoutSlots(
      { ...input, workoutType: 'TRIAL', intensity: 'HEAVY' },
      [track, { ...track, id: 'other' }],
      [],
      from,
      from,
      new Date('2026-11-24T08:10:00Z'),
    );
    expect(slots).toHaveLength(0); // 30-minute notice leaves no 90-minute window before 17:00.
    const morning = rankWorkoutSlots(
      input,
      [track, { ...track, id: 'other' }],
      [],
      from,
      from,
      new Date('2026-11-23T00:00Z'),
    );
    expect(new Set(morning.map((s) => s.startAt)).size).toBe(morning.length);
  });
  it('keeps sessions outside lunch/care and returns only one fitting late trial', () => {
    const beforeLunch = rankWorkoutSlots(
      input,
      [track],
      [],
      from,
      from,
      new Date('2026-11-24T03:00Z'),
    );
    expect(beforeLunch[0].endAt).toBe('2026-11-24T04:30:00.000Z');
    const afterCutoff = rankWorkoutSlots(
      input,
      [track],
      [],
      from,
      from,
      new Date('2026-11-24T03:01Z'),
    );
    expect(afterCutoff[0].startAt).toBe('2026-11-24T07:15:00.000Z');
    const trial = rankWorkoutSlots(
      { ...input, workoutType: 'TRIAL', intensity: 'HEAVY' },
      [track],
      [],
      from,
      from,
      new Date('2026-11-24T08:00Z'),
    );
    expect(trial).toHaveLength(1);
    expect(trial[0].startAt).toBe('2026-11-24T08:30:00.000Z');
    expect(trial[0].endAt).toBe('2026-11-24T10:00:00.000Z');
  });
  it('applies symmetric rest against a future booking and never relaxes it to fill three cards', () => {
    const rows = [
      {
        id: 'future',
        horseId: 'horse',
        trackId: 'track',
        trackSurface: 'TURF',
        workoutType: 'TRIAL',
        intensity: 'HEAVY',
        status: 'SCHEDULED',
        scheduledDate: new Date('2026-11-25T00:00Z'),
        trainingPlan: { trainerUserId: 'trainer' },
      },
    ];
    expect(
      rankWorkoutSlots(input, [track], rows, from, to, new Date('2026-11-23T00:00Z')),
    ).toHaveLength(0);
  });
  it('respects capacity and edited-workout exclusion', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: `w${i}`,
      horseId: `h${i}`,
      trackId: 'track',
      trackSurface: 'TURF',
      workoutType: 'WALK',
      intensity: 'LIGHT',
      status: 'SCHEDULED',
      scheduledDate: new Date('2026-11-23T23:00Z'),
      trainingPlan: { trainerUserId: `t${i}` },
    }));
    expect(
      rankWorkoutSlots(input, [track], rows, from, from, new Date('2026-11-23T00:00Z'))[0].startAt,
    ).not.toBe('2026-11-23T23:15:00.000Z');
    expect(
      rankWorkoutSlots(input, [track], rows, from, from, new Date('2026-11-23T00:00Z'), 'w0')[0]
        .startAt,
    ).toBe('2026-11-23T23:15:00.000Z');
  });
  it('loads one snapshot for all candidates and rejects foreign plans before loading occupancy', async () => {
    const tx = {
      trainingPlan: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p',
          trainerUserId: 'trainer',
          horseId: 'horse',
          status: 'ACTIVE',
          startDate: new Date('2026-11-24'),
          endDate: new Date('2026-11-30'),
          phases: [],
          horse: { status: 'ACTIVE', medicalLocks: [], stallAllocations: [] },
          trainer: { role: 'HEAD_TRAINER', status: 'ACTIVE' },
        }),
      },
      trainingTrack: { findMany: jest.fn().mockResolvedValue([track]) },
      workoutSession: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const db = { $transaction: jest.fn((fn) => fn(tx)) };
    const service = new WorkoutSlotSuggestionsService(db as any);
    const user = { userId: 'trainer', role: 'HEAD_TRAINER' } as any;
    const dto = {
      from,
      to,
      workoutType: 'CANTER',
      intensity: 'MEDIUM',
      trackSurface: 'TURF',
      phaseId: 'phase',
      distanceMeters: 1200,
    };
    jest.useFakeTimers().setSystemTime(new Date('2026-11-23T00:00Z'));
    try {
      expect((await service.suggest('p', dto, user)).slots).toHaveLength(3);
      expect(tx.workoutSession.findMany).toHaveBeenCalledTimes(1);
      expect(tx.trainingTrack.findMany).toHaveBeenCalledTimes(1);
      await expect(service.suggest('p', dto, { ...user, userId: 'another' })).rejects.toMatchObject(
        { status: 403 },
      );
      expect(tx.workoutSession.findMany).toHaveBeenCalledTimes(1);
      tx.workoutSession.findMany.mockResolvedValueOnce([
        {
          id: 'heavy',
          horseId: 'other',
          trackId: 'track',
          trackSurface: 'TURF',
          scheduledDate: new Date('2026-11-23T23:30:00Z'),
          workoutType: 'BREEZE',
          intensity: 'HEAVY',
          status: 'SCHEDULED',
          trainingPlan: { trainerUserId: 'other' },
        },
      ] as any);
      expect((await service.suggest('p', dto, user)).slots[0].startAt).toBe(
        '2026-11-24T00:45:00.000Z',
      );
      let simulated!: ReturnType<typeof service.suggest>;
      demoClockMiddleware(
        { headers: { 'x-demo-date': '2026-11-24T13:00' } } as any,
        {} as any,
        () => {
          simulated = service.suggest('p', dto, user);
        },
      );
      expect((await simulated).slots[0].startAt).toBe('2026-11-24T07:15:00.000Z');
      expect(tx.workoutSession.findMany).toHaveBeenCalledTimes(3);
      tx.trainingPlan.findUnique.mockResolvedValueOnce({
        ...(await tx.trainingPlan.findUnique()),
        horse: { status: 'ACTIVE', isMedicalLocked: true, medicalLocks: [], stallAllocations: [] },
      });
      expect((await service.suggest('p', dto, user)).slots).toHaveLength(0);
      expect(tx.workoutSession.findMany).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
