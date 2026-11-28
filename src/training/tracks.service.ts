import { effectiveNow } from '../common/utils/demo-clock';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { CreateTrainingTrackDto, UpdateTrainingTrackDto } from './dto/training-track.dto';
import { lockWorkoutSchedule, WorkoutAvailabilityService } from './workout-availability.service';
import { isHeavy, workoutDurationMinutes } from './training-rules';

@Injectable()
export class TracksService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}
  async list(
    includeInactive: boolean,
    actor: CurrentUserPayload,
    date?: string,
    time?: string,
    workoutType?: string,
  ) {
    if (!['CLUB_MANAGER', 'HEAD_TRAINER', 'VETERINARIAN', 'GROOM'].includes(actor.role))
      throw new ForbiddenException();
    const tracks = await this.db.trainingTrack.findMany({
      where: includeInactive && actor.role === 'CLUB_MANAGER' ? {} : { isActive: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
    });
    if (!date || !time) {
      return tracks.map((t) => ({ ...t, currentCount: 0, isFull: false }));
    }

    const dateOnly = date.slice(0, 10);
    const targetDt = new Date(`${dateOnly}T${time.length === 5 ? time + ':00' : time}+07:00`);
    if (isNaN(targetDt.getTime())) {
      return tracks.map((t) => ({ ...t, currentCount: 0, isFull: false }));
    }

    const targetStart = targetDt.getTime();
    const targetDur = workoutDurationMinutes(workoutType);
    const targetEnd = targetStart + targetDur * 60 * 1000;
    const isTargetHeavy = isHeavy(workoutType, 'MEDIUM');

    const maxPreWindow = 120 * 60 * 1000;
    const workouts = await this.db.workoutSession.findMany({
      where: {
        status: { not: 'CANCELLED' },
        scheduledDate: {
          gte: new Date(targetStart - maxPreWindow),
          lte: new Date(targetEnd),
        },
      },
      select: {
        id: true,
        trackId: true,
        trackSurface: true,
        scheduledDate: true,
        workoutType: true,
        intensity: true,
      },
    });

    return tracks.map((track) => {
      const trackWorkouts = workouts.filter((w) => {
        if (w.trackId !== track.id && !(w.trackId === null && w.trackSurface === track.surface)) {
          return false;
        }
        if (!w.scheduledDate || typeof w.scheduledDate.getTime !== 'function') return false;
        const wStart = w.scheduledDate.getTime();
        const wDur = workoutDurationMinutes(w.workoutType);
        const wEnd = wStart + (wDur + 15) * 60 * 1000;
        return targetStart < wEnd && wStart < targetEnd;
      });

      const hasHeavy = trackWorkouts.some((w) => isHeavy(w.workoutType, w.intensity));
      const count = trackWorkouts.length;
      const isFull = hasHeavy || (isTargetHeavy && count > 0) || count >= track.capacity;

      return {
        ...track,
        currentCount: count,
        isFull,
        hasHeavy,
      };
    });
  }
  async save(
    id: string | null,
    dto: CreateTrainingTrackDto | UpdateTrainingTrackDto,
    actor: CurrentUserPayload,
  ) {
    if (actor.role !== 'CLUB_MANAGER') throw new ForbiddenException();
    return this.db.$transaction(async (tx) => {
      await lockWorkoutSchedule(tx);
      if (id) {
        const track = await tx.trainingTrack.findUnique({ where: { id } });
        if (!track) throw new NotFoundException('TRACK_NOT_FOUND');
        if (
          (dto.surface !== undefined && dto.surface !== track.surface) ||
          (dto.capacity !== undefined && dto.capacity !== track.capacity) ||
          dto.isActive === false
        ) {
          if (
            await tx.workoutSession.count({
              where: { trackId: id, status: 'SCHEDULED', scheduledDate: { gte: effectiveNow() } },
            })
          )
            throw new ConflictException(
              'TRACK_HAS_FUTURE_WORKOUTS: move or cancel its scheduled workouts before changing track safety settings.',
            );
        }
      }
      let track;
      try {
        track = id
          ? await tx.trainingTrack.update({ where: { id }, data: dto })
          : await tx.trainingTrack.create({ data: dto as CreateTrainingTrackDto });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002')
          throw new ConflictException('TRACK_CODE_EXISTS');
        throw error;
      }
      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        id ? 'UPDATE_TRAINING_TRACK' : 'CREATE_TRAINING_TRACK',
        `Track ${track.code}`,
        track.id,
        { entityName: 'TrainingTrack' },
        tx,
      );
      return track;
    });
  }
  async mapLegacy(id: string, workoutIds: string[], actor: CurrentUserPayload) {
    if (actor.role !== 'CLUB_MANAGER') throw new ForbiddenException();
    return this.db.$transaction(async (tx) => {
      await lockWorkoutSchedule(tx);
      const track = await tx.trainingTrack.findUnique({ where: { id } });
      if (!track?.isActive) throw new ConflictException('TRAINING_TRACK_UNAVAILABLE');
      const rows = await tx.workoutSession.findMany({
        where: { id: { in: workoutIds } },
        include: { trainingPlan: true },
      });
      if (
        rows.length !== workoutIds.length ||
        rows.some(
          (row) =>
            row.trackId ||
            !['SCHEDULED', 'BLOCKED'].includes(row.status) ||
            row.scheduledDate <= effectiveNow() ||
            row.trackSurface !== track.surface,
        )
      )
        throw new ConflictException('INVALID_LEGACY_TRACK_MAPPING');
      await tx.workoutSession.updateMany({
        where: { id: { in: workoutIds }, trackId: null },
        data: { trackId: id },
      });
      for (const row of rows.filter((row) => row.status === 'SCHEDULED'))
        await new WorkoutAvailabilityService().validate(
          tx,
          {
            horseId: row.horseId,
            trainerUserId: row.trainingPlan.trainerUserId,
            scheduledDate: row.scheduledDate,
            workoutType: row.workoutType ?? 'TROT',
            intensity: row.intensity ?? 'MEDIUM',
            trackSurface: track.surface,
            trackId: id,
          },
          row.id,
        );
      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'MAP_LEGACY_WORKOUT_TRACK',
        `Verified track ${track.code} for ${rows.length} future workouts`,
        id,
        { entityName: 'TrainingTrack', newValues: { workoutIds } },
        tx,
      );
      return { mapped: rows.length };
    });
  }
}
