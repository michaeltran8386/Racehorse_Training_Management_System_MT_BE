import { lockChanged } from '../business-mail/templates/health-templates';
import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { apiError } from '../common/exceptions/api-error';
import { effectiveNow } from '../common/utils/demo-clock';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import {
  Role,
  HorseStatus,
  WorkoutStatus,
  RegistrationStatus,
  TournamentStatus,
} from '@prisma/client';
import { assertStatusTransition } from '../horses/horse-rules';
import { HEAVY_WORKOUT_WHERE } from '../training/training-rules';
import {
  CreateMedicalLockDto,
  ExtendMedicalLockDto,
  ReleaseMedicalLockDto,
  MedicalLockQueryDto,
} from './dto/medical-lock.dto';
import { PrismaService } from '../prisma/prisma.service';
import { groomZoneIds, horsesInZones } from '../shift-rosters/groom-zones';
import { AuditService } from '../audit/audit.service';
import { MedicalAccessService } from './medical-access.service';
import { DailyTasksService } from '../daily-tasks/daily-tasks.service';
import { SimulatorRealtimeService } from '../simulator/simulator-realtime.service';

/** P2-04: Khóa huấn luyện — đặt, gỡ, gia hạn, danh sách (FR-3.10 → FR-3.12). */
export async function generateMedicalLockCode(tx: {
  medicalLock?: {
    count?: (args?: any) => Promise<number>;
    findUnique?: (args: any) => Promise<any>;
  };
}): Promise<string> {
  const year = effectiveNow().getFullYear();
  const prefix = `MLK-${year}-`;
  let seq = 1;
  try {
    if (typeof tx?.medicalLock?.count === 'function') {
      const countThisYear = await tx.medicalLock.count({
        where: { lockCode: { startsWith: prefix } },
      });
      seq = countThisYear + 1;
    }
  } catch {
    // fallback if count throws
  }
  let lockCode = `${prefix}${String(seq).padStart(3, '0')}`;
  let attempts = 0;
  while (attempts < 20) {
    if (typeof tx?.medicalLock?.findUnique !== 'function') break;
    const existing = await tx.medicalLock.findUnique({ where: { lockCode } });
    if (!existing) break;
    attempts++;
    seq++;
    lockCode = `${prefix}${String(seq).padStart(3, '0')}`;
  }
  return lockCode;
}

@Injectable()
export class MedicalLocksService {
  private readonly logger = new Logger(MedicalLocksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly access: MedicalAccessService,
    private readonly realtime: SimulatorRealtimeService,
    @Optional() private readonly dailyTasks?: DailyTasksService,
  ) {}

  /** FR-011: đặt/gỡ/gia hạn khóa báo HT, CM, chủ ngựa và groom đang chăm. */
  private notifyLockAudience(
    horseId: string,
    input: Parameters<NotificationsService['notifyUsers']>[1],
    actorId: string,
  ) {
    return this.notifications.notifyHorse(
      horseId,
      { roles: [Role.CLUB_MANAGER], trainer: true, owner: true, groom: true },
      { ...input, link: `/medical/horses/${horseId}` },
      actorId,
    );
  }

  private async syncCare(horseId: string) {
    try {
      await this.dailyTasks?.syncMedicalTasksForHorse(horseId);
      return false;
    } catch (error) {
      this.logger.warn(`Could not sync care for ${horseId}: ${String(error)}`);
      return true;
    }
  }

