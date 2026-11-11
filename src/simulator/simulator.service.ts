import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import {
  RaceProgressPacketDto,
  SessionFinishedPacketDto,
  TelemetryTickPacketDto,
} from './dto/simulator-packet.dto';
import {
  AnySimulationContext,
  ExamSimulationResultResponse,
  LiveSimulatorSession,
  SimulatorSessionsResponse,
  WorkoutSimulationResultResponse,
  WorkoutSimulationStartResponse,
} from './simulator.types';
import { ExamFinishedPacketDto } from './dto/exam-packet.dto';
import {
  HorseStatus,
  SimulatorSession,
  SimulatorSessionStatus,
  SimulatorSessionType,
  WorkoutStatus,
} from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';
import { UserRole } from '../common/enums/role.enum';
import { allowEarlyWorkoutStart, isHeavy } from '../training/training-rules';

@Injectable()
export class SimulatorService {
  private readonly logger = new Logger(SimulatorService.name);
  private readonly active = new Map<string, LiveSimulatorSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async startWorkout(
    workoutId: string,
    actor: CurrentUserPayload,
  ): Promise<WorkoutSimulationStartResponse> {
    if (actor.role !== UserRole.HEAD_TRAINER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_TRAINER_REQUIRED',
        'Only the assigned head trainer can start this simulation.',
      );
    }

    const session = await this.prisma.$transaction(async (tx) => {
      const workout = await tx.workoutSession.findUnique({
        where: { id: workoutId },
        include: {
          trainingPlan: { select: { id: true, trainerUserId: true } },
          horse: {
            select: {
              id: true,
              horseCode: true,
              name: true,
              microchipRfid: true,
              breed: true,
              dob: true,
              gender: true,
              color: true,
              status: true,
              isMedicalLocked: true,
              medicalLocks: { where: { isLocked: true }, take: 1, select: { id: true } },
            },
          },
        },
      });
      if (!workout) {
        throw apiError(HttpStatus.NOT_FOUND, 'WORKOUT_NOT_FOUND', 'Workout session not found.');
      }
      if (workout.trainingPlan.trainerUserId !== actor.userId) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'WORKOUT_NOT_ASSIGNED',
          'This workout belongs to another trainer.',
        );
      }
      if (workout.status !== WorkoutStatus.SCHEDULED) {
        throw apiError(
          HttpStatus.CONFLICT,
          'WORKOUT_NOT_SIMULATABLE',
          'Only scheduled workouts can be simulated.',
        );
      }
      if (workout.scheduledDate > new Date() && !allowEarlyWorkoutStart()) {
        throw apiError(
          HttpStatus.CONFLICT,
          'WORKOUT_NOT_STARTED',
          'The workout has not reached its scheduled start time.',
        );
      }
      if (workout.horse.status === HorseStatus.RETIRED) {
        throw apiError(HttpStatus.BAD_REQUEST, 'HORSE_RETIRED', 'Ngựa đã ngừng quản lý.');
      }
      const locked = workout.horse.isMedicalLocked || workout.horse.medicalLocks.length > 0;
      if (locked && isHeavy(workout.workoutType ?? '', workout.intensity ?? '')) {
        throw apiError(
          HttpStatus.CONFLICT,
          'MEDICAL_LOCK_ACTIVE',
          'A medical lock prevents this high-intensity workout.',
        );
      }

      const existing = await tx.simulatorSession.findUnique({
        where: { workoutSessionId: workout.id },
      });

      if (
        existing &&
        (existing.status === SimulatorSessionStatus.COMPLETED ||
          existing.status === SimulatorSessionStatus.ABORTED_INJURY)
      ) {
        throw apiError(
          HttpStatus.CONFLICT,
          'SIMULATOR_SESSION_FINISHED',
          'This workout session has already been simulated and finished.',
        );
      }

      if (existing && existing.status === SimulatorSessionStatus.PENDING) {
        const isExpired = Date.now() - new Date(existing.createdAt).getTime() > 5 * 60 * 1000;
        if (isExpired) {
          await tx.simulatorSession.delete({ where: { id: existing.id } });
          return tx.simulatorSession.create({
            data: {
              id: randomUUID(),
              type: SimulatorSessionType.WORKOUT,
              status: SimulatorSessionStatus.PENDING,
              workoutSessionId: workout.id,
              horseIds: [workout.horse.id],
              actorUserId: actor.userId,
            },
          });
        }
      }

