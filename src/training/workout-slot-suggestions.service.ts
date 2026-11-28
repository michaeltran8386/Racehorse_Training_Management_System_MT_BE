import { effectiveNow } from '../common/utils/demo-clock';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { apiError } from '../common/exceptions/api-error';
import {
  AvailableTrack,
  AvailabilityDraft,
  OccupiedWorkout,
  evaluateWorkoutAvailability,
} from './workout-availability.service';
import {
  addDays,
  clubDate,
  effectiveIntensity,
  effectiveSurface,
  isHeavy,
  MAX_WORKOUTS_PER_DAY,
  GROOM_BUFFER_MINUTES,
  TRACK_MAX_LIGHT_HORSES,
  TRIAL_SLOT_MINUTES,
  MAX_PRIME_HEAVY_SESSIONS_PER_TRAINER,
  isWithinPrimeTime,
  startOfClubDay,
  startOfClubWeek,
  workoutDurationMinutes,
} from './training-rules';
import { MEDICAL_STATUSES, phasesOf } from './training-shared';
import { assertTrainerZone } from './trainer-zones';
import { SuggestWorkoutSlotsDto } from './dto/suggest-workout-slots.dto';

export function rankWorkoutSlots(
  input: Omit<AvailabilityDraft, 'scheduledDate'>,
  tracks: AvailableTrack[],
  rows: OccupiedWorkout[],
  from: string,
  to: string,
  now: Date,
  excludeWorkoutId?: string,
  eligible: (at: Date) => boolean = () => true,
) {
  const slots: {
    startAt: string;
    endAt: string;
    trackId: string | null;
    availableCapacity?: number;
    reasons: string[];
  }[] = [];
  const choices =
    input.trackSurface === 'NONE'
      ? [null]
      : tracks
          .filter(
            (t) =>
              t.isActive &&
              t.surface === input.trackSurface &&
              (!input.trackId || t.id === input.trackId),
          )
          .sort((a, b) => a.id.localeCompare(b.id));
  // Keep the whole session between meals/care, preferring the nearest available day.
  for (let day = new Date(`${from}T00:00:00+07:00`); clubDate(day) <= to; day = addDays(day, 1)) {
    for (const [begin, end] of [
      [375, 690],
      [855, 1020],
    ]) {
      for (
        let minute = begin;
        minute + workoutDurationMinutes(input.workoutType) <= end;
        minute += 15
      ) {
        const at = new Date(+day + minute * 60000);
        if (+at < +now + 30 * 60000 || !eligible(at)) continue;
        for (const track of choices) {
          try {
            const result = evaluateWorkoutAvailability(
              { ...input, scheduledDate: at, trackId: track?.id },
              track,
              rows,
              excludeWorkoutId,
            );
            slots.push({
              startAt: at.toISOString(),
              endAt: new Date(
                +at + workoutDurationMinutes(input.workoutType) * 60000,
              ).toISOString(),
              trackId: track?.id ?? null,
              ...result,
              reasons: ['Within preferred training hours', 'Availability checked; not reserved'],
            });
            if (slots.length === 3) return slots;
            break; // Different physical tracks at the same time are one time suggestion.
          } catch (error) {
            if (!(error instanceof HttpException) || error.getStatus() >= 500) throw error;
          }
        }
      }
    }
  }
  return slots;
}