  /**
   * Đặt Khóa huấn luyện. Mọi lệnh ghi (khóa, trạng thái ngựa, giáo án, buổi tập, nhật ký) nằm trong
   * MỘT transaction: lỗi giữa chừng thì không ghi gì. Dòng Horse bị khóa (FOR UPDATE) trước khi kiểm
   * "đã có khóa chưa", nên 2 bác sĩ bấm cùng lúc thì người sau phải chờ và thấy khóa của người trước.
   */
  async createMedicalLock(actor: CurrentUserPayload, dto: CreateMedicalLockDto) {
    this.access.assertVet(actor, 'place a training lock');

    const appliedStatus = dto.appliedMedicalStatus || HorseStatus.INJURED;

    const now = effectiveNow();
    let recheckDate: Date;
    const inputDate = dto.recheckDate;
    if (inputDate) {
      recheckDate = new Date(inputDate);
    } else {
      const restDays = dto.expectedRestDays || 7;
      recheckDate = new Date(now.getTime() + restDays * 24 * 60 * 60 * 1000);
    }

    if (recheckDate <= now) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'REVIEW_DATE_TOO_EARLY',
        'The review date must be tomorrow or later.',
      );
    }

    const maxRecheck = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
    if (recheckDate > maxRecheck) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'REVIEW_DATE_TOO_LATE',
        'The review date must be within 180 days from today.',
      );
    }

    const restDaysCalculated = Math.ceil(
      (recheckDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );

    const { lock, horse } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${dto.horseId} FOR UPDATE`;
      const horse = await tx.horse.findUnique({ where: { id: dto.horseId, deletedAt: null } });
      if (!horse) throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Horse not found.');

      // Bắt buộc phải gắn với Bệnh án: Bệnh án phải tồn tại và đang mở điều trị (OPEN)
      let recordIdToLink: string | null = null;
      const medRecordClient = tx.medicalRecord || this.prisma.medicalRecord;
      if (dto.medicalRecordId) {
        const linkedRecord = await medRecordClient?.findUnique?.({
          where: { id: dto.medicalRecordId },
          select: { id: true, horseId: true, status: true },
        });
        if (!linkedRecord || linkedRecord.horseId !== dto.horseId) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'RECORD_NOT_FOR_HORSE',
            'Bệnh án không tồn tại hoặc không thuộc về chiến mã này. / Medical record not found or does not belong to this horse.',
          );
        }
        if (linkedRecord.status !== 'OPEN' && linkedRecord.status !== 'DRAFT') {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'RECORD_NOT_OPEN',
            'Chỉ có thể đặt Khóa huấn luyện khi Bệnh án đang mở điều trị (OPEN). / Training lock requires an open medical record.',
          );
        }
        recordIdToLink = linkedRecord.id;
      } else if (medRecordClient?.findFirst) {
        const openRecord = await medRecordClient.findFirst({
          where: { horseId: dto.horseId, status: 'OPEN' },
          select: { id: true },
        });
        if (!openRecord) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'OPEN_RECORD_REQUIRED',
            'Chỉ có thể đặt Khóa huấn luyện khi chiến mã có Bệnh án đang mở điều trị (OPEN). / Training Lock requires an active OPEN medical record for this horse.',
          );
        }
        recordIdToLink = openRecord.id;
      }

      const existingLock = await tx.medicalLock.findFirst({
        where: { horseId: dto.horseId, isLocked: true },
      });
      if (existingLock) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'LOCK_ALREADY_ACTIVE',
          'This horse already has an active Training Lock.',
        );
      }

      const lockCode = await generateMedicalLockCode(tx);

      const lock = await tx.medicalLock.create({
        data: {
          lockCode,
          horseId: dto.horseId,
          medicalRecordId: recordIdToLink,
          veterinarianUserId: actor.userId,
          expectedRestDays: restDaysCalculated,
          recheckDate,
          appliedMedicalStatus: appliedStatus,
          lockReason: dto.lockReason,
          unlockConditions:
            dto.unlockConditions || 'Hết triệu chứng chấn thương và được Bác sĩ thú y khám lại',
          isLocked: true,
        },
        include: {
          horse: {
            select: { id: true, name: true, horseCode: true, microchip: true, microchipRfid: true },
          },
          veterinarian: { select: { id: true, fullName: true, email: true } },
          medicalRecord: { select: { id: true, examinationDate: true, clinicalDiagnosis: true } },
        },
      });

      await tx.horse.update({
        where: { id: dto.horseId },
        data: { isMedicalLocked: true, status: appliedStatus },
      });

      // RULE-MED-01 (Flow 2 §4.2, Q-2.01, Bug #54): giáo án giữ nguyên; chỉ buổi tập NẶNG đã lên lịch
      // sau thời điểm đặt khóa chuyển sang Bị chặn. Các buổi đã tập trước đó giữ nguyên để ghi kết quả.
      await tx.workoutSession.updateMany({
        where: {
          horseId: dto.horseId,
          status: WorkoutStatus.SCHEDULED,
          scheduledDate: { gte: effectiveNow() },
          ...HEAVY_WORKOUT_WHERE,
        },
        data: {
          status: WorkoutStatus.BLOCKED,
          statusReason: `Khóa huấn luyện thú y ${lockCode}: ${dto.lockReason}`,
        },
      });

      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'CREATE_MEDICAL_LOCK',
        `Medical lock ${lockCode} created for horse ${dto.horseId}`,
        lock.id,
        { entityName: 'MedicalLock' },
        tx,
      );
      // Ghi thêm vào nhật ký của ngựa để Tab Lịch sử trạng thái (Flow 1) có lần đổi này (CL-1.08).
      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'HORSE_STATUS_CHANGED',
        `Changed status of horse ${horse.name} from ${horse.status} to ${appliedStatus} (training lock ${lockCode})`,
        horse.id,
        {
          entityName: 'Horse',
          newValues: {
            oldStatus: horse.status,
            newStatus: appliedStatus,
            reason: dto.lockReason,
            source: 'MEDICAL_LOCK',
            lockCode,
          },
        },
        tx,
      );

      return { lock, horse };
    });

    // Tự động rút đăng ký các giải đấu chưa diễn ra khi ngựa bị khóa y tế (STT 1: F3 → F5).
    // Thực hiện NGOÀI transaction chính để nếu có lỗi bảng giải đấu thì không làm hỏng transaction đặt khóa.
    // Kết quả được trả về cho người đặt khóa: lỗi không còn bị nuốt im lặng trong log.
    const raceWithdrawal = { scratched: 0, failed: false, error: null as string | null };
    try {
      const upcomingRegs = await (this.prisma as any).tournamentRegistration?.findMany({
        where: {
          horseId: dto.horseId,
          status: { in: [RegistrationStatus.REGISTERED, RegistrationStatus.CONFIRMED] },
          tournament: {
            raceDate: { gte: effectiveNow() },
            status: { notIn: [TournamentStatus.COMPLETED, TournamentStatus.CANCELLED] },
          },
        },
        select: { id: true, notes: true },
      });

      for (const reg of upcomingRegs || []) {
        const scratched = await (this.prisma as any).tournamentRegistration.update({
          where: { id: reg.id },
          data: {
            status: RegistrationStatus.SCRATCHED_MEDICAL,
            notes: reg.notes
              ? `${reg.notes} | Rút vì Khóa y tế ${lock.lockCode}: ${dto.lockReason}`
              : `Rút vì Khóa y tế ${lock.lockCode}: ${dto.lockReason}`,
          },
        });
        await this.audit.record(
          { id: actor.userId, name: actor.fullName },
          'SCRATCH_TOURNAMENT_REGISTRATION',
          `Auto-scratched registration ${reg.id} due to medical lock ${lock.lockCode}`,
          reg.id,
          { entityName: 'TournamentRegistration', oldValues: reg, newValues: scratched },
        );
        raceWithdrawal.scratched += 1;
      }
    } catch (err: any) {
      raceWithdrawal.failed = true;
      raceWithdrawal.error = String(err?.message || err).slice(0, 200);
      this.logger.warn(
        `Không thể tự động rút đăng ký giải đấu cho ngựa ${dto.horseId}: ${err?.message || err}`,
      );
    }

    const impactAssessment = {
      horseId: horse.id,
      horseName: horse.name,
      previousStatus: horse.status,
      newStatus: appliedStatus,
      blockedWorkoutsMessage: 'Các buổi tập nặng sắp tới sẽ tự động bị chặn',
      suspendedRegistrationsMessage: 'Đăng ký thi đấu chưa diễn ra sẽ tạm treo',
      raceWithdrawal,
      notificationRecipients: [
        'Huấn luyện viên Trưởng',
        'Quản lý Câu lạc bộ',
        'Nhân viên chăm sóc phụ trách',
        'Chủ sở hữu chiến mã',
      ],
    };

    const careSyncFailed = await this.syncCare(horse.id);
    const notificationSent = await this.notifyLockAudience(
      horse.id,
      {
        email: {
          eventCode: 'LOCK_CHANGED',
          body: {
            ...lockChanged(
              horse,
              {
                type: lock.lockCode ?? lock.id,
                reason: dto.lockReason,
                expiresAt: lock.recheckDate,
              },
              'planned',
              { name: actor.fullName },
            ),
            refId: lock.id,
            milestone: 'placed',
          },
        },
        type: 'LOCK_PLACED',
        dedupeKey: `lock-placed:${lock.id}`,
        category: 'LOCK',
        title: 'Training Lock placed',
        message: `${horse.name} is under a Training Lock. Heavy workouts are blocked. Reason: ${dto.lockReason}`,
        params: { horse: horse.name, reason: dto.lockReason },
        link: '/locks',
        senderName: actor.fullName,
      },
      actor.userId,
    );

    this.realtime.emit('sys:medical_lock_sync', {
      event: 'sys:medical_lock_sync',
      horse_id: horse.id,
      medical_lock: true,
      issued_by_role: 'VETERINARIAN',
      lock_actions: ['BLOCK_HEAVY_WORKOUT', 'BLOCK_TOURNAMENT_ENTRY'],
      note: dto.lockReason,
    });

    return {
      ...lock,
      impactAssessment: {
        ...impactAssessment,
        notificationFailed: notificationSent === false,
        careSyncFailed,
      },
      message: `Đã đặt Khóa huấn luyện cho ${horse.name}`,
    };
  }

  /** Gỡ khóa: cập nhật khóa + trạng thái ngựa + nhật ký trong một transaction (khóa dòng MedicalLock). */
  async releaseMedicalLock(lockId: string, actor: CurrentUserPayload, dto: ReleaseMedicalLockDto) {
    this.access.assertVet(actor, 'lift a training lock');

    const { lock, unlocked, stillLocked, activeLockCodes } = await this.prisma.$transaction(
      async (tx) => {
        const target = await tx.medicalLock.findUnique({
          where: { id: lockId },
          select: { horseId: true },
        });
        if (target)
          await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${target.horseId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "MedicalLock" WHERE "id" = ${lockId} FOR UPDATE`;
        const lock = await tx.medicalLock.findUnique({
          where: { id: lockId },
          include: { horse: { include: { injuryLogs: { where: { stage: 'ACUTE' } } } } },
        });
        if (!lock || !lock.isLocked) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'LOCK_NOT_ACTIVE',
            'The Training Lock was not found or is already lifted.',
          );
        }

        if (lock.source === 'INCIDENT_AUTO') {
          const record = lock.medicalRecordId
            ? await tx.medicalRecord.findUnique({ where: { id: lock.medicalRecordId } })
            : null;
          if (
            !record ||
            record.horseId !== lock.horseId ||
            record.status !== 'CLOSED' ||
            record.treatmentResult !== 'RECOVERED'
          ) {
            throw apiError(
              HttpStatus.CONFLICT,
              'RECOVERED_RECORD_REQUIRED',
              'Incident protection requires recovery confirmed in its linked medical record.',
            );
          }
        }

        if (
          dto.newHorseStatus &&
          (dto.newHorseStatus === HorseStatus.RETIRED || dto.newHorseStatus === HorseStatus.INJURED)
        ) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'INVALID_RELEASE_STATUS',
            'Trạng thái sau khi gỡ khóa y tế không thể là RETIRED hoặc INJURED.',
          );
        }

        const newHorseStatus = dto.newHorseStatus || lock.horse?.status;
        const currentStatus =
          lock.horse?.status || lock.appliedMedicalStatus || HorseStatus.INJURED;
        if (newHorseStatus && newHorseStatus !== currentStatus) {
          assertStatusTransition({
            role: actor.role,
            from: currentStatus,
            to: newHorseStatus,
            isMedicalLocked: false,
            reason: dto.unlockReason,
          });
        }

        // Đếm số lệnh khóa đang còn active của ngựa (tránh tắt nhầm cờ nếu còn khóa khác - H-08)
        const remainingActiveLocks = await tx.medicalLock.count({
          where: {
            horseId: lock.horseId,
            isLocked: true,
            id: { not: lockId },
          },
        });
        const stillLocked = remainingActiveLocks > 0;

        const unlocked = await tx.medicalLock.update({
          where: { id: lockId },
          data: {
            isLocked: false,
            unlockedAt: effectiveNow(),
            unlockVetUserId: actor.userId,
            unlockReason: dto.unlockReason,
            recheckNotes: dto.recheckNotes || dto.unlockReason,
          },
          include: {
            horse: {
              select: {
                id: true,
                name: true,
                horseCode: true,
                microchip: true,
                microchipRfid: true,
              },
            },
            veterinarian: { select: { id: true, fullName: true } },
            unlockVet: { select: { id: true, fullName: true } },
          },
        });

        await tx.horse.update({
          where: { id: lock.horseId },
          data: {
            isMedicalLocked: stillLocked,
            status: stillLocked ? lock.horse?.status || HorseStatus.INJURED : newHorseStatus,
          },
        });

        await this.audit.record(
          { id: actor.userId, name: actor.fullName },
          'RELEASE_MEDICAL_LOCK',
          `Medical lock ${lock.lockCode || lockId} released for horse ${lock.horseId}`,
          lockId,
          { entityName: 'MedicalLock' },
          tx,
        );
        await this.audit.record(
          { id: actor.userId, name: actor.fullName },
          'HORSE_STATUS_CHANGED',
          `Changed status of horse ${lock.horse.name} from ${lock.horse.status} to ${newHorseStatus} (training lock lifted)`,
          lock.horseId,
          {
            entityName: 'Horse',
            newValues: {
              oldStatus: lock.horse.status,
              newStatus: newHorseStatus,
              reason: dto.unlockReason,
              source: 'MEDICAL_LOCK',
              lockCode: lock.lockCode,
            },
          },
          tx,
        );

        const activeLocks = await tx.medicalLock.findMany({
          where: { horseId: lock.horseId, isLocked: true },
          select: { id: true, lockCode: true },
        });
        return {
          lock,
          unlocked,
          stillLocked,
          activeLockCodes: activeLocks.map((item) => item.lockCode ?? item.id),
        };
      },
    );

    const careSyncFailed = await this.syncCare(lock.horseId);
    const notificationSent = await this.notifyLockAudience(
      lock.horseId,
      {
        email: {
          eventCode: 'LOCK_CHANGED',
          body: {
            ...lockChanged(
              lock.horse,
              { type: lock.lockCode ?? lockId, reason: dto.unlockReason },
              'released',
              { name: actor.fullName },
              activeLockCodes,
            ),
            refId: lockId,
            milestone: 'released',
          },
        },
        type: 'LOCK_LIFTED',
        dedupeKey: `lock-lifted:${lockId}`,
        category: 'LOCK',
        title: 'Training Lock lifted',
        message: stillLocked
          ? `${lock.horse.name} remains under a separate Training Lock.`
          : `${lock.horse.name} was released back to work. Blocked workouts can be restored.`,
        params: { horse: lock.horse.name },
        link: '/locks',
        senderName: actor.fullName,
      },
      actor.userId,
    );

    this.realtime.emit('sys:medical_lock_sync', {
      event: 'sys:medical_lock_sync',
      horse_id: lock.horseId,
      medical_lock: stillLocked,
      issued_by_role: 'VETERINARIAN',
      lock_actions: stillLocked ? ['BLOCK_HEAVY_WORKOUT', 'BLOCK_TOURNAMENT_ENTRY'] : [],
      note: dto.unlockReason,
    });

    const warnings: string[] = [];
    if (lock.horse?.injuryLogs && lock.horse.injuryLogs.length > 0) {
      warnings.push(`Ngựa còn ${lock.horse.injuryLogs.length} chấn thương ở giai đoạn Cấp tính`);
    }

    return {
      ...unlocked,
      notificationFailed: notificationSent === false,
      careSyncFailed,
      warnings,
      message: `Đã gỡ Khóa huấn luyện cho ${lock.horse.name}`,
      notificationToTrainer: 'Có các buổi tập bị chặn có thể khôi phục',
    };
  }

  /** Gia hạn: đọc - kiểm - ghi lịch sử gia hạn trong một transaction (khóa dòng MedicalLock). */
  async extendMedicalLock(lockId: string, actor: CurrentUserPayload, dto: ExtendMedicalLockDto) {
    this.access.assertVet(actor, 'extend a training lock');

    const extended = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "MedicalLock" WHERE "id" = ${lockId} FOR UPDATE`;
      const lock = await tx.medicalLock.findUnique({ where: { id: lockId } });
      if (!lock || !lock.isLocked) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'LOCK_NOT_ACTIVE',
          'No active Training Lock was found.',
        );
      }

      const now = effectiveNow();
      let newRecheckDate: Date;

      const targetDate = dto.recheckDate;
      if (targetDate) {
        newRecheckDate = new Date(targetDate);
      } else if (dto.additionalDays) {
        const baseDate = lock.recheckDate && lock.recheckDate > now ? lock.recheckDate : now;
        newRecheckDate = new Date(baseDate.getTime() + dto.additionalDays * 24 * 60 * 60 * 1000);
      } else {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'VALIDATION',
          'Choose a new review date or the number of extra days.',
        );
      }

      if (newRecheckDate <= now) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'REVIEW_DATE_TOO_EARLY',
          'The new review date must be after today.',
        );
      }

      if (lock.recheckDate && newRecheckDate <= lock.recheckDate) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'REVIEW_DATE_NOT_LATER',
          `The new review date must be after the current one (${lock.recheckDate.toISOString().slice(0, 10)}).`,
        );
      }

      const maxRecheck = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
      if (newRecheckDate > maxRecheck) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'REVIEW_DATE_TOO_LATE',
          'The new review date must be within 180 days from today.',
        );
      }

      let history: any[] = [];
      if (lock.extensionHistory) {
        try {
          history =
            typeof lock.extensionHistory === 'string'
              ? JSON.parse(lock.extensionHistory)
              : (lock.extensionHistory as any[]);
        } catch {
          history = [];
        }
      }

      const extensionReason = dto.extendReason || 'Gia hạn ngày xem xét lại';

      history.push({
        id: `ext-${Date.now()}`,
        oldRecheckDate: lock.recheckDate ? lock.recheckDate.toISOString() : null,
        newRecheckDate: newRecheckDate.toISOString(),
        reason: extensionReason,
        updatedByUserId: actor.userId,
        updatedByName: actor.fullName,
        createdAt: now.toISOString(),
      });

      const newRestDays = Math.ceil(
        (newRecheckDate.getTime() - new Date(lock.lockedAt).getTime()) / (24 * 60 * 60 * 1000),
      );

      const extended = await tx.medicalLock.update({
        where: { id: lockId },
        data: {
          recheckDate: newRecheckDate,
          expectedRestDays: newRestDays,
          recheckNotes: extensionReason,
          extensionHistory: history,
        },
        include: {
          horse: {
            select: { id: true, name: true, horseCode: true, microchip: true, microchipRfid: true },
          },
          veterinarian: { select: { id: true, fullName: true } },
        },
      });

      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'EXTEND_MEDICAL_LOCK',
        `Medical lock ${lock.lockCode || lockId} extended to ${newRecheckDate.toLocaleDateString()}`,
        lockId,
        { entityName: 'MedicalLock' },
        tx,
      );

      return {
        ...extended,
        message: `Đã gia hạn ngày xem xét lại đến ${newRecheckDate.toLocaleDateString()}`,
      };
    });

    const until = extended.recheckDate ? extended.recheckDate.toISOString().slice(0, 10) : '';
    const notificationSent = await this.notifyLockAudience(
      extended.horseId,
      {
        email: {
          eventCode: 'LOCK_CHANGED',
          body: {
            ...lockChanged(
              extended.horse,
              {
                type: extended.lockCode ?? lockId,
                reason: extended.recheckNotes ?? undefined,
                expiresAt: extended.recheckDate,
              },
              'extended',
              { name: actor.fullName },
            ),
            refId: lockId,
            milestone: 'extended:' + until,
          },
        },
        type: 'LOCK_EXTENDED',
        dedupeKey: `lock-extended:${lockId}:${until}`,
        category: 'LOCK',
        title: 'Training Lock extended',
        message: `The Training Lock of ${extended.horse?.name ?? 'a horse'} now runs until ${until}.`,
        params: { horse: extended.horse?.name ?? '', date: until },
        link: '/locks',
        senderName: actor.fullName,
      },
      actor.userId,
    );

    this.realtime.emit('sys:medical_lock_sync', {
      event: 'sys:medical_lock_sync',
      horse_id: extended.horseId,
      medical_lock: true,
      issued_by_role: 'VETERINARIAN',
      lock_actions: ['BLOCK_HEAVY_WORKOUT', 'BLOCK_TOURNAMENT_ENTRY'],
      note: extended.recheckNotes || 'Medical lock extended',
    });

    return { ...extended, notificationFailed: notificationSent === false };
  }

  async getMedicalLocks(currentUser: CurrentUserPayload, query: MedicalLockQueryDto) {
    const {
      horseId,
      tab,
      overdueOnly,
      appliedMedicalStatus,
      search,
      page = '1',
      limit = '10',
    } = query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where: any = {};

    if (horseId) {
      await this.access.checkHorseAccess(horseId, currentUser);
      where.horseId = horseId;
    } else if (currentUser.role === Role.HORSE_OWNER) {
      where.horse = { ownerId: currentUser.userId };
    } else if (currentUser.role === Role.GROOM) {
      where.horse = horsesInZones(await groomZoneIds(this.prisma, currentUser.userId));
    }

    if (tab === 'ACTIVE') {
      where.isLocked = true;
    } else if (tab === 'HISTORY') {
      where.isLocked = false;
    }

    if (appliedMedicalStatus) {
      where.appliedMedicalStatus = appliedMedicalStatus;
    }

    const now = effectiveNow();
    if (overdueOnly === 'true') {
      where.isLocked = true;
      where.recheckDate = { lt: now };
    }

    if (search) {
      where.OR = [
        { lockCode: { contains: search, mode: 'insensitive' } },
        { lockReason: { contains: search, mode: 'insensitive' } },
        { horse: { name: { contains: search, mode: 'insensitive' } } },
        { horse: { microchip: { contains: search, mode: 'insensitive' } } },
        { horse: { microchipRfid: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [total, locks] = await Promise.all([
      this.prisma.medicalLock.count({ where }),
      this.prisma.medicalLock.findMany({
        where,
        skip,
        take,
        orderBy: { lockedAt: 'desc' },
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              microchip: true,
              microchipRfid: true,
              status: true,
            },
          },
          veterinarian: { select: { id: true, fullName: true, email: true } },
          unlockVet: { select: { id: true, fullName: true, email: true } },
          medicalRecord: { select: { id: true, examinationDate: true, clinicalDiagnosis: true } },
        },
      }),
    ]);

    const mappedLocks = locks.map((lock) => {
      const isOverdue = lock.isLocked && !!lock.recheckDate && lock.recheckDate < now;
      let daysOverdue = 0;
      if (isOverdue && lock.recheckDate) {
        daysOverdue = Math.floor(
          (now.getTime() - new Date(lock.recheckDate).getTime()) / (24 * 60 * 60 * 1000),
        );
      }

      const lockDurationDays = Math.ceil(
        ((lock.unlockedAt ? new Date(lock.unlockedAt) : now).getTime() -
          new Date(lock.lockedAt).getTime()) /
          (24 * 60 * 60 * 1000),
      );

      return {
        ...lock,
        isOverdue,
        daysOverdue,
        lockDurationDays,
      };
    });

    return {
      data: mappedLocks,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(total / take),
    };
  }

  async getMedicalLockDetail(id: string, currentUser: CurrentUserPayload) {
    const lock = await this.prisma.medicalLock.findUnique({
      where: { id },
      include: {
        horse: {
          select: {
            id: true,
            name: true,
            horseCode: true,
            microchip: true,
            microchipRfid: true,
            status: true,
            ownerId: true,
          },
        },
        veterinarian: { select: { id: true, fullName: true, email: true, phoneNumber: true } },
        unlockVet: { select: { id: true, fullName: true, email: true } },
        medicalRecord: { select: { id: true, examinationDate: true, clinicalDiagnosis: true } },
      },
    });

    if (!lock) {
      throw apiError(HttpStatus.NOT_FOUND, 'LOCK_NOT_FOUND', 'Training Lock not found.');
    }

    await this.access.checkHorseAccess(lock.horseId, currentUser);

    const now = effectiveNow();
    const isOverdue = lock.isLocked && !!lock.recheckDate && lock.recheckDate < now;
    let daysOverdue = 0;
    if (isOverdue && lock.recheckDate) {
      daysOverdue = Math.floor(
        (now.getTime() - new Date(lock.recheckDate).getTime()) / (24 * 60 * 60 * 1000),
      );
    }

    const lockDurationDays = Math.ceil(
      ((lock.unlockedAt ? new Date(lock.unlockedAt) : now).getTime() -
        new Date(lock.lockedAt).getTime()) /
        (24 * 60 * 60 * 1000),
    );

    return {
      ...lock,
      isOverdue,
      daysOverdue,
      lockDurationDays,
    };
  }
}
