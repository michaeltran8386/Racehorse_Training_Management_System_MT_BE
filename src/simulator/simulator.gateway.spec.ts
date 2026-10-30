import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Role, SeverityLevel, SimulatorSessionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { IncidentsService } from '../incidents/incidents.service';
import { SimulatorGateway } from './simulator.gateway';
import { SimulatorService } from './simulator.service';
import { SimulatorRealtimeService } from './simulator-realtime.service';

describe('SimulatorGateway', () => {
  let gateway: SimulatorGateway;
  let authService: any;
  let jwtService: any;
  let simulatorService: any;
  let incidentsService: any;
  let realtimeService: any;
  let mockServer: any;
  let prismaService: any;

  beforeEach(async () => {
    authService = {
      getMe: jest.fn(),
    };
    jwtService = {
      verify: jest.fn(),
    };
    simulatorService = {
      recordTelemetry: jest.fn(),
      recordRaceProgress: jest.fn(),
      recordFinished: jest.fn(),
      recordExamFinished: jest.fn(),
      abortSession: jest.fn(),
      getActiveSession: jest.fn(),
    };
    incidentsService = {
      createFromSimulator: jest.fn(),
    };
    realtimeService = {
      setServer: jest.fn(),
      emit: jest.fn(),
    };
    mockServer = {
      emit: jest.fn(),
    };
    prismaService = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      simulatorSession: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimulatorGateway,
        { provide: AuthService, useValue: authService },
        { provide: JwtService, useValue: jwtService },
        { provide: SimulatorService, useValue: simulatorService },
        { provide: IncidentsService, useValue: incidentsService },
        { provide: SimulatorRealtimeService, useValue: realtimeService },
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    gateway = module.get<SimulatorGateway>(SimulatorGateway);
    gateway.server = mockServer;
  });

  describe('handleConnection', () => {
    it('disconnects client when both token and sessionId are missing (no fallback)', async () => {
      const mockClient: any = {
        handshake: { auth: {} },
        disconnect: jest.fn(),
        data: {},
      };

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
      expect(mockClient.data.user).toBeUndefined();
    });

    it('disconnects client when token-only connection is attempted without sessionId (R-1)', async () => {
      const mockClient: any = {
        handshake: {
          auth: { token: 'jwt-token-without-session' },
        },
        disconnect: jest.fn(),
        data: {},
      };

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
      expect(mockClient.data.user).toBeUndefined();
    });

    it('disconnects client when credentials or sessionId are provided in query parameters', async () => {
      const mockClient: any = {
        handshake: {
          auth: {},
          query: { token: 'leak-in-query' },
        },
        disconnect: jest.fn(),
        data: {},
      };

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('connects client with valid workout sessionId and resolves actor from session.actorUserId', async () => {
      const mockClient: any = {
        handshake: { auth: { sessionId: 'sess-workout-1' } },
        disconnect: jest.fn(),
        data: {},
      };
      prismaService.simulatorSession.findUnique.mockResolvedValue({
        id: 'sess-workout-1',
        type: 'WORKOUT',
        status: 'PENDING',
        actorUserId: 'trainer-uuid-1',
        createdAt: new Date(),
      });
      prismaService.user.findUnique.mockResolvedValue({
        id: 'trainer-uuid-1',
        email: 'headtrainer@equiflow.com',
        role: Role.HEAD_TRAINER,
        status: 'ACTIVE',
        fullName: 'Head Trainer Minh',
      });

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).not.toHaveBeenCalled();
      expect(mockClient.data.user).toBeDefined();
      expect(mockClient.data.user.userId).toBe('trainer-uuid-1');
      expect(mockClient.data.user.role).toBe(Role.HEAD_TRAINER);
      expect(mockClient.data.session.id).toBe('sess-workout-1');
    });

    it('connects client with valid exam sessionId and resolves actor as VETERINARIAN', async () => {
      const mockClient: any = {
        handshake: { auth: { sessionId: 'sess-exam-1' } },
        disconnect: jest.fn(),
        data: {},
      };
      prismaService.simulatorSession.findUnique.mockResolvedValue({
        id: 'sess-exam-1',
        type: 'EXAM',
        status: 'PENDING',
        actorUserId: 'vet-uuid-1',
        createdAt: new Date(),
      });
      prismaService.user.findUnique.mockResolvedValue({
        id: 'vet-uuid-1',
        email: 'vet@equiflow.com',
        role: Role.VETERINARIAN,
        status: 'ACTIVE',
        fullName: 'Dr. Veterinarian',
      });

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).not.toHaveBeenCalled();
      expect(mockClient.data.user).toBeDefined();
      expect(mockClient.data.user.userId).toBe('vet-uuid-1');
      expect(mockClient.data.user.role).toBe(Role.VETERINARIAN);
    });

    it('disconnects client when sessionId does not exist in DB', async () => {
      const mockClient: any = {
        handshake: { auth: { sessionId: 'sess-non-existent' } },
        disconnect: jest.fn(),
        data: {},
      };
      prismaService.simulatorSession.findUnique.mockResolvedValue(null);

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects client when session is in terminal state (COMPLETED)', async () => {
      const mockClient: any = {
        handshake: { auth: { sessionId: 'sess-finished' } },
        disconnect: jest.fn(),
        data: {},
      };
      prismaService.simulatorSession.findUnique.mockResolvedValue({
        id: 'sess-finished',
        type: 'WORKOUT',
        status: 'COMPLETED',
        actorUserId: 'trainer-uuid-1',
        createdAt: new Date(),
      });

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects client when PENDING session is expired (> 5 minutes)', async () => {
      const mockClient: any = {
        handshake: { auth: { sessionId: 'sess-expired' } },
        disconnect: jest.fn(),
        data: {},
      };
      prismaService.simulatorSession.findUnique.mockResolvedValue({
        id: 'sess-expired',
        type: 'WORKOUT',
        status: 'PENDING',
        actorUserId: 'trainer-uuid-1',
        createdAt: new Date(Date.now() - 301_000),
      });

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects client when cross-actor token does not match session actorUserId', async () => {
      const mockClient: any = {
        handshake: { auth: { sessionId: 'sess-workout-1', token: 'other-trainer-token' } },
        disconnect: jest.fn(),
        data: {},
      };
      prismaService.simulatorSession.findUnique.mockResolvedValue({
        id: 'sess-workout-1',
        type: 'WORKOUT',
        status: 'PENDING',
        actorUserId: 'trainer-uuid-1',
        createdAt: new Date(),
      });
      jwtService.verify.mockReturnValue({ sub: 'other-trainer-uuid' });

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects client when JWT is invalid', async () => {
      const mockClient: any = {
        handshake: { auth: { token: 'invalid-token' } },
        disconnect: jest.fn(),
        data: {},
      };
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects client when user is inactive or blocked', async () => {
      const mockClient: any = {
        handshake: { auth: { token: 'valid-token' } },
        disconnect: jest.fn(),
        data: {},
      };
      jwtService.verify.mockReturnValue({ sub: 'user-1' });
      authService.getMe.mockResolvedValue({
        id: 'user-1',
        email: 'inactive@equiflow.com',
        role: Role.HEAD_TRAINER,
        status: 'INACTIVE',
      });

      await gateway.handleConnection(mockClient);

      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('rejects Horse Owner and Groom from simulator namespace', async () => {
      const mockGroomClient: any = {
        handshake: { auth: { token: 'groom-token' } },
        disconnect: jest.fn(),
        data: {},
      };
      jwtService.verify.mockReturnValue({ sub: 'groom-1' });
      authService.getMe.mockResolvedValue({
        id: 'groom-1',
        email: 'groom@equiflow.com',
        role: Role.GROOM,
        status: 'ACTIVE',
      });

      await gateway.handleConnection(mockGroomClient);

      expect(mockGroomClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('accepts session-bound connection with optional matching JWT token (R-1)', async () => {
      const mockTrainerClient: any = {
        handshake: { auth: { sessionId: 'sess-workout-1', token: 'trainer-token' } },
        disconnect: jest.fn(),
        data: {},
      };
      jwtService.verify.mockReturnValue({ sub: 'trainer-uuid-1' });
      prismaService.simulatorSession.findUnique.mockResolvedValue({
        id: 'sess-workout-1',
        type: 'WORKOUT',
        status: 'PENDING',
        actorUserId: 'trainer-uuid-1',
        createdAt: new Date(),
      });
      prismaService.user.findUnique.mockResolvedValue({
        id: 'trainer-uuid-1',
        email: 'trainer@equiflow.com',
        role: Role.HEAD_TRAINER,
        status: 'ACTIVE',
        fullName: 'Trainer Minh',
      });

      await gateway.handleConnection(mockTrainerClient);

      expect(mockTrainerClient.disconnect).not.toHaveBeenCalled();
      expect(mockTrainerClient.data.user).toBeDefined();
      expect(mockTrainerClient.data.user.role).toBe(Role.HEAD_TRAINER);
      expect(mockTrainerClient.data.session.id).toBe('sess-workout-1');
    });

    it('waits for asynchronous session authentication before handling the first packet', async () => {
      let resolveSession!: (session: any) => void;
      const mockClient: any = {
        handshake: { auth: { sessionId: 'sess-async-1' } },
        disconnect: jest.fn(),
        data: {},
      };
      prismaService.simulatorSession.findUnique.mockReturnValue(
        new Promise((resolve) => (resolveSession = resolve)),
      );
      prismaService.user.findUnique.mockResolvedValue({
        id: 'trainer-1',
        email: 'trainer@equiflow.com',
        role: Role.HEAD_TRAINER,
        status: 'ACTIVE',
        fullName: 'Trainer Minh',
      });
      simulatorService.recordFinished.mockResolvedValue({
        session: {
          id: 'sess-async-1',
          status: 'COMPLETED',
        },
        transitioned: true,
      });

      const connection = gateway.handleConnection(mockClient);
      const firstPacket = gateway.handleSessionFinished(mockClient, {
        event: 'sim:session_finished',
        session_id: 'sess-async-1',
        type: 'WORKOUT',
        status: 'COMPLETED',
        horse: { horse_id: 'horse-1' },
        result: {},
      });
      resolveSession({
        id: 'sess-async-1',
        type: 'WORKOUT',
        status: 'PENDING',
        actorUserId: 'trainer-1',
        horseIds: ['horse-1'],
        createdAt: new Date(),
      });

      await connection;
      await expect(firstPacket).resolves.toEqual({ accepted: true, id: 'sess-async-1' });
    });
  });

  describe('telemetry and incident relay', () => {
    it('lets a veterinarian publish only a valid examination result', async () => {
      const client: any = {
        data: {
          user: { userId: 'vet-1', role: Role.VETERINARIAN, email: 'vet@equiflow.com' },
          session: {
            id: 'exam-1',
            type: SimulatorSessionType.EXAM,
            horseIds: ['68eecf5d-1bc8-4a98-8d74-0b2399d04fe1'],
            actorUserId: 'vet-1',
          },
        },
      };
      const packet = {
        event: 'sim:exam_finished' as const,
        session_id: 'exam-1',
        horse_id: '68eecf5d-1bc8-4a98-8d74-0b2399d04fe1',
        captured_at: '2026-10-23T01:00:00.000Z',
        model_version: 'equiflow-sim-v3',
        source: 'EQUIFLOW_SIMULATOR' as const,
        metrics: {
          temperature: { value: 38.2, unit: 'CELSIUS' as const },
          resting_heart_rate: { value: 38, unit: 'BPM' as const },
          respiratory_rate: { value: 13, unit: 'BREATHS_PER_MINUTE' as const },
          weight: { value: 480, unit: 'KG' as const },
        },
      };
      simulatorService.recordExamFinished.mockResolvedValue({ id: 'exam-1' });

      await expect(gateway.handleExamFinished(client, packet)).resolves.toEqual({
        accepted: true,
        id: 'exam-1',
      });
      expect(simulatorService.recordExamFinished).toHaveBeenCalledWith(packet, client.data.user);

      await expect(
        gateway.handleExamFinished(client, {
          ...packet,
          metrics: { ...packet.metrics, temperature: { value: 99, unit: 'FAHRENHEIT' as any } },
        }),
      ).resolves.toEqual({ accepted: false, code: 'INVALID_SIMULATOR_PACKET' });

      await expect(
        gateway.handleExamFinished(
          {
            data: {
              user: { ...client.data.user, role: Role.HEAD_TRAINER },
              session: client.data.session,
            },
          } as any,
          packet,
        ),
      ).resolves.toEqual({ accepted: false, code: 'FORBIDDEN' });
    });

    it('R-10: produces exactly one server broadcast and persistence call per accepted exam finish', async () => {
      const client: any = {
        data: {
          user: {
            userId: 'vet-1',
            role: Role.VETERINARIAN,
            email: 'vet@equiflow.com',
            fullName: 'Dr. Vet',
          },
          session: {
            id: 'exam-single-10',
            type: SimulatorSessionType.EXAM,
            horseIds: ['00000000-0000-4000-a002-000000000004'],
            actorUserId: 'vet-1',
          },
        },
      };

      const packet: any = {
        event: 'sim:exam_finished',
        session_id: 'exam-single-10',
        horse_id: '00000000-0000-4000-a002-000000000004',
        captured_at: new Date().toISOString(),
        model_version: 'equiflow-sim-v3',
        source: 'EQUIFLOW_SIMULATOR',
        metrics: {
          temperature: { value: 38.2, unit: 'CELSIUS' },
          resting_heart_rate: { value: 35, unit: 'BPM' },
          respiratory_rate: { value: 12, unit: 'BREATHS_PER_MINUTE' },
          weight: { value: 490, unit: 'KG' },
        },
      };

      simulatorService.recordExamFinished.mockResolvedValue({ id: 'exam-single-10' });
      jest.clearAllMocks();
      simulatorService.recordExamFinished.mockResolvedValue({ id: 'exam-single-10' });
      const res = await gateway.handleExamFinished(client, packet);
      expect(res).toEqual({ accepted: true, id: 'exam-single-10' });
      expect(simulatorService.recordExamFinished).toHaveBeenCalledTimes(1);
      expect(mockServer.emit).toHaveBeenCalledTimes(1);
      expect(mockServer.emit).toHaveBeenCalledWith('sim:exam_finished', packet);
    });

    it('relays accepted telemetry packet to subscribers', async () => {
      const mockTrainerClient: any = {
        data: {
          user: {
            userId: 'trainer-1',
            role: Role.HEAD_TRAINER,
            email: 'trainer@equiflow.com',
            fullName: 'Trainer Minh',
          },
          session: {
            id: 'WRK-20261021-001',
            type: SimulatorSessionType.WORKOUT,
            horseIds: ['horse-1'],
            actorUserId: 'trainer-1',
          },
        },
      };

      const packet: any = {
        event: 'sim:telemetry_tick',
        session_id: 'WRK-20261021-001',
        timestamp_ms: 1729520000000,
        sim_time_s: 1.0,
        sim_speed_multiplier: 1.0,
        horse: {
          horse_id: 'horse-1',
          microchip_id: '985141000000001',
          lifecycle_status: 'IN_TRAINING',
          medical_lock: false,
        },
        track: {
          surface: 'TURF',
          target_distance_m: 1200,
          covered_distance_m: 10,
          track_condition: 'FAST',
          obstacles_cleared: 0,
          obstacles_total: 0,
        },
        metrics: {
          velocity_mps: 15.0,
          heart_rate_bpm: 120,
          stamina_pct: 99.0,
          body_temp_c: 38.0,
          stride_length_m: 6.0,
          stride_freq_spm: 130,
          calories_kcal: 20,
        },
        alerts: {
          overload_warning: false,
          limp_detected: false,
          heat_stress: false,
        },
      };

      const result = await gateway.handleTelemetryTick(mockTrainerClient, packet);

      expect(simulatorService.recordTelemetry).toHaveBeenCalledWith(
        packet,
        mockTrainerClient.data.user,
      );
      expect(mockServer.emit).toHaveBeenCalledWith('sim:telemetry_tick', packet);
      expect(result).toEqual({ accepted: true });
    });

    it.each([
      ['out-of-range metric', { metrics: { velocity_mps: 51 } }],
      ['unknown field', { unexpected: true }],
      ['non-object payload', { payload: null }],
    ] as [string, { metrics?: { velocity_mps: number }; unexpected?: boolean; payload?: null }][])(
      'returns a stable ack for %s without recording telemetry',
      async (_name, invalid) => {
        const mockTrainerClient: any = {
          data: {
            user: {
              userId: 'trainer-1',
              role: Role.HEAD_TRAINER,
              email: 'trainer@equiflow.com',
              fullName: 'Trainer Minh',
            },
            session: {
              id: 'session-1',
              type: SimulatorSessionType.WORKOUT,
              horseIds: ['horse-1'],
              actorUserId: 'trainer-1',
            },
          },
        };
        const validPacket: any = {
          event: 'sim:telemetry_tick',
          session_id: 'session-1',
          timestamp_ms: 1,
          sim_time_s: 1,
          sim_speed_multiplier: 1,
          horse: { horse_id: 'horse-1' },
          track: {
            surface: 'GRASS',
            target_distance_m: 1200,
            covered_distance_m: 10,
            track_condition: 'GOOD',
            obstacles_cleared: 0,
            obstacles_total: 0,
          },
          metrics: {
            velocity_mps: 15,
            heart_rate_bpm: 120,
            stamina_pct: 99,
            body_temp_c: 38,
            stride_length_m: 6,
            stride_freq_spm: 130,
            calories_kcal: 20,
            ...invalid.metrics,
          },
          alerts: { overload_warning: false, limp_detected: false, heat_stress: false },
          ...(invalid.unexpected ? { unexpected: true } : {}),
        };
        const packet = invalid.payload === null ? null : validPacket;

        await expect(gateway.handleTelemetryTick(mockTrainerClient, packet)).resolves.toEqual({
          accepted: false,
          code: 'INVALID_SIMULATOR_PACKET',
        });
        expect(simulatorService.recordTelemetry).not.toHaveBeenCalled();
      },
    );

    it('rejects an invalid incident before persistence', async () => {
      const mockTrainerClient: any = {
        data: {
          user: {
            userId: 'trainer-1',
            role: Role.HEAD_TRAINER,
            email: 'trainer@equiflow.com',
            fullName: 'Trainer Minh',
          },
          session: {
            id: 'session-1',
            type: SimulatorSessionType.WORKOUT,
            horseIds: ['horse-1'],
            actorUserId: 'trainer-1',
          },
        },
      };
      const packet: any = {
        event: 'sim:incident_report',
        session_id: null,
        timestamp_ms: 1,
        horse: { horse_id: 'horse-1' },
        incident: {
          kind: 'COLIC',
          label: 'Colic',
          location: 'STALL',
          stall: { col: 2, row: 3, unexpected: true },
        },
      };

      await expect(gateway.handleIncidentReport(mockTrainerClient, packet)).resolves.toEqual({
        accepted: false,
        code: 'INVALID_SIMULATOR_PACKET',
      });
      expect(incidentsService.createFromSimulator).not.toHaveBeenCalled();
    });

    it('ingests incident packet, sets CRITICAL for FRACTURE, and relays to monitors without medical lock', async () => {
      const mockTrainerClient: any = {
        data: {
          user: {
            userId: 'trainer-1',
            role: Role.HEAD_TRAINER,
            email: 'trainer@equiflow.com',
            fullName: 'Trainer Minh',
          },
          session: {
            id: 'WRK-20261021-001',
            type: SimulatorSessionType.WORKOUT,
            horseIds: ['horse-1'],
            actorUserId: 'trainer-1',
          },
        },
      };

      const incidentPacket: any = {
        event: 'sim:incident_report',
        packet_id: 'pkt-inc-001',
        session_id: 'WRK-20261021-001',
        timestamp_ms: 1729520000000,
        horse: {
          horse_id: 'horse-1',
          microchip_id: '985141000000001',
          lifecycle_status: 'IN_TRAINING',
          medical_lock: false,
        },
        incident: {
          kind: 'FRACTURE',
          label: 'Gãy xương chân cấp tính',
          location: 'STALL',
          stall: { col: 2, row: 3 },
        },
        snapshot: {
          covered_distance_m: 600,
          velocity_mps: 16.5,
          heart_rate_bpm: 190,
          body_temp_c: 39.0,
        },
        notify: {
          managing_actors: ['HEAD_TRAINER', 'HORSE_OWNER', 'GROOM', 'CLUB_MANAGER'],
          veterinarian_scope: 'ALL_HORSES_ON_TRACK',
        },
      };

      const mockSavedIncident = {
        id: 'inc-row-1',
        incidentNumber: 'INC-20261021-0001',
        horseId: 'horse-1',
        severity: SeverityLevel.CRITICAL,
      };

      incidentsService.createFromSimulator.mockResolvedValue(mockSavedIncident);

      const ack = await gateway.handleIncidentReport(mockTrainerClient, incidentPacket);

      expect(incidentsService.createFromSimulator).toHaveBeenCalledWith(
        'pkt-inc-001',
        incidentPacket,
        mockTrainerClient.data.user,
      );
      expect(mockServer.emit).toHaveBeenCalledWith(
        'sim:incident_report',
        expect.objectContaining({
          event: 'sim:incident_report',
          packet_id: 'pkt-inc-001',
          incident_id: 'inc-row-1',
        }),
      );
      expect(ack).toEqual({ accepted: true, id: 'inc-row-1' });
    });
  });

  describe('session-bound packet validation (R-7)', () => {
    const trainerUser = {
      userId: 'trainer-1',
      role: Role.HEAD_TRAINER,
      email: 'trainer@equiflow.com',
      fullName: 'Trainer Minh',
    };
    const sessionA = {
      id: 'session-A',
      type: SimulatorSessionType.WORKOUT,
      horseIds: ['horse-1'],
      actorUserId: 'trainer-1',
    };
    const clientSessionA: any = {
      data: {
        user: trainerUser,
        session: sessionA,
      },
    };

    it('rejects packet when socket authenticated with session A submits packet for session B (same actor)', async () => {
      const packet: any = {
        event: 'sim:telemetry_tick',
        session_id: 'session-B', // session mismatch!
        timestamp_ms: 1729520000000,
        sim_time_s: 1.0,
        sim_speed_multiplier: 1.0,
        horse: { horse_id: 'horse-1' },
        track: {
          surface: 'GRASS',
          target_distance_m: 1200,
          covered_distance_m: 10,
          track_condition: 'GOOD',
          obstacles_cleared: 0,
          obstacles_total: 0,
        },
        metrics: {
          velocity_mps: 15.0,
          heart_rate_bpm: 120,
          stamina_pct: 99.0,
          body_temp_c: 38.0,
          stride_length_m: 6.0,
          stride_freq_spm: 130,
          calories_kcal: 20,
        },
        alerts: { overload_warning: false, limp_detected: false, heat_stress: false },
      };

      const result = await gateway.handleTelemetryTick(clientSessionA, packet);
      expect(result).toEqual({ accepted: false, code: 'SESSION_MISMATCH' });
      expect(simulatorService.recordTelemetry).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();

      // Also verify session_finished rejection for session mismatch
      const finishPacket: any = {
        event: 'sim:session_finished',
        session_id: 'session-B',
        type: 'WORKOUT',
        status: 'COMPLETED',
        horse: { horse_id: 'horse-1' },
      };
      const finishResult = await gateway.handleSessionFinished(clientSessionA, finishPacket);
      expect(finishResult).toEqual({ accepted: false, code: 'SESSION_MISMATCH' });
      expect(simulatorService.recordFinished).not.toHaveBeenCalled();
    });

    it('rejects incident report for foreign horse not in authenticated session', async () => {
      const packet: any = {
        event: 'sim:incident_report',
        packet_id: 'pkt-foreign-001',
        session_id: 'session-A',
        timestamp_ms: 1729520000000,
        horse: { horse_id: 'foreign-horse-999' }, // foreign horse!
        incident: {
          kind: 'FRACTURE',
          label: 'Gãy xương chân cấp tính',
          location: 'STALL',
          stall: { col: 2, row: 3 },
        },
      };

      const result = await gateway.handleIncidentReport(clientSessionA, packet);
      expect(result).toEqual({ accepted: false, code: 'HORSE_MISMATCH' });
      expect(incidentsService.createFromSimulator).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('rejects packet when event is incompatible with session type', async () => {
      // clientSessionA is a HEAD_TRAINER with a WORKOUT session.
      // sim:race_progress requires a RACE session.
      const racePacket: any = {
        event: 'sim:race_progress',
        session_id: 'session-A',
        sim_time_s: 5.0,
        positions: [
          {
            position: 1,
            lane: 1,
            horse_id: 'horse-1',
            covered_distance_m: 100,
            gap_lengths: 0,
            velocity_mps: 15.0,
            heart_rate_bpm: 120,
            status: 'RUNNING',
          },
        ],
      };

      const result = await gateway.handleRaceProgress(clientSessionA, racePacket);
      expect(result).toEqual({ accepted: false, code: 'SESSION_TYPE_INCOMPATIBLE' });
      expect(simulatorService.recordRaceProgress).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });

    it('accepts and processes valid matching packets for session and horse', async () => {
      const packet: any = {
        event: 'sim:telemetry_tick',
        session_id: 'session-A',
        timestamp_ms: 1729520000000,
        sim_time_s: 1.0,
        sim_speed_multiplier: 1.0,
        horse: { horse_id: 'horse-1' },
        track: {
          surface: 'GRASS',
          target_distance_m: 1200,
          covered_distance_m: 10,
          track_condition: 'GOOD',
          obstacles_cleared: 0,
          obstacles_total: 0,
        },
        metrics: {
          velocity_mps: 15.0,
          heart_rate_bpm: 120,
          stamina_pct: 99.0,
          body_temp_c: 38.0,
          stride_length_m: 6.0,
          stride_freq_spm: 130,
          calories_kcal: 20,
        },
        alerts: { overload_warning: false, limp_detected: false, heat_stress: false },
      };

      const result = await gateway.handleTelemetryTick(clientSessionA, packet);
      expect(result).toEqual({ accepted: true });
      expect(simulatorService.recordTelemetry).toHaveBeenCalledWith(packet, trainerUser);
      expect(mockServer.emit).toHaveBeenCalledWith('sim:telemetry_tick', packet);
    });
  });

  describe('timer lifecycle and abort contracts (CR-022 / R-4)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('Scenario 1: reconnect before 15s cancels disconnect abort timer and preserves running session', async () => {
      const sessionId = 'sess-timer-1';
      const mockClient: any = {
        id: 'client-1',
        data: {
          session: { id: sessionId, status: 'RUNNING' },
        },
      };
      simulatorService.getActiveSession.mockReturnValue({
        sessionId,
        status: 'RUNNING',
      });

      gateway.handleDisconnect(mockClient);

      expect((gateway as any).disconnectTimers.has(sessionId)).toBe(true);

      // Advance 10s (< 15s)
      jest.advanceTimersByTime(10000);

      // Client reconnects within grace period
      const reconnectClient: any = {
        id: 'client-2',
        handshake: { auth: { sessionId } },
        disconnect: jest.fn(),
        data: {},
      };
      prismaService.simulatorSession.findUnique.mockResolvedValue({
        id: sessionId,
        type: 'WORKOUT',
        status: 'RUNNING',
        actorUserId: 'trainer-1',
        createdAt: new Date(),
      });
      prismaService.user.findUnique.mockResolvedValue({
        id: 'trainer-1',
        role: Role.HEAD_TRAINER,
        status: 'ACTIVE',
        email: 'trainer@eq.com',
      });

      await gateway.handleConnection(reconnectClient);

      expect(reconnectClient.disconnect).not.toHaveBeenCalled();
      expect((gateway as any).disconnectTimers.has(sessionId)).toBe(false);

      // Advance past the original 15s mark
      jest.advanceTimersByTime(10000);
      await Promise.resolve();

      expect(simulatorService.abortSession).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalledWith('sim:session_finished', expect.anything());
    });

    it('Scenario 2: 15s disconnect expiry aborts running session once and emits single broadcast', async () => {
      const sessionId = 'sess-timer-2';
      const mockClient: any = {
        id: 'client-disconnect-2',
        data: {
          session: { id: sessionId, status: 'RUNNING' },
        },
      };
      simulatorService.getActiveSession.mockReturnValue({
        sessionId,
        status: 'RUNNING',
      });
      simulatorService.abortSession.mockResolvedValue({
        session: { id: sessionId, type: 'WORKOUT', status: 'ABORTED_INJURY' },
        transitioned: true,
      });

      gateway.handleDisconnect(mockClient);

      expect((gateway as any).disconnectTimers.has(sessionId)).toBe(true);

      // Advance 15s
      jest.advanceTimersByTime(15000);
      await Promise.resolve();

      expect(simulatorService.abortSession).toHaveBeenCalledTimes(1);
      expect(simulatorService.abortSession).toHaveBeenCalledWith(
        sessionId,
        'DISCONNECT_TIMEOUT_15S',
      );
      expect(mockServer.emit).toHaveBeenCalledTimes(1);
      expect(mockServer.emit).toHaveBeenCalledWith('sim:session_finished', {
        event: 'sim:session_finished',
        session_id: sessionId,
        type: 'WORKOUT',
        status: 'ABORTED_INJURY',
        result: { reason: 'DISCONNECT_TIMEOUT_15S' },
      });
      expect((gateway as any).disconnectTimers.has(sessionId)).toBe(false);
    });

    it('Scenario 3: normal finish cancels disconnect timer and 5m watchdog timer', async () => {
      const sessionId = 'sess-timer-3';
      const dummyTimer1 = setTimeout(() => {}, 10000);
      const dummyTimer2 = setTimeout(() => {}, 300000);
      (gateway as any).disconnectTimers.set(sessionId, dummyTimer1);
      (gateway as any).sessionTimeouts.set(sessionId, dummyTimer2);

      const client: any = {
        data: {
          user: { userId: 'trainer-1', role: Role.HEAD_TRAINER },
          session: {
            id: sessionId,
            type: SimulatorSessionType.WORKOUT,
            horseIds: ['horse-1'],
          },
        },
      };

      const packet: any = {
        event: 'sim:session_finished',
        session_id: sessionId,
        type: 'WORKOUT',
        status: 'COMPLETED',
        horse: { horse_id: 'horse-1' },
        result: { distanceCompletedM: 1800 },
      };

      simulatorService.recordFinished.mockResolvedValue({
        session: {
          id: sessionId,
          status: 'COMPLETED',
        },
        transitioned: true,
      });

      const res = await gateway.handleSessionFinished(client, packet);

      expect(res).toEqual({ accepted: true, id: sessionId });
      expect((gateway as any).disconnectTimers.has(sessionId)).toBe(false);
      expect((gateway as any).sessionTimeouts.has(sessionId)).toBe(false);

      // Advance past both timers
      jest.advanceTimersByTime(400000);
      await Promise.resolve();

      expect(simulatorService.abortSession).not.toHaveBeenCalled();
    });

    it('Scenario 4: 5m watchdog aborts running session once after 300,000ms from 1st tick', async () => {
      const sessionId = 'sess-timer-4';
      const client: any = {
        data: {
          user: { userId: 'trainer-1', role: Role.HEAD_TRAINER },
          session: {
            id: sessionId,
            type: SimulatorSessionType.WORKOUT,
            horseIds: ['horse-1'],
          },
        },
      };

      const packet: any = {
        event: 'sim:telemetry_tick',
        session_id: sessionId,
        timestamp_ms: 1729520000000,
        sim_time_s: 1.0,
        sim_speed_multiplier: 1.0,
        horse: { horse_id: 'horse-1' },
        track: {
          surface: 'GRASS',
          target_distance_m: 1200,
          covered_distance_m: 10,
          track_condition: 'GOOD',
          obstacles_cleared: 0,
          obstacles_total: 0,
        },
        metrics: {
          velocity_mps: 15.0,
          heart_rate_bpm: 120,
          stamina_pct: 99.0,
          body_temp_c: 38.0,
          stride_length_m: 6.0,
          stride_freq_spm: 130,
          calories_kcal: 20,
        },
        alerts: { overload_warning: false, limp_detected: false, heat_stress: false },
      };

      simulatorService.recordTelemetry.mockResolvedValue({ sessionId });
      simulatorService.abortSession.mockResolvedValue({
        session: { id: sessionId, type: 'WORKOUT', status: 'ABORTED_INJURY' },
        transitioned: true,
      });

      await gateway.handleTelemetryTick(client, packet);

      expect((gateway as any).sessionTimeouts.has(sessionId)).toBe(true);

      // Advance 299,000 ms - should not fire yet
      jest.advanceTimersByTime(299000);
      await Promise.resolve();
      expect(simulatorService.abortSession).not.toHaveBeenCalled();

      // Advance remaining 1,000 ms to reach 300,000 ms
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(simulatorService.abortSession).toHaveBeenCalledTimes(1);
      expect(simulatorService.abortSession).toHaveBeenCalledWith(sessionId, 'SESSION_TIMEOUT_5M');
      expect(mockServer.emit).toHaveBeenCalledWith('sim:session_finished', {
        event: 'sim:session_finished',
        session_id: sessionId,
        type: 'WORKOUT',
        status: 'ABORTED_INJURY',
        result: { reason: 'SESSION_TIMEOUT_5M' },
      });
      expect((gateway as any).sessionTimeouts.has(sessionId)).toBe(false);
    });

    it('Scenario 5: duplicate timer triggers do not duplicate persistence or broadcast', async () => {
      const sessionId = 'sess-timer-5';

      simulatorService.abortSession
        .mockResolvedValueOnce({
          session: { id: sessionId, type: 'WORKOUT', status: 'ABORTED_INJURY' },
          transitioned: true,
        })
        .mockResolvedValueOnce({
          session: { id: sessionId, type: 'WORKOUT', status: 'ABORTED_INJURY' },
          transitioned: false,
        });

      // Call abortDueToDisconnect twice
      await (gateway as any).abortDueToDisconnect(sessionId);
      await (gateway as any).abortDueToDisconnect(sessionId);

      expect(mockServer.emit).toHaveBeenCalledTimes(1);
      expect(mockServer.emit).toHaveBeenCalledWith('sim:session_finished', {
        event: 'sim:session_finished',
        session_id: sessionId,
        type: 'WORKOUT',
        status: 'ABORTED_INJURY',
        result: { reason: 'DISCONNECT_TIMEOUT_15S' },
      });
    });

    it('Scenario 6: completed session cannot be overwritten by delayed abort and broadcast is suppressed', async () => {
      const sessionId = 'sess-timer-6';

      simulatorService.abortSession.mockResolvedValue({
        session: { id: sessionId, type: 'WORKOUT', status: 'COMPLETED' },
        transitioned: false,
      });

      await (gateway as any).abortDueToDisconnect(sessionId);

      expect(mockServer.emit).not.toHaveBeenCalledWith('sim:session_finished', expect.anything());
    });

    it('Scenario 6b: aborted session suppresses duplicate broadcast from delayed finish packet', async () => {
      const sessionId = 'sess-timer-6b';
      const client = {
        id: 'client-6b',
        data: {
          user: { userId: 'trainer-1', role: Role.HEAD_TRAINER },
          session: {
            id: sessionId,
            type: 'WORKOUT',
            status: 'RUNNING',
            actorUserId: 'trainer-1',
            horseIds: ['horse-1'],
          },
        },
      } as any;

      simulatorService.recordFinished.mockResolvedValue({
        session: { id: sessionId, type: 'WORKOUT', status: 'ABORTED_INJURY' },
        transitioned: false,
      });

      const finishPacket: any = {
        event: 'sim:session_finished',
        session_id: sessionId,
        type: 'WORKOUT',
        status: 'COMPLETED',
        horse: { horse_id: 'horse-1' },
        result: { distanceCompletedM: 1800 },
      };

      const ack = await gateway.handleSessionFinished(client, finishPacket);
      expect(ack).toEqual({ accepted: true, id: sessionId });

      expect(mockServer.emit).not.toHaveBeenCalledWith('sim:session_finished', expect.anything());
    });

    it('Scenario 7: onModuleDestroy cleanly clears all active timers', async () => {
      const timer1 = setTimeout(() => {}, 15000);
      const timer2 = setTimeout(() => {}, 300000);
      (gateway as any).disconnectTimers.set('sess-7a', timer1);
      (gateway as any).sessionTimeouts.set('sess-7b', timer2);

      expect((gateway as any).disconnectTimers.size).toBe(1);
      expect((gateway as any).sessionTimeouts.size).toBe(1);

      gateway.onModuleDestroy();

      expect((gateway as any).disconnectTimers.size).toBe(0);
      expect((gateway as any).sessionTimeouts.size).toBe(0);

      // Advance time by 1,000,000 ms to confirm no lingering timer callbacks fire
      jest.advanceTimersByTime(1000000);
      await Promise.resolve();

      expect(simulatorService.abortSession).not.toHaveBeenCalled();
    });
  });
});