@Injectable()
export class WorkoutSlotSuggestionsService {
  constructor(private readonly prisma: PrismaService) {}
  async suggest(planId: string, dto: SuggestWorkoutSlotsDto, user: CurrentUserPayload) {
    if (user.role !== 'HEAD_TRAINER')
      throw apiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Trainer scheduling permission required.');
    const from = new Date(`${dto.from}T00:00:00+07:00`),
      to = new Date(`${dto.to}T00:00:00+07:00`);
    if (
      !Number.isFinite(+from) ||
      !Number.isFinite(+to) ||
      +to < +from ||
      +to - +from > 13 * 86400000
    )
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_SLOT_RANGE',
        'Choose a range of at most 14 days.',
      );
    const now = effectiveNow();
    return this.prisma.$transaction(
      async (tx) => {
        const plan = await tx.trainingPlan.findUnique({
          where: { id: planId },
          include: {
            horse: {
              include: {
                medicalLocks: { where: { isLocked: true }, take: 1 },
                stallAllocations: {
                  where: { isActive: true },
                  select: { stall: { select: { zoneId: true } } },
                },
              },
            },
            trainer: true,
          },
        });
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
            select: { trainingPlanId: true },
          });
          if (existing?.trainingPlanId !== plan.id)
            throw apiError(
              HttpStatus.FORBIDDEN,
              'FORBIDDEN',
              'The edited workout does not belong to this plan.',
            );
        }
        const horse = plan.horse;
        const type = dto.workoutType,
          intensity = effectiveIntensity(type, dto.intensity),
          surface = effectiveSurface(type, dto.trackSurface);
        const unavailable = (reason: string) => ({
          slots: [],
          reasons: [reason],
          evaluatedAt: now.toISOString(),
        });
        if (!['DRAFT', 'ACTIVE'].includes(plan.status)) return unavailable('PLAN_CLOSED');
        if (horse.deletedAt || ['RETIRED', 'ISOLATED'].includes(horse.status))
          return unavailable('HORSE_UNAVAILABLE');
        if (horse.isMedicalLocked || horse.medicalLocks.length)
          return unavailable('MEDICAL_LOCK_ACTIVE');
        if (horse.isDebtImpounded && isHeavy(type, intensity)) return unavailable('DEBT_IMPOUNDED');
        if (
          MEDICAL_STATUSES.includes(horse.status) &&
          isHeavy(type, intensity) &&
          !dto.vetConsulted
        )
          return unavailable('VET_CONFIRMATION_REQUIRED');
        if (plan.trainer.status !== 'ACTIVE' || plan.trainer.role !== 'HEAD_TRAINER')
          return unavailable('INVALID_TRAINER');
        await assertTrainerZone(tx, horse.id, horse.stallAllocations[0]?.stall.zoneId, [
          plan.trainerUserId,
        ]);
        if (
          dto.distanceMeters * (dto.repetitions ?? 1) > 10000 ||
          (['BREEZE', 'TRIAL'].includes(type) && dto.targetSpeedKmh == null)
        )
          return unavailable('INVALID_WORKOUT_INPUT');
        const phases = phasesOf(plan),
          phase = phases.find((p) => p.id === dto.phaseId);
        if (phases.length && !phase) return unavailable('PHASE_REQUIRED');
        // One snapshot for the entire candidate search, including rest and weekly limits.
        const [tracks, rows] = await Promise.all([
          tx.trainingTrack.findMany({
            where: { isActive: true, surface, ...(dto.trackId ? { id: dto.trackId } : {}) },
          }),
          tx.workoutSession.findMany({
            where: {
              status: { not: 'CANCELLED' },
              scheduledDate: { gte: addDays(startOfClubWeek(from), -3), lt: addDays(to, 8) },
              OR: [
                { horseId: horse.id },
                { trainingPlan: { trainerUserId: plan.trainerUserId } },
                { trackSurface: surface },
              ],
            },
            include: { trainingPlan: { select: { trainerUserId: true } } },
          }),
        ]);
        const live = rows.filter((r) => r.id !== dto.excludeWorkoutId);
        let hitWeekQuota = false;
        const slots = rankWorkoutSlots(
          {
            horseId: horse.id,
            trainerUserId: plan.trainerUserId,
            workoutType: type,
            intensity,
            trackSurface: surface,
            trackId: dto.trackId,
          },
          tracks,
          live,
          dto.from,
          dto.to,
          now,
          dto.excludeWorkoutId,
          (at) => {
            const date = clubDate(at);
            if (
              at < startOfClubDay(plan.startDate) ||
              at >= addDays(startOfClubDay(plan.endDate), 1) ||
              (phase && (date < phase.startDate || date > phase.endDate))
            )
              return false;
            const day = live.filter((r) => clubDate(r.scheduledDate) === date);
            if (day.filter((r) => r.horseId === horse.id).length >= MAX_WORKOUTS_PER_DAY)
              return false;
            if (
              day.some(
                (r) => r.horseId === horse.id && Math.abs(+r.scheduledDate - +at) <= 29 * 60000,
              )
            )
              return false;
            if (
              surface !== 'NONE' &&
              day.some(
                (r) =>
                  r.trainingPlan.trainerUserId === plan.trainerUserId &&
                  r.trackSurface !== null &&
                  !['NONE', surface].includes(r.trackSurface),
              )
            )
              return false;
            // Match the save path's surface safety rules, including its transition buffer.
            if (surface !== 'NONE') {
              const end = +at + (workoutDurationMinutes(type) + GROOM_BUFFER_MINUTES) * 60000;
              const onSurface = day.filter(
                (r) =>
                  r.trackSurface === surface &&
                  +at < +r.scheduledDate + (workoutDurationMinutes(r.workoutType) + 15) * 60000 &&
                  +r.scheduledDate < end,
              );
              if (
                onSurface.some((r) => isHeavy(r.workoutType, r.intensity)) ||
                (isHeavy(type, intensity) && type !== 'TRIAL' && onSurface.length > 0) ||
                onSurface.length >= TRACK_MAX_LIGHT_HORSES
              )
                return false;
              if (
                type === 'TRIAL' &&
                day.some(
                  (r) =>
                    r.workoutType === 'TRIAL' &&
                    r.trackSurface === surface &&
                    Math.abs(+r.scheduledDate - +at) < TRIAL_SLOT_MINUTES * 60000,
                )
              )
                return false;
            }
            if (
              isHeavy(type, intensity) &&
              isWithinPrimeTime(at) &&
              day.filter(
                (r) =>
                  r.trainingPlan.trainerUserId === plan.trainerUserId &&
                  isHeavy(r.workoutType, r.intensity) &&
                  isWithinPrimeTime(r.scheduledDate),
              ).length >= MAX_PRIME_HEAVY_SESSIONS_PER_TRAINER
            )
              return false;
            if (phase) {
              const week = startOfClubWeek(at),
                weekRows = live.filter(
                  (r) =>
                    r.trainingPlanId === plan.id &&
                    r.phaseId === phase.id &&
                    r.scheduledDate >= week &&
                    r.scheduledDate < addDays(week, 7),
                );
              if (
                weekRows.length + 1 > phase.sessionsPerWeek ||
                weekRows.reduce((n, r) => n + r.distanceMeters * r.repetitions, 0) +
                  dto.distanceMeters * (dto.repetitions ?? 1) >
                  phase.maxWeeklyDistance
              ) {
                hitWeekQuota = true;
                return false;
              }
            }
            return true;
          },
        );
        return {
          slots,
          reasons:
            slots.length === 0 && hitWeekQuota
              ? ['PHASE_WEEK_QUOTA_FULL']
              : slots.length < 3
                ? ['Fewer than three slots meet the current safety and phase limits.']
                : [],
          evaluatedAt: now.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
