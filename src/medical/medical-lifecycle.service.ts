import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateMedicalLockDto } from './dto/medical-lock.dto';
import {
  HorseStatus,
  Prisma,
  RegistrationStatus,
  TournamentStatus,
  WorkoutStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { lockIssuer } from '../incidents/incident-lifecycle';
import { HEAVY_WORKOUT_WHERE } from '../training/training-rules';
import { generateMedicalLockCode } from './medical-lock-code';

/** Transaction primitives only. The caller owns commit and post-commit delivery. */
@Injectable()
export class MedicalLifecycleService {
  constructor(private readonly audit: AuditService) {}

  async placeVeterinaryLock(
    tx: Prisma.TransactionClient,
    dto: CreateMedicalLockDto,
    actor: CurrentUserPayload,
    recheckDate = new Date(Date.now() + (dto.expectedRestDays ?? 7) * 86400000),
  ) {
    if (actor.role !== 'VETERINARIAN') throw new ForbiddenException();
    await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${dto.horseId} FOR UPDATE`;
    const horse = await tx.horse.findUnique({ where: { id: dto.horseId, deletedAt: null } });
    if (!horse || horse.status === 'RETIRED') throw new ConflictException('HORSE_NOT_ACTIVE');
    if (dto.medicalRecordId) {
      const record = await tx.medicalRecord.findUnique({ where: { id: dto.medicalRecordId } });
      if (!record || record.horseId !== horse.id || record.status === 'CLOSED')
        throw new BadRequestException('MEDICAL_RECORD_MISMATCH');
    }
    const active = await tx.medicalLock.findFirst({ where: { horseId: horse.id, isLocked: true } });
    if (active && !dto.medicalRecordId) throw new ConflictException('LOCK_ALREADY_ACTIVE');
    const bound = dto.medicalRecordId
      ? await tx.medicalLock.findFirst({
          where: { horseId: horse.id, medicalRecordId: dto.medicalRecordId, isLocked: true },
        })
      : null;
    const data = {
      veterinarianUserId: actor.userId,
      appliedMedicalStatus: dto.appliedMedicalStatus ?? HorseStatus.INJURED,
      lockReason: dto.lockReason,
      unlockConditions: dto.unlockConditions ?? 'Bác sĩ xác nhận hồi phục',
      expectedRestDays: dto.expectedRestDays ?? 7,
      recheckDate,
    };
    const include = {
      horse: {
        select: { id: true, name: true, horseCode: true, microchip: true, microchipRfid: true },
      },
      veterinarian: { select: { id: true, fullName: true, email: true } },
      medicalRecord: { select: { id: true, examinationDate: true, clinicalDiagnosis: true } },
    };
    const lock = bound
      ? await tx.medicalLock.update({ where: { id: bound.id }, data, include })
      : await tx.medicalLock.create({
          data: {
            ...data,
            ...lockIssuer('VET', actor.userId, actor.userId),
            horseId: horse.id,
            medicalRecordId: dto.medicalRecordId ?? null,
            lockCode: await generateMedicalLockCode(tx),
          },
          include,
        });
    await tx.horse.update({
      where: { id: horse.id },
      data: { isMedicalLocked: true, status: data.appliedMedicalStatus },
    });
    await tx.workoutSession.updateMany({
      where: {
        horseId: horse.id,
        status: 'SCHEDULED',
        scheduledDate: { gte: new Date() },
        ...HEAVY_WORKOUT_WHERE,
      },
      data: { status: 'BLOCKED', statusReason: `Khóa y tế ${lock.lockCode}` },
    });
    await tx.tournamentRegistration.updateMany({
      where: {
        horseId: horse.id,
        status: { in: ['REGISTERED', 'CONFIRMED'] },
        tournament: {
          raceDate: { gte: new Date() },
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
      },
      data: { status: 'SCRATCHED_MEDICAL' },
    });
    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'CREATE_MEDICAL_LOCK',
      `Veterinary lock for ${horse.id}`,
      lock.id,
      { entityName: 'MedicalLock' },
      tx,
    );
    return { lock, horse };
  }

  async releaseRecordLocks(
    tx: Prisma.TransactionClient,
    recordId: string,
    actor: CurrentUserPayload,
    postTreatmentStatus: 'RESTING' | 'ACTIVE',
  ) {
    const record = await tx.medicalRecord.findUnique({ where: { id: recordId } });
    if (!record) throw new NotFoundException('RECORD_NOT_FOUND');
    const horse = await tx.horse.findUnique({ where: { id: record.horseId } });
    if (!horse || horse.status === HorseStatus.RETIRED)
      throw new ConflictException('HORSE_NOT_ACTIVE');
    const own = await tx.medicalLock.findMany({
      where: { medicalRecordId: record.id, isLocked: true },
    });
    await tx.medicalLock.updateMany({
      where: { medicalRecordId: record.id, isLocked: true },
      data: {
        isLocked: false,
        unlockedAt: new Date(),
        unlockVetUserId: actor.userId,
        unlockReason: 'Bác sĩ xác nhận hồi phục khi kết thúc bệnh án',
      },
    });
    const incidentIds = own.map((lock) => lock.sourceIncidentId).filter((id): id is string => !!id);
    if (incidentIds.length)
      await tx.incidentReport.updateMany({
        where: { id: { in: incidentIds }, status: { in: ['REPORTED', 'UNDER_REVIEW'] } },
        data: { status: 'RESOLVED', resolvedAt: new Date(), reviewedById: actor.userId },
      });
    const remainingActiveLocks = await tx.medicalLock.findMany({
      where: { horseId: horse.id, isLocked: true },
    });
    const isMedicalLocked = remainingActiveLocks.length > 0;
    const horseStatus = isMedicalLocked ? horse.status : postTreatmentStatus;
    await tx.horse.update({
      where: { id: horse.id },
      data: { isMedicalLocked, status: horseStatus },
    });
    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'RECORD_LOCKS_RELEASED',
      `Record ${record.id}; ${horse.status} -> ${horseStatus}; remaining locks ${remainingActiveLocks.length}`,
      horse.id,
      { entityName: 'Horse' },
      tx,
    );
    return { remainingActiveLocks, isMedicalLocked, horseStatus };
  }

  async placeIncidentLock(
    tx: Prisma.TransactionClient,
    incidentId: string,
    actor: CurrentUserPayload,
  ) {
    const incident = await tx.incidentReport.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('INCIDENT_NOT_FOUND');
    if (!['SEVERE', 'CRITICAL'].includes(incident.severity)) return null;
    await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${incident.horseId} FOR UPDATE`;
    const existing = await tx.medicalLock.findUnique({ where: { sourceIncidentId: incidentId } });
    if (existing) return existing;
    const horse = await tx.horse.findUnique({ where: { id: incident.horseId } });
    if (!horse || horse.deletedAt || horse.status === HorseStatus.RETIRED)
      throw new ConflictException('HORSE_NOT_ACTIVE');
    const status = [HorseStatus.INJURED, HorseStatus.ISOLATED].includes(horse.status as any)
      ? horse.status
      : HorseStatus.UNDER_OBSERVATION;
    const now = new Date();
    const lock = await tx.medicalLock.create({
      data: {
        ...lockIssuer('INCIDENT_AUTO', actor.userId, undefined, incident.id),
        horseId: horse.id,
        lockCode: await generateMedicalLockCode(tx, now),
        appliedMedicalStatus: status,
        lockReason: 'Bảo vệ tạm thời sau báo cáo nặng; chờ bác sĩ đánh giá.',
        unlockConditions: 'Bác sĩ xác nhận hồi phục trong bệnh án liên quan',
        expectedRestDays: 7,
        recheckDate: new Date(now.getTime() + 7 * 86400000),
      },
    });
    await tx.horse.update({ where: { id: horse.id }, data: { isMedicalLocked: true, status } });
    await tx.workoutSession.updateMany({
      where: {
        horseId: horse.id,
        status: WorkoutStatus.SCHEDULED,
        scheduledDate: { gte: now },
        ...HEAVY_WORKOUT_WHERE,
      },
      data: { status: WorkoutStatus.BLOCKED, statusReason: `Khóa bảo vệ từ sự cố ${incident.id}` },
    });
    await tx.tournamentRegistration.updateMany({
      where: {
        horseId: horse.id,
        status: { in: [RegistrationStatus.REGISTERED, RegistrationStatus.CONFIRMED] },
        tournament: {
          raceDate: { gte: now },
          status: { notIn: [TournamentStatus.COMPLETED, TournamentStatus.CANCELLED] },
        },
      },
      data: { status: RegistrationStatus.SCRATCHED_MEDICAL },
    });
    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'AUTO_INCIDENT_SAFETY_LOCK',
      `Temporary protection for incident ${incident.id}; not a veterinary diagnosis`,
      lock.id,
      { entityName: 'MedicalLock' },
      tx,
    );
    return lock;
  }
}
