import { effectiveNow } from '../common/utils/demo-clock';
import { MedicalLifecycleService } from './medical-lifecycle.service';
import { renderMail, linkBase } from '../business-mail/templates/html';
import { prescriptionIssued } from '../business-mail/templates/health-templates';
import { HttpStatus, Injectable } from '@nestjs/common';
import { apiError } from '../common/exceptions/api-error';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import {
  DailyTaskType,
  Role,
  HorseStatus,
  SeverityLevel,
  SupplyCategory,
  SupplyUnit,
} from '@prisma/client';
import { assertStatusTransition } from '../horses/horse-rules';
import { CreateMedicalRecordDto } from './dto/create-medical-record.dto';
import { UpdateMedicalRecordDto } from './dto/update-medical-record.dto';
import { MedicalRecordQueryDto } from './dto/medical-record-query.dto';
import { CreateTreatmentPhaseDto, UpdateTreatmentPhaseDto } from './dto/treatment-phase.dto';
import {
  CreatePrescriptionDto,
  StopPrescriptionDto,
  UpdatePrescriptionDto,
} from './dto/prescription.dto';
import { CreateFollowUpDto } from './dto/follow-up.dto';
import { CloseMedicalRecordDto, ReopenMedicalRecordDto } from './dto/close-record.dto';
import { FinalizeRecordDto } from './dto/finalize-record.dto';
import { PrismaService } from '../prisma/prisma.service';
import { groomZoneIds, horsesInZones } from '../shift-rosters/groom-zones';
import { AuditService } from '../audit/audit.service';
import { MedicalAccessService } from './medical-access.service';
import { MedicalLocksService } from './medical-locks.service';
import { Optional } from '@nestjs/common';
import { DailyTasksService } from '../daily-tasks/daily-tasks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { clubDate } from '../training/training-rules';

/** Đơn vị trên đơn thuốc lấy theo đơn vị của thuốc trong kho, bác sĩ không chọn đơn vị khác. */
const RX_UNIT: Record<SupplyUnit, string> = {
  KG: 'kg',
  G: 'g',
  LITER: 'l',
  ML: 'ml',
  PILL: 'tablets',
  PACKET: 'sachets',
  BOTTLE: 'bottles',
  VIAL: 'vials',
  PIECE: 'pieces',
  SET: 'sets',
};

