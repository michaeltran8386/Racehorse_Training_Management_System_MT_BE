import {
  assertPrimaryGroom,
  assertReceivingGroom,
  lockCareAssignments,
  transferPendingCare,
  MAX_CARE_STALLS,
} from '../stalls/groom-care.rules';
import { onDutyGrooms, rosterDay, shiftInterval } from '../shift-rosters/groom-zones';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  AdmissionStatus,
  HandoverStatus,
  HorseCatalogType,
  HorseStatus,
  PlanStatus,
  Prisma,
  Role,
  TrainerAssignmentStatus,
  UserStatus,
  WorkoutStatus,
} from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';
import { UserRole } from '../common/enums/role.enum';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { CreateHorseDto } from './dto/create-horse.dto';
import { UpdateHorseDto } from './dto/update-horse.dto';
import { QueryHorseDto } from './dto/query-horse.dto';
import { AssignHorseTrainerDto, HandoverAction, RespondHandoverDto } from './dto/handover.dto';
import { MAX_HORSES_PER_TRAINER } from '../training/training-rules';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CounterService } from '../audit/counter.service';
import { HorseCatalogsService } from '../horse-catalogs/horse-catalogs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BusinessMailService } from '../business-mail/business-mail.service';
import {
  ApproveAdmissionDto,
  CancelAdmissionDto,
  InspectAdmissionDto,
  QueryAdmissionDto,
  RejectAdmissionDto,
  ScheduleAdmissionDto,
  UpdateOwnerAdmissionSubmissionDto,
} from './dto/admission.dto';
import { effectiveNow } from '../common/utils/demo-clock';
import {
  ACTIVE_ADMISSION_STATUSES,
  assertAdmissionApprovable,
  assertInspectFieldRoles,
  assertNoActiveAdmission,
  assertRejectionReason,
  assertValidCancelTransition,
  assertValidInspectTransition,
  assertValidRejectTransition,
  assertValidScheduleTransition,
  computeMicrochipVerified,
} from './admission-rules';
import { assertStatusTransition } from './horse-rules';
import {
  assertAdmissionCapacity,
  availableAdmissionStalls,
  lockAdmissionStall,
} from './admission-capacity';
import { assertStaffAvailable, workInterval } from './staff-work.rules';
import {
  admissionAppointmentScheduled,
  admissionCapacityDeferred,
  admissionApproved,
  admissionRejected,
  admissionRequestReceived,
} from '../business-mail/templates/admission-templates';

/** Safe user projection preventing credential / sensitive data leakage */
export const USER_SAFE_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phoneNumber: true,
} as const;

/** P1-07: hồ sơ ngựa — tạo, sửa định danh, chuyển chủ, danh sách, chi tiết (FR-1.01 → FR-1.04, FR-1.16). */
@Injectable()
export class HorsesService {
  private readonly logger = new Logger(HorsesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly counter: CounterService,
    private readonly catalogs: HorseCatalogsService,
    private readonly notifications: NotificationsService,
    private readonly businessMail: BusinessMailService,
  ) {}

  /**
   * Gửi email nghiệp vụ sau commit; lỗi SMTP chỉ ghi log, tuyệt đối không rollback.
   */
  private async safeSendMail(event: {
    eventCode: string;
    recipients: Array<{ userId: string; body: any }>;
  }): Promise<void> {
    try {
      await this.businessMail.emit(event);
    } catch (err) {
      this.logger.warn(`Failed to send business mail [${event.eventCode}]: ${String(err)}`);
    }
  }

  /**
   * Kiểm tra lỗi P2002 có thực sự do xung đột duy nhất trên microchip/microchipRfid hay không.
   */
  private isMicrochipUniqueConflict(err: any): boolean {
    if (err?.code !== 'P2002') return false;
    const target = err?.meta?.target;
    if (Array.isArray(target)) {
      return target.some((t: string) => t.includes('microchip') || t.includes('microchipRfid'));
    }
    if (typeof target === 'string') {
      return target.includes('microchip') || target.includes('microchipRfid');
    }
    return false;
  }