      return tx.simulatorSession.upsert({
        where: { workoutSessionId: workout.id },
        update: {},
        create: {
          id: randomUUID(),
          type: SimulatorSessionType.WORKOUT,
          status: SimulatorSessionStatus.PENDING,
          workoutSessionId: workout.id,
          horseIds: [workout.horse.id],
          actorUserId: actor.userId,
        },
      });
    });

    const baseUrl = this.config
      .get<string>('SIMULATOR_URL', 'http://localhost:5175')
      .replace(/\/$/, '');
    return {
      sessionId: session.id,
      status: session.status,
      launchUrl: `${baseUrl}/?sessionId=${encodeURIComponent(session.id)}`,
    };
  }

  async startExam(
    horseId: string,
    medicalRecordId: string | undefined,
    actor: CurrentUserPayload,
  ): Promise<WorkoutSimulationStartResponse> {
    if (actor.role !== UserRole.VETERINARIAN) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_VET_REQUIRED',
        'Only a veterinarian can start an examination simulation.',
      );
    }

    const session = await this.prisma.$transaction(async (tx) => {
      const horse = await tx.horse.findUnique({ where: { id: horseId, deletedAt: null } });
      if (!horse) throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Horse not found.');

      if (medicalRecordId) {
        const record = await tx.medicalRecord.findUnique({ where: { id: medicalRecordId } });
        if (!record || record.horseId !== horseId) {
          throw apiError(
            HttpStatus.CONFLICT,
            'MEDICAL_RECORD_HORSE_MISMATCH',
            'Medical record does not belong to this horse.',
          );
        }
      }

      const existing = await tx.simulatorSession.findFirst({
        where: {
          type: SimulatorSessionType.EXAM,
          actorUserId: actor.userId,
          horseIds: { has: horseId },
          status: { in: [SimulatorSessionStatus.PENDING, SimulatorSessionStatus.RUNNING] },
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (existing) {
        if (existing.status === SimulatorSessionStatus.PENDING) {
          const isExpired = Date.now() - new Date(existing.createdAt).getTime() > 5 * 60 * 1000;
          if (isExpired) {
            await tx.simulatorSession.delete({ where: { id: existing.id } });
            return tx.simulatorSession.create({
              data: {
                id: randomUUID(),
                type: SimulatorSessionType.EXAM,
                status: SimulatorSessionStatus.PENDING,
                horseIds: [horseId],
                actorUserId: actor.userId,
                medicalRecordId,
              },
            });
          }
        }
        return existing;
      }

      return tx.simulatorSession.create({
        data: {
          id: randomUUID(),
          type: SimulatorSessionType.EXAM,
          status: SimulatorSessionStatus.PENDING,
          horseIds: [horseId],
          actorUserId: actor.userId,
          medicalRecordId,
        },
      });
    });

    const baseUrl = this.config
      .get<string>('SIMULATOR_URL', 'http://localhost:5175')
      .replace(/\/$/, '');
    return {
      sessionId: session.id,
      status: session.status,
      launchUrl: `${baseUrl}/?sessionId=${encodeURIComponent(session.id)}&type=EXAM`,
    };
  }

  async startTournamentRace(tournamentId: string, actor: CurrentUserPayload) {
    if (actor.role !== UserRole.HEAD_TRAINER && actor.role !== UserRole.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_ROLE_FORBIDDEN',
        'Only Head Trainer or Club Manager can start tournament race simulation.',
      );
    }

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        registrations: {
          where: {
            status: { in: ['CONFIRMED', 'REGISTERED'] },
          },
          include: {
            horse: {
              select: {
                id: true,
                name: true,
                horseCode: true,
                breed: true,
                status: true,
                color: true,
                weightKg: true,
                dob: true,
                isMedicalLocked: true,
                isDebtImpounded: true,
              },
            },
          },
          orderBy: { registrationDate: 'asc' },
        },
      },
    });

    if (!tournament) {
      throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Tournament not found.');
    }

    if (tournament.status === 'COMPLETED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TOURNAMENT_COMPLETED',
        'Tournament already completed.',
      );
    }

    const activeEntries = tournament.registrations.filter(
      (r) => !r.horse.isMedicalLocked && !r.horse.isDebtImpounded,
    );

    if (activeEntries.length === 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'NO_ELIGIBLE_ENTRIES',
        'No eligible horses registered for this tournament.',
      );
    }

    const horseIds = activeEntries.map((r) => r.horse.id);

    const session = await this.prisma.$transaction(async (tx) => {
      const pendingSessions = await tx.simulatorSession.findMany({
        where: {
          type: SimulatorSessionType.RACE,
          actorUserId: actor.userId,
          status: SimulatorSessionStatus.PENDING,
        },
        orderBy: { updatedAt: 'desc' },
      });
      const existing = pendingSessions.find(
        (s) => (s.lastSnapshot as any)?.tournamentId === tournament.id,
      );

      const snapshot = {
        tournamentId: tournament.id,
        tournamentName: tournament.name,
        distanceMeters: tournament.distanceMeters,
        trackType: tournament.trackType,
        prizePool: Number(tournament.prizePool || 0),
      };

      const now = new Date();
      if (existing) {
        return tx.simulatorSession.update({
          where: { id: existing.id },
          data: {
            horseIds,
            status: SimulatorSessionStatus.PENDING,
            lastSnapshot: snapshot,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      return tx.simulatorSession.create({
        data: {
          id: randomUUID(),
          type: SimulatorSessionType.RACE,
          status: SimulatorSessionStatus.PENDING,
          horseIds,
          actorUserId: actor.userId,
          lastSnapshot: snapshot,
        },
      });
    });

    const baseUrl = this.config
      .get<string>('SIMULATOR_URL', 'http://localhost:5175')
      .replace(/\/$/, '');

    return {
      sessionId: session.id,
      status: session.status,
      launchUrl: `${baseUrl}/?sessionId=${encodeURIComponent(session.id)}&type=RACE&tournamentId=${encodeURIComponent(tournament.id)}`,
      tournament: {
        id: tournament.id,
        name: tournament.name,
        distanceMeters: tournament.distanceMeters,
        trackType: tournament.trackType,
      },
      entries: activeEntries.map((r, i) => ({
        lane: i + 1,
        registrationId: r.id,
        horse: r.horse,
      })),
    };
  }

  async quickSimulateTournamentRace(tournamentId: string, actor: CurrentUserPayload) {
    if (actor.role !== UserRole.HEAD_TRAINER && actor.role !== UserRole.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_ROLE_FORBIDDEN',
        'Only Head Trainer or Club Manager can run tournament race quick simulation.',
      );
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        registrations: {
          where: {
            status: { in: ['CONFIRMED', 'REGISTERED'] },
          },
          include: {
            horse: {
              select: {
                id: true,
                name: true,
                horseCode: true,
                breed: true,
                status: true,
                color: true,
                weightKg: true,
                dob: true,
                isMedicalLocked: true,
                isDebtImpounded: true,
                workoutSessions: {
                  where: {
                    status: 'COMPLETED',
                    scheduledDate: { gte: thirtyDaysAgo },
                  },
                  select: {
                    distanceMeters: true,
                    actualTimeSeconds: true,
                    targetSpeedKmh: true,
                    performanceScore: true,
                    heartRatePeak: true,
                  },
                  orderBy: { scheduledDate: 'desc' },
                  take: 15,
                },
              },
            },
          },
          orderBy: { registrationDate: 'asc' },
        },
      },
    });

    if (!tournament) {
      throw apiError(HttpStatus.NOT_FOUND, 'TOURNAMENT_NOT_FOUND', 'Tournament not found.');
    }

    if (tournament.status === 'COMPLETED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TOURNAMENT_COMPLETED',
        'Tournament already completed.',
      );
    }

    const activeEntries = tournament.registrations.filter(
      (r) => !r.horse.isMedicalLocked && !r.horse.isDebtImpounded,
    );

    if (activeEntries.length === 0) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'NO_ELIGIBLE_ENTRIES',
        'No eligible horses registered for this tournament.',
      );
    }

    const distanceMeters = Math.max(400, Number(tournament.distanceMeters || 1600));
    const prizePool = Number(tournament.prizePool || 0);
    const surfaceFactor = tournament.trackType === 'DIRT' ? 0.985 : 1.0;

    // Tính toán tốc độ thực tế từ lịch sử tập luyện 30 ngày gần nhất của từng chiến mã
    const rawRunners = activeEntries.map((reg, index) => {
      const workouts = reg.horse.workoutSessions || [];
      let baseSpeedKmh = 56.8;

      if (workouts.length > 0) {
        const speeds: number[] = [];
        let scoreSum = 0;
        let scoreCount = 0;

        for (const w of workouts) {
          if (w.actualTimeSeconds && w.actualTimeSeconds > 0 && w.distanceMeters > 0) {
            const sp = (w.distanceMeters / w.actualTimeSeconds) * 3.6;
            if (sp >= 35 && sp <= 70) speeds.push(sp);
          } else if (w.targetSpeedKmh && w.targetSpeedKmh >= 35 && w.targetSpeedKmh <= 70) {
            speeds.push(w.targetSpeedKmh);
          }
          if (typeof w.performanceScore === 'number') {
            scoreSum += w.performanceScore;
            scoreCount++;
          }
        }

        if (speeds.length > 0) {
          const avgWorkoutSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
          // Trong giải đua chính thức, ngựa bung sức nhanh hơn buổi tập thông thường ~12-18%
          baseSpeedKmh = Math.min(61.8, Math.max(54.2, avgWorkoutSpeed * 1.14));
        }

        const avgScore = scoreCount > 0 ? scoreSum / scoreCount : 8.0;
        const fitnessBonus = Math.min(1.6, workouts.length * 0.08) + (avgScore - 7.5) * 0.35;
        baseSpeedKmh += fitnessBonus;
      }

      // Dao động ngẫu nhiên nhỏ trong ngày thi đấu (-0.85 .. +0.85 km/h) để tạo kịch tính thực tế
      const raceDayVariance = (Math.random() - 0.48) * 1.7;
      const effectiveSpeedKmh = Math.min(
        63.2,
        Math.max(53.0, (baseSpeedKmh + raceDayVariance) * surfaceFactor),
      );
      const rawFinishTime = distanceMeters / (effectiveSpeedKmh / 3.6);

      return {
        lane: index + 1,
        registrationId: reg.id,
        horseId: reg.horse.id,
        horseName: reg.horse.name,
        horseCode: reg.horse.horseCode,
        workoutCount30d: workouts.length,
        rawFinishTime,
      };
    });

    // Xếp hạng theo thời gian về đích tăng dần, đảm bảo không trùng khít hoàn toàn thời gian (cách nhau tối thiểu 0.08s)
    rawRunners.sort((a, b) => a.rawFinishTime - b.rawFinishTime);
    for (let i = 1; i < rawRunners.length; i++) {
      if (rawRunners[i].rawFinishTime <= rawRunners[i - 1].rawFinishTime + 0.07) {
        rawRunners[i].rawFinishTime = rawRunners[i - 1].rawFinishTime + 0.12;
      }
    }

    const capturedAt = new Date().toISOString();
    const computedResults = rawRunners.map((runner, idx) => {
      const finalRank = idx + 1;
      const finishTimeSeconds = Math.round(runner.rawFinishTime * 100) / 100;
      const avgSpeedKmh = Math.round((distanceMeters / finishTimeSeconds) * 3.6 * 100) / 100;
      let prizeShare = 0;
      if (finalRank === 1) prizeShare = 0.5;
      else if (finalRank === 2) prizeShare = 0.3;
      else if (finalRank === 3) prizeShare = 0.2;
      const prizeMoneyWon = Math.round(prizePool * prizeShare);
      const peakHr = Math.min(208, Math.max(176, Math.round(182 + avgSpeedKmh * 0.32 - idx * 1.2)));

      return {
        registrationId: runner.registrationId,
        horseId: runner.horseId,
        horseName: runner.horseName,
        horseCode: runner.horseCode,
        lane: runner.lane,
        finalRank,
        finishTimeSeconds,
        avgSpeedKmh,
        prizeMoneyWon,
        peakHeartRateBpm: peakHr,
        officialNotes: `TMEC Simulator (Đo nhanh) · Làn ${runner.lane} · Nhịp tim đỉnh ${peakHr} bpm`,
      };
    });

    const horseIds = computedResults.map((r) => r.horseId);

    const session = await this.prisma.$transaction(async (tx) => {
      for (const item of computedResults) {
        await tx.tournamentResult.upsert({
          where: { registrationId: item.registrationId },
          create: {
            registrationId: item.registrationId,
            finalRank: item.finalRank,
            finishTimeSeconds: item.finishTimeSeconds,
            avgSpeedKmh: item.avgSpeedKmh,
            prizeMoneyWon: item.prizeMoneyWon,
            officialNotes: item.officialNotes,
          },
          update: {
            finalRank: item.finalRank,
            finishTimeSeconds: item.finishTimeSeconds,
            avgSpeedKmh: item.avgSpeedKmh,
            prizeMoneyWon: item.prizeMoneyWon,
            officialNotes: item.officialNotes,
          },
        });
      }

      return tx.simulatorSession.create({
        data: {
          id: randomUUID(),
          type: SimulatorSessionType.RACE,
          status: SimulatorSessionStatus.COMPLETED,
          horseIds,
          actorUserId: actor.userId,
          startedAt: new Date(),
          finishedAt: new Date(),
          lastSnapshot: {
            tournamentId: tournament.id,
            tournamentName: tournament.name,
            distanceMeters,
            trackType: tournament.trackType,
            prizePool,
            mode: 'QUICK_READING',
          },
          result: {
            modelVersion: 'TMEC-QuickSim-v3',
            capturedAt,
            surface: tournament.trackType === 'DIRT' ? 'DIRT' : 'GRASS',
            distance_m: distanceMeters,
            results: computedResults.map((r) => ({
              final_rank: r.finalRank,
              lane: r.lane,
              horse_id: r.horseId,
              status: 'FINISHED',
              finish_time_s: r.finishTimeSeconds,
              avg_speed_kmh: r.avgSpeedKmh,
              prize_money_won: r.prizeMoneyWon,
              peak_heart_rate_bpm: r.peakHeartRateBpm,
            })),
          } as any,
        },
      });
    });

    return {
      sessionId: session.id,
      status: session.status,
      source: `TMEC Simulator (Đo nhanh) · ${new Date(capturedAt).toLocaleTimeString('vi-VN')}`,
      capturedAt,
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      distanceMeters,
      prizePool,
      results: computedResults,
    };
  }

  async getHorsesForSimulator() {
    const horses = await this.prisma.horse.findMany({
      where: { deletedAt: null },
      select: {
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
        stallAllocations: {
          where: { isActive: true },
          select: {
            id: true,
            stall: { select: { id: true, code: true, zone: true } },
          },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
    return horses.map((h) => ({
      ...h,
      stallCode: h.stallAllocations[0]?.stall?.code || null,
      zone: h.stallAllocations[0]?.stall?.zone || null,
    }));
  }

  /** Sơ đồ chuồng thật cho Simulator (chỉ đọc): khu đang dùng + ô + ngựa/groom đang ở. */
  async getStallMapForSimulator() {
    const zones = await this.prisma.stallZone.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        rows: true,
        cols: true,
        sortOrder: true,
        stalls: {
          orderBy: { code: 'asc' },
          select: {
            id: true,
            code: true,
            row: true,
            col: true,
            status: true,
            notes: true,
            allocations: {
              where: { isActive: true },
              take: 1,
              select: {
                horse: { select: { id: true, name: true } },
                assignedGroom: { select: { fullName: true } },
              },
            },
          },
        },
      },
    });
    return zones.map(({ stalls, ...zone }) => ({
      ...zone,
      stalls: stalls.map(({ allocations, ...st }) => ({
        ...st,
        zoneCode: zone.code,
        horseId: allocations[0]?.horse.id ?? null,
        horseName: allocations[0]?.horse.name ?? null,
        assignedGroomName: allocations[0]?.assignedGroom?.fullName ?? null,
      })),
    }));
  }

  /**
   * Nhân sự đang làm việc cho Simulator (chỉ đọc). Endpoint công khai nên chỉ trả tên + vai trò,
   * ca trực hôm nay và ngựa phụ trách; không trả email, số điện thoại, trạng thái tài khoản.
   */
  async getStaffForSimulator() {
    // Ngày hôm nay theo giờ câu lạc bộ (UTC+7); ShiftRoster.date là cột @db.Date.
    const clubToday = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        role: { in: ['CLUB_MANAGER', 'HEAD_TRAINER', 'VETERINARIAN', 'GROOM'] },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      select: {
        id: true,
        fullName: true,
        role: true,
        stallAllocations: {
          where: { isActive: true },
          select: { horse: { select: { id: true, name: true } } },
        },
        shiftRosters: {
          where: { date: new Date(`${clubToday}T00:00:00.000Z`) },
          orderBy: { shift: { sortOrder: 'asc' } },
          select: {
            shift: { select: { name: true, startTime: true, endTime: true } },
            zone: { select: { code: true, name: true } },
          },
        },
      },
    });
    return users.map(({ stallAllocations, shiftRosters, ...u }) => ({
      ...u,
      horses: stallAllocations.map((a) => a.horse),
      shiftsToday: shiftRosters.map((r) => ({
        name: r.shift.name,
        startTime: r.shift.startTime,
        endTime: r.shift.endTime,
        zoneCode: r.zone.code,
        zoneName: r.zone.name,
      })),
    }));
  }

  private maskMicrochip(chip?: string | null): string {
    if (!chip) return '';
    if (chip.length <= 4) return '****';
    return '*'.repeat(chip.length - 4) + chip.slice(-4);
  }

  async getContext(
    sessionId: string,
    actor?: CurrentUserPayload | null,
  ): Promise<AnySimulationContext> {
    const session = await this.prisma.simulatorSession.findUnique({
      where: { id: sessionId },
      include: {
        workoutSession: {
          include: {
            horse: {
              include: {
                stallAllocations: {
                  where: { isActive: true },
                  include: { stall: true, assignedGroom: true },
                  take: 1,
                },
              },
            },
            trainingPlan: { select: { trainerUserId: true } },
          },
        },
      },
    });
    if (!session) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'SIMULATOR_SESSION_NOT_FOUND',
        'Simulation session not found.',
      );
    }

    if (
      session.status === SimulatorSessionStatus.COMPLETED ||
      session.status === SimulatorSessionStatus.ABORTED_INJURY
    ) {
      throw apiError(
        HttpStatus.CONFLICT,
        'SIMULATOR_SESSION_FINISHED',
        'Simulation session has already finished.',
      );
    }

    if (
      session.status === SimulatorSessionStatus.PENDING &&
      Date.now() - new Date(session.createdAt).getTime() > 5 * 60 * 1000
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'SIMULATOR_SESSION_EXPIRED',
        'Simulation session launch window has expired.',
      );
    }

    if (
      session.status !== SimulatorSessionStatus.PENDING &&
      session.status !== SimulatorSessionStatus.RUNNING
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'SIMULATOR_SESSION_INVALID',
        'Simulation session is not eligible.',
      );
    }

    // R-2: Bind REST context to the persisted SimulatorSession actor from PostgreSQL
    const sessionActor = await this.prisma.user.findUnique({
      where: { id: session.actorUserId },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!sessionActor || sessionActor.status !== 'ACTIVE') {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_SESSION_FORBIDDEN',
        'Session actor is invalid or inactive.',
      );
    }

    // Caller check: an arbitrary JWT cannot override or hijack another actor's session (except CM cross-role observation)
    if (actor && actor.userId !== session.actorUserId && actor.role !== UserRole.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_SESSION_FORBIDDEN',
        'This simulation session belongs to another user.',
      );
    }

    if (session.type === SimulatorSessionType.EXAM) {
      const horse = await this.prisma.horse.findUnique({
        where: { id: session.horseIds[0] },
        include: {
          stallAllocations: {
            where: { isActive: true },
            include: { stall: true, assignedGroom: true },
            take: 1,
          },
        },
      });
      if (!horse) {
        throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Horse not found.');
      }

      const activeStall = horse.stallAllocations?.[0];
      const activeStallCode = activeStall?.stall?.code ?? null;
      let isGroom = false;

      if (sessionActor.role === UserRole.GROOM) {
        if (!activeStall || activeStall.assignedGroomUserId !== sessionActor.id) {
          throw apiError(
            HttpStatus.FORBIDDEN,
            'SIMULATOR_SESSION_FORBIDDEN',
            'You are not assigned to groom this horse.',
          );
        }
        isGroom = true;
      } else if (sessionActor.role === UserRole.VETERINARIAN) {
        isGroom = false;
      } else if (sessionActor.role === UserRole.CLUB_MANAGER) {
        isGroom = false;
      } else {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'SIMULATOR_SESSION_FORBIDDEN',
          'Access to this examination simulation is not permitted for your role.',
        );
      }

      const rawChip = horse.microchipRfid || horse.microchip || '';
      const microchip = isGroom ? this.maskMicrochip(rawChip) : rawChip;

      return {
        type: 'EXAM',
        sessionId: session.id,
        status: session.status,
        medicalRecordId: session.medicalRecordId,
        horse: {
          id: horse.id,
          horseCode: horse.horseCode,
          name: horse.name,
          microchipRfid: microchip,
          breed: horse.breed,
          dob: horse.dob,
          gender: horse.gender,
          color: horse.color,
          status: horse.status,
          isMedicalLocked: horse.isMedicalLocked,
          weightKg: horse.weightKg ?? null,
          stall: activeStallCode,
        },
      };
    }

    if (session.type === SimulatorSessionType.RACE) {
      const snapshot = (session.lastSnapshot as any) || {};
      const tournamentId = snapshot.tournamentId;
      const tournament = tournamentId
        ? await this.prisma.tournament.findUnique({
            where: { id: tournamentId },
            include: {
              registrations: {
                where: { status: { in: ['CONFIRMED', 'REGISTERED'] } },
                include: {
                  horse: {
                    select: {
                      id: true,
                      name: true,
                      horseCode: true,
                      breed: true,
                      status: true,
                      color: true,
                      dob: true,
                      weightKg: true,
                      avatarUrl: true,
                    },
                  },
                },
                orderBy: { registrationDate: 'asc' },
              },
            },
          })
        : null;

      const entries = tournament
        ? tournament.registrations.map((r, i) => ({
            lane: i + 1,
            registrationId: r.id,
            horse: r.horse,
          }))
        : [];

      return {
        type: 'RACE',
        sessionId: session.id,
        status: session.status,
        tournamentId: tournament?.id || tournamentId,
        tournamentName: tournament?.name || snapshot.tournamentName || 'Giải đua mô phỏng',
        distanceMeters: tournament?.distanceMeters || snapshot.distanceMeters || 1600,
        trackType: tournament?.trackType || snapshot.trackType || 'TURF',
        surface: tournament?.trackType === 'DIRT' ? 'DIRT' : 'GRASS',
        entries,
        horse: (entries[0]?.horse as any) || ({} as any),
      };
    }

    const workout = session.workoutSession;
    if (!workout) {
      throw apiError(
        HttpStatus.CONFLICT,
        'SIMULATOR_CONTEXT_MISSING',
        'The simulation session is not linked to a workout.',
      );
    }

    const horse = workout.horse;
    const activeStall = horse.stallAllocations?.[0];
    const activeStallCode = activeStall?.stall?.code ?? null;
    let isGroom = false;

    if (sessionActor.role === UserRole.GROOM) {
      if (!activeStall || activeStall.assignedGroomUserId !== sessionActor.id) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'SIMULATOR_SESSION_FORBIDDEN',
          'You are not assigned to groom this horse.',
        );
      }
      isGroom = true;
    } else if (sessionActor.role === UserRole.HEAD_TRAINER) {
      if (workout.trainingPlan.trainerUserId !== sessionActor.id) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'SIMULATOR_SESSION_FORBIDDEN',
          'This simulation session belongs to another trainer.',
        );
      }
      isGroom = false;
    } else if (sessionActor.role === UserRole.CLUB_MANAGER) {
      isGroom = false;
    } else if (sessionActor.role === UserRole.HORSE_OWNER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_TRAINER_REQUIRED',
        'Only the assigned head trainer can open this simulation.',
      );
    } else {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_SESSION_FORBIDDEN',
        'Only the assigned head trainer can open this simulation.',
      );
    }

    const rawChip = horse.microchipRfid || horse.microchip || '';
    const microchip = isGroom ? this.maskMicrochip(rawChip) : rawChip;

    return {
      type: 'WORKOUT',
      sessionId: session.id,
      status: session.status,
      horse: {
        id: horse.id,
        horseCode: horse.horseCode,
        name: horse.name,
        microchipRfid: microchip,
        breed: horse.breed,
        dob: horse.dob,
        gender: horse.gender,
        color: horse.color,
        status: horse.status,
        isMedicalLocked: horse.isMedicalLocked,
        weightKg: horse.weightKg ?? null,
        stall: activeStallCode,
      },
      workout: {
        id: workout.id,
        scheduledDate: workout.scheduledDate,
        workoutType: workout.workoutType,
        intensity: workout.intensity,
        distanceMeters: workout.distanceMeters,
        repetitions: workout.repetitions,
        targetSpeedKmh: workout.targetSpeedKmh,
        targetDurationSeconds: workout.targetDurationSeconds,
        trackSurface: workout.trackSurface,
      },
    };
  }

  async recordExamFinished(
    dto: ExamFinishedPacketDto,
    actor: CurrentUserPayload,
  ): Promise<SimulatorSession> {
    if (actor.role !== UserRole.VETERINARIAN) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_VET_REQUIRED',
        'Only a veterinarian can publish examination measurements.',
      );
    }
    const issued = await this.requireIssuedSession(
      dto.session_id,
      SimulatorSessionType.EXAM,
      [dto.horse_id],
      actor,
      true,
    );
    if (issued.status === SimulatorSessionStatus.COMPLETED) return issued;

    return this.prisma.simulatorSession.update({
      where: { id: dto.session_id },
      data: {
        status: SimulatorSessionStatus.COMPLETED,
        finishedAt: new Date(),
        result: {
          capturedAt: dto.captured_at,
          modelVersion: dto.model_version,
          source: dto.source,
          metrics: dto.metrics,
        } as any,
      },
    });
  }

  async recordTelemetry(
    dto: TelemetryTickPacketDto,
    actor: CurrentUserPayload,
  ): Promise<LiveSimulatorSession> {
    const horseId = dto.horse?.horse_id;
    const horseIds = horseId ? [horseId] : [];
    const session = await this.requireIssuedSession(
      dto.session_id,
      SimulatorSessionType.WORKOUT,
      horseIds,
      actor,
    );
    const workout = session.workoutSession!;
    const locked = workout.horse.isMedicalLocked || workout.horse.medicalLocks.length > 0;
    if (
      session.status === SimulatorSessionStatus.PENDING &&
      locked &&
      isHeavy(workout.workoutType ?? '', workout.intensity ?? '')
    ) {
      throw apiError(
        HttpStatus.CONFLICT,
        'MEDICAL_LOCK_ACTIVE',
        'A medical lock prevents this high-intensity workout.',
      );
    }

    const live: LiveSimulatorSession = {
      sessionId: dto.session_id,
      type: SimulatorSessionType.WORKOUT,
      status: SimulatorSessionStatus.RUNNING,
      horseIds,
      actorUserId: actor.userId,
      startedAt: session.startedAt,
      finishedAt: null,
      lastSnapshot: dto,
      updatedAt: new Date(),
    };
    this.active.set(dto.session_id, live);

    await this.prisma.simulatorSession.update({
      where: { id: dto.session_id },
      data: {
        status: SimulatorSessionStatus.RUNNING,
        lastSnapshot: dto as any,
        updatedAt: new Date(),
      },
    });

    return live;
  }

  async recordRaceProgress(
    dto: RaceProgressPacketDto,
    actor: CurrentUserPayload,
  ): Promise<LiveSimulatorSession> {
    const horseIds = dto.positions?.map((p) => p.horse_id) || [];
    const session = await this.requireIssuedSession(
      dto.session_id,
      SimulatorSessionType.RACE,
      horseIds,
      actor,
    );

    const prevSnapshot =
      session.lastSnapshot &&
      typeof session.lastSnapshot === 'object' &&
      !Array.isArray(session.lastSnapshot)
        ? (session.lastSnapshot as Record<string, any>)
        : {};
    const mergedSnapshot = {
      ...(prevSnapshot.tournamentId
        ? {
            tournamentId: prevSnapshot.tournamentId,
            tournamentName: prevSnapshot.tournamentName,
            distanceMeters: prevSnapshot.distanceMeters,
            trackType: prevSnapshot.trackType,
            prizePool: prevSnapshot.prizePool,
          }
        : {}),
      ...dto,
    };

    const live: LiveSimulatorSession = {
      sessionId: dto.session_id,
      type: SimulatorSessionType.RACE,
      status: SimulatorSessionStatus.RUNNING,
      horseIds,
      actorUserId: actor.userId,
      startedAt: session.startedAt,
      finishedAt: null,
      lastSnapshot: mergedSnapshot,
      updatedAt: new Date(),
    };
    this.active.set(dto.session_id, live);

    await this.prisma.simulatorSession.update({
      where: { id: dto.session_id },
      data: {
        status: SimulatorSessionStatus.RUNNING,
        lastSnapshot: mergedSnapshot as any,
        updatedAt: new Date(),
      },
    });

    return live;
  }

  async recordFinished(
    dto: SessionFinishedPacketDto,
    actor: CurrentUserPayload,
  ): Promise<{ session: SimulatorSession | null; transitioned: boolean }> {
    const status =
      dto.status === 'ABORTED_INJURY'
        ? SimulatorSessionStatus.ABORTED_INJURY
        : SimulatorSessionStatus.COMPLETED;

    const horseIds =
      dto.type === 'WORKOUT' && dto.horse?.horse_id
        ? [dto.horse.horse_id]
        : dto.results?.map((r) => r.horse_id) || [];
    const issued = await this.requireIssuedSession(
      dto.session_id,
      dto.type === 'RACE' ? SimulatorSessionType.RACE : SimulatorSessionType.WORKOUT,
      horseIds,
      actor,
      true,
    );

    if (
      issued.status === SimulatorSessionStatus.COMPLETED ||
      issued.status === SimulatorSessionStatus.ABORTED_INJURY
    ) {
      this.active.delete(dto.session_id);
      return { session: issued, transitioned: false };
    }

    const finishedAt = new Date();
    const resultPayload =
      dto.type === 'WORKOUT'
        ? {
            ...(typeof dto.result === 'object' && dto.result ? dto.result : {}),
            surface: dto.surface,
          }
        : (dto.results ?? null);

    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.simulatorSession.updateMany({
        where: {
          id: dto.session_id,
          status: { in: [SimulatorSessionStatus.PENDING, SimulatorSessionStatus.RUNNING] },
        },
        data: {
          status,
          finishedAt,
          result: resultPayload as any,
          ...(horseIds.length > 0 ? { horseIds } : {}),
        },
      });

      this.active.delete(dto.session_id);

      // Tự động lưu kết quả giải đua khi nhận gói tin sim:session_finished của cuộc đua
      if (dto.type === 'RACE' && Array.isArray(dto.results) && dto.results.length > 0) {
        const snapshot = (issued.lastSnapshot as any) || {};
        const tournamentId = snapshot.tournamentId;
        const prizePool = Number(snapshot.prizePool || 0);
        const targetTournament =
          tournamentId && typeof tx.tournament?.findUnique === 'function'
            ? await tx.tournament.findUnique({
                where: { id: tournamentId },
                select: { status: true },
              })
            : null;
        if (tournamentId && targetTournament?.status !== 'COMPLETED') {
          for (let i = 0; i < dto.results.length; i++) {
            const r = dto.results[i];
            const horseId = r.horse_id;
            if (!horseId) continue;

            const reg = await tx.tournamentRegistration.findFirst({
              where: {
                tournamentId,
                horseId,
                status: { in: ['CONFIRMED', 'REGISTERED'] },
              },
            });

            if (reg) {
              const finalRank =
                typeof r.final_rank === 'number' ? r.final_rank : r.status === 'DNF' ? 99 : i + 1;
              const finishTimeSeconds = typeof r.finish_time_s === 'number' ? r.finish_time_s : 0;
              const avgSpeedKmh = typeof r.avg_speed_kmh === 'number' ? r.avg_speed_kmh : 0;
              let prizeShare = 0;
              if (r.status !== 'DNF') {
                if (finalRank === 1) prizeShare = 0.5;
                else if (finalRank === 2) prizeShare = 0.3;
                else if (finalRank === 3) prizeShare = 0.2;
              }
              const prizeMoneyWon = Math.round(prizePool * prizeShare);

              await tx.tournamentResult.upsert({
                where: { registrationId: reg.id },
                create: {
                  registrationId: reg.id,
                  finalRank,
                  finishTimeSeconds,
                  avgSpeedKmh,
                  prizeMoneyWon,
                  officialNotes:
                    r.status === 'DNF'
                      ? 'DNF - Dừng thi đấu do sự cố trên đường đua'
                      : 'Ghi nhận từ mô phỏng 2D chính thức',
                },
                update: {
                  finalRank,
                  finishTimeSeconds,
                  avgSpeedKmh,
                  prizeMoneyWon,
                  officialNotes:
                    r.status === 'DNF'
                      ? 'DNF - Dừng thi đấu do sự cố trên đường đua'
                      : 'Ghi nhận từ mô phỏng 2D chính thức',
                },
              });
            }
          }
        }
      }

      const session = await tx.simulatorSession.findUnique({
        where: { id: dto.session_id },
      });

      return {
        session,
        transitioned: updateResult.count > 0,
      };
    });
  }

  async abortSession(
    sessionId: string,
    reason = 'ABORTED',
  ): Promise<{ session: SimulatorSession | null; transitioned: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.simulatorSession.updateMany({
        where: {
          id: sessionId,
          status: { in: [SimulatorSessionStatus.PENDING, SimulatorSessionStatus.RUNNING] },
        },
        data: {
          status: SimulatorSessionStatus.ABORTED_INJURY,
          finishedAt: new Date(),
          result: {
            abortReason: reason,
            abortedAt: new Date().toISOString(),
          } as any,
        },
      });

      this.active.delete(sessionId);

      const session = await tx.simulatorSession.findUnique({
        where: { id: sessionId },
      });

      return {
        session,
        transitioned: updateResult.count > 0,
      };
    });
  }

  private async requireIssuedSession(
    sessionId: string,
    type: SimulatorSessionType,
    horseIds: string[],
    actor: CurrentUserPayload,
    allowFinished = false,
  ) {
    const session = await this.prisma.simulatorSession.findUnique({
      where: { id: sessionId },
      include: {
        workoutSession: {
          include: {
            trainingPlan: { select: { trainerUserId: true } },
            horse: {
              select: {
                id: true,
                isMedicalLocked: true,
                medicalLocks: { where: { isLocked: true }, take: 1, select: { id: true } },
              },
            },
          },
        },
      },
    });
    if (!session) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'SIMULATOR_SESSION_NOT_FOUND',
        'Simulation session not found.',
      );
    }
    if (session.actorUserId !== actor.userId) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_SESSION_FORBIDDEN',
        'This simulation session belongs to another trainer.',
      );
    }
    if (session.type !== type) {
      throw apiError(
        HttpStatus.CONFLICT,
        'SIMULATOR_SESSION_TYPE_MISMATCH',
        'Simulation packet type does not match the issued session.',
      );
    }
    if (horseIds.length === 0 || horseIds.some((horseId) => !session.horseIds.includes(horseId))) {
      throw apiError(
        HttpStatus.CONFLICT,
        'SIMULATOR_HORSE_MISMATCH',
        'Simulation horse does not match the issued session.',
      );
    }
    if (type === SimulatorSessionType.WORKOUT) {
      const workout = session.workoutSession;
      if (!workout) {
        throw apiError(
          HttpStatus.CONFLICT,
          'SIMULATOR_CONTEXT_MISSING',
          'The simulation session is not linked to a workout.',
        );
      }
      if (workout.trainingPlan.trainerUserId !== actor.userId) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'SIMULATOR_SESSION_FORBIDDEN',
          'This simulation session belongs to another trainer.',
        );
      }
      if (workout.horse.id !== horseIds[0]) {
        throw apiError(
          HttpStatus.CONFLICT,
          'SIMULATOR_HORSE_MISMATCH',
          'Simulation horse does not match the issued workout.',
        );
      }
    }
    if (
      !allowFinished &&
      (session.status === SimulatorSessionStatus.COMPLETED ||
        session.status === SimulatorSessionStatus.ABORTED_INJURY)
    ) {
      throw apiError(
        HttpStatus.CONFLICT,
        'SIMULATOR_SESSION_FINISHED',
        'Simulation session has already finished.',
      );
    }
    if (
      session.status === SimulatorSessionStatus.PENDING &&
      Date.now() - new Date(session.createdAt).getTime() > 5 * 60 * 1000
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'SIMULATOR_SESSION_EXPIRED',
        'Simulation session launch window has expired.',
      );
    }
    return session;
  }

  async getLatestWorkoutResult(
    workoutId: string,
    actor: CurrentUserPayload,
  ): Promise<WorkoutSimulationResultResponse> {
    if (actor.role !== UserRole.HEAD_TRAINER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_TRAINER_REQUIRED',
        'Only the assigned head trainer can review this simulation.',
      );
    }
    const workout = await this.prisma.workoutSession.findUnique({
      where: { id: workoutId },
      include: {
        trainingPlan: { select: { trainerUserId: true } },
        simulatorSession: { select: { id: true, status: true, result: true } },
      },
    });
    if (!workout) {
      throw apiError(HttpStatus.NOT_FOUND, 'WORKOUT_NOT_FOUND', 'Workout session not found.');
    }
    if (workout.trainingPlan.trainerUserId !== actor.userId) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'WORKOUT_NOT_ASSIGNED',
        'This workout belongs to another trainer.',
      );
    }
    const session = workout.simulatorSession;
    if (!session) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'SIMULATOR_RESULT_NOT_FOUND',
        'No simulation result exists for this workout.',
      );
    }

    return {
      sessionId: session.id,
      status: session.status,
      resultDraft: session.result ? this.toWorkoutResultDraft(session.result) : null,
    };
  }

  async getLatestExamResult(
    horseId: string,
    actor: CurrentUserPayload,
  ): Promise<ExamSimulationResultResponse> {
    if (actor.role !== UserRole.VETERINARIAN && actor.role !== UserRole.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'SIMULATOR_MEDICAL_REVIEW_REQUIRED',
        'Only medical staff can review examination simulations.',
      );
    }
    const session = await this.prisma.simulatorSession.findFirst({
      where: {
        type: SimulatorSessionType.EXAM,
        horseIds: { has: horseId },
        status: SimulatorSessionStatus.COMPLETED,
      },
      orderBy: { finishedAt: 'desc' },
    });
    if (!session) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'SIMULATOR_EXAM_RESULT_NOT_FOUND',
        'No simulation examination result exists for this horse.',
      );
    }

    const value = session.result as any;
    return {
      sessionId: session.id,
      status: session.status,
      resultDraft: value
        ? {
            temperature: value.metrics?.temperature?.value ?? null,
            restingHeartRate: value.metrics?.resting_heart_rate?.value ?? null,
            respiratoryRate: value.metrics?.respiratory_rate?.value ?? null,
            weightKg: value.metrics?.weight?.value ?? null,
            capturedAt: value.capturedAt,
            modelVersion: value.modelVersion,
            source: value.source,
          }
        : null,
    };
  }

  private toWorkoutResultDraft(
    result: unknown,
  ): NonNullable<WorkoutSimulationResultResponse['resultDraft']> {
    const value =
      typeof result === 'object' && result !== null && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : {};
    const number = (key: string) =>
      typeof value[key] === 'number' && Number.isFinite(value[key])
        ? (value[key] as number)
        : undefined;
    const surfaces = { GRASS: 'TURF', SAND: 'DIRT', MIXED: 'SYNTHETIC' } as const;
    const conditions = { GOOD: 'GOOD', WET: 'SOFT', HEAVY: 'HEAVY' } as const;
    return {
      actualTimeSeconds: number('durationS'),
      actualDistanceMeters: number('distanceCompletedM'),
      heartRatePeak: number('peakHr'),
      heartRateRecovery: number('hrRecovery10m'),
      topSpeedKmh: number('topSpeedKmh'),
      actualSurface: surfaces[value.surface as keyof typeof surfaces],
      trackCondition: conditions[value.condition as keyof typeof conditions],
    };
  }

  async listRecent(
    limit = 20,
    status?: SimulatorSessionStatus,
  ): Promise<SimulatorSessionsResponse> {
    const clampedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 20));

    const recent = await this.prisma.simulatorSession.findMany({
      ...(status ? { where: { status } } : {}),
      take: clampedLimit,
      orderBy: { updatedAt: 'desc' },
    });

    return {
      active: Array.from(this.active.values()).filter(
        (session) => !status || session.status === status,
      ),
      recent,
    };
  }

  activeSessions(): LiveSimulatorSession[] {
    return Array.from(this.active.values());
  }

  getActiveSession(sessionId: string): LiveSimulatorSession | undefined {
    return this.active.get(sessionId);
  }
}