/** P2-02: bệnh án, phác đồ, đơn thuốc, tái khám (FR-3.03 → FR-3.07). */
@Injectable()
export class MedicalRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: MedicalAccessService,
    private readonly locks: MedicalLocksService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly dailyTasks?: DailyTasksService,
    @Optional() private readonly mailService?: MailService,
  ) {}

  private async syncHorseMedicalTasks(
    horseId: string,
    fromDateStr?: string,
    toDateStr?: string,
  ): Promise<boolean> {
    if (!this.dailyTasks?.syncMedicalTasksForHorse) return false;
    return this.dailyTasks.syncMedicalTasksForHorse(horseId, fromDateStr, toDateStr).then(
      () => false,
      () => true,
    );
  }

  private async publishDiagnosis(
    horseId: string,
    recordId: string,
    diagnosis: string | undefined,
    actor: CurrentUserPayload,
  ) {
    if (!diagnosis?.trim() || diagnosis === 'Chờ chẩn đoán') return false;
    const sent = await this.notifications.notifyHorse(
      horseId,
      { roles: [Role.CLUB_MANAGER], trainer: true, owner: true, groom: true },
      {
        email: {
          eventCode: 'INCIDENT_CONFIRMED',
          body: {
            ...renderMail('Kết luận y tế đã xác nhận', [
              { label: 'Hồ sơ', value: recordId },
              { label: 'Bác sĩ xác nhận', value: actor.fullName },
              {
                label: 'Hướng dẫn và hạn chế',
                value: 'Xem chỉ định đang có hiệu lực trong hồ sơ sau đăng nhập.',
              },
              { label: 'Xem hồ sơ', value: linkBase() + '/medical/horses/' + horseId },
            ]),
            refId: recordId,
          },
        },
        type: 'MEDICAL_DIAGNOSIS_CONFIRMED',
        category: 'MEDICAL',
        title: 'Veterinary diagnosis confirmed',
        message:
          'The veterinarian has confirmed a diagnosis. View the horse’s health record for care instructions.',
        link: `/medical/horses/${horseId}`,
        dedupeKey: `medical-diagnosis:${recordId}`,
        senderName: actor.fullName,
      },
      actor.userId,
    );
    return sent === false;
  }

  /** Trạng thái đề xuất hợp lệ của ngựa; giá trị lạ hoặc rỗng → null. */
  private toHorseStatus(value?: string | null): HorseStatus | null {
    return value && Object.values(HorseStatus).includes(value as HorseStatus)
      ? (value as HorseStatus)
      : null;
  }

  /** Mã MED-YYYY-NNN: số thứ tự đếm lại mỗi năm, lấy số lớn nhất hiện có + 1 (không trùng sau khi xóa nháp). */
  private async nextRecordNumber(now: Date): Promise<string> {
    const year = now.getFullYear();
    const prefix = `MED-${year}-`;
    const last = await this.prisma.medicalRecord.findFirst({
      where: { recordNumber: { startsWith: prefix } },
      orderBy: { recordNumber: 'desc' },
      select: { recordNumber: true },
    });
    const lastSeq = last?.recordNumber ? parseInt(last.recordNumber.slice(prefix.length), 10) : 0;
    return `${prefix}${String((Number.isNaN(lastSeq) ? 0 : lastSeq) + 1).padStart(3, '0')}`;
  }

  async createMedicalRecord(actor: CurrentUserPayload, dto: CreateMedicalRecordDto) {
    this.access.assertVet(actor, 'create medical records');

    const horse = await this.prisma.horse.findUnique({
      where: { id: dto.horseId, deletedAt: null },
    });
    if (!horse) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Horse not found.');
    }

    if (horse.status === HorseStatus.RETIRED) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'HORSE_RETIRED',
        'The horse is no longer managed by the club; medical records cannot be created.',
      );
    }

    // #9: bệnh án mở từ một sự cố phải dành cho đúng con ngựa trong sự cố đó.
    if (dto.incidentId) {
      const incident = await this.prisma.incidentReport.findUnique({
        where: { id: dto.incidentId },
        select: { horseId: true },
      });
      if (!incident) {
        throw apiError(HttpStatus.NOT_FOUND, 'INCIDENT_NOT_FOUND', 'Incident report not found.');
      }
      if (incident.horseId !== dto.horseId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INCIDENT_HORSE_MISMATCH',
          'Bệnh án phải được tạo cho đúng con ngựa trong báo cáo sự cố.',
        );
      }
    }

    // Kiểm tra quy tắc nghiệp vụ: Mỗi chiến mã chỉ có tối đa 1 bệnh án mở tại một thời điểm
    const existingOpenRecord = await this.prisma.medicalRecord.findFirst({
      where: {
        horseId: dto.horseId,
        status: 'OPEN',
      },
      select: { id: true, recordNumber: true },
    });
    if (existingOpenRecord) {
      throw apiError(
        HttpStatus.CONFLICT,
        'HORSE_HAS_OPEN_RECORD',
        `Chiến mã này đang có bệnh án ở trạng thái mở (${existingOpenRecord.recordNumber || existingOpenRecord.id}). Không thể tạo thêm bệnh án khi bệnh án cũ chưa kết thúc điều trị.`,
      );
    }

    let examDate = effectiveNow();
    if (dto.examinationDate) {
      examDate = new Date(dto.examinationDate);
      const now = effectiveNow();
      if (examDate > now) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'DATE_IN_FUTURE',
          'The examination date cannot be in the future.',
        );
      }
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      if (examDate < thirtyDaysAgo) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'DATE_TOO_OLD',
          'The examination date cannot be more than 30 days ago.',
        );
      }
    }

    const isDraft = dto.isDraft ?? false;
    const recommendedHorseStatus = this.toHorseStatus(dto.recommendedHorseStatus);
    const recordNumber = await this.nextRecordNumber(effectiveNow());

    // Build labTests JSON
    let labTestsStr: string | null = null;
    if (dto.labTests && dto.labTests.length > 0) {
      labTestsStr = JSON.stringify(dto.labTests);
    }

    const record = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${dto.horseId} FOR UPDATE`;
      const currentHorse = await tx.horse.findUnique({ where: { id: dto.horseId } });
      if (!currentHorse || currentHorse.deletedAt || currentHorse.status === 'RETIRED')
        throw apiError(HttpStatus.CONFLICT, 'HORSE_RETIRED', 'Horse is no longer active.');
      const open = await tx.medicalRecord.findFirst({
        where: { horseId: dto.horseId, status: 'OPEN' },
      });
      if (!isDraft && open)
        throw apiError(
          HttpStatus.CONFLICT,
          'HORSE_HAS_OPEN_RECORD',
          'Horse already has an open record.',
        );
      const record = await tx.medicalRecord.create({
        data: {
          recordNumber,
          proposeMedicalLock:
            !!dto.proposeMedicalLock || ['SEVERE', 'CRITICAL'].includes(dto.severity ?? ''),
          lockExpectedRestDays: dto.lockExpectedRestDays ?? 7,
          lockUnlockConditions: dto.lockUnlockConditions,
          horseId: dto.horseId,
          veterinarianUserId: actor.userId,
          examinationDate: examDate,
          examinationType: dto.examinationType || 'Routine Clinical',
          discoverySource: dto.discoverySource || null,
          severity: dto.severity || SeverityLevel.MODERATE,
          recommendedHorseStatus,
          examinationReason: dto.reason || null,
          temperature: dto.vitals?.temperature ? Number(dto.vitals.temperature) : null,
          restingHeartRate: dto.vitals?.restingHeartRate
            ? Number(dto.vitals.restingHeartRate)
            : null,
          respiratoryRate: dto.vitals?.respiratoryRate ? Number(dto.vitals.respiratoryRate) : null,
          weightKg: dto.vitals?.weightKg ? Number(dto.vitals.weightKg) : null,
          clinicalExamination: dto.vitals?.clinicalExamination || null,
          symptoms: dto.symptoms || dto.reason || 'Khám tổng quát',
          clinicalDiagnosis: dto.diagnosis || 'Chờ chẩn đoán',
          treatmentProtocol:
            dto.reason || dto.vitals?.clinicalExamination || 'Theo dõi và điều trị',
          labTests: labTestsStr,
          requiresFollowUp: false,
          status: isDraft ? 'DRAFT' : 'OPEN',
        },
        include: {
          horse: true,
          veterinarian: true,
        },
      });

      if (!isDraft && recommendedHorseStatus) {
        if (horse.status !== recommendedHorseStatus) {
          await tx.horse.update({
            where: { id: dto.horseId },
            data: { status: recommendedHorseStatus },
          });

          await this.audit.record(
            { id: actor.userId, name: actor.fullName },
            'HORSE_STATUS_CHANGED',
            `Changed status of horse ${horse.name} from ${horse.status} to ${recommendedHorseStatus}. Reason: Đề xuất từ bệnh án #${recordNumber}`,
            horse.id,
            { entityName: 'Horse' },
            tx,
          );
        }
      }

      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        isDraft ? 'CREATE_MEDICAL_RECORD_DRAFT' : 'CREATE_MEDICAL_RECORD',
        `Medical record created for horse ${dto.horseId}`,
        record.id,
        { entityName: 'MedicalRecord' },
        tx,
      );

      if (dto.incidentId) {
        const sourceIncident = await tx.incidentReport.findUnique({
          where: { id: dto.incidentId },
        });
        if (
          !sourceIncident ||
          sourceIncident.horseId !== dto.horseId ||
          !['REPORTED', 'UNDER_REVIEW'].includes(sourceIncident.status)
        )
          throw apiError(
            HttpStatus.CONFLICT,
            'INCIDENT_STATE_CONFLICT',
            'Incident is no longer available.',
          );
        await tx.incidentReport.update({
          where: { id: dto.incidentId },
          data: { medicalRecordId: record.id, status: 'UNDER_REVIEW' },
        });
      }

      if (dto.incidentId)
        await tx.medicalLock.updateMany({
          where: { sourceIncidentId: dto.incidentId, isLocked: true },
          data: { medicalRecordId: record.id },
        });
      if (
        !isDraft &&
        (['SEVERE', 'CRITICAL'].includes(dto.severity ?? '') || dto.proposeMedicalLock)
      ) {
        await new MedicalLifecycleService(this.audit).placeVeterinaryLock(
          tx,
          {
            horseId: dto.horseId,
            medicalRecordId: record.id,
            appliedMedicalStatus: recommendedHorseStatus ?? HorseStatus.INJURED,
            lockReason: `Bảo vệ từ bệnh án ${recordNumber}`,
            expectedRestDays: 7,
          },
          actor,
        );
      }
      return record;
    });

    const careSyncFailed = isDraft ? false : await this.syncHorseMedicalTasks(dto.horseId);
    const notificationFailed =
      isDraft || !dto.diagnosis
        ? false
        : await this.publishDiagnosis(dto.horseId, record.id, dto.diagnosis, actor);
    return { ...record, notificationFailed, careSyncFailed };
  }

  async getMedicalRecords(currentUser: CurrentUserPayload, query: MedicalRecordQueryDto) {
    const { horseId, status, startDate, endDate, search, page = '1', limit = '10' } = query;
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

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.examinationDate = {};
      if (startDate) where.examinationDate.gte = new Date(startDate);
      if (endDate) where.examinationDate.lte = new Date(endDate);
    }

    if (search && search.trim()) {
      const term = search.trim();
      where.OR = [
        { recordNumber: { contains: term, mode: 'insensitive' } },
        { symptoms: { contains: term, mode: 'insensitive' } },
        { clinicalDiagnosis: { contains: term, mode: 'insensitive' } },
        { clinicalExamination: { contains: term, mode: 'insensitive' } },
        { horse: { name: { contains: term, mode: 'insensitive' } } },
        { horse: { horseCode: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [total, records] = await Promise.all([
      this.prisma.medicalRecord.count({ where }),
      this.prisma.medicalRecord.findMany({
        where,
        skip,
        take,
        orderBy: { examinationDate: 'desc' },
        include: {
          horse: {
            select: { id: true, name: true, horseCode: true, microchipRfid: true, status: true },
          },
          veterinarian: {
            select: { id: true, fullName: true, email: true },
          },
          injuries: true,
        },
      }),
    ]);

    // Mask sensitive details for HORSE_OWNER if needed
    const mappedRecords = records.map((record) => {
      const horseName = record.horse?.name ?? null;
      const horseCode = (record.horse as any)?.horseCode ?? null;
      // FE đọc `diagnosis` / `vetName` (giống health-overview); giữ cả tên cột gốc.
      const diagnosis = record.clinicalDiagnosis;
      const vetName = record.veterinarian?.fullName ?? null;
      if (currentUser.role === Role.HORSE_OWNER) {
        return {
          id: record.id,
          horseId: record.horseId,
          horseName,
          horseCode,
          horse: record.horse,
          examinationDate: record.examinationDate,
          symptoms: record.symptoms,
          clinicalDiagnosis: record.clinicalDiagnosis,
          diagnosis,
          vetName,
          requiresFollowUp: record.requiresFollowUp,
          followUpDate: record.followUpDate,
          createdAt: record.createdAt,
        };
      }
      return {
        ...record,
        horseName,
        horseCode,
        diagnosis,
        vetName,
      };
    });

    return {
      data: mappedRecords,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      totalPages: Math.ceil(total / take),
    };
  }

  async getMedicalRecordDetail(id: string, currentUser: CurrentUserPayload) {
    const record = await this.prisma.medicalRecord.findUnique({
      where: { id },
      include: {
        horse: {
          include: {
            medicalLocks: { where: { isLocked: true } },
          },
        },
        veterinarian: {
          select: { id: true, fullName: true, email: true, phoneNumber: true },
        },
        injuries: true,
      },
    });

    if (!record) {
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');
    }

    await this.access.checkHorseAccess(record.horseId, currentUser);

    // Đọc và parse danh sách giai đoạn phác đồ điều trị
    let treatmentPhases: any[] = [];
    if (record.treatmentPhases) {
      try {
        const parsed = JSON.parse(record.treatmentPhases);
        if (Array.isArray(parsed)) treatmentPhases = parsed;
      } catch {
        /* ignore invalid JSON */
      }
    }

    // Đọc và parse danh sách đơn thuốc (từ prescriptions hoặc fallback prescriptionDetails)
    let prescriptions: any[] = [];
    const rxSource = record.prescriptions || record.prescriptionDetails;
    if (rxSource) {
      try {
        const parsed = JSON.parse(rxSource);
        if (Array.isArray(parsed)) {
          prescriptions = parsed;
        } else if (parsed && typeof parsed === 'object' && !parsed.labTests) {
          prescriptions = [parsed];
        }
      } catch {
        /* ignore invalid JSON */
      }
    }

    // Đọc và parse danh sách các lần tái khám
    let followUps: any[] = [];
    if (record.followUps) {
      try {
        const parsed = JSON.parse(record.followUps);
        if (Array.isArray(parsed)) followUps = parsed;
      } catch {
        /* ignore invalid JSON */
      }
    }

    // Đọc danh sách xét nghiệm từ cột riêng labTests hoặc prescriptionDetails
    let labTests: any[] = [];
    if (record.labTests) {
      try {
        const parsed = JSON.parse(record.labTests);
        if (Array.isArray(parsed)) labTests = parsed;
      } catch {
        /* ignore invalid JSON */
      }
    } else if (record.prescriptionDetails) {
      try {
        const parsed = JSON.parse(record.prescriptionDetails);
        if (parsed?.labTests && Array.isArray(parsed.labTests)) {
          labTests = parsed.labTests;
        }
      } catch {
        /* ignore invalid JSON */
      }
    }

    const vitals = {
      temperature: record.temperature ?? undefined,
      restingHeartRate: record.restingHeartRate ?? undefined,
      respiratoryRate: record.respiratoryRate ?? undefined,
      weightKg: record.weightKg ?? undefined,
      clinicalNotes: record.clinicalExamination ?? undefined,
    };

    if (currentUser.role === Role.HORSE_OWNER) {
      return {
        id: record.id,
        recordNumber: record.recordNumber || record.id,
        horseId: record.horseId,
        horseName: record.horse?.name,
        horse: record.horse,
        status: record.status,
        veterinarian: record.veterinarian,
        vetName: record.veterinarian?.fullName,
        examinationDate: record.examinationDate.toISOString(),
        examinationType: record.examinationType || 'Routine Clinical',
        symptoms: record.symptoms,
        clinicalDiagnosis: record.clinicalDiagnosis,
        diagnosis: record.clinicalDiagnosis,
        requiresFollowUp: record.requiresFollowUp,
        followUpDate: record.followUpDate,
        conclusion: record.conclusion || undefined,
        treatmentResult: record.treatmentResult || undefined,
        treatmentPhases,
        prescriptions,
        followUps,
        labTests,
        closedAt: record.closedAt ? record.closedAt.toISOString() : undefined,
        createdAt: record.createdAt.toISOString(),
      };
    }

    return {
      ...record,
      recordNumber: record.recordNumber || record.id,
      horseName: record.horse?.name,
      vetName: record.veterinarian?.fullName,
      diagnosis: record.clinicalDiagnosis,
      examinationReason: record.examinationReason ?? undefined,
      status: record.status,
      examinationType: record.examinationType || 'Routine Clinical',
      discoverySource: record.discoverySource || 'VET Self-Discovered',
      severity: record.severity || 'MODERATE',
      proposedStatus: record.recommendedHorseStatus ?? undefined,
      conclusion: record.conclusion || undefined,
      treatmentResult: record.treatmentResult || undefined,
      vitals,
      treatmentPhases,
      prescriptions,
      followUps,
      labTests,
      examinationDate: record.examinationDate
        ? typeof record.examinationDate === 'string'
          ? record.examinationDate
          : record.examinationDate.toISOString()
        : effectiveNow().toISOString(),
      closedAt: record.closedAt
        ? typeof record.closedAt === 'string'
          ? record.closedAt
          : record.closedAt.toISOString()
        : undefined,
      reopenedAt: record.reopenedAt
        ? typeof record.reopenedAt === 'string'
          ? record.reopenedAt
          : record.reopenedAt.toISOString()
        : undefined,
      createdAt: record.createdAt
        ? typeof record.createdAt === 'string'
          ? record.createdAt
          : record.createdAt.toISOString()
        : effectiveNow().toISOString(),
      updatedAt: record.updatedAt
        ? typeof record.updatedAt === 'string'
          ? record.updatedAt
          : record.updatedAt.toISOString()
        : effectiveNow().toISOString(),
    };
  }

  async updateMedicalRecord(id: string, actor: CurrentUserPayload, dto: UpdateMedicalRecordDto) {
    this.access.assertVet(actor, 'edit medical records');

    const record = await this.prisma.medicalRecord.findUnique({
      where: { id },
    });
    if (!record) {
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');
    }
    // Cho phép chỉnh sửa khi bệnh án ở trạng thái nháp (DRAFT) hoặc đang mở điều trị (OPEN).
    // Bệnh án đã đóng / kết thúc (CLOSED) không được phép chỉnh sửa.
    if (record.status === 'CLOSED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_CLOSED',
        'Cannot edit a medical record that has already been closed.',
      );
    }

    const dataToUpdate: any = {};
    if (dto.symptoms !== undefined) dataToUpdate.symptoms = dto.symptoms;
    if (dto.diagnosis !== undefined) dataToUpdate.clinicalDiagnosis = dto.diagnosis;
    if (dto.reason !== undefined) {
      dataToUpdate.examinationReason = dto.reason;
      dataToUpdate.treatmentProtocol = dto.reason;
    }
    if (dto.examinationType !== undefined) dataToUpdate.examinationType = dto.examinationType;
    if (dto.discoverySource !== undefined) dataToUpdate.discoverySource = dto.discoverySource;
    if (dto.severity !== undefined) dataToUpdate.severity = dto.severity;
    if (record.status === 'DRAFT') {
      if (dto.proposeMedicalLock !== undefined)
        dataToUpdate.proposeMedicalLock = dto.proposeMedicalLock;
      if (dto.lockExpectedRestDays !== undefined)
        dataToUpdate.lockExpectedRestDays = dto.lockExpectedRestDays;
      if (dto.lockUnlockConditions !== undefined)
        dataToUpdate.lockUnlockConditions = dto.lockUnlockConditions;
      if (['SEVERE', 'CRITICAL'].includes(dto.severity ?? ''))
        dataToUpdate.proposeMedicalLock = true;
    }
    if (dto.recommendedHorseStatus !== undefined) {
      dataToUpdate.recommendedHorseStatus = this.toHorseStatus(dto.recommendedHorseStatus);
    }
    if (dto.vitals) {
      const v = dto.vitals;
      if (v.temperature !== undefined) dataToUpdate.temperature = Number(v.temperature);
      if (v.restingHeartRate !== undefined)
        dataToUpdate.restingHeartRate = Number(v.restingHeartRate);
      if (v.respiratoryRate !== undefined) dataToUpdate.respiratoryRate = Number(v.respiratoryRate);
      if (v.weightKg !== undefined) dataToUpdate.weightKg = Number(v.weightKg);
      if (v.clinicalExamination !== undefined)
        dataToUpdate.clinicalExamination = v.clinicalExamination;
    }
    if (dto.labTests !== undefined) {
      dataToUpdate.labTests = dto.labTests.length > 0 ? JSON.stringify(dto.labTests) : null;
    }
    if (dto.examinationDate) {
      const examDate = new Date(dto.examinationDate);
      const now = effectiveNow();
      if (examDate > now) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'DATE_IN_FUTURE',
          'The examination date cannot be in the future.',
        );
      }
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      if (examDate < thirtyDaysAgo) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'DATE_TOO_OLD',
          'The examination date cannot be more than 30 days ago.',
        );
      }
      dataToUpdate.examinationDate = examDate;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${record.horseId} FOR UPDATE`;
      const currentRecord = await tx.medicalRecord.findUnique({ where: { id } });
      if (!currentRecord || currentRecord.status === 'CLOSED')
        throw apiError(HttpStatus.CONFLICT, 'RECORD_CLOSED', 'Record was closed while editing.');
      if (
        currentRecord.status !== record.status ||
        (currentRecord.updatedAt &&
          record.updatedAt &&
          +currentRecord.updatedAt !== +record.updatedAt)
      )
        throw apiError(
          HttpStatus.CONFLICT,
          'RECORD_CHANGED',
          'Record changed while editing. Refresh before saving clinical changes.',
        );
      let horseUpdateNeeded = false;
      let targetHorse: any = null;

      if (currentRecord.status === 'OPEN' && dataToUpdate.recommendedHorseStatus) {
        targetHorse = await tx.horse.findUnique({
          where: { id: record.horseId },
          select: { id: true, name: true, status: true, isMedicalLocked: true },
        });

        if (targetHorse && targetHorse.status !== dataToUpdate.recommendedHorseStatus) {
          if (targetHorse.status === HorseStatus.RETIRED) {
            throw apiError(
              HttpStatus.BAD_REQUEST,
              'HORSE_RETIRED',
              'The horse is no longer managed by the club; its status cannot change.',
            );
          }

          assertStatusTransition({
            role: actor.role,
            from: targetHorse.status,
            to: dataToUpdate.recommendedHorseStatus,
            isMedicalLocked: targetHorse.isMedicalLocked,
            reason: `Cập nhật từ bệnh án #${record.recordNumber || record.id}`,
          });

          horseUpdateNeeded = true;
        }
      }

      const updatedRecord = await tx.medicalRecord.update({
        where: { id },
        data: dataToUpdate,
        include: {
          horse: true,
          veterinarian: true,
          injuries: true,
        },
      });

      if (horseUpdateNeeded && targetHorse) {
        await tx.horse.update({
          where: { id: record.horseId },
          data: { status: dataToUpdate.recommendedHorseStatus },
        });
      }

      if (currentRecord.status === 'OPEN' && ['SEVERE', 'CRITICAL'].includes(dto.severity ?? '')) {
        await new MedicalLifecycleService(this.audit).placeVeterinaryLock(
          tx,
          {
            horseId: record.horseId,
            medicalRecordId: id,
            appliedMedicalStatus:
              dataToUpdate.recommendedHorseStatus ??
              record.recommendedHorseStatus ??
              HorseStatus.INJURED,
            lockReason: `Bảo vệ sau cập nhật bệnh án ${record.recordNumber ?? id}`,
            expectedRestDays: dto.lockExpectedRestDays ?? record.lockExpectedRestDays ?? 7,
          },
          actor,
        );
      }
      return { updatedRecord, horseUpdateNeeded, targetHorse };
    });

    if (updated.horseUpdateNeeded && updated.targetHorse) {
      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'HORSE_STATUS_CHANGED',
        `Changed status of horse ${updated.targetHorse.name} from ${updated.targetHorse.status} to ${dataToUpdate.recommendedHorseStatus}. Reason: Cập nhật từ bệnh án #${record.recordNumber || record.id}`,
        record.horseId,
      );
    }

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'UPDATE_MEDICAL_RECORD',
      `Medical record ${id} updated`,
      id,
      { entityName: 'MedicalRecord' },
    );

    return updated.updatedRecord;
  }

  async deleteMedicalRecord(id: string, actor: CurrentUserPayload) {
    this.access.assertVet(actor, 'delete medical records');

    const record = await this.prisma.medicalRecord.findUnique({
      where: { id },
    });
    if (!record) {
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');
    }

    if (record.status !== 'DRAFT') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_NOT_DRAFT',
        'Only a draft medical record can be deleted.',
      );
    }

    if (record.veterinarianUserId !== actor.userId && actor.role !== Role.CLUB_MANAGER) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'NOT_DRAFT_OWNER',
        'Only the veterinarian who created this draft can delete it.',
      );
    }

    await this.prisma.medicalRecord.delete({ where: { id } });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'DELETE_MEDICAL_RECORD',
      `Medical record draft ${id} deleted`,
      id,
      { entityName: 'MedicalRecord' },
    );

    return { message: 'Đã xóa bản nháp bệnh án thành công' };
  }

  async finalizeMedicalRecord(recordId: string, actor: CurrentUserPayload, dto: FinalizeRecordDto) {
    this.access.assertVet(actor, 'finalize medical records');
    const initial = await this.prisma.medicalRecord.findUnique({ where: { id: recordId } });
    if (!initial)
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${initial.horseId} FOR UPDATE`;
      const record = await tx.medicalRecord.findUnique({
        where: { id: recordId },
        include: { horse: true },
      });
      if (!record || record.status !== 'DRAFT')
        throw apiError(
          HttpStatus.CONFLICT,
          'RECORD_ALREADY_FINALIZED',
          'This record is already official.',
        );
      const other = await tx.medicalRecord.findFirst({
        where: { horseId: record.horseId, status: 'OPEN', id: { not: recordId } },
      });
      if (other)
        throw apiError(
          HttpStatus.CONFLICT,
          'HORSE_HAS_OPEN_RECORD',
          'This horse already has an open medical record.',
        );
      const shouldLock =
        (dto.proposeMedicalLock ?? record.proposeMedicalLock) ||
        ['SEVERE', 'CRITICAL'].includes(record.severity ?? '');
      if (shouldLock) {
        try {
          await new MedicalLifecycleService(this.audit).placeVeterinaryLock(
            tx,
            {
              horseId: record.horseId,
              medicalRecordId: record.id,
              appliedMedicalStatus: record.recommendedHorseStatus ?? HorseStatus.INJURED,
              lockReason:
                dto.lockReason ?? `Khóa khi chốt bệnh án ${record.recordNumber ?? record.id}`,
              expectedRestDays: dto.lockExpectedRestDays ?? record.lockExpectedRestDays ?? 7,
              unlockConditions:
                dto.lockUnlockConditions ?? record.lockUnlockConditions ?? undefined,
            },
            actor,
          );
        } catch (error) {
          throw apiError(HttpStatus.BAD_REQUEST, 'FINALIZE_LOCK_FAILED', String(error));
        }
      } else if (dto.applyProposedStatus && record.recommendedHorseStatus) {
        assertStatusTransition({
          role: actor.role,
          from: record.horse.status,
          to: record.recommendedHorseStatus,
          isMedicalLocked: record.horse.isMedicalLocked,
          reason: 'Finalized veterinary recommendation',
        });
        await tx.horse.update({
          where: { id: record.horseId },
          data: { status: record.recommendedHorseStatus },
        });
      }
      const result = await tx.medicalRecord.update({
        where: { id: recordId },
        data: { status: 'OPEN' },
      });
      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'FINALIZE_MEDICAL_RECORD',
        `Finalized ${recordId}`,
        recordId,
        { entityName: 'MedicalRecord' },
        tx,
      );
      return result;
    });
    const careSyncFailed = await this.syncHorseMedicalTasks(initial.horseId);
    const notificationFailed = await this.publishDiagnosis(
      initial.horseId,
      recordId,
      initial.clinicalDiagnosis,
      actor,
    );
    return { record: updated, notificationFailed, careSyncFailed };
  }

  async closeMedicalRecord(id: string, actor: CurrentUserPayload, dto: CloseMedicalRecordDto) {
    this.access.assertVet(actor, 'close medical records');
    const initial = await this.prisma.medicalRecord.findUnique({ where: { id } });
    if (!initial)
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');
    if (initial.status === 'CLOSED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_ALREADY_CLOSED',
        'This medical record is already closed.',
      );
    }
    // Nháp phải chốt (OPEN) trước rồi mới kết thúc điều trị.
    if (initial.status === 'DRAFT') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_NOT_OPEN',
        'Finalize the draft before concluding treatment.',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${initial.horseId} FOR UPDATE`;
      const record = await tx.medicalRecord.findUnique({ where: { id } });
      if (!record || record.status !== 'OPEN')
        throw apiError(
          HttpStatus.CONFLICT,
          'RECORD_NOT_OPEN',
          'Only an open medical record can be closed.',
        );
      const locks = await tx.medicalLock.findMany({
        where: { medicalRecordId: id, isLocked: true },
      });
      const activeHorseLocks = await tx.medicalLock.findMany({
        where: { horseId: record.horseId, isLocked: true },
      });
      const activeHorseLock = tx.medicalLock.findFirst
        ? await tx.medicalLock.findFirst({ where: { horseId: record.horseId, isLocked: true } })
        : null;
      const recovered = (dto.treatmentResult ?? 'RECOVERED') === 'RECOVERED';
      if (
        recovered &&
        (locks.length || activeHorseLocks.length || activeHorseLock) &&
        (!dto.recoveryConfirmed || !dto.postTreatmentStatus)
      ) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'ACTIVE_LOCK_EXISTS',
          'Chiến mã vẫn còn Khóa huấn luyện y tế đang hiệu lực. Vui lòng xác nhận hồi phục trước khi đóng bệnh án. / Cannot close medical record while Training Lock is active. Please confirm recovery first.',
        );
      }
      let rx: any[] = [];
      try {
        const parsed = JSON.parse(record.prescriptions || record.prescriptionDetails || '[]');
        if (Array.isArray(parsed)) rx = parsed;
      } catch {
        /* Preserve closure for legacy malformed prescriptions. */
      }
      const now = effectiveNow();
      const stopped = rx.map((item) =>
        item.status === 'ACTIVE'
          ? {
              ...item,
              status: 'STOPPED',
              stoppedAt: now.toISOString(),
              stoppedReason: 'Bệnh án kết thúc điều trị',
            }
          : item,
      );
      const updated = await tx.medicalRecord.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: now,
          conclusion: dto.conclusion,
          treatmentResult: dto.treatmentResult ?? 'RECOVERED',
          requiresFollowUp: false,
          treatmentProtocol: `${record.treatmentProtocol}\n[KẾT LUẬN]: ${dto.conclusion}`,
          prescriptions: JSON.stringify(stopped),
          prescriptionDetails: JSON.stringify(stopped),
        },
      });
      let state: { remainingActiveLocks: any[]; isMedicalLocked: boolean; horseStatus: any };
      if (recovered && dto.recoveryConfirmed && dto.postTreatmentStatus) {
        state = await new MedicalLifecycleService(this.audit).releaseRecordLocks(
          tx,
          id,
          actor,
          dto.postTreatmentStatus,
        );
      } else {
        const remainingActiveLocks = await tx.medicalLock.findMany({
          where: { horseId: record.horseId, isLocked: true },
        });
        const horse = await tx.horse.findUnique({ where: { id: record.horseId } });
        let horseStatus = horse?.status;
        if (
          !remainingActiveLocks.length &&
          horse &&
          horse.status !== HorseStatus.RETIRED &&
          horse.status !== HorseStatus.RESTING
        ) {
          horseStatus = dto.postTreatmentStatus || HorseStatus.RESTING;
          await tx.horse.update({
            where: { id: record.horseId },
            data: { status: horseStatus, isMedicalLocked: false },
          });
        }
        state = {
          remainingActiveLocks,
          isMedicalLocked: remainingActiveLocks.length > 0,
          horseStatus,
        };
      }
      await this.audit.record(
        { id: actor.userId, name: actor.fullName },
        'CLOSE_MEDICAL_RECORD',
        `Closed ${id}: ${dto.conclusion}`,
        id,
        { entityName: 'MedicalRecord' },
        tx,
      );
      return { ...updated, ...state };
    });

    // Khóa các công việc y tế chưa hoàn thành của ngựa và ghi chú thông báo cho Groom
    if (this.prisma.dailyCareTask?.updateMany) {
      await this.prisma.dailyCareTask.updateMany({
        where: {
          horseId: initial.horseId,
          isCompleted: false,
          taskType: {
            in: [
              DailyTaskType.MEDICATION,
              DailyTaskType.ICE_BOOT_REST,
              DailyTaskType.PHYSICAL_THERAPY,
            ],
          },
        },
        data: {
          isMedicalLocked: true,
          medicalLockNotes: 'Bác sĩ thú y đã kết thúc điều trị / đóng bệnh án.',
          cancelledAt: effectiveNow(),
        },
      });
    }

    const careSyncFailed = await this.syncHorseMedicalTasks(initial.horseId);
    let notificationFailed = false;
    try {
      const sent = await this.notifications.notifyHorse(
        initial.horseId,
        { roles: [Role.CLUB_MANAGER], trainer: true, owner: true, groom: true },
        {
          type: 'MEDICAL_TREATMENT_CLOSED',
          category: 'MEDICAL',
          title: 'Bệnh án đã kết thúc điều trị',
          message: result.isMedicalLocked
            ? `Ngựa vẫn còn ${result.remainingActiveLocks.length} khóa bảo vệ đang hiệu lực.`
            : `Trạng thái sau điều trị: ${result.horseStatus}. Không tự khôi phục buổi tập hoặc đăng ký đã rút.`,
          link: `/medical/records/${id}`,
          dedupeKey: `record-closed:${id}:${result.closedAt?.toISOString()}`,
        },
      );
      notificationFailed = sent === false;
    } catch {
      notificationFailed = true;
    }
    return { ...result, notificationFailed, careSyncFailed };
  }

  async reopenMedicalRecord(id: string, actor: CurrentUserPayload, dto: ReopenMedicalRecordDto) {
    this.access.assertVet(actor, 'reopen medical records');

    const effectiveReason = (dto.reason || '').trim();
    if (!effectiveReason || effectiveReason.length < 10) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION',
        'Reason for reopening must be at least 10 characters.',
      );
    }

    const record = await this.prisma.medicalRecord.findUnique({ where: { id } });
    if (!record) {
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');
    }

    if (record.status !== 'CLOSED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_NOT_CLOSED',
        'Only a closed medical record can be reopened.',
      );
    }

    // Kiểm tra: Không thể mở lại bệnh án nếu ngựa đang có một bệnh án khác ở trạng thái OPEN
    const existingOpenRecord = await this.prisma.medicalRecord.findFirst({
      where: {
        horseId: record.horseId,
        status: 'OPEN',
        id: { not: record.id },
      },
      select: { id: true, recordNumber: true },
    });
    if (existingOpenRecord) {
      throw apiError(
        HttpStatus.CONFLICT,
        'HORSE_HAS_OPEN_RECORD',
        `Chiến mã này đang có một bệnh án khác ở trạng thái mở (${existingOpenRecord.recordNumber || existingOpenRecord.id}). Không thể mở lại bệnh án này.`,
      );
    }

    // Kiểm tra quy tắc nghiệp vụ: Chỉ được mở lại trong vòng 7 ngày kể từ khi kết thúc
    if (record.closedAt) {
      const diffMs = effectiveNow().getTime() - new Date(record.closedAt).getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays > 7) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'REOPEN_EXPIRED',
          'A medical record can be reopened only within 7 days after it was closed.',
        );
      }
    }

    const now = effectiveNow();
    // Cập nhật Database: đổi trạng thái sang OPEN, ghi nhận reopenedAt và reopenReason
    const updated = await this.prisma.medicalRecord.update({
      where: { id },
      data: {
        treatmentProtocol: `${record.treatmentProtocol}\n[MỞ LẠI]: ${effectiveReason}`,
        status: 'OPEN',
        reopenedAt: now,
        reopenReason: effectiveReason,
      },
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'REOPEN_MEDICAL_RECORD',
      `Medical record ${id} reopened with reason: ${effectiveReason}`,
      id,
      { entityName: 'MedicalRecord' },
    );

    await this.syncHorseMedicalTasks(record.horseId);

    return updated;
  }

  async addTreatmentPhase(
    recordId: string,
    actor: CurrentUserPayload,
    dto: CreateTreatmentPhaseDto,
  ) {
    this.access.assertVet(actor, 'add treatment phases');

    const record = await this.prisma.medicalRecord.findUnique({ where: { id: recordId } });
    if (!record)
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');

    if (record.status === 'CLOSED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_CLOSED',
        'Bệnh án đã đóng điều trị, không thể thêm giai đoạn phác đồ.',
      );
    }

    if (dto.startDate && dto.endDate) {
      const start = new Date(dto.startDate);
      const end = new Date(dto.endDate);
      if (end < start) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_DATE_RANGE',
          'The phase end date must be on or after its start date.',
        );
      }
    }

    let phases: any[] = [];
    if (record.treatmentPhases) {
      try {
        phases = JSON.parse(record.treatmentPhases);
        if (!Array.isArray(phases)) phases = [];
      } catch {
        phases = [];
      }
    }

    // Kiểm tra không cho phép các giai đoạn lồng / chồng chéo thời gian lên nhau
    if (dto.startDate && dto.endDate) {
      const newStart = new Date(dto.startDate).getTime();
      const newEnd = new Date(dto.endDate).getTime();
      for (const ex of phases) {
        if (ex.startDate && ex.endDate) {
          const exStart = new Date(ex.startDate).getTime();
          const exEnd = new Date(ex.endDate).getTime();
          if (newStart <= exEnd && newEnd >= exStart) {
            throw apiError(
              HttpStatus.BAD_REQUEST,
              'PHASE_OVERLAP',
              `Giai đoạn "${dto.phaseName}" bị trùng lặp thời gian (${dto.startDate} đến ${dto.endDate}) với giai đoạn "${ex.phaseName}" (${ex.startDate} đến ${ex.endDate}). Các giai đoạn phác đồ không được lồng vào nhau.`,
            );
          }
        }
      }
    }

    const phase = {
      id: `phase-${Date.now()}`,
      phaseName: dto.phaseName,
      startDate: dto.startDate,
      endDate: dto.endDate,
      target: dto.target || null,
      careInstructions: dto.careInstructions || [],
      createdAt: effectiveNow().toISOString(),
    };

    phases.push(phase);

    const phaseNote = `[PHÁC ĐỒ - ${dto.phaseName}]: Từ: ${dto.startDate} Đến: ${dto.endDate} | Mục tiêu: ${dto.target || 'N/A'}`;
    const updatedProtocol = record.treatmentProtocol
      ? `${record.treatmentProtocol}\n${phaseNote}`
      : phaseNote;

    // Lưu phác đồ điều trị vào cột treatmentPhases trong Database
    const updated = await this.prisma.medicalRecord.update({
      where: { id: recordId },
      data: {
        treatmentPhases: JSON.stringify(phases),
        treatmentProtocol: updatedProtocol,
      },
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'ADD_TREATMENT_PHASE',
      `Added treatment phase ${dto.phaseName} to medical record ${recordId}`,
      recordId,
    );

    await this.syncHorseMedicalTasks(record.horseId, dto.startDate, dto.endDate);

    return { message: 'Đã thêm giai đoạn phác đồ thành công', phase, record: updated };
  }

  async updateTreatmentPhase(
    recordId: string,
    phaseId: string,
    actor: CurrentUserPayload,
    dto: UpdateTreatmentPhaseDto,
  ) {
    this.access.assertVet(actor, 'update treatment phases');

    const record = await this.prisma.medicalRecord.findUnique({ where: { id: recordId } });
    if (!record)
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');

    if (record.status === 'CLOSED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_CLOSED',
        'Bệnh án đã đóng điều trị, không thể chỉnh sửa phác đồ.',
      );
    }

    let phases: any[] = [];
    if (record.treatmentPhases) {
      try {
        phases = JSON.parse(record.treatmentPhases);
        if (!Array.isArray(phases)) phases = [];
      } catch {
        phases = [];
      }
    }

    const index = phases.findIndex((p) => p.id === phaseId);
    if (index === -1) {
      throw apiError(HttpStatus.NOT_FOUND, 'PHASE_NOT_FOUND', 'Treatment phase not found.');
    }

    const updatedPhase = {
      ...phases[index],
      ...dto,
      updatedAt: effectiveNow().toISOString(),
    };

    if (updatedPhase.startDate && updatedPhase.endDate) {
      const start = new Date(updatedPhase.startDate);
      const end = new Date(updatedPhase.endDate);
      if (end < start) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_DATE_RANGE',
          'The phase end date must be on or after its start date.',
        );
      }

      // Kiểm tra không cho phép các giai đoạn lồng / chồng chéo thời gian lên nhau
      const newStart = start.getTime();
      const newEnd = end.getTime();
      for (const ex of phases) {
        if (ex.id === phaseId) continue;
        if (ex.startDate && ex.endDate) {
          const exStart = new Date(ex.startDate).getTime();
          const exEnd = new Date(ex.endDate).getTime();
          if (newStart <= exEnd && newEnd >= exStart) {
            throw apiError(
              HttpStatus.BAD_REQUEST,
              'PHASE_OVERLAP',
              `Giai đoạn "${updatedPhase.phaseName}" bị trùng lặp thời gian (${updatedPhase.startDate} đến ${updatedPhase.endDate}) với giai đoạn "${ex.phaseName}" (${ex.startDate} đến ${ex.endDate}). Các giai đoạn phác đồ không được lồng vào nhau.`,
            );
          }
        }
      }
    }

    phases[index] = updatedPhase;

    // Lưu cập nhật vào cột treatmentPhases trong Database
    const updated = await this.prisma.medicalRecord.update({
      where: { id: recordId },
      data: {
        treatmentPhases: JSON.stringify(phases),
      },
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'UPDATE_TREATMENT_PHASE',
      `Updated treatment phase ${phaseId} for medical record ${recordId}`,
      recordId,
      { entityName: 'MedicalRecord' },
    );

    await this.syncHorseMedicalTasks(record.horseId, updatedPhase.startDate, updatedPhase.endDate);

    return {
      message: 'Đã cập nhật phác đồ điều trị thành công',
      phase: updatedPhase,
      record: updated,
    };
  }

  async addPrescription(recordId: string, actor: CurrentUserPayload, dto: CreatePrescriptionDto) {
    this.access.assertVet(actor, 'prescribe medication');

    const record = await this.prisma.medicalRecord.findUnique({ where: { id: recordId } });
    if (!record)
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');

    if (record.status === 'CLOSED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_CLOSED',
        'Bệnh án đã đóng điều trị, không thể kê thêm đơn thuốc.',
      );
    }

    let currentRx: any[] = [];
    const rxSource = record.prescriptions || record.prescriptionDetails;
    if (rxSource) {
      try {
        currentRx = JSON.parse(rxSource);
        if (!Array.isArray(currentRx)) currentRx = [currentRx];
      } catch {
        currentRx = [];
      }
    }

    // Cảnh báo trùng thuốc đang hiệu lực: kiểm tra trong bệnh án hiện tại hoặc các bệnh án OPEN khác của ngựa
    const activeSameMedInCurrent = currentRx.find(
      (rx) =>
        rx.status === 'ACTIVE' &&
        rx.medicationName?.trim().toLowerCase() === dto.medicationName?.trim().toLowerCase(),
    );

    let conflictWarning: string | null = null;
    if (activeSameMedInCurrent) {
      conflictWarning = `Cảnh báo: Thuốc ${dto.medicationName} đang có hiệu lực trong bệnh án này!`;
    } else {
      const otherRecords = await this.prisma.medicalRecord.findMany({
        where: {
          horseId: record.horseId,
          status: 'OPEN',
          id: { not: recordId },
        },
        select: { id: true, recordNumber: true, prescriptions: true, prescriptionDetails: true },
      });

      for (const otherRec of otherRecords) {
        const otherSrc = otherRec.prescriptions || otherRec.prescriptionDetails;
        if (otherSrc) {
          try {
            const otherRxs = JSON.parse(otherSrc);
            if (Array.isArray(otherRxs)) {
              const matched = otherRxs.find(
                (rx) =>
                  rx.status === 'ACTIVE' &&
                  rx.medicationName?.trim().toLowerCase() ===
                    dto.medicationName?.trim().toLowerCase(),
              );
              if (matched) {
                conflictWarning = `Cảnh báo: Thuốc ${dto.medicationName} đang được sử dụng ở bệnh án khác (#${otherRec.recordNumber || otherRec.id})!`;
                break;
              }
            }
          } catch {
            /* ignore invalid JSON */
          }
        }
      }
    }

    const { supply, unit } = await this.resolveRxSupply(dto.supplyId);
    const dose = this.assertDose(dto.dosage ?? 1);

    const route = dto.route || '';
    const frequencyPerDay = dto.frequencyPerDay || 1;
    const freq = `${frequencyPerDay} lần/ngày`;

    let effectiveEndDate = dto.endDate;
    if (!effectiveEndDate) {
      const s = new Date(dto.startDate || effectiveNow().getTime());
      const days = Number(dto.daysCount) > 0 ? Number(dto.daysCount) : 1;
      effectiveEndDate = new Date(s.getTime() + (days - 1) * 86400000).toISOString().split('T')[0];
    }
    const dosageStr = String(dose);

    const newPrescription = {
      id: `rx-${Date.now()}`,
      supplyId: supply.id,
      medicationName: supply.name,
      dosage: dosageStr,
      unit,
      route,
      frequencyPerDay,
      frequency: freq,
      startDate: dto.startDate,
      endDate: effectiveEndDate,
      daysCount: dto.daysCount || 0,
      withdrawalDays: dto.withdrawalDays || 0,
      notes: dto.notes || '',
      status: 'ACTIVE',
      createdAt: effectiveNow().toISOString(),
    };

    currentRx.push(newPrescription);

    // Lưu danh sách đơn thuốc vào cột prescriptions riêng biệt trong Database (đồng bộ prescriptionDetails để tương thích ngược)
    const updated = await this.prisma.medicalRecord.update({
      where: { id: recordId },
      data: {
        prescriptions: JSON.stringify(currentRx),
        prescriptionDetails: JSON.stringify(currentRx),
      },
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'ADD_PRESCRIPTION',
      `Prescribed ${dto.medicationName} for medical record ${recordId}`,
      recordId,
    );

    await this.syncHorseMedicalTasks(record.horseId, dto.startDate, effectiveEndDate);

    const days = Number(dto.daysCount) > 0 ? Number(dto.daysCount) : 1;
    const perDay = Number(dto.frequencyPerDay) > 0 ? Number(dto.frequencyPerDay) : 1;
    const stockWarning = await this.stockWarning(
      record.horseId,
      supply.id,
      dose * perDay * days,
      unit,
    );
    await this.notifyPrescription(record.horseId, recordId, actor, 'PRESCRIPTION_ADDED', {
      med: supply.name,
      dose: `${dosageStr} ${unit}`,
      perDay,
      days,
      start: String(dto.startDate).slice(0, 10),
    });

    return {
      message: 'Kê đơn thuốc thành công',
      prescription: newPrescription,
      warning: [conflictWarning, stockWarning].filter(Boolean).join(' ') || null,
      record: updated,
    };
  }

  async updatePrescription(
    recordId: string,
    prescriptionId: string,
    actor: CurrentUserPayload,
    dto: UpdatePrescriptionDto,
  ) {
    this.access.assertVet(actor, 'edit prescriptions');

    const record = await this.prisma.medicalRecord.findUnique({ where: { id: recordId } });
    if (!record)
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');

    if (record.status === 'CLOSED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_CLOSED',
        'Bệnh án đã đóng điều trị, không thể chỉnh sửa đơn thuốc.',
      );
    }

    let currentRx: any[] = [];
    const rxSource = record.prescriptions || record.prescriptionDetails;
    if (rxSource) {
      try {
        currentRx = JSON.parse(rxSource);
      } catch {
        currentRx = [];
      }
    }

    const index = currentRx.findIndex((rx) => rx.id === prescriptionId);
    if (index === -1) {
      throw apiError(HttpStatus.NOT_FOUND, 'PRESCRIPTION_NOT_FOUND', 'Prescription not found.');
    }

    const rx = currentRx[index];

    // Quy tắc nghiệp vụ: Chỉ cho phép chỉnh sửa khi đơn thuốc chưa bắt đầu dùng (startDate > now)
    if (rx.startDate) {
      const start = new Date(rx.startDate);
      if (start.getTime() <= effectiveNow().getTime()) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'PRESCRIPTION_STARTED',
          'This prescription has already started and cannot be edited. Stop it and prescribe a new one.',
        );
      }
    }

    const patch: Record<string, unknown> = { ...dto };
    if (dto.supplyId) {
      const { supply, unit } = await this.resolveRxSupply(dto.supplyId);
      patch.medicationName = supply.name;
      patch.unit = unit;
    } else {
      delete patch.unit; // đơn vị luôn theo thuốc trong kho
    }
    if (dto.dosage !== undefined) patch.dosage = String(this.assertDose(dto.dosage));
    currentRx[index] = { ...rx, ...patch, updatedAt: effectiveNow().toISOString() };

    // Cập nhật mảng đơn thuốc vào cột prescriptions trong Database
    await this.prisma.medicalRecord.update({
      where: { id: recordId },
      data: {
        prescriptions: JSON.stringify(currentRx),
        prescriptionDetails: JSON.stringify(currentRx),
      },
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'UPDATE_PRESCRIPTION',
      `Updated prescription ${prescriptionId} for medical record ${recordId}`,
      recordId,
    );

    await this.syncHorseMedicalTasks(
      record.horseId,
      currentRx[index].startDate,
      currentRx[index].endDate,
    );

    const changed = currentRx[index];
    await this.notifyPrescription(record.horseId, recordId, actor, 'PRESCRIPTION_UPDATED', {
      med: changed.medicationName,
      dose: `${changed.dosage} ${changed.unit}`,
      perDay: Number(changed.frequencyPerDay) || 1,
      days: Number(changed.daysCount) || 1,
      start: String(changed.startDate).slice(0, 10),
    });

    return { message: 'Cập nhật đơn thuốc thành công', prescription: changed };
  }

  async stopPrescription(
    recordId: string,
    prescriptionId: string,
    actor: CurrentUserPayload,
    dto: StopPrescriptionDto,
  ) {
    this.access.assertVet(actor, 'stop medication');

    const record = await this.prisma.medicalRecord.findUnique({ where: { id: recordId } });
    if (!record)
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');

    if (record.status === 'CLOSED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_CLOSED',
        'Bệnh án đã đóng điều trị, không thể thao tác trên đơn thuốc.',
      );
    }

    let currentRx: any[] = [];
    const rxSource = record.prescriptions || record.prescriptionDetails;
    if (rxSource) {
      try {
        currentRx = JSON.parse(rxSource);
      } catch {
        currentRx = [];
      }
    }

    const rx = currentRx.find((item) => item.id === prescriptionId);
    if (!rx) {
      throw apiError(HttpStatus.NOT_FOUND, 'PRESCRIPTION_NOT_FOUND', 'Prescription not found.');
    }

    rx.status = 'STOPPED';
    rx.stoppedReason = dto.reason || 'Bác sĩ yêu cầu dừng thuốc';
    rx.stopNotes = '';
    rx.stoppedDate = dto.stoppedDate || effectiveNow().toISOString().split('T')[0];
    rx.stoppedAt = effectiveNow().toISOString();

    // Cập nhật trạng thái dừng đơn thuốc vào cột prescriptions trong Database
    await this.prisma.medicalRecord.update({
      where: { id: recordId },
      data: {
        prescriptions: JSON.stringify(currentRx),
        prescriptionDetails: JSON.stringify(currentRx),
      },
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'STOP_PRESCRIPTION',
      `Stopped prescription ${prescriptionId} for medical record ${recordId}: ${rx.stoppedReason}`,
      recordId,
    );

    await this.syncHorseMedicalTasks(record.horseId, rx.startDate, rx.endDate);

    return { message: 'Đã dừng đơn thuốc thành công', prescription: rx };
  }

  async addFollowUp(recordId: string, actor: CurrentUserPayload, dto: CreateFollowUpDto) {
    this.access.assertVet(actor, 'record follow-up visits');

    const record = await this.prisma.medicalRecord.findUnique({ where: { id: recordId } });
    if (!record)
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');

    if (record.status === 'CLOSED') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'RECORD_CLOSED',
        'Bệnh án đã đóng điều trị, không thể thêm lịch tái khám.',
      );
    }

    const rawVisitDate = dto.followUpDate;
    const visitDate = rawVisitDate ? new Date(rawVisitDate) : effectiveNow();

    let followUps: any[] = [];
    if (record.followUps) {
      try {
        followUps = JSON.parse(record.followUps);
        if (!Array.isArray(followUps)) followUps = [];
      } catch {
        followUps = [];
      }
    }

    const followUp = {
      id: `fu-${Date.now()}`,
      followUpDate: visitDate.toISOString().split('T')[0],
      temperature: dto.temperature ?? null,
      restingHeartRate: dto.restingHeartRate ?? null,
      respiratoryRate: dto.respiratoryRate ?? null,
      progressNotes: dto.progressNotes,
      adjustments: dto.adjustments || null,
      vetName: actor.fullName || actor.email || 'Veterinarian',
      createdAt: effectiveNow().toISOString(),
    };

    followUps.push(followUp);

    // Lưu danh sách tái khám vào cột followUps trong Database
    const updated = await this.prisma.medicalRecord.update({
      where: { id: recordId },
      data: {
        requiresFollowUp: true,
        followUpDate: visitDate,
        followUps: JSON.stringify(followUps),
        treatmentProtocol: `${record.treatmentProtocol}\n[TÁI KHÁM ${visitDate.toLocaleDateString()}]: ${dto.progressNotes}`,
      },
    });

    await this.audit.record(
      { id: actor.userId, name: actor.fullName },
      'ADD_FOLLOW_UP',
      `Recorded follow-up visit for medical record ${recordId}`,
      recordId,
    );

    if (followUp.followUpDate >= clubDate(effectiveNow())) {
      const horse = await this.prisma.horse.findUnique({
        where: { id: record.horseId },
        select: { name: true, horseCode: true },
      });
      const horseName = horse?.name ?? '';
      const audience = await this.notifications.horseAudience(record.horseId, {
        owner: true,
        groom: true,
      });
      await this.notifications.notifyUsers(
        [...audience, record.veterinarianUserId],
        {
          type: 'FOLLOW_UP_SCHEDULED',
          category: 'MEDICAL',
          title: 'Follow-up visit scheduled',
          message: `${horseName} has a follow-up visit on ${followUp.followUpDate}.`,
          params: { horse: horseName, date: followUp.followUpDate },
          link: `/medical/records/${recordId}`,
          senderName: actor.fullName,
        },
        actor.userId,
      );

      // Gửi email thông báo trực tiếp đến tài khoản email của Bác sĩ thú y phụ trách
      const vet = this.prisma.user?.findUnique
        ? await this.prisma.user.findUnique({
            where: { id: actor.userId },
            select: { email: true, fullName: true },
          })
        : null;
      if (vet?.email && this.mailService) {
        const followUpDateStr = visitDate.toISOString().split('T')[0];
        const subject = `[Lịch tái khám] Ngựa ${horseName || 'Ngựa'} - Ngày ${followUpDateStr}`;
        const text = `Xin chào Bác sĩ ${vet.fullName || actor.fullName},\n\nBạn đã ghi nhận/lên lịch tái khám cho ngựa ${horseName || ''} (Mã: ${horse?.horseCode || record.horseId}) vào ngày ${followUpDateStr}.\nGhi chú tái khám: ${dto.progressNotes || 'Không có ghi chú thêm'}.\nMã bệnh án liên kết: ${record.recordNumber || record.id}.\n\nTrân trọng,\nHệ thống Quản lý Huấn luyện Ngựa Đua.`;
        await this.mailService.send(vet.email, subject, text).catch(() => {});
      }
    }

    return { message: 'Ghi nhận tái khám thành công', followUp, record: updated };
  }

  /**
   * #13: nhật ký cho thuốc của bệnh án. Mỗi lần dùng thuốc là một việc MEDICATION hằng ngày của Groom
   * (ai cho, lúc nào; hoàn thành thì trừ kho), nên bác sĩ đối chiếu được liều nào đã cho, liều nào bị bỏ lỡ.
   */
  async getMedicationLog(id: string, currentUser: CurrentUserPayload) {
    const record = await this.prisma.medicalRecord.findUnique({
      where: { id },
      select: { horseId: true, closedAt: true, prescriptions: true, prescriptionDetails: true },
    });
    if (!record) {
      throw apiError(HttpStatus.NOT_FOUND, 'RECORD_NOT_FOUND', 'Medical record not found.');
    }
    await this.access.checkHorseAccess(record.horseId, currentUser);

    let rxs: any[] = [];
    try {
      const parsed = JSON.parse(record.prescriptions || record.prescriptionDetails || '[]');
      rxs = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      rxs = [];
    }
    const starts = rxs.map((r) => String(r?.startDate ?? '').slice(0, 10)).filter(Boolean);
    const ends = rxs
      .map((r) => String(r?.endDate ?? r?.startDate ?? '').slice(0, 10))
      .filter(Boolean);
    const empty = { items: [], summary: { done: 0, missed: 0, upcoming: 0 } };
    if (starts.length === 0) return empty;

    const from = starts.sort()[0];
    let to = ends.sort()[ends.length - 1];
    if (record.closedAt && clubDate(record.closedAt) < to) to = clubDate(record.closedAt);

    const tasks = await this.prisma.dailyCareTask.findMany({
      where: {
        horseId: record.horseId,
        taskType: DailyTaskType.MEDICATION,
        date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
      },
      orderBy: [{ date: 'asc' }, { scheduledTime: 'asc' }],
      select: {
        id: true,
        date: true,
        scheduledTime: true,
        title: true,
        description: true,
        isCompleted: true,
        completedAt: true,
        completedBy: { select: { id: true, fullName: true } },
        assignedGroom: { select: { id: true, fullName: true } },
      },
    });

    const today = clubDate(effectiveNow());
    const items = tasks.map((t) => {
      const day = t.date.toISOString().slice(0, 10);
      const status = t.isCompleted ? 'DONE' : day < today ? 'MISSED' : 'UPCOMING';
      return { ...t, date: day, status };
    });
    const count = (s: string) => items.filter((i) => i.status === s).length;
    return {
      items,
      summary: { done: count('DONE'), missed: count('MISSED'), upcoming: count('UPCOMING') },
    };
  }

  /** #10 #14: thuốc phải có trong danh mục kho (nhóm Thuốc, đang dùng); đơn vị lấy theo kho. */
  private async resolveRxSupply(supplyId?: string) {
    if (!supplyId) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'SUPPLY_REQUIRED',
        'Thuốc phải được chọn từ danh mục kho.',
      );
    }
    const supply = await this.prisma.supplyCatalog.findUnique({ where: { id: supplyId } });
    if (!supply || !supply.isActive || supply.category !== SupplyCategory.MEDICINE) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_SUPPLY',
        'Thuốc không có trong danh mục kho hoặc đã ngừng sử dụng.',
      );
    }
    return { supply, unit: RX_UNIT[supply.unit] };
  }

  private assertDose(raw: unknown): number {
    const dose = Number(raw);
    if (!Number.isFinite(dose) || !Number.isInteger(dose) || dose < 1) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_DOSAGE',
        'Liều dùng thuốc phải là số tự nhiên lớn hơn hoặc bằng 1.',
      );
    }
    return dose;
  }

  /** #14: kho của khu chuồng ngựa không đủ cho cả liệu trình thì cảnh báo bác sĩ và báo Club Manager. */
  private async stockWarning(
    horseId: string,
    supplyId: string,
    needed: number,
    unit: string,
  ): Promise<string | null> {
    const alloc = await this.prisma.stallAllocation.findFirst({
      where: { horseId, isActive: true },
      select: { stall: { select: { zoneId: true, zoneRef: { select: { name: true } } } } },
    });
    const zoneId = alloc?.stall?.zoneId;
    if (!zoneId) return null;
    const balance = await this.prisma.stockBalance.findUnique({
      where: { zoneId_supplyId: { zoneId, supplyId } },
      include: { supply: { select: { name: true } } },
    });
    const have = Number(balance?.quantity ?? 0);
    if (have >= needed) return null;

    const zone = alloc.stall.zoneRef?.name ?? '';
    const haveStr = `${have} ${unit}`;
    const needStr = `${needed} ${unit}`;
    await this.notifications.notifyRoles([Role.CLUB_MANAGER], {
      type: 'RX_STOCK_SHORT',
      category: 'MEDICAL',
      title: 'Medicine stock too low for a prescription',
      message: `${zone}: ${balance?.supply.name ?? 'medicine'} has ${haveStr}, the prescription needs ${needStr}.`,
      params: { zone, have: haveStr, need: needStr },
      link: '/supplies/inventory',
    });
    return `Kho ${zone} chỉ còn ${haveStr}, đơn thuốc cần ${needStr}. Cần bổ sung kho.`;
  }

  /** #11: chủ ngựa và Groom biết ngay ngựa được kê / sửa đơn thuốc gì. */
  private async notifyPrescription(
    horseId: string,
    recordId: string,
    actor: CurrentUserPayload,
    type: 'PRESCRIPTION_ADDED' | 'PRESCRIPTION_UPDATED',
    rx: { med: string; dose: string; perDay: number; days: number; start: string },
  ) {
    const horse = await this.prisma.horse.findUnique({
      where: { id: horseId },
      select: { name: true, status: true },
    });
    const horseName = horse?.name ?? '';
    const vet = actor.fullName || actor.email;
    const verb = type === 'PRESCRIPTION_ADDED' ? 'prescribed' : 'changed the prescription of';
    await this.notifications.notifyHorse(
      horseId,
      { owner: true, groom: true },
      {
        type,
        category: 'MEDICAL',
        title:
          type === 'PRESCRIPTION_ADDED'
            ? 'New prescription for your horse'
            : 'Prescription changed',
        message: `${vet} ${verb} ${rx.med} for ${horseName}: ${rx.dose}, ${rx.perDay} time(s)/day for ${rx.days} day(s) from ${rx.start}.`,
        params: {
          vet,
          med: rx.med,
          horse: horseName,
          dose: rx.dose,
          perDay: rx.perDay,
          days: rx.days,
          start: rx.start,
        },
        link: `/medical/records/${recordId}`,
        senderName: actor.fullName,
        email: {
          eventCode: type,
          body: prescriptionIssued(
            { id: horseId, name: horseName, status: horse?.status },
            rx,
            { name: vet },
            type === 'PRESCRIPTION_UPDATED',
          ),
        },
      },
      actor.userId,
    );
  }
}