  /**
   * Sinh mã hồ sơ tiếp nhận ADM-YYYY-NNN (dùng trực tiếp transaction client trên bảng Counter để chống connection starvation).
   */
  async generateAdmissionCode(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    for (let attempts = 0; attempts < 50; attempts++) {
      let seq: number;
      if (tx?.counter?.upsert) {
        const counterRow = await tx.counter.upsert({
          where: { name: `admission_code_${year}` },
          create: { name: `admission_code_${year}`, value: 1 },
          update: { value: { increment: 1 } },
        });
        seq = counterRow.value;
      } else {
        seq = await this.counter.next(`admission_code_${year}`);
      }
      const candidate = `ADM-${year}-${String(seq).padStart(3, '0')}`;
      const exists = await tx.horseAdmissionRecord.findUnique({
        where: { admissionCode: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    throw apiError(
      HttpStatus.CONFLICT,
      'ADMISSION_CODE_EXHAUSTED',
      'Không thể sinh mã tiếp nhận duy nhất sau nhiều lần thử, vui lòng thử lại.',
    );
  }

  async admissionPlacement(stallId?: string, allocationId?: string) {
    const stalls = await this.prisma.stall.findMany({
      where: { ...availableAdmissionStalls, zoneId: { not: null } },
      include: { zoneRef: { select: { name: true } } },
      orderBy: { code: 'asc' },
    });
    const target = stalls.find((s) => s.id === stallId);
    if (!target?.zoneId) return { stalls, grooms: [], receivingGrooms: [] };
    const users = await this.prisma.user.findMany({
      where: { role: 'GROOM', status: 'ACTIVE' },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
    const allocations = await this.prisma.stallAllocation.findMany({
      where: { isActive: true, assignedGroomUserId: { not: null } },
      include: { stall: { select: { zoneId: true } } },
    });
    const grooms = users.map((g) => {
      const own = allocations.filter(
        (a) => a.assignedGroomUserId === g.id && a.id !== allocationId,
      );
      return {
        ...g,
        count: own.length,
        max: MAX_CARE_STALLS,
        eligible:
          own.length < MAX_CARE_STALLS && own.every((a) => a.stall.zoneId === target.zoneId),
      };
    });
    const receivingGrooms: Array<{ id: string; fullName: string }> = [];
    for (const roster of await onDutyGrooms(this.prisma, target.zoneId)) {
      if (!roster.dutyTypes.includes('HORSE_CARE')) continue;
      const tasks = await this.prisma.dailyCareTask.findMany({
        where: {
          date: roster.date,
          shiftId: roster.shiftId,
          assignedGroomUserId: roster.groomUserId,
          cancelledAt: null,
        },
        select: { horseId: true },
        distinct: ['horseId'],
      });
      const excluded = allocationId
        ? allocations.find((a) => a.id === allocationId)?.horseId
        : undefined;
      if (
        new Set(tasks.filter((t) => t.horseId !== excluded).map((t) => t.horseId)).size <
        MAX_CARE_STALLS
      )
        receivingGrooms.push({ id: roster.groomUserId, fullName: roster.groom.fullName });
    }
    return { stalls, grooms, receivingGrooms };
  }

  async admissionCapacity() {
    const available = await this.prisma.stall.count({ where: availableAdmissionStalls });
    return { available };
  }

  async deferAdmissionForCapacity(admissionId: string, user: CurrentUserPayload) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "HorseAdmissionRecord" WHERE "id" = ${admissionId} FOR UPDATE`;
      const record = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        include: { horse: true, owner: { select: USER_SAFE_SELECT } },
      });
      if (!record)
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      if (!['PENDING_VERIFICATION', 'APPOINTED'].includes(record.status)) {
        throw apiError(
          HttpStatus.CONFLICT,
          'ADMISSION_NOT_DEFERRABLE',
          'Chỉ hoãn được hồ sơ chưa bắt đầu thẩm định.',
        );
      }
      if (record.capacityDeferredAt) return { record, changed: false };
      if (await tx.stall.count({ where: availableAdmissionStalls })) {
        throw apiError(
          HttpStatus.CONFLICT,
          'ADMISSION_HAS_CAPACITY',
          'CLB vẫn còn chuồng trống. Vui lòng kiểm tra lại trước khi hoãn.',
        );
      }
      const deferredAt = new Date();
      await tx.horseAdmissionRecord.update({
        where: { id: admissionId },
        data: {
          status: 'PENDING_VERIFICATION',
          appointmentDate: null,
          appointmentEndDate: null,
          managerUserId: null,
          veterinarianUserId: null,
          capacityDeferredAt: deferredAt,
        },
      });
      await tx.admissionHistoryLog.create({
        data: {
          admissionId,
          fromStatus: record.status,
          toStatus: 'PENDING_VERIFICATION',
          actorUserId: user.userId,
          actorName: user.fullName || user.email,
          note: 'Hoãn thẩm định vì hết chuồng; giữ hồ sơ để liên hệ hẹn lại.',
        },
      });
      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'ADMISSION_CAPACITY_DEFERRED',
        'Hoãn thẩm định vì hết chuồng',
        admissionId,
        {
          entityName: 'HorseAdmissionRecord',
          oldValues: { appointmentDate: record.appointmentDate },
          newValues: { capacityDeferredAt: deferredAt },
        },
        tx,
      );
      return { record, changed: true };
    });
    if (result.changed)
      await this.safeSendMail({
        eventCode: 'ADMISSION_CAPACITY_DEFERRED',
        recipients: [
          {
            userId: result.record.ownerId,
            body: {
              ...admissionCapacityDeferred(result.record, result.record.horse, result.record.owner),
              refId: admissionId,
              milestone: `capacity-${result.record.appointmentDate?.getTime() ?? result.record.createdAt.getTime()}`,
            },
          },
        ],
      });
    if (result.changed)
      await this.notifications.notifyUsers(
        [result.record.managerUserId, result.record.veterinarianUserId],
        {
          type: 'ADMISSION_CAPACITY_DEFERRED',
          category: 'SYSTEM',
          title: 'Hoãn lịch thẩm định vì hết chuồng',
          message: `Hồ sơ ${result.record.admissionCode} được giữ lại để hẹn mới. Lịch hẹn cũ không còn hiệu lực.`,
          link: '/staff/schedule',
          dedupeKey: `admission-capacity:${result.record.id}:${result.record.appointmentDate?.getTime() ?? result.record.createdAt.getTime()}`,
        },
      );
    return { deferred: true, notified: result.changed };
  }

  /**
   * Sinh mã ngựa HR-XXXXXX từ bảng Counter (tăng nguyên tử nên 2 người tạo cùng lúc không trùng mã).
   */
  async generateHorseCode(tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx || this.prisma;
    for (;;) {
      let seq: number;
      if (tx?.counter?.upsert) {
        const counterRow = await tx.counter.upsert({
          where: { name: 'horse_code' },
          create: { name: 'horse_code', value: 1 },
          update: { value: { increment: 1 } },
        });
        seq = counterRow.value;
      } else {
        seq = await this.counter.next('horse_code');
      }
      const candidate = `HR-${String(seq).padStart(6, '0')}`;
      const taken = await client.horse.findUnique({ where: { horseCode: candidate } });
      if (!taken) return candidate;
    }
  }

  /**
   * Tự sinh số microchip 15 chữ số theo chuẩn ISO (bắt đầu bằng 985 + 12 số ngẫu nhiên). Không dùng timestamp fallback.
   */
  async generateMicrochip(tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx || this.prisma;
    for (let attempts = 0; attempts < 100; attempts++) {
      const random12 = Math.floor(Math.random() * 1e12)
        .toString()
        .padStart(12, '0');
      const candidate = `985${random12}`;
      const exists = await client.horse.findFirst({
        where: { OR: [{ microchip: candidate }, { microchipRfid: candidate }] },
      });
      if (!exists) return candidate;
    }
    throw apiError(
      HttpStatus.CONFLICT,
      'MICROCHIP_GENERATION_FAILED',
      'Không thể sinh số vi mạch ngẫu nhiên duy nhất sau 100 lần thử.',
    );
  }

  /**
   * Che giấu số microchip với vai trò GROOM (chỉ hiển thị 4 số cuối).
   */
  private maskMicrochip(chip?: string | null): string | null {
    if (!chip) return null;
    if (chip.length <= 4) return '****';
    return '*'.repeat(chip.length - 4) + chip.slice(-4);
  }

  /** Chuẩn hóa bộ ảnh giấy tờ pháp lý & link ảnh đại diện khi chủ ngựa nộp hoặc bổ sung hồ sơ. */
  private normalizeAdmissionSubmissionDocs(input: {
    documentsUrl?: string;
    documentPhotos?: Array<{ label: string; url: string }>;
  }): {
    documentsUrl: string | null;
    documentPhotos: Array<{ label: string; url: string }> | null;
  } {
    const cleanedPhotos = Array.isArray(input.documentPhotos)
      ? input.documentPhotos
          .map((item) => ({
            label: (item?.label ?? '').trim() || 'Giấy tờ pháp lý',
            url: (item?.url ?? '').trim(),
          }))
          .filter((item) => item.url.length > 0)
          .slice(0, 3)
      : null;

    const explicitUrl = input.documentsUrl?.trim() || '';
    const primaryUrl = explicitUrl || cleanedPhotos?.[0]?.url || null;
    const finalPhotos =
      cleanedPhotos && cleanedPhotos.length > 0
        ? cleanedPhotos
        : explicitUrl
          ? [{ label: 'Giấy tờ pháp lý đính kèm', url: explicitUrl }]
          : null;

    return {
      documentsUrl: primaryUrl,
      documentPhotos: finalPhotos,
    };
  }

  /** Che giấu ghi chú thẩm định nội bộ trước khi trả hồ sơ tiếp nhận cho Chủ ngựa. */
  private sanitizeAdmissionForRole(record: any, user: CurrentUserPayload): any {
    if (!record || user.role !== UserRole.HORSE_OWNER) return record;
    const ownerSafe = { ...record };
    delete ownerSafe.legalDocumentsNote;
    delete ownerSafe.healthCheckNotes;
    delete ownerSafe.healthReviews;
    delete ownerSafe.isHealthEligible;
    return ownerSafe;
  }

  /**
   * Áp dụng chính sách bảo mật dữ liệu và che giấu trường nhạy cảm theo vai trò người dùng.
   */
  applyRolePolicy(horse: any, user: CurrentUserPayload): any {
    if (!horse) return horse;
    const cloned = { ...horse };

    // 1. Che giấu số microchip nếu là GROOM
    if (user.role === UserRole.GROOM) {
      if (cloned.microchip) {
        cloned.microchip = this.maskMicrochip(cloned.microchip);
      }
      if (cloned.microchipRfid) {
        cloned.microchipRfid = this.maskMicrochip(cloned.microchipRfid);
      }
    }

    // 2. Gắn thông tin ô chuồng và người chăm sóc hiện tại cho ngựa
    if (cloned.stallAllocations && cloned.stallAllocations.length > 0) {
      const activeStall = cloned.stallAllocations.find((a: any) => a.isActive !== false);
      cloned.allocationId = activeStall?.id ?? null;
      cloned.stallId = activeStall?.stallId ?? activeStall?.stall?.id ?? null;
      cloned.stallSince = activeStall?.startDate ?? null;
      cloned.stallCode = activeStall?.stall?.code || null;
      cloned.zone = activeStall?.stall?.zone || null;
      cloned.primaryGroom = activeStall?.assignedGroom?.fullName || null;
    }
    if (user.role === UserRole.HORSE_OWNER) {
      delete cloned.stallAllocations;
    }

    if (cloned.trainingPlans) {
      const p = cloned.trainingPlans[0];
      cloned.activePlan = p
        ? {
            id: p.id,
            name: p.phaseName,
            endDate: p.endDate,
            trainerName: p.trainer?.fullName ?? null,
          }
        : null;
      delete cloned.trainingPlans;
    }

    // 3. Ẩn thông tin chủ sở hữu đối với VET và GROOM (CL-1.07)
    if (user.role === UserRole.VETERINARIAN || user.role === UserRole.GROOM) {
      delete cloned.owner;
      cloned.owner = null;
      cloned.ownerName = null;
      cloned.ownerId = null;
    }

    if (Array.isArray(cloned.admissionRecords)) {
      cloned.admissionRecords = cloned.admissionRecords.map((adm: any) =>
        this.sanitizeAdmissionForRole(adm, user),
      );
      cloned.latestAdmission = cloned.admissionRecords[0] ?? null;
    }

    return cloned;
  }

  /**
   * Tạo hồ sơ ngựa mới kèm hồ sơ tiếp nhận ban đầu (ADM-01, FR-1.01).
   * Hỗ trợ nộp lại hồ sơ cho ngựa từng bị REJECTED / CANCELLED bởi chính chủ sở hữu.
   * Sử dụng transaction và row-level lock để ngăn ngừa race condition, chip takeover và duplicate admission.
   */
  async create(input: CreateHorseDto, user: CurrentUserPayload) {
    const dto: CreateHorseDto = { ...input, ownerId: user.userId };
    const dob = new Date(dto.dob);
    const now = new Date();
    const twelveYearsAgo = new Date();
    twelveYearsAgo.setFullYear(now.getFullYear() - 12);

    if (dob > now) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_DOB',
        'Ngày sinh không được sau ngày hiện tại.',
      );
    }
    if (dob < twelveYearsAgo) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_DOB',
        'Tuổi đăng ký của ngựa không được vượt quá 12 tuổi (ngày sinh không sớm hơn 12 năm trước tính đến ngày hiện tại).',
      );
    }

    const microchip = dto.microchip?.trim();
    if (!microchip) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'MICROCHIP_REQUIRED',
        'Số vi mạch (microchip) là bắt buộc và không được để trống.',
      );
    }

    if (!dto.ownerId) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'OWNER_REQUIRED',
        'Owner is required to register a horse.',
      );
    }
    const owner = await this.prisma.user.findUnique({ where: { id: dto.ownerId } });
    if (!owner) {
      throw apiError(HttpStatus.NOT_FOUND, 'OWNER_NOT_FOUND', 'Selected owner does not exist.');
    }
    if (owner.role !== Role.HORSE_OWNER) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_OWNER_ROLE',
        'The specified owner account must have the HORSE_OWNER role.',
      );
    }
    if (owner.status && owner.status !== UserStatus.ACTIVE) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'OWNER_INACTIVE',
        'The selected owner account is not active.',
      );
    }
    if (owner.isBadDebtFlagged) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'OWNER_BAD_DEBT',
        'The selected owner is flagged with bad debt due to overdue payments. Cannot register new horses for this owner.',
      );
    }

    const breed = await this.catalogs.resolveName(HorseCatalogType.BREED, dto.breed);
    const color = await this.catalogs.resolveName(HorseCatalogType.COLOR, dto.color);
    const normalizedDocs = this.normalizeAdmissionSubmissionDocs({
      documentsUrl: dto.documentsUrl,
      documentPhotos: dto.documentPhotos,
    });
    const normalizedOwnerNotes = dto.ownerNotes?.trim() || null;

    let horse: any;
    let admission: any;
    let isReapply = false;

    try {
      const res = await this.prisma.$transaction(async (tx) => {
        // 1. Kiểm tra tồn tại chip trong transaction và acquire row-lock nếu có
        let existingChip = await tx.horse.findFirst({
          where: { OR: [{ microchip }, { microchipRfid: microchip }] },
        });

        if (existingChip) {
          // Khóa hàng Horse để ngăn ngừa race condition
          await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${existingChip.id} FOR UPDATE`;
          const freshHorse = await tx.horse.findUnique({ where: { id: existingChip.id } });
          if (freshHorse) {
            existingChip = freshHorse;
          }

          // Chặn đăng ký lại hồ sơ đã xóa mềm — yêu cầu khôi phục thay vì đăng ký mới
          if (existingChip.deletedAt !== null) {
            throw apiError(
              HttpStatus.CONFLICT,
              'DUPLICATE_MICROCHIP',
              'Số microchip thuộc một hồ sơ trong mục Hồ sơ đã xóa. Hãy khôi phục hồ sơ đó thay vì tạo mới.',
            );
          }

          // Chống chiếm đoạt vi mạch: chỉ chính chủ sở hữu của hồ sơ mới được nộp lại
          if (existingChip.ownerId !== user.userId) {
            throw apiError(
              HttpStatus.CONFLICT,
              'DUPLICATE_MICROCHIP',
              'Số microchip đã được gán cho ngựa khác hoặc thuộc chủ sở hữu khác.',
            );
          }

          // Kiểm tra hồ sơ tiếp nhận đang hoạt động (được bảo vệ bởi row-lock)
          const activeCount = await tx.horseAdmissionRecord.count({
            where: {
              horseId: existingChip.id,
              status: { in: ACTIVE_ADMISSION_STATUSES },
            },
          });
          assertNoActiveAdmission(activeCount);

          // Chỉ cho phép nộp lại khi trạng thái là REJECTED hoặc PENDING_ADMISSION (hồ sơ trước đã terminal)
          if (
            existingChip.status !== HorseStatus.REJECTED &&
            existingChip.status !== HorseStatus.PENDING_ADMISSION
          ) {
            throw apiError(
              HttpStatus.CONFLICT,
              'DUPLICATE_MICROCHIP',
              'Chiến mã này đã gia nhập CLB hoặc đang trong hệ thống quản lý.',
            );
          }

          // Kiểm tra trùng tên khi đổi tên trong lần nộp lại
          if (dto.name.trim().toLowerCase() !== existingChip.name.toLowerCase()) {
            const duplicateName = await tx.horse.findFirst({
              where: {
                name: { equals: dto.name.trim(), mode: 'insensitive' },
                id: { not: existingChip.id },
                deletedAt: null,
              },
            });
            if (duplicateName) {
              throw apiError(
                HttpStatus.CONFLICT,
                'DUPLICATE_NAME',
                'Tên ngựa đã tồn tại trong hệ thống.',
              );
            }
          }

          const admissionCode = await this.generateAdmissionCode(tx);

          const updatedHorse = await tx.horse.update({
            where: { id: existingChip.id },
            data: {
              name: dto.name.trim(),
              breed,
              dob,
              gender: dto.gender,
              color,
              weightKg: dto.weightKg != null ? Number(dto.weightKg) : null,
              status: HorseStatus.PENDING_ADMISSION,
              avatarUrl: dto.avatarUrl || existingChip.avatarUrl,
              deletedAt: null,
              deletedById: null,
              deleteReason: null,
            },
            include: {
              owner: { select: USER_SAFE_SELECT },
              stallAllocations: {
                where: { isActive: true },
                include: { stall: true, assignedGroom: { select: USER_SAFE_SELECT } },
              },
            },
          });

          const createdAdm = await tx.horseAdmissionRecord.create({
            data: {
              admissionCode,
              horseId: updatedHorse.id,
              ownerId: user.userId,
              status: AdmissionStatus.PENDING_VERIFICATION,
              declaredMicrochip: microchip,
              documentsUrl: normalizedDocs.documentsUrl,
              ...(normalizedDocs.documentPhotos
                ? { documentPhotos: normalizedDocs.documentPhotos as Prisma.InputJsonValue }
                : {}),
              ...(normalizedOwnerNotes ? { ownerNotes: normalizedOwnerNotes } : {}),
            },
          });

          const reapplyDocCount = normalizedDocs.documentPhotos?.length ?? 0;
          await tx.admissionHistoryLog.create({
            data: {
              admissionId: createdAdm.id,
              fromStatus: null,
              toStatus: AdmissionStatus.PENDING_VERIFICATION,
              actorUserId: user.userId,
              actorName: user.fullName || user.email || 'Chủ ngựa',
              note:
                reapplyDocCount > 0
                  ? `Chủ ngựa nộp đơn đăng ký lại tiếp nhận vào CLB (kèm ${reapplyDocCount} ảnh giấy tờ pháp lý)`
                  : 'Chủ ngựa nộp đơn đăng ký lại tiếp nhận vào CLB',
            },
          });

          await this.auditService.record(
            { id: user.userId, name: user.fullName || user.email },
            'HORSE_ADMISSION_REGISTERED',
            `Đăng ký lại tiếp nhận ngựa ${updatedHorse.name} (${updatedHorse.horseCode}) - Mã ${admissionCode}`,
            updatedHorse.id,
            {
              entityName: 'HorseAdmissionRecord',
              newValues: {
                name: updatedHorse.name,
                horseCode: updatedHorse.horseCode,
                status: updatedHorse.status,
                admissionCode,
              },
            },
            tx,
          );

          return { horse: updatedHorse, admission: createdAdm, isReapply: true };
        }

        // Ngựa mới hoàn toàn: kiểm tra trùng tên
        const existingName = await tx.horse.findFirst({
          where: { name: { equals: dto.name.trim(), mode: 'insensitive' }, deletedAt: null },
        });
        if (existingName) {
          throw apiError(
            HttpStatus.CONFLICT,
            'DUPLICATE_NAME',
            'Tên ngựa đã tồn tại trong hệ thống.',
          );
        }

        const horseCode = await this.generateHorseCode(tx);
        const admissionCode = await this.generateAdmissionCode(tx);
        const microchipRfid = microchip;

        const created = await tx.horse.create({
          data: {
            horseCode,
            name: dto.name.trim(),
            breed,
            dob,
            gender: dto.gender,
            color,
            weightKg: dto.weightKg != null ? Number(dto.weightKg) : null,
            microchip,
            microchipRfid,
            status: HorseStatus.PENDING_ADMISSION,
            isMedicalLocked: false,
            ownerId: dto.ownerId || null,
            avatarUrl: dto.avatarUrl || null,
          },
          include: {
            owner: { select: USER_SAFE_SELECT },
            stallAllocations: {
              where: { isActive: true },
              include: { stall: true, assignedGroom: { select: USER_SAFE_SELECT } },
            },
          },
        });

        const createdAdm = await tx.horseAdmissionRecord.create({
          data: {
            admissionCode,
            horseId: created.id,
            ownerId: user.userId,
            status: AdmissionStatus.PENDING_VERIFICATION,
            declaredMicrochip: microchip,
            documentsUrl: normalizedDocs.documentsUrl,
            ...(normalizedDocs.documentPhotos
              ? { documentPhotos: normalizedDocs.documentPhotos as Prisma.InputJsonValue }
              : {}),
            ...(normalizedOwnerNotes ? { ownerNotes: normalizedOwnerNotes } : {}),
          },
        });

        const initialDocCount = normalizedDocs.documentPhotos?.length ?? 0;
        await tx.admissionHistoryLog.create({
          data: {
            admissionId: createdAdm.id,
            fromStatus: null,
            toStatus: AdmissionStatus.PENDING_VERIFICATION,
            actorUserId: user.userId,
            actorName: user.fullName || user.email || 'Chủ ngựa',
            note:
              initialDocCount > 0
                ? `Chủ ngựa nộp hồ sơ đăng ký tiếp nhận vào CLB (kèm ${initialDocCount} ảnh giấy tờ pháp lý)`
                : 'Chủ ngựa nộp đơn đăng ký tiếp nhận vào CLB',
          },
        });

        await this.auditService.record(
          { id: user.userId, name: user.fullName || user.email },
          'HORSE_CREATED',
          `Tạo mới hồ sơ ngựa ${created.name} (${created.horseCode}) - Chờ thẩm định tiếp nhận`,
          created.id,
          {
            entityName: 'Horse',
            newValues: {
              name: created.name,
              horseCode: created.horseCode,
              status: created.status,
              admissionCode,
            },
          },
          tx,
        );

        return { horse: created, admission: createdAdm, isReapply: false };
      });

      horse = res.horse;
      admission = res.admission;
      isReapply = res.isReapply;
    } catch (err: any) {
      if (this.isMicrochipUniqueConflict(err)) {
        const existingHorse = await this.prisma.horse.findFirst({
          where: { OR: [{ microchip }, { microchipRfid: microchip }] },
          select: { id: true, ownerId: true },
        });
        if (existingHorse) {
          const activeCount = await this.prisma.horseAdmissionRecord.count({
            where: {
              horseId: existingHorse.id,
              status: { in: ACTIVE_ADMISSION_STATUSES },
            },
          });
          if (activeCount > 0) {
            throw apiError(
              HttpStatus.CONFLICT,
              'ACTIVE_ADMISSION_EXISTS',
              'Ngựa này đang có hồ sơ tiếp nhận được xử lý.',
            );
          }
        }
        throw apiError(
          HttpStatus.CONFLICT,
          'DUPLICATE_MICROCHIP',
          'Số microchip đã tồn tại trong hệ thống hoặc thuộc chủ sở hữu khác.',
        );
      }
      throw err;
    }

    // Gửi email sau transaction commit thành công
    await this.safeSendMail({
      eventCode: 'ADMISSION_REQUEST_RECEIVED',
      recipients: [
        {
          userId: user.userId,
          body: {
            ...admissionRequestReceived(admission, horse, {
              id: user.userId,
              fullName: user.fullName || user.email || 'Chủ ngựa',
              email: user.email,
            }),
            refId: admission.id,
            milestone: isReapply ? `reapply-${admission.id}` : 'initial',
          },
        },
      ],
    });

    return this.applyRolePolicy(horse, user);
  }

  /**
   * Cập nhật thông tin định danh hồ sơ ngựa (FR-1.02).
   * Khóa không cho thay đổi microchip khi ngựa đã được tiếp nhận hoặc đang có hồ sơ tiếp nhận hoạt động.
   * Chống race condition với đăng ký lại: toàn bộ read, active check và write gói trong transaction với row-lock Horse.
   */
  async update(id: string, dto: UpdateHorseDto, user: CurrentUserPayload) {
    const updated = await this.prisma.$transaction(async (tx) => {
      // 1. Khóa hàng Horse trước để đồng bộ thứ tự khóa với reapply/admissions (Horse row-lock)
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${id} FOR UPDATE`;

      const horse = await tx.horse.findUnique({
        where: { id, deletedAt: null },
        include: {
          stallAllocations: { where: { isActive: true } },
        },
      });

      if (!horse) {
        throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Không tìm thấy hồ sơ ngựa.');
      }

      if (horse.ownerId !== user.userId) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'NOT_HORSE_OWNER',
          'You can only edit horses you own.',
        );
      }

      if (horse.status === HorseStatus.RETIRED) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'HORSE_RETIRED',
          'Ngựa đã ngừng quản lý. Vui lòng kích hoạt lại trước khi thao tác.',
        );
      }

      const dobChanged = !!dto.dob && new Date(dto.dob).getTime() !== horse.dob.getTime();
      if (dto.dob && dobChanged) {
        const dob = new Date(dto.dob);
        const now = new Date();
        const twelveYearsAgo = new Date();
        twelveYearsAgo.setFullYear(now.getFullYear() - 12);

        if (dob > now) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'INVALID_DOB',
            'Ngày sinh không được sau ngày hiện tại.',
          );
        }
        if (dob < twelveYearsAgo) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'INVALID_DOB',
            'Tuổi của ngựa không được vượt quá 12 tuổi (ngày sinh không sớm hơn 12 năm trước tính đến ngày hiện tại).',
          );
        }
      }

      if (dto.name && dto.name.trim().toLowerCase() !== horse.name.toLowerCase()) {
        const existingName = await tx.horse.findFirst({
          where: {
            name: { equals: dto.name.trim(), mode: 'insensitive' },
            id: { not: id },
            deletedAt: null,
          },
        });
        if (existingName) {
          throw apiError(
            HttpStatus.CONFLICT,
            'DUPLICATE_NAME',
            'Tên ngựa đã tồn tại trong hệ thống.',
          );
        }
      }

      if (dto.microchip && dto.microchip !== horse.microchip) {
        // 1. Chặn đổi microchip nếu ngựa đã được tiếp nhận vào CLB
        if (
          horse.status !== HorseStatus.PENDING_ADMISSION &&
          horse.status !== HorseStatus.REJECTED
        ) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'MICROCHIP_IMMUTABLE',
            'Không thể sửa số vi mạch của ngựa đã được tiếp nhận vào CLB.',
          );
        }

        // 2. Chặn đổi microchip khi đang có hồ sơ tiếp nhận hoạt động (được bảo vệ bởi row-lock đã acquire ở trên)
        const activeAdmission = await tx.horseAdmissionRecord.findFirst({
          where: { horseId: id, status: { in: ACTIVE_ADMISSION_STATUSES } },
        });
        if (activeAdmission) {
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'ADMISSION_IN_PROGRESS',
            'Không thể sửa số vi mạch khi hồ sơ tiếp nhận đang được xử lý.',
          );
        }

        const existingChip = await tx.horse.findFirst({
          where: {
            OR: [{ microchip: dto.microchip }, { microchipRfid: dto.microchip }],
            id: { not: id },
          },
        });
        if (existingChip) {
          throw apiError(
            HttpStatus.CONFLICT,
            'DUPLICATE_MICROCHIP',
            'Số microchip đã được gán cho ngựa khác.',
          );
        }
      }

      const breed = dto.breed
        ? await this.catalogs.resolveName(HorseCatalogType.BREED, dto.breed, horse.breed)
        : undefined;
      const color = dto.color
        ? await this.catalogs.resolveName(HorseCatalogType.COLOR, dto.color, horse.color)
        : undefined;

      const updatedHorse = await tx.horse.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(breed ? { breed } : {}),
          ...(dto.dob ? { dob: new Date(dto.dob) } : {}),
          ...(dto.gender ? { gender: dto.gender } : {}),
          ...(color ? { color } : {}),
          ...(dto.weightKg !== undefined
            ? { weightKg: dto.weightKg != null ? Number(dto.weightKg) : null }
            : {}),
          ...(dto.microchip
            ? {
                microchip: dto.microchip,
                microchipRfid: dto.microchip,
              }
            : {}),
          ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
        },
        include: {
          owner: { select: USER_SAFE_SELECT },
          stallAllocations: {
            where: { isActive: true },
            include: { stall: true, assignedGroom: { select: USER_SAFE_SELECT } },
          },
        },
      });

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'HORSE_UPDATED',
        `Updated identification record for horse ${updatedHorse.name} (${updatedHorse.horseCode || updatedHorse.id})`,
        updatedHorse.id,
        {
          entityName: 'Horse',
          oldValues: { name: horse.name, status: horse.status, microchip: horse.microchip },
          newValues: {
            name: updatedHorse.name,
            status: updatedHorse.status,
            microchip: updatedHorse.microchip,
          },
        },
        tx,
      );

      return updatedHorse;
    });

    return this.applyRolePolicy(updated, user);
  }

  /**
   * Tra cứu danh sách hồ sơ ngựa có tìm kiếm, lọc, sắp xếp, phân trang (FR-1.03).
   */
  async findAll(query: QueryHorseDto, user: CurrentUserPayload) {
    const {
      search,
      status,
      isMedicalLocked,
      breed,
      gender,
      sortBy = 'name',
      sortOrder = 'asc',
      page = 1,
      limit = 20,
    } = query;

    const where: Prisma.HorseWhereInput = { deletedAt: null };
    const andFilters: Prisma.HorseWhereInput[] = [];

    if (user.role === UserRole.HORSE_OWNER) {
      where.ownerId = user.userId;
    } else if (user.role === UserRole.GROOM) {
      andFilters.push({
        OR: [
          { stallAllocations: { some: { isActive: true, assignedGroomUserId: user.userId } } },
          {
            dailyCareTasks: {
              some: { date: rosterDay(), assignedGroomUserId: user.userId, cancelledAt: null },
            },
          },
        ],
      });
    } else if (user.role === UserRole.HEAD_TRAINER) {
      andFilters.push(trainerHorseScope(user.userId, query.assignable === 'true'));
    }

    if (search && search.trim()) {
      const q = search.trim();
      andFilters.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { horseCode: { contains: q, mode: 'insensitive' } },
          { microchip: { contains: q, mode: 'insensitive' } },
          { microchipRfid: { contains: q, mode: 'insensitive' } },
          { breed: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    if (status && status !== 'ALL') {
      const statuses = status
        .split(',')
        .map((s) => s.trim())
        .filter((s) => Object.values(HorseStatus).includes(s as HorseStatus)) as HorseStatus[];

      if (statuses.length === 1) {
        where.status = statuses[0];
      } else if (statuses.length > 1) {
        where.status = { in: statuses };
      }
    }

    if (isMedicalLocked !== undefined && isMedicalLocked !== '') {
      where.isMedicalLocked = isMedicalLocked === 'true';
    }

    if (
      query.noStall === 'true' &&
      user.role !== UserRole.GROOM &&
      user.role !== UserRole.HORSE_OWNER
    ) {
      where.stallAllocations = { none: { isActive: true } };
    }

    if (breed && breed !== 'ALL') {
      where.breed = { equals: breed, mode: 'insensitive' };
    }
    if (gender && gender !== 'ALL') {
      where.gender = { equals: gender, mode: 'insensitive' };
    }

    // Sắp xếp
    const isReadinessSort = !sortBy || sortBy === 'readiness' || sortBy === 'name';
    let orderBy: Prisma.HorseOrderByWithRelationInput = { name: sortOrder };
    if (!isReadinessSort) {
      if (sortBy === 'horseCode') {
        orderBy = { horseCode: sortOrder };
      } else if (sortBy === 'status') {
        orderBy = { status: sortOrder };
      } else if (sortBy === 'dob') {
        orderBy = { dob: sortOrder };
      } else if (sortBy === 'createdAt') {
        orderBy = { createdAt: sortOrder };
      }
    }

    const skip = (page - 1) * limit;

    const [horses, total] = await Promise.all([
      this.prisma.horse.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          owner: { select: USER_SAFE_SELECT },
          assignedTrainer: { select: USER_SAFE_SELECT },
          stallAllocations: {
            where: { isActive: true },
            include: { stall: true, assignedGroom: { select: USER_SAFE_SELECT } },
          },
          medicalLocks: {
            where: { isLocked: true },
            take: 1,
            select: { id: true, isLocked: true, lockReason: true, lockedAt: true },
          },
          trainingPlans: {
            where: { status: 'ACTIVE' },
            take: 1,
            select: {
              id: true,
              phaseName: true,
              endDate: true,
              trainer: { select: USER_SAFE_SELECT },
            },
          },
        },
      }),
      this.prisma.horse.count({ where }),
    ]);

    const items = horses.map((h) => this.applyRolePolicy(h, user));

    // Bậc thang 6 cấp độ ưu tiên sẵn sàng thi đấu
    if (isReadinessSort) {
      const horseReadinessRank = (h: {
        status: string;
        isMedicalLocked?: boolean;
        isDebtImpounded?: boolean;
      }): number => {
        if (h.isDebtImpounded || h.status === 'RETIRED') return 6;
        if (h.isMedicalLocked || h.status === 'INJURED' || h.status === 'ISOLATED') return 5;
        if (h.status === 'UNDER_OBSERVATION') return 4;
        if (h.status === 'ACTIVE') return 1;
        if (h.status === 'IN_TRAINING') return 2;
        if (h.status === 'RESTING') return 3;
        return 3;
      };
      items.sort((a, b) => {
        const diff =
          sortOrder === 'desc'
            ? horseReadinessRank(b) - horseReadinessRank(a)
            : horseReadinessRank(a) - horseReadinessRank(b);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, 'vi');
      });
    }

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Xem chi tiết hồ sơ ngựa theo ID (FR-1.04).
   */
  async findOne(id: string, user: CurrentUserPayload) {
    const horse = await this.prisma.horse.findUnique({
      where: { id, deletedAt: null },
      include: {
        owner: { select: USER_SAFE_SELECT },
        assignedTrainer: { select: USER_SAFE_SELECT },
        stallAllocations: {
          where: { isActive: true },
          include: { stall: true, assignedGroom: { select: USER_SAFE_SELECT } },
        },
        medicalLocks: {
          where: { isLocked: true },
          include: { veterinarian: { select: USER_SAFE_SELECT } },
          take: 1,
        },
        handoverRequests: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            toTrainer: { select: USER_SAFE_SELECT },
            fromManager: { select: USER_SAFE_SELECT },
          },
        },
        admissionRecords: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            manager: { select: USER_SAFE_SELECT },
            veterinarian: { select: USER_SAFE_SELECT },
            approvedBy: { select: USER_SAFE_SELECT },
            history: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });

    if (!horse) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'HORSE_NOT_FOUND',
        'Không tìm thấy hồ sơ ngựa hoặc bạn không có quyền xem.',
      );
    }

    if (
      user.role === UserRole.HEAD_TRAINER &&
      !(await this.prisma.horse.count({
        where: { id: horse.id, ...trainerHorseScope(user.userId) },
      }))
    ) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'HORSE_NOT_FOUND',
        'Không tìm thấy hồ sơ ngựa hoặc bạn không có quyền xem.',
      );
    }
    if (user.role === UserRole.HORSE_OWNER && horse.ownerId !== user.userId) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'HORSE_NOT_FOUND',
        'Không tìm thấy hồ sơ ngựa hoặc bạn không có quyền xem.',
      );
    }

    if (user.role === UserRole.GROOM) {
      const allocations = (horse as any).stallAllocations || [];
      const isPrimary = allocations.some(
        (a: any) => a.isActive && a.assignedGroomUserId === user.userId,
      );
      const isAssigned =
        isPrimary ||
        !!(await this.prisma.dailyCareTask.findFirst({
          where: {
            horseId: id,
            date: rosterDay(),
            assignedGroomUserId: user.userId,
            cancelledAt: null,
          },
        }));
      if (!isAssigned) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'HORSE_NOT_FOUND',
          'Không tìm thấy hồ sơ ngựa hoặc bạn không có quyền xem.',
        );
      }
    }

    return this.applyRolePolicy(horse, user);
  }

  // =========================================================================
  // ADMISSION SERVICE METHODS (ADM-02, SPEC-EQUIFLOW-HORSE-ADMISSION-V2 §5)
  // =========================================================================

  /**
   * 1. GET /horses/admissions: Tra cứu danh sách hồ sơ tiếp nhận (Staff-only).
   * Hỗ trợ tìm kiếm, lọc trạng thái, lọc nhanh recent7Days=true, và phân trang.
   */
  async listAdmissions(query: QueryAdmissionDto, user: CurrentUserPayload) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 10));
    const skip = (page - 1) * pageSize;

    const where: Prisma.HorseAdmissionRecordWhereInput = {};
    if (user.role === UserRole.VETERINARIAN) where.veterinarianUserId = user.userId;
    if (user.role === UserRole.HORSE_OWNER) where.ownerId = user.userId;

    if (query.recent7Days) {
      const sevenDaysAgo = new Date(effectiveNow().getTime() - 7 * 24 * 60 * 60 * 1000);
      where.status = AdmissionStatus.APPROVED;
      where.admittedAt = { gte: sevenDaysAgo };
    } else if (query.status) {
      where.status = query.status;
    }

    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { admissionCode: { contains: s, mode: 'insensitive' } },
        { declaredMicrochip: { contains: s, mode: 'insensitive' } },
        { scannedMicrochip: { contains: s, mode: 'insensitive' } },
        { horse: { name: { contains: s, mode: 'insensitive' } } },
        { horse: { horseCode: { contains: s, mode: 'insensitive' } } },
        { horse: { microchip: { contains: s, mode: 'insensitive' } } },
        { owner: { fullName: { contains: s, mode: 'insensitive' } } },
        { owner: { email: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [total, rawData] = await Promise.all([
      this.prisma.horseAdmissionRecord.count({ where }),
      this.prisma.horseAdmissionRecord.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: query.recent7Days
          ? [{ admittedAt: 'desc' }, { id: 'desc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              breed: true,
              gender: true,
              dob: true,
              color: true,
              weightKg: true,
              microchip: true,
              avatarUrl: true,
              status: true,
            },
          },
          owner: { select: USER_SAFE_SELECT },
          manager: { select: USER_SAFE_SELECT },
          veterinarian: { select: USER_SAFE_SELECT },
          approvedBy: { select: USER_SAFE_SELECT },
        },
      }),
    ]);

    const data = rawData.map((rec) => this.sanitizeAdmissionForRole(rec, user));

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 2. GET /horses/admissions/:id/history: Xem dòng thời gian lịch sử các bước của hồ sơ tiếp nhận.
   */
  async getAdmissionHistory(admissionId: string, user: CurrentUserPayload) {
    const admission = await this.prisma.horseAdmissionRecord.findUnique({
      where: { id: admissionId },
      include: {
        healthReviews: { orderBy: { createdAt: 'desc' } },
        horse: {
          select: {
            id: true,
            name: true,
            horseCode: true,
            breed: true,
            gender: true,
            dob: true,
            color: true,
            weightKg: true,
            microchip: true,
            avatarUrl: true,
            status: true,
          },
        },
        owner: { select: USER_SAFE_SELECT },
        manager: { select: USER_SAFE_SELECT },
        veterinarian: { select: USER_SAFE_SELECT },
        approvedBy: { select: USER_SAFE_SELECT },
      },
    });

    if (
      !admission ||
      (user.role === UserRole.VETERINARIAN && admission.veterinarianUserId !== user.userId) ||
      (user.role === UserRole.HORSE_OWNER && admission.ownerId !== user.userId)
    ) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'ADMISSION_NOT_FOUND',
        'Không tìm thấy hồ sơ tiếp nhận.',
      );
    }

    const history = await this.prisma.admissionHistoryLog.findMany({
      where: { admissionId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      admission: this.sanitizeAdmissionForRole(admission, user),
      history,
    };
  }

  /**
   * 3. POST /horses/admissions/:id/schedule: Quản lý CLB xếp ngày giờ hẹn mang ngựa đến trung tâm tiếp nhận.
   * Lock order: Horse rồi đến HorseAdmissionRecord.
   */
  async scheduleAdmission(
    admissionId: string,
    dto: ScheduleAdmissionDto,
    user: CurrentUserPayload,
  ) {
    const previousParticipants: Array<string | null> = [];
    const appointmentDate = new Date(dto.appointmentDate);
    if (isNaN(appointmentDate.getTime())) {
      throw apiError(HttpStatus.BAD_REQUEST, 'INVALID_DATE', 'Thời gian hẹn không hợp lệ.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const pre = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        select: { id: true, horseId: true },
      });
      if (!pre) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      // Khóa tuần tự: Horse -> HorseAdmissionRecord
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${pre.horseId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "HorseAdmissionRecord" WHERE "id" = ${pre.id} FOR UPDATE`;

      const record = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        include: { horse: true, owner: { select: USER_SAFE_SELECT } },
      });
      if (!record) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      assertValidScheduleTransition(record.status);
      previousParticipants.push(record.managerUserId, record.veterinarianUserId);

      const managerUserId = dto.managerUserId ?? user.userId;
      const veterinarianUserId = dto.veterinarianUserId ?? record.veterinarianUserId;
      if (!veterinarianUserId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'ADMISSION_VET_REQUIRED',
          'Vui lòng chọn bác sĩ cùng tham gia thẩm định.',
        );
      }
      const { startsAt, endsAt } = workInterval(
        appointmentDate,
        dto.appointmentEndDate ?? new Date(appointmentDate.getTime() + 3600000),
      );
      if (startsAt <= effectiveNow()) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'APPOINTMENT_IN_PAST',
          'Lịch hẹn phải ở thời điểm trong tương lai.',
        );
      }
      const participants = await tx.user.findMany({
        where: {
          id: { in: [managerUserId, veterinarianUserId] },
          status: UserStatus.ACTIVE,
        },
        select: { id: true, role: true },
      });
      if (
        !participants.some((p) => p.id === managerUserId && p.role === Role.CLUB_MANAGER) ||
        !participants.some((p) => p.id === veterinarianUserId && p.role === Role.VETERINARIAN)
      ) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_ADMISSION_PARTICIPANTS',
          'Quản lý và bác sĩ phải là tài khoản đang hoạt động, đúng vai trò.',
        );
      }
      await assertStaffAvailable(tx, [managerUserId, veterinarianUserId], startsAt, endsAt, {
        admissionId,
      });

      const res = await tx.horseAdmissionRecord.update({
        where: { id: admissionId },
        data: {
          status: AdmissionStatus.APPOINTED,
          appointmentDate,
          appointmentEndDate: endsAt,
          managerUserId,
          veterinarianUserId,
          capacityDeferredAt: null,
          appointmentNotes: dto.appointmentNotes != null ? dto.appointmentNotes.trim() : null,
        },
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              breed: true,
              gender: true,
              dob: true,
              color: true,
              microchip: true,
              avatarUrl: true,
              status: true,
            },
          },
          owner: { select: USER_SAFE_SELECT },
        },
      });

      await tx.admissionHistoryLog.create({
        data: {
          admissionId,
          fromStatus: record.status,
          toStatus: AdmissionStatus.APPOINTED,
          actorUserId: user.userId,
          actorName: user.fullName || user.email || 'Quản lý CLB',
          note:
            (dto.appointmentNotes != null ? dto.appointmentNotes.trim() : null) ||
            (record.status === AdmissionStatus.APPOINTED
              ? 'Đổi lịch hẹn tiếp nhận tại CLB'
              : 'Xếp lịch hẹn tiếp nhận tại trạm kiểm định Cổng A'),
        },
      });

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'ADMISSION_SCHEDULED',
        `Xếp lịch hẹn tiếp nhận cho ngựa ${record.horse.name} (${record.admissionCode}) lúc ${appointmentDate.toISOString()}`,
        admissionId,
        {
          entityName: 'HorseAdmissionRecord',
          oldValues: { status: record.status, appointmentDate: record.appointmentDate },
          newValues: { status: AdmissionStatus.APPOINTED, appointmentDate },
        },
        tx,
      );

      return {
        ...res,
        horse: res.horse || (record as any).horse,
        owner: res.owner || (record as any).owner,
      };
    });

    // Gửi Email 1 sau transaction; phân biệt phiên bản lịch hẹn bằng timestamp milestone
    const removedParticipants = previousParticipants.filter(
      (id) => id && id !== updated.managerUserId && id !== updated.veterinarianUserId,
    );
    if (removedParticipants.length)
      await this.notifications.notifyUsers(removedParticipants, {
        type: 'ADMISSION_APPOINTMENT_SCHEDULED',
        category: 'SYSTEM',
        title: 'Lịch thẩm định chung',
        message: `Lịch thẩm định ${updated.horse.name} (${updated.admissionCode}) đã được cập nhật. Vui lòng kiểm tra thời gian trên lịch công việc.`,
        link: '/staff/schedule',
        dedupeKey: `admission-schedule:${updated.id}:${updated.updatedAt?.getTime() ?? appointmentDate.getTime()}`,
      });
    await this.notifications.notifyUsers([updated.managerUserId], {
      type: 'ADMISSION_APPOINTMENT_ASSIGNED',
      category: 'SYSTEM',
      title: 'Lịch thẩm định được phân công',
      message: `Bạn phụ trách thẩm định ${updated.horse.name} (${updated.admissionCode}).`,
      link: `/horses/admissions?inspection=${updated.id}`,
      dedupeKey: `admission-manager:${updated.id}:${updated.updatedAt?.getTime() ?? appointmentDate.getTime()}`,
    });
    await this.notifications.notifyUsers([updated.veterinarianUserId], {
      type: 'ADMISSION_APPOINTMENT_ASSIGNED',
      category: 'SYSTEM',
      title: 'Thẩm định sức khỏe được phân công',
      message: `Quản lý đã phân công bạn khám thẩm định ${updated.horse.name} (${updated.admissionCode}).`,
      link: `/medical/admissions?inspection=${updated.id}`,
      dedupeKey: `admission-vet:${updated.id}:${updated.updatedAt?.getTime() ?? appointmentDate.getTime()}`,
    });
    await this.notifications.notifyUsers([updated.ownerId], {
      type: 'ADMISSION_APPOINTMENT_SCHEDULED',
      category: 'HORSE',
      title: 'CLB đã xếp lịch hẹn tiếp nhận ngựa',
      message: `Hồ sơ ${updated.admissionCode} (${updated.horse.name}) đã có lịch hẹn thẩm định. Vui lòng xem chi tiết và hướng dẫn đón tiếp.`,
      link: `/horses/${updated.horseId}`,
      dedupeKey: `admission-owner-schedule:${updated.id}:${updated.updatedAt?.getTime() ?? appointmentDate.getTime()}`,
    });
    await this.safeSendMail({
      eventCode: 'ADMISSION_APPOINTMENT_SCHEDULED',
      recipients: [
        {
          userId: updated.ownerId,
          body: {
            ...admissionAppointmentScheduled(updated, updated.horse, updated.owner),
            refId: updated.id,
            milestone: `scheduled-${updated.id}-${appointmentDate.getTime()}`,
          },
        },
      ],
    });

    return updated;
  }

  /**
   * 4. PATCH /horses/admissions/:id/inspect: Cập nhật kết quả quét chip, giấy tờ pháp lý hoặc khám thú y.
   * Lock order: Horse -> HorseAdmissionRecord. Chặn field spoofing; tính toán microchipVerified server-side.
   */
  async inspectAdmission(
    admissionId: string,
    dto: InspectAdmissionDto,
    user: CurrentUserPayload,
    reviewReason?: string,
  ) {
    assertInspectFieldRoles(user.role, dto);

    const updated = await this.prisma.$transaction(async (tx) => {
      const pre = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        select: { id: true, horseId: true },
      });
      if (!pre) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${pre.horseId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "HorseAdmissionRecord" WHERE "id" = ${pre.id} FOR UPDATE`;

      const record = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        include: { horse: true, owner: { select: USER_SAFE_SELECT } },
      });
      if (!record) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      assertValidInspectTransition(record.status);

      await assertAdmissionCapacity(tx);
      if (user.role === UserRole.VETERINARIAN && record.veterinarianUserId !== user.userId) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'ADMISSION_VET_MISMATCH',
          'Hồ sơ này đã được phân công cho bác sĩ khác.',
        );
      }

      const updateData: Prisma.HorseAdmissionRecordUpdateInput = {};
      const oldSnap: Record<string, any> = {};
      const newSnap: Record<string, any> = {};

      if (user.role === UserRole.CLUB_MANAGER) {
        if (dto.scannedMicrochip !== undefined) {
          const scanned = dto.scannedMicrochip != null ? dto.scannedMicrochip.trim() : '';
          updateData.scannedMicrochip = scanned;
          updateData.microchipVerified = computeMicrochipVerified(
            scanned,
            record.declaredMicrochip || record.horse.microchip,
          );
          oldSnap.scannedMicrochip = record.scannedMicrochip;
          oldSnap.microchipVerified = record.microchipVerified;
          newSnap.scannedMicrochip = updateData.scannedMicrochip;
          newSnap.microchipVerified = updateData.microchipVerified;
        }
        if (dto.legalVerified !== undefined) {
          updateData.legalVerified = dto.legalVerified;
          oldSnap.legalVerified = record.legalVerified;
          newSnap.legalVerified = dto.legalVerified;
        }
        if (dto.legalDocumentsNote !== undefined) {
          updateData.legalDocumentsNote =
            dto.legalDocumentsNote != null ? dto.legalDocumentsNote.trim() : null;
          oldSnap.legalDocumentsNote = record.legalDocumentsNote;
          newSnap.legalDocumentsNote = updateData.legalDocumentsNote;
        }
        if (dto.documentsUrl !== undefined) {
          updateData.documentsUrl = dto.documentsUrl != null ? dto.documentsUrl.trim() : null;
          oldSnap.documentsUrl = record.documentsUrl;
          newSnap.documentsUrl = updateData.documentsUrl;
        }
      }

      if (user.role === UserRole.VETERINARIAN) {
        if (record.healthFinalizedAt && !reviewReason)
          throw apiError(
            HttpStatus.CONFLICT,
            'ADMISSION_HEALTH_FINALIZED',
            'Kết luận đã chốt. Chỉ được ghi nhận lượt đánh giá bổ sung, không sửa bản cũ.',
          );
        if (dto.isHealthEligible !== undefined && !dto.finalizeHealth)
          throw apiError(
            HttpStatus.BAD_REQUEST,
            'HEALTH_CONFIRMATION_REQUIRED',
            'Vui lòng xác nhận chốt kết luận sức khỏe.',
          );
        if (dto.finalizeHealth) {
          if (
            typeof dto.isHealthEligible !== 'boolean' ||
            !dto.healthCheckNotes ||
            dto.healthCheckNotes.trim().length < 2
          )
            throw apiError(
              HttpStatus.BAD_REQUEST,
              'HEALTH_CONCLUSION_REQUIRED',
              'Chọn kết luận và nhập ghi chú khám trước khi chốt.',
            );
          updateData.healthFinalizedAt = new Date();
          await tx.admissionHealthReview.create({
            data: {
              admissionId,
              veterinarianUserId: user.userId,
              veterinarianName: user.fullName || user.email,
              isHealthEligible: dto.isHealthEligible,
              notes: dto.healthCheckNotes.trim(),
              reason: reviewReason?.trim() || null,
            },
          });
          newSnap.healthFinalizedAt = updateData.healthFinalizedAt;
          if (reviewReason) newSnap.reviewReason = reviewReason;
        }
        if (dto.isHealthEligible !== undefined) {
          updateData.isHealthEligible = dto.isHealthEligible;
          oldSnap.isHealthEligible = record.isHealthEligible;
          newSnap.isHealthEligible = dto.isHealthEligible;
        }
        if (dto.healthCheckNotes !== undefined) {
          updateData.healthCheckNotes =
            dto.healthCheckNotes != null ? dto.healthCheckNotes.trim() : null;
          oldSnap.healthCheckNotes = record.healthCheckNotes;
          newSnap.healthCheckNotes = updateData.healthCheckNotes;
        }
        updateData.veterinarian = { connect: { id: user.userId } };
        newSnap.veterinarianUserId = user.userId;
      }

      let toStatus = record.status;
      if (record.status === AdmissionStatus.APPOINTED) {
        toStatus = AdmissionStatus.INSPECTION_IN_PROGRESS;
        updateData.status = AdmissionStatus.INSPECTION_IN_PROGRESS;
      }

      const res = await tx.horseAdmissionRecord.update({
        where: { id: admissionId },
        data: updateData,
        include: {
          healthReviews: { orderBy: { createdAt: 'desc' } },
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              breed: true,
              gender: true,
              dob: true,
              color: true,
              microchip: true,
              avatarUrl: true,
              status: true,
            },
          },
          owner: { select: USER_SAFE_SELECT },
          veterinarian: { select: USER_SAFE_SELECT },
        },
      });

      if (record.status !== toStatus) {
        await tx.admissionHistoryLog.create({
          data: {
            admissionId,
            fromStatus: record.status,
            toStatus,
            actorUserId: user.userId,
            actorName:
              user.fullName ||
              user.email ||
              (user.role === UserRole.VETERINARIAN ? 'Bác sĩ thú y' : 'Quản lý CLB'),
            note: 'Bắt đầu thẩm định trực tiếp tại cổng tiếp nhận',
          },
        });
      } else {
        await tx.admissionHistoryLog.create({
          data: {
            admissionId,
            fromStatus: record.status,
            toStatus: record.status,
            actorUserId: user.userId,
            actorName:
              user.fullName ||
              user.email ||
              (user.role === UserRole.VETERINARIAN ? 'Bác sĩ thú y' : 'Quản lý CLB'),
            note:
              user.role === UserRole.VETERINARIAN
                ? `Khám y tế thú y (Đạt: ${res.isHealthEligible ? 'Có' : 'Không'})`
                : `Đối soát vi mạch & pháp lý (Chip khớp: ${res.microchipVerified ? 'Có' : 'Không'}, Pháp lý: ${res.legalVerified ? 'Đạt' : 'Chưa'})`,
          },
        });
      }

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'ADMISSION_INSPECTED',
        `Cập nhật thẩm định hồ sơ tiếp nhận ${record.admissionCode}`,
        admissionId,
        {
          entityName: 'HorseAdmissionRecord',
          oldValues: oldSnap,
          newValues: newSnap,
        },
        tx,
      );

      return {
        ...res,
        horse: res.horse || (record as any).horse,
        owner: res.owner || (record as any).owner,
      };
    });

    return updated;
  }

  /**
   * 5. POST /horses/admissions/:id/approve: Quản lý CLB duyệt tiếp nhận ngựa vào CLB.
   * Lock order: Stall -> Horse -> HorseAdmissionRecord, matching stall assignment.
   * Cập nhật atomic Horse.status = RESTING, Admission = APPROVED. Trả về snapshot horse mới nhất (RESTING).
   */
  async approveAdmission(
    admissionId: string,
    user: CurrentUserPayload,
    placement?: ApproveAdmissionDto,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      if (!placement)
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'ADMISSION_PLACEMENT_REQUIRED',
          'Chọn ô chuồng, Groom chính và người đang trực nhận bàn giao.',
        );
      await lockCareAssignments(tx);
      const stall = await lockAdmissionStall(tx, placement.stallId);
      const pre = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        select: { id: true, horseId: true },
      });
      if (!pre) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${pre.horseId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "HorseAdmissionRecord" WHERE "id" = ${pre.id} FOR UPDATE`;

      const record = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        include: {
          horse: true,
          owner: { select: USER_SAFE_SELECT },
          veterinarian: { select: USER_SAFE_SELECT },
        },
      });

      if (!record) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      assertAdmissionApprovable({
        status: record.status,
        microchipVerified: record.microchipVerified,
        legalVerified: record.legalVerified,
        isHealthEligible: record.isHealthEligible,
      });

      assertStatusTransition({
        role: user.role,
        from: record.horse.status,
        to: HorseStatus.RESTING,
        isMedicalLocked: record.horse.isMedicalLocked,
        isAdmissionProcess: true,
      });

      if (!record.healthFinalizedAt)
        throw apiError(
          HttpStatus.CONFLICT,
          'HEALTH_NOT_FINALIZED',
          'Bác sĩ chưa chốt kết luận sức khỏe.',
        );
      const target = await tx.stall.findUniqueOrThrow({ where: { id: stall.id } });
      await assertPrimaryGroom(tx, target.zoneId, placement.assignedGroomUserId);
      const receivingGroomId = placement.receivingGroomUserId || placement.assignedGroomUserId;
      const now = new Date();
      const clubToday = rosterDay(now);
      const clubYesterday = new Date(clubToday.getTime() - 86400000);
      const alreadyOnDuty = (await onDutyGrooms(tx, target.zoneId!, now)).some(
        (r) => r.groomUserId === receivingGroomId,
      );
      let fallbackShift: { shiftId: string; date: Date } | null = null;
      if (!alreadyOnDuty) {
        const activeShifts = await tx.shiftCatalog.findMany({
          where: { isActive: true },
          orderBy: { startTime: 'asc' },
        });
        let matchedDate = clubToday;
        let matchedShift = activeShifts[0];
        for (const candidateDate of [clubToday, clubYesterday]) {
          const found = activeShifts.find((s) => {
            const range = shiftInterval(candidateDate, s);
            return range.start <= now.getTime() && now.getTime() < range.end;
          });
          if (found) {
            matchedDate = candidateDate;
            matchedShift = found;
            break;
          }
        }
        if (matchedShift) {
          const exists = await tx.shiftRoster.findFirst({
            where: {
              zoneId: target.zoneId!,
              groomUserId: receivingGroomId,
              date: matchedDate,
              shiftId: matchedShift.id,
            },
          });
          if (!exists) {
            await tx.shiftRoster.create({
              data: {
                date: matchedDate,
                shiftId: matchedShift.id,
                zoneId: target.zoneId!,
                groomUserId: receivingGroomId,
                dutyTypes: ['HORSE_CARE', 'CLEANING'],
                createdById: user.userId,
              },
            });
          }
          fallbackShift = { shiftId: matchedShift.id, date: matchedDate };
        }
      }
      const receiving = await assertReceivingGroom(
        tx,
        target.zoneId!,
        receivingGroomId,
        record.horseId,
        now,
      ).catch((err) => {
        if (fallbackShift) return fallbackShift;
        throw err;
      });
      const admittedAt = new Date();

      if (
        await tx.stallAllocation.findFirst({ where: { horseId: record.horseId, isActive: true } })
      ) {
        throw apiError(
          HttpStatus.CONFLICT,
          'HORSE_HAS_STALL',
          'Ngựa đã được bố trí ô chuồng. Vui lòng tải lại hồ sơ.',
        );
      }
      await tx.stallAllocation.create({
        data: {
          stallId: stall.id,
          horseId: record.horseId,
          isActive: true,
          assignedGroomUserId: placement.assignedGroomUserId,
          startDate: admittedAt,
        },
      });
      await tx.stall.update({ where: { id: stall.id }, data: { status: 'OCCUPIED' } });

      await transferPendingCare(
        tx,
        record.horseId,
        target.zoneId!,
        target.id,
        receivingGroomId,
        receiving.shiftId,
        receiving.date,
      );
      await tx.dailyCareTask.create({
        data: {
          taskCode: `STALL-HANDOVER-${record.id}`,
          horseId: record.horseId,
          date: receiving.date,
          stallZoneId: target.zoneId,
          stallId: target.id,
          shiftId: receiving.shiftId,
          assignedGroomUserId: placement.receivingGroomUserId,
          taskType: 'OTHER',
          title: 'Nhận bàn giao ngựa mới tiếp nhận',
          description: 'Kiểm tra hồ sơ bàn giao, tình trạng ngựa và ô chuồng trước khi chăm sóc.',
          scheduledTime: new Date().toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
      });
      await tx.horse.update({
        where: { id: record.horseId },
        data: { status: HorseStatus.RESTING },
      });

      const approvedRecord = await tx.horseAdmissionRecord.update({
        where: { id: admissionId },
        data: {
          status: AdmissionStatus.APPROVED,
          approvedBy: { connect: { id: user.userId } },
          admittedAt,
        },
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              breed: true,
              gender: true,
              dob: true,
              color: true,
              microchip: true,
              avatarUrl: true,
              status: true,
            },
          },
          owner: { select: USER_SAFE_SELECT },
          veterinarian: { select: USER_SAFE_SELECT },
          approvedBy: { select: USER_SAFE_SELECT },
        },
      });

      await tx.admissionHistoryLog.create({
        data: {
          admissionId,
          fromStatus: record.status,
          toStatus: AdmissionStatus.APPROVED,
          actorUserId: user.userId,
          actorName: user.fullName || user.email || 'Quản lý CLB',
          note: 'Quản lý CLB chính thức phê duyệt tiếp nhận chiến mã vào CLB (trạng thái RESTING)',
        },
      });

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'ADMISSION_APPROVED',
        `Phê duyệt tiếp nhận chiến mã ${record.horse.name} (${record.horse.horseCode}) vào CLB`,
        admissionId,
        {
          entityName: 'HorseAdmissionRecord',
          oldValues: { status: record.status, horseStatus: record.horse.status },
          newValues: {
            status: AdmissionStatus.APPROVED,
            horseStatus: HorseStatus.RESTING,
            admittedAt,
          },
        },
        tx,
      );

      return {
        ...approvedRecord,
        horse: approvedRecord.horse || { ...(record as any).horse, status: HorseStatus.RESTING },
        owner: approvedRecord.owner || (record as any).owner,
      };
    });

    // Gửi Email 2 chúc mừng sau transaction
    await this.safeSendMail({
      eventCode: 'HORSE_ADMISSION_CONFIRMED',
      recipients: [
        {
          userId: updated.ownerId,
          body: {
            ...admissionApproved(
              updated,
              updated.horse,
              updated.owner,
              updated.veterinarian?.fullName,
            ),
            refId: updated.id,
            milestone: 'approved',
          },
        },
      ],
    });

    return updated;
  }

  /**
   * 6. POST /horses/admissions/:id/reject: Quản lý CLB từ chối tiếp nhận kèm lý do 10-500 ký tự.
   * Lock order: Horse -> HorseAdmissionRecord.
   * Cập nhật atomic Horse.status = REJECTED, Admission = REJECTED.
   */
  async rejectAdmission(admissionId: string, dto: RejectAdmissionDto, user: CurrentUserPayload) {
    assertRejectionReason(dto.rejectionReason);
    const reason = dto.rejectionReason.trim();

    const updated = await this.prisma.$transaction(async (tx) => {
      const pre = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        select: { id: true, horseId: true },
      });
      if (!pre) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${pre.horseId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "HorseAdmissionRecord" WHERE "id" = ${pre.id} FOR UPDATE`;

      const record = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        include: { horse: true, owner: { select: USER_SAFE_SELECT } },
      });
      if (!record) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      assertValidRejectTransition(record.status);

      assertStatusTransition({
        role: user.role,
        from: record.horse.status,
        to: HorseStatus.REJECTED,
        isMedicalLocked: record.horse.isMedicalLocked,
        reason,
        isAdmissionProcess: true,
      });

      await tx.horse.update({
        where: { id: record.horseId },
        data: { status: HorseStatus.REJECTED },
      });

      const rejectedRecord = await tx.horseAdmissionRecord.update({
        where: { id: admissionId },
        data: {
          status: AdmissionStatus.REJECTED,
          approvedBy: { connect: { id: user.userId } },
          rejectionReason: reason,
        },
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              breed: true,
              gender: true,
              dob: true,
              color: true,
              microchip: true,
              avatarUrl: true,
              status: true,
            },
          },
          owner: { select: USER_SAFE_SELECT },
          approvedBy: { select: USER_SAFE_SELECT },
        },
      });

      await tx.admissionHistoryLog.create({
        data: {
          admissionId,
          fromStatus: record.status,
          toStatus: AdmissionStatus.REJECTED,
          actorUserId: user.userId,
          actorName: user.fullName || user.email || 'Quản lý CLB',
          note: reason,
        },
      });

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'ADMISSION_REJECTED',
        `Từ chối tiếp nhận chiến mã ${record.horse.name} (${record.horse.horseCode}). Lý do: ${reason}`,
        admissionId,
        {
          entityName: 'HorseAdmissionRecord',
          oldValues: { status: record.status, horseStatus: record.horse.status },
          newValues: {
            status: AdmissionStatus.REJECTED,
            horseStatus: HorseStatus.REJECTED,
            rejectionReason: reason,
          },
        },
        tx,
      );

      return {
        ...rejectedRecord,
        horse: rejectedRecord.horse || { ...(record as any).horse, status: HorseStatus.REJECTED },
        owner: rejectedRecord.owner || (record as any).owner,
      };
    });

    // Gửi Email 3 thông báo từ chối sau transaction
    await this.safeSendMail({
      eventCode: 'HORSE_ADMISSION_REJECTED',
      recipients: [
        {
          userId: updated.ownerId,
          body: {
            ...admissionRejected(updated, updated.horse, updated.owner),
            refId: updated.id,
            milestone: `rejected-${Date.now()}`,
          },
        },
      ],
    });

    return updated;
  }

  /**
   * 7. POST /horses/admissions/:id/cancel: Hủy hồ sơ tiếp nhận.
   * Lock order: Horse -> HorseAdmissionRecord.
   * Chủ ngựa hủy đơn của mình (chưa thẩm định); Quản lý CLB hủy khi lịch hẹn đã quá hạn từ 3 ngày trở lên.
   */
  async cancelAdmission(admissionId: string, dto: CancelAdmissionDto, user: CurrentUserPayload) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const pre = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        select: { id: true, horseId: true },
      });
      if (!pre) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${pre.horseId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "HorseAdmissionRecord" WHERE "id" = ${pre.id} FOR UPDATE`;

      const record = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              breed: true,
              gender: true,
              dob: true,
              color: true,
              microchip: true,
              avatarUrl: true,
              status: true,
            },
          },
          owner: { select: USER_SAFE_SELECT },
        },
      });

      if (!record) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      assertValidCancelTransition(record, user, effectiveNow());

      const reason =
        (dto.reason != null ? dto.reason.trim() : null) ||
        (user.role === UserRole.CLUB_MANAGER
          ? 'Quá hạn 3 ngày không mang ngựa đến tiếp nhận'
          : 'Chủ ngựa rút hồ sơ đăng ký');

      const res = await tx.horseAdmissionRecord.update({
        where: { id: admissionId },
        data: { status: AdmissionStatus.CANCELLED },
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              breed: true,
              gender: true,
              dob: true,
              color: true,
              microchip: true,
              avatarUrl: true,
              status: true,
            },
          },
          owner: { select: USER_SAFE_SELECT },
        },
      });

      await tx.admissionHistoryLog.create({
        data: {
          admissionId,
          fromStatus: record.status,
          toStatus: AdmissionStatus.CANCELLED,
          actorUserId: user.userId,
          actorName: user.fullName || user.email || user.role,
          note: reason,
        },
      });

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'ADMISSION_CANCELLED',
        `Hủy hồ sơ tiếp nhận ${record.admissionCode}. Lý do: ${reason}`,
        admissionId,
        {
          entityName: 'HorseAdmissionRecord',
          oldValues: { status: record.status },
          newValues: { status: AdmissionStatus.CANCELLED, reason },
        },
        tx,
      );

      return res;
    });

    await this.notifications.notifyUsers(
      [updated.managerUserId, updated.veterinarianUserId, updated.ownerId],
      {
        type: 'ADMISSION_APPOINTMENT_CANCELLED',
        category: 'SYSTEM',
        title: 'Lịch tiếp nhận đã hủy',
        message: `Hồ sơ ${updated.admissionCode} đã hủy. Lịch thẩm định liên quan không còn hiệu lực.`,
        link: '/horses',
        dedupeKey: `admission-cancelled:${updated.id}`,
      },
    );
    return updated;
  }

  /**
   * 8. PATCH /horses/admissions/:id/submission: Chủ ngựa cập nhật ghi chú mong muốn / bổ sung ảnh giấy tờ
   * khi hồ sơ vẫn ở trạng thái PENDING_VERIFICATION (chưa xếp lịch hẹn).
   */
  async updateOwnerSubmission(
    admissionId: string,
    dto: UpdateOwnerAdmissionSubmissionDto,
    user: CurrentUserPayload,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const pre = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        select: { id: true, horseId: true },
      });
      if (!pre) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${pre.horseId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "HorseAdmissionRecord" WHERE "id" = ${pre.id} FOR UPDATE`;

      const record = await tx.horseAdmissionRecord.findUnique({
        where: { id: admissionId },
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              breed: true,
              gender: true,
              dob: true,
              color: true,
              weightKg: true,
              microchip: true,
              avatarUrl: true,
              status: true,
            },
          },
          owner: { select: USER_SAFE_SELECT },
        },
      });

      if (!record) {
        throw apiError(
          HttpStatus.NOT_FOUND,
          'ADMISSION_NOT_FOUND',
          'Không tìm thấy hồ sơ tiếp nhận.',
        );
      }

      if (record.ownerId !== user.userId) {
        throw apiError(
          HttpStatus.FORBIDDEN,
          'NOT_ADMISSION_OWNER',
          'Bạn chỉ được cập nhật hồ sơ đăng ký của chính mình.',
        );
      }

      if (record.status !== AdmissionStatus.PENDING_VERIFICATION) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'ADMISSION_SUBMISSION_LOCKED',
          'Hồ sơ đã có lịch hẹn hoặc đang xử lý, không thể sửa tờ khai đã nộp.',
        );
      }

      const data: Prisma.HorseAdmissionRecordUpdateInput = {};
      if (dto.ownerNotes !== undefined) {
        data.ownerNotes = dto.ownerNotes.trim() || null;
      }
      if (dto.documentPhotos !== undefined || dto.documentsUrl !== undefined) {
        const normalizedDocs = this.normalizeAdmissionSubmissionDocs({
          documentsUrl: dto.documentsUrl,
          documentPhotos: dto.documentPhotos,
        });
        data.documentsUrl = normalizedDocs.documentsUrl;
        data.documentPhotos = normalizedDocs.documentPhotos
          ? (normalizedDocs.documentPhotos as Prisma.InputJsonValue)
          : Prisma.DbNull;
      }

      const res = await tx.horseAdmissionRecord.update({
        where: { id: admissionId },
        data,
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              breed: true,
              gender: true,
              dob: true,
              color: true,
              weightKg: true,
              microchip: true,
              avatarUrl: true,
              status: true,
            },
          },
          owner: { select: USER_SAFE_SELECT },
          manager: { select: USER_SAFE_SELECT },
          veterinarian: { select: USER_SAFE_SELECT },
          approvedBy: { select: USER_SAFE_SELECT },
          history: { orderBy: { createdAt: 'asc' } },
        },
      });

      await tx.admissionHistoryLog.create({
        data: {
          admissionId,
          fromStatus: record.status,
          toStatus: record.status,
          actorUserId: user.userId,
          actorName: user.fullName || user.email || 'Chủ ngựa',
          note: 'Chủ ngựa cập nhật ghi chú mong muốn / bổ sung ảnh giấy tờ pháp lý',
        },
      });

      await this.auditService.record(
        { id: user.userId, name: user.fullName || user.email },
        'ADMISSION_SUBMISSION_UPDATED',
        `Chủ ngựa bổ sung tờ khai hồ sơ ${record.admissionCode}`,
        admissionId,
        {
          entityName: 'HorseAdmissionRecord',
          newValues: {
            hasOwnerNotes: Boolean(res.ownerNotes),
            documentPhotoCount: Array.isArray(res.documentPhotos) ? res.documentPhotos.length : 0,
          },
        },
        tx,
      );

      return res;
    });

    return this.sanitizeAdmissionForRole(updated, user);
  }

  // =========================================================================
  // HANDOVER & TRAINER ASSIGNMENT (BR-BARN-SOVEREIGNTY, SLA-HANDOVER-48H)
  // =========================================================================

  /**
   * Quản lý phân công HLV phụ trách chiến mã (bắt buộc cùng Barn, kiểm tra trần 8 con).
   * Tạo yêu cầu bàn giao kèm Token SLA 48 giờ và gửi email cho HLV.
   */
  async assignTrainer(horseId: string, dto: AssignHorseTrainerDto, manager: CurrentUserPayload) {
    const horse = await this.prisma.horse.findUnique({
      where: { id: horseId, deletedAt: null },
      include: {
        stallAllocations: {
          where: { isActive: true },
          take: 1,
          include: {
            stall: {
              include: { zoneRef: true },
            },
          },
        },
      },
    });

    if (!horse) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Chiến mã không tồn tại.');
    }
    if (horse.status === HorseStatus.RETIRED) {
      throw apiError(HttpStatus.BAD_REQUEST, 'HORSE_RETIRED', 'Ngựa đã ngừng quản lý.');
    }

    const activeAllocation = horse.stallAllocations[0];
    if (!activeAllocation || !activeAllocation.stall) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'HORSE_NOT_IN_STALL',
        'Chiến mã chưa được xếp ô chuồng. Vui lòng xếp ô chuồng thuộc Khu chuồng (Barn) trước khi phân công HLV.',
      );
    }

    const horseBarnId = activeAllocation.stall.zoneId;

    const trainer = await this.prisma.user.findUnique({
      where: { id: dto.trainerUserId },
      include: { assignedBarn: true },
    });

    if (!trainer || trainer.status !== UserStatus.ACTIVE || trainer.role !== Role.HEAD_TRAINER) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_TRAINER',
        'Huấn luyện viên không hợp lệ hoặc đang không hoạt động.',
      );
    }

    if (!trainer.assignedBarnId) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TRAINER_NO_BARN',
        `Huấn luyện viên ${trainer.fullName} chưa được phân công phụ trách Khu chuồng (Barn) nào.`,
      );
    }

    if (horseBarnId && trainer.assignedBarnId !== horseBarnId) {
      const barnName = activeAllocation.stall.zoneRef?.name || activeAllocation.stall.zone;
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'BARN_MISMATCH',
        `Chiến mã đang ở ${barnName}. HLV ${trainer.fullName} phụ trách ${trainer.assignedBarn?.name || 'khu chuồng khác'}. HLV chỉ được nhận chiến mã trong cùng Khu chuồng.`,
      );
    }

    // Kiểm tra định mức tối đa 8 chiến mã của HLV
    const currentAssignedCount = await this.prisma.horse.count({
      where: {
        assignedTrainerId: trainer.id,
        trainerAssignmentStatus: {
          in: [TrainerAssignmentStatus.ASSIGNED, TrainerAssignmentStatus.PENDING_ACCEPTANCE],
        },
        deletedAt: null,
        id: { not: horse.id },
      },
    });

    if (currentAssignedCount >= MAX_HORSES_PER_TRAINER) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TRAINER_CAPACITY_EXCEEDED',
        `Huấn luyện viên ${trainer.fullName} đã đạt định mức tối đa ${MAX_HORSES_PER_TRAINER} chiến mã đồng thời.`,
      );
    }

    // Chốt chặn WIP Limit: HLV không được tồn quá 2 chiến mã chưa kích hoạt giáo án
    const pendingPlanCount = await this.prisma.horse.count({
      where: {
        assignedTrainerId: trainer.id,
        trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
        trainingPlans: { none: { status: PlanStatus.ACTIVE } },
        deletedAt: null,
        id: { not: horse.id },
      },
    });

    if (pendingPlanCount >= 2) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'TRAINER_WIP_LIMIT_EXCEEDED',
        `Huấn luyện viên ${trainer.fullName} đang tồn ${pendingPlanCount} chiến mã chưa kích hoạt giáo án. Vui lòng hoàn tất giáo án hiện có trước khi phân công thêm.`,
      );
    }

    // Hủy các yêu cầu PENDING cũ của ngựa này nếu có
    await this.prisma.horseHandoverRequest.updateMany({
      where: { horseId: horse.id, status: HandoverStatus.PENDING },
      data: { status: HandoverStatus.CANCELLED },
    });

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 3600 * 1000); // 48 giờ SLA

    const handover = await this.prisma.$transaction(async (tx) => {
      const req = await tx.horseHandoverRequest.create({
        data: {
          horseId: horse.id,
          fromManagerId: manager.userId,
          toTrainerId: trainer.id,
          status: HandoverStatus.PENDING,
          token,
          notes: dto.notes?.trim() || null,
          expiresAt,
        },
      });

      await tx.horse.update({
        where: { id: horse.id },
        data: {
          assignedTrainerId: trainer.id,
          trainerAssignmentStatus: TrainerAssignmentStatus.PENDING_ACCEPTANCE,
          trainerAssignedAt: new Date(),
          trainerResponseDeadline: expiresAt,
          trainerRespondedAt: null,
          trainerDeclineReason: null,
        },
      });

      await this.auditService.record(
        { id: manager.userId, name: manager.fullName || manager.email },
        'HORSE_TRAINER_ASSIGNED',
        `Quản lý phân công chiến mã ${horse.name} (${horse.horseCode}) cho HLV ${trainer.fullName}. Hạn phản hồi: 48 giờ`,
        horse.id,
        {
          entityName: 'Horse',
          newValues: {
            assignedTrainerId: trainer.id,
            trainerAssignmentStatus: TrainerAssignmentStatus.PENDING_ACCEPTANCE,
            expiresAt,
          },
        },
        tx,
      );

      return req;
    });

    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    const confirmLink = `${appUrl}/handovers/${token}`;

    await this.safeSendMail({
      eventCode: 'HORSE_HANDOVER_ASSIGNED',
      recipients: [
        {
          userId: trainer.id,
          body: {
            subject: `[TMEC] Thông báo phân công chiến mã: ${horse.name} (${horse.horseCode})`,
            text: `Kính gửi HLV ${trainer.fullName},\n\nQuản lý đã phân công chiến mã ${horse.name} (${horse.horseCode}) tại ô chuồng ${activeAllocation.stall.code} cho bạn phụ trách.\n\nVui lòng truy cập đường dẫn sau để xác nhận tiếp nhận trong vòng 48 giờ:\n${confirmLink}\n\nTrân trọng,\nTMEC System`,
            html: `<p>Kính gửi HLV <strong>${trainer.fullName}</strong>,</p><p>Quản lý đã phân công chiến mã <strong>${horse.name}</strong> (${horse.horseCode}) tại ô chuồng <strong>${activeAllocation.stall.code}</strong> cho bạn phụ trách.</p><p>Thời hạn tiếp nhận: <strong>48 giờ</strong> (trước ${expiresAt.toLocaleString('vi-VN')}).</p><p><a href="${confirmLink}" style="display:inline-block;padding:10px 20px;background:#16a34a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">TIẾP NHẬN CHIẾN MÃ</a></p><p>Trân trọng,<br>TMEC Equine System</p>`,
            refId: handover.id,
            milestone: 'handover-assigned',
          },
        },
      ],
    });

    return {
      success: true,
      handoverId: handover.id,
      token,
      expiresAt,
      message: `Đã phân công chiến mã ${horse.name} cho HLV ${trainer.fullName} và gửi email xác nhận.`,
    };
  }

  /**
   * HLV xác nhận tiếp nhận hoặc từ chối chiến mã qua Token (SLA 48h).
   * Khi Tiếp nhận: tính hạn lập giáo án theo SLA Lũy tiến (3 ngày + (N-1)*2 ngày).
   */
  async respondHandover(dto: RespondHandoverDto, currentUser?: CurrentUserPayload) {
    const req = await this.prisma.horseHandoverRequest.findUnique({
      where: { token: dto.token },
      include: {
        horse: true,
        toTrainer: true,
        fromManager: true,
      },
    });

    if (!req) {
      throw apiError(
        HttpStatus.NOT_FOUND,
        'HANDOVER_NOT_FOUND',
        'Yêu cầu phân công không tồn tại.',
      );
    }

    if (req.status !== HandoverStatus.PENDING) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'HANDOVER_ALREADY_PROCESSED',
        `Yêu cầu phân công này đã được xử lý (trạng thái: ${req.status}).`,
      );
    }

    if (
      currentUser &&
      currentUser.role === UserRole.HEAD_TRAINER &&
      currentUser.userId !== req.toTrainerId
    ) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không phải là Huấn luyện viên được phân công chiến mã này.',
      );
    }

    if (req.expiresAt < new Date()) {
      await this.prisma.$transaction(async (tx) => {
        await tx.horseHandoverRequest.update({
          where: { id: req.id },
          data: { status: HandoverStatus.EXPIRED },
        });
        await tx.horse.update({
          where: { id: req.horseId },
          data: {
            assignedTrainerId: null,
            trainerAssignmentStatus: TrainerAssignmentStatus.DECLINED,
            trainerDeclineReason: 'Hết hạn phản hồi 48h',
            trainerRespondedAt: new Date(),
          },
        });
      });
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'HANDOVER_EXPIRED',
        'Yêu cầu phân công đã hết hạn phản hồi (48 giờ).',
      );
    }

    if (dto.action === HandoverAction.ACCEPT) {
      // Chuẩn hóa SLA: Hạn cố định 3 ngày (72 giờ) sau khi tiếp nhận để lập giáo án
      const days = 3;
      const planDeadlineAt = new Date(Date.now() + days * 24 * 3600 * 1000);

      await this.prisma.$transaction(async (tx) => {
        await tx.horseHandoverRequest.update({
          where: { id: req.id },
          data: {
            status: HandoverStatus.ACCEPTED,
            acceptedAt: new Date(),
            planDeadlineAt,
          },
        });

        await tx.horse.update({
          where: { id: req.horseId },
          data: {
            assignedTrainerId: req.toTrainerId,
            trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
            trainerRespondedAt: new Date(),
            trainerDeclineReason: null,
          },
        });

        // Kế thừa giáo án & buổi tập (nếu chiến mã đã có giáo án từ HLV tiền nhiệm)
        if (tx.trainingPlan) {
          const activeOrDraftPlans = await tx.trainingPlan.findMany({
            where: {
              horseId: req.horseId,
              status: { in: [PlanStatus.DRAFT, PlanStatus.ACTIVE] },
            },
            select: { id: true, status: true },
          });

          if (activeOrDraftPlans.length > 0) {
            const planIds = activeOrDraftPlans.map((p) => p.id);
            await tx.trainingPlan.updateMany({
              where: { id: { in: planIds } },
              data: { trainerUserId: req.toTrainerId },
            });

            // Các buổi tập từ ngày mai trở đi do HLV mới tiếp quản (buổi tập hôm nay HLV cũ hoàn thành nốt ca)
            if (tx.workoutSession) {
              const startOfTomorrow = new Date();
              startOfTomorrow.setHours(24, 0, 0, 0);
              await tx.workoutSession.updateMany({
                where: {
                  trainingPlanId: { in: planIds },
                  scheduledDate: { gte: startOfTomorrow },
                  status: WorkoutStatus.SCHEDULED,
                },
                data: { assignedStaffUserId: req.toTrainerId },
              });
            }
          }
        }

        await this.auditService.record(
          { id: req.toTrainerId, name: req.toTrainer.fullName },
          'HORSE_HANDOVER_ACCEPTED',
          `HLV ${req.toTrainer.fullName} đã tiếp nhận chiến mã ${req.horse.name}. Hạn lập giáo án: ${days} ngày`,
          req.horseId,
          {
            entityName: 'HorseHandoverRequest',
            newValues: { status: HandoverStatus.ACCEPTED, days, planDeadlineAt },
          },
          tx,
        );
      });

      return {
        success: true,
        action: HandoverAction.ACCEPT,
        message: `Đã tiếp nhận chiến mã ${req.horse.name}. Hạn lập giáo án hoàn thành: ${days} ngày.`,
        days,
        planDeadlineAt,
      };
    } else {
      const declineReason = dto.declineReason?.trim() || 'HLV từ chối tiếp nhận chiến mã';

      await this.prisma.$transaction(async (tx) => {
        await tx.horseHandoverRequest.update({
          where: { id: req.id },
          data: {
            status: HandoverStatus.REJECTED,
            notes: declineReason,
          },
        });

        await tx.horse.update({
          where: { id: req.horseId },
          data: {
            assignedTrainerId: null,
            trainerAssignmentStatus: TrainerAssignmentStatus.DECLINED,
            trainerDeclineReason: declineReason,
            trainerRespondedAt: new Date(),
          },
        });

        await this.auditService.record(
          { id: req.toTrainerId, name: req.toTrainer.fullName },
          'HORSE_HANDOVER_REJECTED',
          `HLV ${req.toTrainer.fullName} từ chối tiếp nhận chiến mã ${req.horse.name}. Lý do: ${declineReason}`,
          req.horseId,
          {
            entityName: 'HorseHandoverRequest',
            newValues: { status: HandoverStatus.REJECTED, declineReason },
          },
          tx,
        );
      });

      // Thông báo cho Quản lý
      await this.safeSendMail({
        eventCode: 'HORSE_HANDOVER_REJECTED',
        recipients: [
          {
            userId: req.fromManagerId,
            body: {
              subject: `[TMEC Cảnh báo] HLV từ chối tiếp nhận chiến mã: ${req.horse.name}`,
              text: `HLV ${req.toTrainer.fullName} đã từ chối tiếp nhận chiến mã ${req.horse.name} (${req.horse.horseCode}).\nLý do: ${declineReason}\nVui lòng truy cập hệ thống để phân công lại.`,
              refId: req.id,
              milestone: 'handover-rejected',
            },
          },
        ],
      });

      return {
        success: true,
        action: HandoverAction.REJECT,
        message: `Đã từ chối tiếp nhận chiến mã ${req.horse.name}.`,
      };
    }
  }

  /**
   * Lấy danh sách yêu cầu phân công đang chờ HLV phản hồi (PENDING, < 48h).
   */
  async getPendingHandovers(user: CurrentUserPayload) {
    return this.prisma.horseHandoverRequest.findMany({
      where: {
        toTrainerId: user.userId,
        status: HandoverStatus.PENDING,
      },
      include: {
        horse: {
          select: {
            id: true,
            name: true,
            horseCode: true,
            avatarUrl: true,
            breed: true,
            gender: true,
            color: true,
            stallAllocations: {
              where: { isActive: true },
              take: 1,
              include: { stall: true },
            },
            trainingPlans: {
              where: { status: { in: [PlanStatus.ACTIVE, PlanStatus.DRAFT] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                planCode: true,
                phaseName: true,
                objective: true,
                targetDistance: true,
                status: true,
                workoutSessions: {
                  where: { scheduledDate: { gte: new Date() } },
                  orderBy: { scheduledDate: 'asc' },
                  take: 5,
                  select: {
                    id: true,
                    scheduledDate: true,
                    workoutType: true,
                    distanceMeters: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
        fromManager: {
          select: { id: true, fullName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Lấy danh sách chiến mã HLV đã tiếp nhận (ASSIGNED) nhưng chưa có giáo án Đang áp dụng (ACTIVE).
   */
  async getMyWaitingHorses(user: CurrentUserPayload) {
    return this.prisma.horse.findMany({
      where: {
        assignedTrainerId: user.userId,
        trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
        deletedAt: null,
        trainingPlans: { none: { status: PlanStatus.ACTIVE } },
      },
      include: {
        handoverRequests: {
          where: { status: HandoverStatus.ACCEPTED },
          orderBy: { acceptedAt: 'desc' },
          take: 1,
        },
        trainingPlans: {
          where: { status: PlanStatus.DRAFT },
          take: 1,
        },
        stallAllocations: {
          where: { isActive: true },
          take: 1,
          include: { stall: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }
}

/**
 * Ngựa HLV được xem: ngựa có giáo án Nháp/Đang áp dụng của HLV HOẶC được gán trực tiếp.
 * withUnclaimed: thêm ngựa chưa có HLV nào phụ trách (chỉ dùng khi chọn ngựa cho giáo án mới).
 */
export function trainerHorseScope(
  trainerUserId: string,
  withUnclaimed = false,
): Prisma.HorseWhereInput {
  const live = { in: [PlanStatus.DRAFT, PlanStatus.ACTIVE] };
  const mine: Prisma.HorseWhereInput = {
    OR: [
      { assignedTrainerId: trainerUserId },
      { trainingPlans: { some: { trainerUserId, status: live } } },
    ],
  };
  return withUnclaimed ? { OR: [mine, { trainingPlans: { none: { status: live } } }] } : mine;
}
