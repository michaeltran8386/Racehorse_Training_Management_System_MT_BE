import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SimulatorService } from './simulator.service';
import { Role } from '@prisma/client';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

describe('SimulatorService', () => {
  let service: SimulatorService;
  let prisma: any;

  const mockActor: CurrentUserPayload = {
    userId: 'user-head-trainer-1',
    email: 'trainer@equiflow.com',
    role: Role.HEAD_TRAINER,
    fullName: 'Head Trainer',
  };
  const mockVet: CurrentUserPayload = {
    userId: 'vet-1',
    email: 'vet@equiflow.com',
    role: Role.VETERINARIAN,
    fullName: 'Veterinarian',
  };
  const mockCM: CurrentUserPayload = {
    userId: 'cm-1',
    email: 'cm@equiflow.com',
    role: Role.CLUB_MANAGER,
    fullName: 'Club Manager',
  };
  const mockGroom: CurrentUserPayload = {
    userId: 'groom-1',
    email: 'groom@equiflow.com',
    role: Role.GROOM,
    fullName: 'Assigned Groom',
  };
  const mockUnassignedGroom: CurrentUserPayload = {
    userId: 'groom-2',
    email: 'othergroom@equiflow.com',
    role: Role.GROOM,
    fullName: 'Other Groom',
  };
  const mockOwner: CurrentUserPayload = {
    userId: 'owner-1',
    email: 'owner@equiflow.com',
    role: Role.HORSE_OWNER,
    fullName: 'Horse Owner',
  };

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(prisma)),
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          const userMap: Record<string, any> = {
            [mockActor.userId]: {
              id: mockActor.userId,
              email: mockActor.email,
              role: Role.HEAD_TRAINER,
              status: 'ACTIVE',
            },
            [mockVet.userId]: {
              id: mockVet.userId,
              email: mockVet.email,
              role: Role.VETERINARIAN,
              status: 'ACTIVE',
            },
            [mockCM.userId]: {
              id: mockCM.userId,
              email: mockCM.email,
              role: Role.CLUB_MANAGER,
              status: 'ACTIVE',
            },
            [mockGroom.userId]: {
              id: mockGroom.userId,
              email: mockGroom.email,
              role: Role.GROOM,
              status: 'ACTIVE',
            },
            [mockUnassignedGroom.userId]: {
              id: mockUnassignedGroom.userId,
              email: mockUnassignedGroom.email,
              role: Role.GROOM,
              status: 'ACTIVE',
            },
            [mockOwner.userId]: {
              id: mockOwner.userId,
              email: mockOwner.email,
              role: Role.HORSE_OWNER,
              status: 'ACTIVE',
            },
            'trainer-owner-uuid': {
              id: 'trainer-owner-uuid',
              email: 'other@eq.com',
              role: Role.HEAD_TRAINER,
              status: 'ACTIVE',
            },
            'vet-owner-uuid': {
              id: 'vet-owner-uuid',
              email: 'othervet@eq.com',
              role: Role.VETERINARIAN,
              status: 'ACTIVE',
            },
          };
          return userMap[where.id] ?? null;
        }),
      },
      workoutSession: {
        findUnique: jest.fn(),
      },
      horse: { findUnique: jest.fn(), findMany: jest.fn() },
      simulatorSession: {
        upsert: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      medicalLock: {
        create: jest.fn(),
        update: jest.fn(),
      },
      medicalRecord: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulatorService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'http://localhost:5175') } },
      ],
    }).compile();

    service = module.get<SimulatorService>(SimulatorService);
  });

  it('issues an exam session and stores a validated result without finalizing a medical record', async () => {
    prisma.horse.findUnique.mockResolvedValue(eligibleWorkout().horse);
    prisma.simulatorSession.findFirst.mockResolvedValue(null);
    prisma.simulatorSession.create.mockResolvedValue({ id: 'exam-1', status: 'PENDING' });

    await expect(service.startExam('horse-uuid-1', undefined, mockVet)).resolves.toEqual({
      sessionId: 'exam-1',
      status: 'PENDING',
      launchUrl: 'http://localhost:5175/?sessionId=exam-1&type=EXAM',
    });

    const issued = {
      id: 'exam-1',
      type: 'EXAM',
      status: 'PENDING',
      horseIds: ['horse-uuid-1'],
      actorUserId: mockVet.userId,
      workoutSession: null,
    };
    prisma.simulatorSession.findUnique.mockResolvedValue(issued);
    prisma.simulatorSession.update.mockResolvedValue({ ...issued, status: 'COMPLETED' });
    await service.recordExamFinished(
      {
        event: 'sim:exam_finished',
        session_id: 'exam-1',
        horse_id: 'horse-uuid-1',
        captured_at: '2026-10-23T01:00:00.000Z',
        model_version: 'equiflow-sim-v3',
        source: 'EQUIFLOW_SIMULATOR',
        metrics: {
          temperature: { value: 38.2, unit: 'CELSIUS' },
          resting_heart_rate: { value: 38, unit: 'BPM' },
          respiratory_rate: { value: 13, unit: 'BREATHS_PER_MINUTE' },
          weight: { value: 480, unit: 'KG' },
        },
      },
      mockVet,
    );

    expect(prisma.medicalRecord.create).not.toHaveBeenCalled();
    expect(prisma.medicalRecord.update).not.toHaveBeenCalled();
  });

  it('reissues fresh PENDING session when existing workout session has expired (R-2)', async () => {
    prisma.workoutSession.findUnique.mockResolvedValue(eligibleWorkout());
    prisma.simulatorSession.findUnique.mockResolvedValue({
      id: 'expired-workout-session',
      status: 'PENDING',
      createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
    });
    prisma.simulatorSession.create.mockResolvedValue({
      id: 'fresh-workout-session',
      status: 'PENDING',
    });

    const res = await service.startWorkout('workout-1', mockActor);

    expect(prisma.simulatorSession.delete).toHaveBeenCalledWith({
      where: { id: 'expired-workout-session' },
    });
    expect(prisma.simulatorSession.create).toHaveBeenCalled();
    expect(res.sessionId).toBe('fresh-workout-session');
    expect(res.status).toBe('PENDING');
  });

  it('rejects startWorkout with 409 SIMULATOR_SESSION_FINISHED when existing session is COMPLETED (R-11)', async () => {
    prisma.workoutSession.findUnique.mockResolvedValue(eligibleWorkout());
    prisma.simulatorSession.findUnique.mockResolvedValue({
      id: 'completed-workout-session',
      status: 'COMPLETED',
      createdAt: new Date(),
    });

    await expect(service.startWorkout('workout-1', mockActor)).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'SIMULATOR_SESSION_FINISHED',
      },
    });
  });

  it('rejects startWorkout with 409 SIMULATOR_SESSION_FINISHED when existing session is ABORTED_INJURY (R-11)', async () => {
    prisma.workoutSession.findUnique.mockResolvedValue(eligibleWorkout());
    prisma.simulatorSession.findUnique.mockResolvedValue({
      id: 'aborted-workout-session',
      status: 'ABORTED_INJURY',
      createdAt: new Date(),
    });

    await expect(service.startWorkout('workout-1', mockActor)).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'SIMULATOR_SESSION_FINISHED',
      },
    });
  });

  it('reissues fresh PENDING session when existing exam session has expired (R-2)', async () => {
    prisma.horse.findUnique.mockResolvedValue(eligibleWorkout().horse);
    prisma.simulatorSession.findFirst.mockResolvedValue({
      id: 'expired-exam-session',
      status: 'PENDING',
      createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
    });
    prisma.simulatorSession.create.mockResolvedValue({
      id: 'fresh-exam-session',
      status: 'PENDING',
    });

    const res = await service.startExam('horse-uuid-1', undefined, mockVet);

    expect(prisma.simulatorSession.delete).toHaveBeenCalledWith({
      where: { id: 'expired-exam-session' },
    });
    expect(prisma.simulatorSession.create).toHaveBeenCalled();
    expect(res.sessionId).toBe('fresh-exam-session');
    expect(res.status).toBe('PENDING');
  });

  const eligibleWorkout = () => ({
    id: 'workout-1',
    status: 'SCHEDULED',
    scheduledDate: new Date(Date.now() - 60_000),
    workoutType: 'TRIAL',
    intensity: 'MODERATE',
    distanceMeters: 1200,
    repetitions: 1,
    targetSpeedKmh: 45,
    targetDurationSeconds: 100,
    trackSurface: 'TURF',
    simulatorSession: null,
    trainingPlan: { id: 'plan-1', trainerUserId: mockActor.userId },
    horse: {
      id: 'horse-uuid-1',
      horseCode: 'NG-000001',
      name: 'Thunder',
      microchipRfid: '985141000000001',
      breed: 'Thoroughbred',
      dob: new Date('2020-01-01'),
      gender: 'MALE',
      color: 'Bay',
      status: 'IN_TRAINING',
      isMedicalLocked: false,
      medicalLocks: [],
      weightKg: 490,
      stallAllocations: [
        {
          id: 'alloc-1',
          assignedGroomUserId: 'groom-1',
          stall: { id: 'stall-1', code: 'A-01', zone: 'Zone A' },
        },
      ],
    },
  });

  const telemetryTick = () => ({
    event: 'sim:telemetry_tick' as const,
    session_id: 'server-session-1',
    timestamp_ms: 1729520000000,
    sim_time_s: 1,
    sim_speed_multiplier: 1,
    horse: {
      horse_id: 'horse-uuid-1',
      microchip_id: '985141000000001',
      lifecycle_status: 'IN_TRAINING',
      medical_lock: false,
    },
    track: {
      surface: 'GRASS',
      target_distance_m: 1200,
      covered_distance_m: 15.2,
      track_condition: 'GOOD',
      obstacles_cleared: 0,
      obstacles_total: 0,
    },
    metrics: {
      velocity_mps: 15.2,
      heart_rate_bpm: 120,
      stamina_pct: 98.5,
      body_temp_c: 38,
      stride_length_m: 6.2,
      stride_freq_spm: 130,
      calories_kcal: 25.4,
    },
    alerts: {
      overload_warning: false,
      limp_detected: false,
      heat_stress: false,
    },
  });

  const issuedSession = (overrides: Record<string, unknown> = {}) => ({
    id: 'server-session-1',
    type: 'WORKOUT',
    status: 'PENDING',
    horseIds: ['horse-uuid-1'],
    actorUserId: mockActor.userId,
    startedAt: new Date(),
    workoutSession: eligibleWorkout(),
    ...overrides,
  });

  describe('backend-issued workout sessions', () => {
    it('creates one pending session and returns a simulator launch URL', async () => {
      const workout = eligibleWorkout();
      prisma.workoutSession.findUnique.mockResolvedValue(workout);
      prisma.simulatorSession.upsert.mockResolvedValue({
        id: 'server-session-1',
        status: 'PENDING',
        workoutSessionId: workout.id,
      });

      const result = await service.startWorkout(workout.id, mockActor);

      expect(result).toEqual({
        sessionId: 'server-session-1',
        status: 'PENDING',
        launchUrl: 'http://localhost:5175/?sessionId=server-session-1',
      });
      expect(prisma.simulatorSession.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workoutSessionId: workout.id },
          create: expect.objectContaining({
            id: expect.any(String),
            workoutSessionId: workout.id,
            actorUserId: mockActor.userId,
            horseIds: [workout.horse.id],
            status: 'PENDING',
          }),
        }),
      );
    });

    it('returns the same session when start is retried', async () => {
      const workout = eligibleWorkout();
      prisma.workoutSession.findUnique.mockResolvedValue(workout);
      prisma.simulatorSession.upsert.mockResolvedValue({
        id: 'server-session-1',
        status: 'PENDING',
        workoutSessionId: workout.id,
      });

      const first = await service.startWorkout(workout.id, mockActor);
      const retried = await service.startWorkout(workout.id, mockActor);

      expect(retried.sessionId).toBe(first.sessionId);
      expect(prisma.simulatorSession.upsert).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['missing workout', null, mockActor, 'WORKOUT_NOT_FOUND'],
      [
        'wrong role',
        eligibleWorkout(),
        { ...mockActor, role: Role.VETERINARIAN },
        'SIMULATOR_TRAINER_REQUIRED',
      ],
      [
        'another trainer workout',
        { ...eligibleWorkout(), trainingPlan: { id: 'plan-1', trainerUserId: 'trainer-2' } },
        mockActor,
        'WORKOUT_NOT_ASSIGNED',
      ],
      [
        'future workout',
        { ...eligibleWorkout(), scheduledDate: new Date(Date.now() + 60_000) },
        mockActor,
        'WORKOUT_NOT_STARTED',
      ],
      [
        'completed workout',
        { ...eligibleWorkout(), status: 'COMPLETED' },
        mockActor,
        'WORKOUT_NOT_SIMULATABLE',
      ],
      [
        'medical lock on heavy workout',
        {
          ...eligibleWorkout(),
          intensity: 'HIGH',
          horse: { ...eligibleWorkout().horse, isMedicalLocked: true },
        },
        mockActor,
        'MEDICAL_LOCK_ACTIVE',
      ],
    ])('rejects %s with a stable code', async (_name, workout, actor, code) => {
      prisma.workoutSession.findUnique.mockResolvedValue(workout);

      await expect(
        service.startWorkout('workout-1', actor as CurrentUserPayload),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code }),
      });
      expect(prisma.simulatorSession.upsert).not.toHaveBeenCalled();
    });

    it('returns only the assigned horse and workout context', async () => {
      const workout = eligibleWorkout();
      prisma.simulatorSession.findUnique.mockResolvedValue({
        id: 'server-session-1',
        status: 'PENDING',
        actorUserId: mockActor.userId,
        workoutSessionId: workout.id,
        workoutSession: workout,
      });

      const result = await service.getContext('server-session-1', mockActor);

      expect(result.type).toBe('WORKOUT');
      if (result.type !== 'WORKOUT') throw new Error('Expected workout context');
      expect(result.sessionId).toBe('server-session-1');
      expect(result.horse.id).toBe(workout.horse.id);
      expect(result.workout).toEqual(
        expect.objectContaining({ id: workout.id, distanceMeters: 1200, trackSurface: 'TURF' }),
      );
    });
  });

  it('records one active snapshot without a telemetry DB row', async () => {
    prisma.simulatorSession.findUnique.mockResolvedValue(issuedSession());
    prisma.simulatorSession.update.mockResolvedValue({ ...issuedSession(), status: 'RUNNING' });

    const snapshot = await service.recordTelemetry(telemetryTick(), mockActor);

    expect(snapshot).toBeDefined();
    expect(snapshot.sessionId).toBe('server-session-1');
    expect(snapshot.horseIds).toEqual(['horse-uuid-1']);
    expect(prisma.simulatorSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'server-session-1' },
        data: expect.objectContaining({ status: 'RUNNING' }),
      }),
    );
    expect(prisma.simulatorSession.upsert).not.toHaveBeenCalled();
    expect(prisma.medicalLock.create).not.toHaveBeenCalled();
    expect(prisma.medicalRecord.create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing session', null, telemetryTick(), mockActor, 'SIMULATOR_SESSION_NOT_FOUND'],
    [
      'different actor',
      issuedSession({ actorUserId: 'trainer-2' }),
      telemetryTick(),
      mockActor,
      'SIMULATOR_SESSION_FORBIDDEN',
    ],
    [
      'different horse',
      issuedSession(),
      { ...telemetryTick(), horse: { ...telemetryTick().horse, horse_id: 'horse-2' } },
      mockActor,
      'SIMULATOR_HORSE_MISMATCH',
    ],
    [
      'finished session',
      issuedSession({ status: 'COMPLETED' }),
      telemetryTick(),
      mockActor,
      'SIMULATOR_SESSION_FINISHED',
    ],
    [
      'expired PENDING session',
      issuedSession({ status: 'PENDING', createdAt: new Date(Date.now() - 301_000) }),
      telemetryTick(),
      mockActor,
      'SIMULATOR_SESSION_EXPIRED',
    ],
  ])('rejects telemetry for %s', async (_name, session, packet, actor, code) => {
    prisma.simulatorSession.findUnique.mockResolvedValue(session);

    await expect(service.recordTelemetry(packet, actor)).rejects.toMatchObject({
      response: expect.objectContaining({ code }),
    });
    expect(prisma.simulatorSession.update).not.toHaveBeenCalled();
    expect(prisma.simulatorSession.upsert).not.toHaveBeenCalled();
  });

  it('rechecks the medical lock before the first tick', async () => {
    const workout = eligibleWorkout();
    prisma.simulatorSession.findUnique.mockResolvedValue(
      issuedSession({
        workoutSession: {
          ...workout,
          intensity: 'HEAVY',
          horse: { ...workout.horse, isMedicalLocked: true },
        },
      }),
    );

    await expect(service.recordTelemetry(telemetryTick(), mockActor)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MEDICAL_LOCK_ACTIVE' }),
    });
    expect(prisma.simulatorSession.update).not.toHaveBeenCalled();
  });

  it('finishes an issued session idempotently', async () => {
    const finishedWorkout = {
      event: 'sim:session_finished' as const,
      session_id: 'server-session-1',
      type: 'WORKOUT' as const,
      status: 'COMPLETED' as const,
      horse: {
        horse_id: 'horse-uuid-1',
        microchip_id: '985141000000001',
        lifecycle_status: 'IN_TRAINING',
        medical_lock: false,
      },
      surface: 'TURF',
      distance_planned_m: 1200,
      result: {
        finish_time_s: 72.4,
        avg_speed_mps: 16.5,
        top_speed_mps: 18.2,
        avg_heart_rate_bpm: 175,
        peak_heart_rate_bpm: 195,
        calories_total_kcal: 420,
      },
    };

    const now = new Date();
    const completedSession = {
      ...issuedSession(),
      type: 'WORKOUT',
      status: 'COMPLETED',
      finishedAt: now,
      result: finishedWorkout.result,
    };
    prisma.simulatorSession.findUnique
      .mockResolvedValueOnce(issuedSession({ status: 'RUNNING' }))
      .mockResolvedValueOnce(completedSession);
    prisma.simulatorSession.update.mockResolvedValue(completedSession);

    await service.recordFinished(finishedWorkout, mockActor);
    await expect(service.recordFinished(finishedWorkout, mockActor)).resolves.toBe(
      completedSession,
    );

    expect(prisma.simulatorSession.update).toHaveBeenCalledTimes(1);
    expect(prisma.simulatorSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'server-session-1' } }),
    );
    expect(prisma.simulatorSession.upsert).not.toHaveBeenCalled();

    // Neither call touches medical locks or records
    expect(prisma.medicalLock.create).not.toHaveBeenCalled();
    expect(prisma.medicalRecord.create).not.toHaveBeenCalled();
  });

  it('maps the latest simulator result into a trainer draft', async () => {
    prisma.workoutSession.findUnique.mockResolvedValue({
      id: 'workout-1',
      trainingPlan: { trainerUserId: mockActor.userId },
      simulatorSession: {
        id: 'server-session-1',
        status: 'ABORTED_INJURY',
        result: {
          durationS: 72.4,
          distanceCompletedM: 1187,
          peakHr: 195,
          hrRecovery10m: 86,
          topSpeedKmh: 65.5,
          surface: 'GRASS',
          condition: 'WET',
        },
      },
    });

    await expect(service.getLatestWorkoutResult('workout-1', mockActor)).resolves.toEqual({
      sessionId: 'server-session-1',
      status: 'ABORTED_INJURY',
      resultDraft: {
        actualTimeSeconds: 72.4,
        actualDistanceMeters: 1187,
        heartRatePeak: 195,
        heartRateRecovery: 86,
        topSpeedKmh: 65.5,
        actualSurface: 'TURF',
        trackCondition: 'SOFT',
      },
    });
  });

  it('lists newest persisted sessions with active memory snapshots', async () => {
    prisma.simulatorSession.findMany.mockResolvedValue([
      {
        id: 'WRK-20261021-001',
        type: 'WORKOUT',
        status: 'COMPLETED',
        horseIds: ['horse-uuid-1'],
        lastSnapshot: null,
        result: { finish_time_s: 72.4 },
        actorUserId: mockActor.userId,
        startedAt: new Date(Date.now() - 60000),
        finishedAt: new Date(),
        createdAt: new Date(Date.now() - 60000),
        updatedAt: new Date(),
      },
    ]);

    const result = await service.listRecent(20);

    expect(result).toHaveProperty('active');
    expect(result).toHaveProperty('recent');
    expect(Array.isArray(result.active)).toBe(true);
    expect(Array.isArray(result.recent)).toBe(true);
    expect(result.recent.length).toBe(1);
    expect(prisma.simulatorSession.findMany).toHaveBeenCalledWith({
      take: 20,
      orderBy: { updatedAt: 'desc' },
    });
  });

  describe('getContext', () => {
    it('returns workout context for valid session without requiring actor parameter', async () => {
      const session = issuedSession({
        id: 'sess-workout-1',
        status: 'PENDING',
        createdAt: new Date(),
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      const ctx = await service.getContext('sess-workout-1');

      expect(ctx.type).toBe('WORKOUT');
      expect(ctx.sessionId).toBe('sess-workout-1');
      expect((ctx as any).horse.name).toBe('Thunder');
      expect((ctx as any).horse.weightKg).toBe(490);
      expect((ctx as any).horse.stall).toBe('A-01');
      expect((ctx as any).workout.id).toBe('workout-1');
    });

    it('returns exam context for valid exam session', async () => {
      const examSession = {
        id: 'sess-exam-1',
        type: 'EXAM',
        status: 'PENDING',
        createdAt: new Date(),
        horseIds: ['horse-uuid-1'],
        actorUserId: mockVet.userId,
        medicalRecordId: 'rec-1',
        workoutSession: null,
      };
      prisma.simulatorSession.findUnique.mockResolvedValue(examSession);
      prisma.horse.findUnique.mockResolvedValue(eligibleWorkout().horse);

      const ctx = await service.getContext('sess-exam-1');

      expect(ctx.type).toBe('EXAM');
      expect(ctx.sessionId).toBe('sess-exam-1');
      expect((ctx as any).horse.name).toBe('Thunder');
      expect((ctx as any).horse.weightKg).toBe(490);
      expect((ctx as any).horse.stall).toBe('A-01');
      expect((ctx as any).medicalRecordId).toBe('rec-1');
    });

    it('rejects getContext when session is not found', async () => {
      prisma.simulatorSession.findUnique.mockResolvedValue(null);

      await expect(service.getContext('non-existent')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SIMULATOR_SESSION_NOT_FOUND' }),
      });
    });

    it('rejects getContext when session is already COMPLETED or ABORTED', async () => {
      const session = issuedSession({ status: 'COMPLETED' });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      await expect(service.getContext('sess-completed')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SIMULATOR_SESSION_FINISHED' }),
      });
    });

    it('rejects getContext when PENDING session is expired (> 5 minutes)', async () => {
      const session = issuedSession({
        status: 'PENDING',
        createdAt: new Date(Date.now() - 301_000),
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      await expect(service.getContext('sess-expired')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SIMULATOR_SESSION_EXPIRED' }),
      });
    });

    it('rejects getContext on cross-actor mismatch for workout session', async () => {
      const session = issuedSession({
        actorUserId: 'trainer-owner-1',
        workoutSession: {
          ...eligibleWorkout(),
          trainingPlan: { trainerUserId: 'trainer-owner-1' },
        },
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      await expect(service.getContext('sess-workout-1', mockActor)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SIMULATOR_SESSION_FORBIDDEN' }),
      });
    });

    it('rejects getContext on cross-actor mismatch for exam session', async () => {
      const examSession = {
        id: 'sess-exam-1',
        type: 'EXAM',
        status: 'PENDING',
        createdAt: new Date(),
        horseIds: ['horse-uuid-1'],
        actorUserId: 'vet-owner-1',
        medicalRecordId: null,
        workoutSession: null,
      };
      prisma.simulatorSession.findUnique.mockResolvedValue(examSession);
      prisma.horse.findUnique.mockResolvedValue(eligibleWorkout().horse);

      await expect(service.getContext('sess-exam-1', mockVet)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'SIMULATOR_SESSION_FORBIDDEN' }),
      });
    });

    it('allows CLUB_MANAGER to get context for workout session (returns unmasked 15-digit chip and active stall)', async () => {
      const session = issuedSession({
        id: 'sess-cm-wrk-1',
        status: 'PENDING',
        createdAt: new Date(),
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      const ctx = await service.getContext('sess-cm-wrk-1', mockCM);

      expect(ctx.type).toBe('WORKOUT');
      expect(ctx.horse.id).toBe('horse-uuid-1');
      expect(ctx.horse.microchipRfid).toBe('985141000000001');
      expect(ctx.horse.stall).toBe('A-01');
    });

    it('allows CLUB_MANAGER to get context for exam session (returns unmasked 15-digit chip and active stall)', async () => {
      const examSession = {
        id: 'sess-cm-exam-1',
        type: 'EXAM',
        status: 'PENDING',
        createdAt: new Date(),
        horseIds: ['horse-uuid-1'],
        actorUserId: mockVet.userId,
        medicalRecordId: 'rec-1',
        workoutSession: null,
      };
      prisma.simulatorSession.findUnique.mockResolvedValue(examSession);
      prisma.horse.findUnique.mockResolvedValue(eligibleWorkout().horse);

      const ctx = await service.getContext('sess-cm-exam-1', mockCM);

      expect(ctx.type).toBe('EXAM');
      expect(ctx.horse.id).toBe('horse-uuid-1');
      expect(ctx.horse.microchipRfid).toBe('985141000000001');
      expect(ctx.horse.stall).toBe('A-01');
    });

    it('allows assigned GROOM to get context for workout session with masked 15-digit chip and active stall', async () => {
      const session = issuedSession({
        id: 'sess-groom-wrk-1',
        status: 'PENDING',
        createdAt: new Date(),
        actorUserId: mockGroom.userId,
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      const ctx = await service.getContext('sess-groom-wrk-1', mockGroom);

      expect(ctx.type).toBe('WORKOUT');
      expect(ctx.horse.id).toBe('horse-uuid-1');
      expect(ctx.horse.microchipRfid).toBe('***********0001');
      expect(ctx.horse.microchipRfid?.length).toBe(15);
      expect(ctx.horse.stall).toBe('A-01');
    });

    it('allows assigned GROOM to get context for exam session with masked 15-digit chip and active stall', async () => {
      const examSession = {
        id: 'sess-groom-exam-1',
        type: 'EXAM',
        status: 'PENDING',
        createdAt: new Date(),
        horseIds: ['horse-uuid-1'],
        actorUserId: mockGroom.userId,
        medicalRecordId: null,
        workoutSession: null,
      };
      prisma.simulatorSession.findUnique.mockResolvedValue(examSession);
      prisma.horse.findUnique.mockResolvedValue(eligibleWorkout().horse);

      const ctx = await service.getContext('sess-groom-exam-1', mockGroom);

      expect(ctx.type).toBe('EXAM');
      expect(ctx.horse.id).toBe('horse-uuid-1');
      expect(ctx.horse.microchipRfid).toBe('***********0001');
      expect(ctx.horse.microchipRfid?.length).toBe(15);
      expect(ctx.horse.stall).toBe('A-01');
    });

    it('rejects unassigned GROOM with 403 SIMULATOR_SESSION_FORBIDDEN on workout session', async () => {
      const session = issuedSession({
        id: 'sess-groom-wrk-1',
        status: 'PENDING',
        createdAt: new Date(),
        actorUserId: mockUnassignedGroom.userId,
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      await expect(
        service.getContext('sess-groom-wrk-1', mockUnassignedGroom),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SIMULATOR_SESSION_FORBIDDEN',
          message: 'You are not assigned to groom this horse.',
        }),
      });
    });

    it('rejects unassigned GROOM with 403 SIMULATOR_SESSION_FORBIDDEN on exam session', async () => {
      const examSession = {
        id: 'sess-groom-exam-1',
        type: 'EXAM',
        status: 'PENDING',
        createdAt: new Date(),
        horseIds: ['horse-uuid-1'],
        actorUserId: mockUnassignedGroom.userId,
        medicalRecordId: null,
        workoutSession: null,
      };
      prisma.simulatorSession.findUnique.mockResolvedValue(examSession);
      prisma.horse.findUnique.mockResolvedValue(eligibleWorkout().horse);

      await expect(
        service.getContext('sess-groom-exam-1', mockUnassignedGroom),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SIMULATOR_SESSION_FORBIDDEN',
          message: 'You are not assigned to groom this horse.',
        }),
      });
    });

    it('rejects HORSE_OWNER with 403 SIMULATOR_TRAINER_REQUIRED on workout session', async () => {
      const session = issuedSession({
        id: 'sess-owner-wrk-1',
        status: 'PENDING',
        createdAt: new Date(),
        actorUserId: mockOwner.userId,
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      await expect(service.getContext('sess-owner-wrk-1', mockOwner)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SIMULATOR_TRAINER_REQUIRED',
        }),
      });
    });

    it('rejects HORSE_OWNER with 403 SIMULATOR_SESSION_FORBIDDEN on exam session', async () => {
      const examSession = {
        id: 'sess-owner-exam-1',
        type: 'EXAM',
        status: 'PENDING',
        createdAt: new Date(),
        horseIds: ['horse-uuid-1'],
        actorUserId: mockOwner.userId,
        medicalRecordId: null,
        workoutSession: null,
      };
      prisma.simulatorSession.findUnique.mockResolvedValue(examSession);
      prisma.horse.findUnique.mockResolvedValue(eligibleWorkout().horse);

      await expect(service.getContext('sess-owner-exam-1', mockOwner)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SIMULATOR_SESSION_FORBIDDEN',
        }),
      });
    });

    it('proves REST actor identity binds to persisted session actor when actor is null (assigned Groom returns masked chip)', async () => {
      const session = issuedSession({
        id: 'sess-groom-wrk-null-actor',
        status: 'PENDING',
        createdAt: new Date(),
        actorUserId: mockGroom.userId,
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      const ctx = await service.getContext('sess-groom-wrk-null-actor', null);

      expect(ctx.horse.microchipRfid).toBe('***********0001');
      expect(ctx.horse.microchipRfid?.length).toBe(15);
      expect(ctx.horse.stall).toBe('A-01');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockGroom.userId },
        select: { id: true, email: true, role: true, status: true },
      });
    });

    it('proves no actor-null path leaks an unmasked chip when session actor is unassigned or unauthorized', async () => {
      const unassignedSession = issuedSession({
        id: 'sess-unassigned-wrk-null-actor',
        status: 'PENDING',
        createdAt: new Date(),
        actorUserId: mockUnassignedGroom.userId,
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(unassignedSession);

      await expect(
        service.getContext('sess-unassigned-wrk-null-actor', null),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SIMULATOR_SESSION_FORBIDDEN',
          message: 'You are not assigned to groom this horse.',
        }),
      });
    });

    it('rejects getContext when session actor is inactive or suspended in database', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: mockActor.userId,
        email: mockActor.email,
        role: Role.HEAD_TRAINER,
        status: 'INACTIVE',
      });
      const session = issuedSession({
        id: 'sess-inactive-actor',
        status: 'PENDING',
        createdAt: new Date(),
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      await expect(service.getContext('sess-inactive-actor', null)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SIMULATOR_SESSION_FORBIDDEN',
          message: 'Session actor is invalid or inactive.',
        }),
      });
    });

    it('rejects caller when authenticated actor does not match persisted session actor and is not CLUB_MANAGER', async () => {
      const session = issuedSession({
        id: 'sess-mismatch',
        status: 'PENDING',
        createdAt: new Date(),
        actorUserId: mockActor.userId,
      });
      prisma.simulatorSession.findUnique.mockResolvedValue(session);

      await expect(service.getContext('sess-mismatch', mockGroom)).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'SIMULATOR_SESSION_FORBIDDEN',
          message: 'This simulation session belongs to another user.',
        }),
      });
    });
  });

  describe('getHorsesForSimulator', () => {
    it('returns complete real horse catalogue with 15-digit microchips, active stalls, and weight', async () => {
      prisma.horse.findMany.mockResolvedValue([
        {
          id: 'horse-uuid-1',
          name: 'QA Zephyr Wind',
          horseCode: 'QA-HR-000001',
          microchipRfid: '985141099000001',
          microchip: '985141099000001',
          breed: 'Thoroughbred',
          color: 'Bay',
          gender: 'Colt',
          dob: new Date('2021-03-15'),
          status: 'ACTIVE',
          isMedicalLocked: false,
          weightKg: 490,
          stallAllocations: [
            {
              id: 'alloc-1',
              stall: { id: 'stall-1', code: 'STALL-QA01', zone: 'Zone QA' },
            },
          ],
        },
        {
          id: 'horse-uuid-2',
          name: 'QA Shadow Runner',
          horseCode: 'QA-HR-000010',
          microchipRfid: '985141099000010',
          microchip: '985141099000010',
          breed: 'Thoroughbred',
          color: 'Grey',
          gender: 'Colt',
          dob: new Date('2021-03-15'),
          status: 'IN_TRAINING',
          isMedicalLocked: false,
          weightKg: 505,
          stallAllocations: [],
        },
      ]);

      const result = await service.getHorsesForSimulator();

      expect(prisma.horse.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        select: expect.objectContaining({
          id: true,
          name: true,
          horseCode: true,
          microchipRfid: true,
          microchip: true,
          breed: true,
          color: true,
          gender: true,
          dob: true,
          status: true,
          isMedicalLocked: true,
          weightKg: true,
          stallAllocations: expect.any(Object),
        }),
        orderBy: { name: 'asc' },
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'horse-uuid-1',
          name: 'QA Zephyr Wind',
          microchip: '985141099000001',
          microchipRfid: '985141099000001',
          weightKg: 490,
          stallCode: 'STALL-QA01',
          zone: 'Zone QA',
        }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          id: 'horse-uuid-2',
          name: 'QA Shadow Runner',
          stallCode: null,
          zone: null,
        }),
      );
    });
  });
});
