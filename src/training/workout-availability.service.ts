import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';
import { GROOM_BUFFER_MINUTES, isHeavy, workoutDurationMinutes } from './training-rules';

export interface AvailabilityDraft {
  horseId: string;
  trainerUserId: string;
  scheduledDate: Date;
  workoutType: string;
  intensity: string;
  trackSurface: string;
  trackId?: string | null;
}
export interface AvailableTrack {
  id: string;
  surface: string;
  capacity: number;
  isActive: boolean;
}
export interface OccupiedWorkout {
  id: string;
  horseId: string;
  trackId?: string | null;
  trackSurface: string | null;
  scheduledDate: Date;
  workoutType: string | null;
  intensity: string | null;
  status: string;
  trainingPlan: { trainerUserId: string };
  horse?: { name: string };
}
export async function lockWorkoutSchedule(tx: Prisma.TransactionClient) {
  // Club scheduling writes are small/short; serialize admissions before any row lock.
  // Returns an integer instead of PostgreSQL void so Prisma can deserialize the result.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(74203191)`;
}

export function evaluateWorkoutAvailability(
  w: AvailabilityDraft,
  track: AvailableTrack | null,
  rows: OccupiedWorkout[],
  excludeWorkoutId?: string,
) {
  const usesTrack = w.trackSurface !== 'NONE';
  if (usesTrack && (!w.trackId || !track))
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'TRAINING_TRACK_REQUIRED',
      'Select a physical training track.',
    );
  if (
    usesTrack &&
    track &&
    (!track.isActive || track.id !== w.trackId || track.surface !== w.trackSurface)
  )
    throw apiError(
      HttpStatus.CONFLICT,
      'TRAINING_TRACK_UNAVAILABLE',
      'Selected track is inactive or does not match the surface.',
    );
  const start = +w.scheduledDate;
  const end = start + workoutDurationMinutes(w.workoutType) * 60000;
  const events = [
    { at: start, delta: 1 },
    { at: end, delta: -1 },
  ];
  for (const row of rows) {
    if (row.id === excludeWorkoutId || !['SCHEDULED', 'COMPLETED'].includes(row.status)) continue;
    const otherStart = +row.scheduledDate;
    const otherEnd = otherStart + workoutDurationMinutes(row.workoutType) * 60000;
    const overlaps = start < otherEnd && otherStart < end;
    if (row.horseId === w.horseId) {
      if (overlaps)
        throw apiError(
          HttpStatus.CONFLICT,
          'HORSE_WORKOUT_TIME_CONFLICT',
          'This horse already has an overlapping workout.',
        );
      const restHours =
        isHeavy(row.workoutType, row.intensity) || isHeavy(w.workoutType, w.intensity)
          ? 48
          : ['TROT', 'CANTER'].includes(row.workoutType ?? '') ||
              ['TROT', 'CANTER'].includes(w.workoutType)
            ? 24
            : 0;
      if (Math.abs(start - otherStart) < restHours * 3600000)
        throw apiError(
          HttpStatus.CONFLICT,
          'WORKOUT_REST_REQUIRED',
          `WORKOUT_REST_REQUIRED: horse needs ${restHours} hours between these sessions.`,
        );
    }
    if (
      row.trainingPlan.trainerUserId === w.trainerUserId &&
      start < otherEnd + GROOM_BUFFER_MINUTES * 60000 &&
      otherStart < end + GROOM_BUFFER_MINUTES * 60000
    )
      throw apiError(
        HttpStatus.CONFLICT,
        'TRAINER_BUSY_SLOT',
        `HLV đã có lịch huấn luyện ngựa ${row.horse?.name ?? ''} trong khung giờ này (cần tối thiểu 15 phút chuyển tiếp giữa hai buổi tập).`,
      );
    if (!usesTrack || !overlaps) continue;
    if (!row.trackId && row.trackSurface === w.trackSurface)
      throw apiError(
        HttpStatus.CONFLICT,
        'TRACK_MAPPING_REQUIRED',
        'TRACK_MAPPING_REQUIRED: overlapping legacy workouts need a verified physical-track mapping.',
      );
    if (row.trackId === w.trackId) {
      events.push(
        { at: Math.max(start, otherStart), delta: 1 },
        { at: Math.min(end, otherEnd), delta: -1 },
      );
    }
  }
  let active = 0,
    peak = 0;
  for (const event of events.sort((a, b) => a.at - b.at || a.delta - b.delta)) {
    active += event.delta;
    peak = Math.max(peak, active);
  }
  if (track && usesTrack && peak > track.capacity)
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'TRACK_CAPACITY_EXCEEDED',
      'Sân tập đã đạt sức chứa tối đa 6 ngựa trong khung giờ này.',
    );
  return { availableCapacity: track && usesTrack ? track.capacity - peak + 1 : undefined };
}

@Injectable()
export class WorkoutAvailabilityService {
  async validate(tx: Prisma.TransactionClient, w: AvailabilityDraft, excludeWorkoutId?: string) {
    const track = w.trackId
      ? await tx.trainingTrack.findUnique({ where: { id: w.trackId } })
      : null;
    const rows = await tx.workoutSession.findMany({
      where: {
        status: { in: ['SCHEDULED', 'COMPLETED'] },
        scheduledDate: {
          gte: new Date(+w.scheduledDate - 50 * 3600000),
          lte: new Date(+w.scheduledDate + 50 * 3600000),
        },
        OR: [
          { horseId: w.horseId },
          { trainingPlan: { trainerUserId: w.trainerUserId } },
          ...(w.trackId
            ? [{ trackId: w.trackId }, { trackId: null, trackSurface: w.trackSurface }]
            : []),
        ],
      },
      select: {
        id: true,
        horseId: true,
        trackId: true,
        trackSurface: true,
        scheduledDate: true,
        workoutType: true,
        intensity: true,
        status: true,
        trainingPlan: { select: { trainerUserId: true } },
        horse: { select: { name: true } },
      },
    });
    return evaluateWorkoutAvailability(w, track, rows, excludeWorkoutId);
  }
}
