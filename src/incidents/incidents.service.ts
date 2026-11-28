import { effectiveNow } from '../common/utils/demo-clock';
import { MedicalLifecycleService } from '../medical/medical-lifecycle.service';
import { assertIncidentTransition, assertMergeCandidate } from './incident-lifecycle';
import { clubDate } from '../training/training-rules';
import { incidentReported, incidentConfirmed } from '../business-mail/templates/health-templates';
import { incidentDescription, incidentNotificationText } from './incident-evidence';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { IncidentStatus, Role, SeverityLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateIncidentDto,
  QueryIncidentsDto,
  ReviewIncidentDto,
  ResolveIncidentDto,
} from './dto/incident.dto';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async notifyHorseSafe(...args: Parameters<NotificationsService['notifyHorse']>) {
    try {
      return await this.notifications.notifyHorse(...args);
    } catch (error) {
      this.logger.warn(`Incident committed, notification failed: ${String(error)}`);
      return false;
    }
  }

  async duplicateCandidates(id: string, actor: CurrentUserPayload) {
    if (actor.role !== Role.VETERINARIAN) throw new ForbiddenException();
    const parent = await this.prisma.incidentReport.findUnique({ where: { id } });
    if (!parent) throw new NotFoundException('INCIDENT_NOT_FOUND');
    const now = effectiveNow();
    return this.prisma.incidentReport.findMany({
      where: {
        id: { not: id },
        horseId: parent.horseId,
        status: { in: ['REPORTED', 'UNDER_REVIEW'] },
        parentIncidentId: null,
        createdAt: { gte: new Date(now.getTime() - 48 * 3600000), lte: now },
      },
      select: {
        id: true,
        incidentNumber: true,
        horseId: true,
        severity: true,
        status: true,
        description: true,
        createdAt: true,
        medicalRecordId: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
    });
  }

  async resolve(id: string, dto: ResolveIncidentDto, actor: CurrentUserPayload) {
    if (actor.role !== Role.VETERINARIAN) throw new ForbiddenException();
    if (
      !dto.recoveryConfirmed ||
      dto.duplicateIncidentIds.length > 100 ||
      new Set(dto.duplicateIncidentIds).size !== dto.duplicateIncidentIds.length
    )
      throw new BadRequestException('RECOVERY_CONFIRMATION_REQUIRED');
    const initial = await this.prisma.incidentReport.findUnique({
      where: { id },
      include: { horse: { select: { id: true, name: true } } },
    });
    if (!initial) throw new NotFoundException('INCIDENT_NOT_FOUND');
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${initial.horseId} FOR UPDATE`;
      const parent = await tx.incidentReport.findUnique({ where: { id } });
      const record = await tx.medicalRecord.findUnique({ where: { id: dto.medicalRecordId } });
      if (
        !parent ||
        parent.parentIncidentId ||
        !['REPORTED', 'UNDER_REVIEW', 'RESOLVED'].includes(parent.status) ||
        !record ||
        record.horseId !== parent.horseId ||
        record.status !== 'CLOSED' ||
        record.treatmentResult !== 'RECOVERED' ||
        (parent.medicalRecordId && parent.medicalRecordId !== record.id)
      )
        throw new BadRequestException('RECOVERED_RECORD_REQUIRED');
      const children = [] as NonNullable<typeof parent>[];
      const now = effectiveNow();
      for (const childId of dto.duplicateIncidentIds) {
        const child = await tx.incidentReport.findUnique({ where: { id: childId } });
        if (
          !child ||
          child.parentIncidentId ||
          (child.medicalRecordId && child.medicalRecordId !== record.id)
        )
          throw new BadRequestException('INVALID_DUPLICATE_INCIDENT');
        assertMergeCandidate(parent, child, now);
        children.push(child);
      }
      const primary = await tx.incidentReport.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          medicalRecordId: record.id,
          resolvedAt: now,
          reviewedAt: now,
          reviewedById: actor.userId,
        },
      });
      for (const child of children)
        await tx.incidentReport.update({
          where: { id: child.id },
          data: {
            status: 'MERGED_INTO_TREATMENT',
            parentIncidentId: id,
            medicalRecordId: record.id,
            resolvedAt: now,
            reviewedAt: now,
            reviewedById: actor.userId,
            vetNotes: `Được bác sĩ ${actor.fullName} xử lý chung trong đợt ${id}.`,
          },
        });
      await tx.medicalLock.updateMany({
        where: {
          sourceIncidentId: { in: [id, ...children.map((child) => child.id)] },
          isLocked: true,
        },
        data: { medicalRecordId: record.id },
      });
      const state = await new MedicalLifecycleService(this.auditService).releaseRecordLocks(
        tx,
        record.id,
        actor,
        'RESTING',
      );
      await this.auditService.record(
        { id: actor.userId, name: actor.fullName },
        'RESOLVE_INCIDENT_WITH_DUPLICATES',
        `Resolved ${id}; selected ${children.map((child) => child.id).join(',')}`,
        id,
        { entityName: 'IncidentReport' },
        tx,
      );
      return { primary, children, state };
    });
    for (const report of [result.primary, ...result.children]) {
      try {
        await this.notifications.notifyUsers([report.reportedById], {
          type: 'INCIDENT_REVIEWED',
          category: 'MEDICAL',
          title: 'Báo cáo sự cố đã được xử lý',
          message: 'Bác sĩ đã xác nhận hoàn tất điều trị trong bệnh án liên quan.',
          link: '/incidents',
          dedupeKey: `incident-treatment:${report.id}:${dto.medicalRecordId}`,
        });
      } catch (error) {
        this.logger.warn(`Incident committed, reporter delivery failed: ${String(error)}`);
      }
    }
    await this.notifyHorseSafe(
      initial.horseId,
      { roles: [Role.CLUB_MANAGER], owner: true, trainer: true, groom: true },
      {
        type: 'INCIDENT_CONFIRMED',
        category: 'MEDICAL',
        title: 'Đã hoàn tất điều trị sự cố',
        message: result.state.isMedicalLocked
          ? 'Ngựa vẫn còn khóa bảo vệ khác.'
          : 'Xem trạng thái và chỉ định hồi phục trong hồ sơ.',
        link: '/incidents',
        dedupeKey: `incident-resolved:${id}`,
        email: {
          eventCode: 'INCIDENT_CONFIRMED',
          body: {
            ...incidentConfirmed(
              result.primary,
              { id: initial.horseId, name: initial.horse?.name ?? 'Ngựa trong hồ sơ liên quan' },
              { name: actor.fullName },
            ),
            refId: id,
          },
        },
      },
    );
    return { ...result.primary, ...result.state, mergedCount: result.children.length };
  }

  private async persistIncident(
    data: Prisma.IncidentReportUncheckedCreateInput,
    actor: CurrentUserPayload,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Horse" WHERE "id" = ${data.horseId} FOR UPDATE`;
      const current = await tx.horse.findUnique({ where: { id: data.horseId } });
      if (!current || current.deletedAt || current.status === 'RETIRED')
        throw new BadRequestException('HORSE_NOT_ACTIVE');
      if (data.sourceEventId) {
        const prior = await tx.incidentReport.findUnique({
          where: { sourceEventId: data.sourceEventId },
        });
        if (prior) return { incident: prior, isNew: false };
      }
      const dateStr = clubDate(effectiveNow()).replace(/-/g, '');
      const count = await tx.incidentReport.count({
        where: { incidentNumber: { startsWith: `INC-${dateStr}-` } },
      });
      const counter = await tx.counter.upsert({
        where: { name: `incident:${dateStr}` },
        create: { name: `incident:${dateStr}`, value: count + 1 },
        update: { value: { increment: 1 } },
      });
      const incident = await tx.incidentReport.create({
        data: {
          ...data,
          incidentNumber: `INC-${dateStr}-${String(counter.value).padStart(4, '0')}`,
        },
        include: {
          horse: {
            select: { id: true, name: true, horseCode: true, status: true, isMedicalLocked: true },
          },
          stallZone: { select: { id: true, code: true, name: true } },
          reportedBy: { select: { id: true, fullName: true, role: true } },
        },
      });
      const safetyLock = await new MedicalLifecycleService(this.auditService).placeIncidentLock(
        tx,
        incident.id,
        actor,
      );
      if (safetyLock && incident.horse) {
        incident.horse.isMedicalLocked = true;
        incident.horse.status = safetyLock.appliedMedicalStatus;
      }
      await this.auditService.record(
        { id: actor.userId, name: actor.fullName },
        'REPORT_INCIDENT',
        `Report ${incident.incidentNumber}`,
        incident.id,
        { entityName: 'IncidentReport' },
        tx,
      );
      return { incident, isNew: true };
    });
  }

  /**
   * TASK F4-05-BE: Báo cáo sự cố đột xuất hoặc quan sát sức khỏe tại chuồng
   */
  async create(dto: CreateIncidentDto, reporter: CurrentUserPayload) {
    const horse = await this.prisma.horse.findUnique({
      where: { id: dto.horseId },
      include: {
        stallAllocations: {
          where: { isActive: true },
          include: { stall: true },
          take: 1,
        },
      },
    });

    if (!horse || horse.deletedAt) {
      throw new NotFoundException('Không tìm thấy thông tin con ngựa.');
    }

    const allocation = horse.stallAllocations[0];
    const stallZoneId = dto.stallZoneId || allocation?.stall?.zoneId || undefined;

    const symptomsList = dto.symptoms && dto.symptoms.length > 0 ? dto.symptoms : ['OTHER'];

    const { incident, isNew } = await this.persistIncident(
      {
        horseId: horse.id,
        stallZoneId,
        reportedById: reporter.userId,
        severity: dto.severity,
        symptomsJson: symptomsList,
        description: incidentDescription(dto.description, dto.evidencePhotoUrl),
        status: IncidentStatus.REPORTED,
      },
      reporter,
    );
    if (!isNew) return incident;
    const incidentNumber = incident.incidentNumber ?? incident.id;

    // CR-001: Thông báo sự cố theo mức độ nghiêm trọng
    // CRITICAL: 5 nhóm (Vet, Head Trainer, Club Manager, Groom, Owner)
    // MILD / MODERATE: 3 nhóm (Vet, Groom, Owner) - không gửi đại trà cho HT/CM
    const isCritical = dto.severity === SeverityLevel.CRITICAL;
    const isModerate = dto.severity === SeverityLevel.MODERATE;

    const titlePrefix = isCritical
      ? '🚨 [KHẨN CẤP] Sự cố nghiêm trọng:'
      : isModerate
        ? '⚠️ [Cảnh báo] Bất thường sức khỏe:'
        : '📝 Ghi nhận quan sát sức khỏe:';

    const symptomsText = symptomsList.join(', ');

    await this.notifyHorseSafe(
      horse.id,
      { roles: [Role.VETERINARIAN, Role.CLUB_MANAGER], trainer: true, groom: true },
      {
        email: {
          eventCode: 'INCIDENT_REPORTED',
          body: {
            ...incidentReported(incident, horse, { name: reporter.fullName }),
            refId: incident.id,
          },
        },
        type: isCritical ? 'CRITICAL_INCIDENT_REPORTED' : 'HEALTH_ANOMALY_LOGGED',
        category: 'MEDICAL',
        title: `${titlePrefix} ${horse.name} (${horse.horseCode || ''})`,
        message: `Nhân viên chăm sóc ${reporter.fullName} báo cáo: ${symptomsText}. Nội dung: "${incidentNotificationText(dto.description)}"`,
        params: {
          incidentNumber,
          horseId: horse.id,
          horseName: horse.name,
          severity: dto.severity,
        },
        link: '/incidents',
        senderName: reporter.fullName,
      },
    );

    return incident;
  }

  /**
   * Tạo báo cáo sự cố từ gói tin mô phỏng (Simulator).
   * Idempotent dựa trên sourceEventId để tránh trùng lặp bản ghi và thông báo khi retry.
   */
  async createFromSimulator(
    sourceEventId: string | undefined,
    packet: any,
    reporter: CurrentUserPayload,
  ) {
    if (sourceEventId) {
      const existing = await this.prisma.incidentReport.findUnique({
        where: { sourceEventId },
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              status: true,
              isMedicalLocked: true,
            },
          },
          stallZone: { select: { id: true, code: true, name: true } },
          reportedBy: { select: { id: true, fullName: true, role: true } },
        },
      });

      if (existing) {
        return existing;
      }
    }

    const horseId = packet.horse?.horse_id;
    const horse = await this.prisma.horse.findUnique({
      where: { id: horseId },
      include: {
        stallAllocations: {
          where: { isActive: true },
          include: { stall: true },
          take: 1,
        },
      },
    });

    if (!horse || horse.deletedAt) {
      throw new NotFoundException('Không tìm thấy thông tin con ngựa từ gói tin mô phỏng.');
    }

    const allocation = horse.stallAllocations[0];
    const stallZoneId = allocation?.stall?.zoneId || undefined;

    const kind = packet.incident?.kind;
    const severity = kind === 'FRACTURE' ? SeverityLevel.CRITICAL : SeverityLevel.MODERATE;

    const symptomsList =
      kind === 'FRACTURE'
        ? ['FRACTURE', 'HOOF_INJURY']
        : kind === 'LAMENESS'
          ? ['LAMENESS']
          : kind === 'COLIC'
            ? ['COLIC']
            : kind === 'FEVER'
              ? ['FEVER']
              : ['OTHER'];

    const snapshot = packet.snapshot;
    const snapshotText = snapshot
      ? ` [Chỉ số: v=${snapshot.velocity_mps ?? 0}m/s, hr=${snapshot.heart_rate_bpm ?? 0}bpm, temp=${snapshot.body_temp_c ?? 0}°C]`
      : '';
    const description = `[Mô phỏng - ${packet.incident?.location || 'TRACK'}] ${packet.incident?.label || 'Sự cố sân chạy'}.${snapshotText}`;

    const { incident, isNew } = await this.persistIncident(
      {
        sourceEventId: sourceEventId || undefined,

        horseId: horse.id,
        stallZoneId,
        reportedById: reporter.userId,
        severity,
        symptomsJson: symptomsList,
        description,
        status: IncidentStatus.REPORTED,
      },
      reporter,
    );
    if (!isNew) return incident;
    const incidentNumber = incident.incidentNumber ?? incident.id;

    const isCritical = severity === SeverityLevel.CRITICAL;
    const titlePrefix = isCritical
      ? '🚨 [KHẨN CẤP - SIMULATOR] Sự cố nghiêm trọng:'
      : '⚠️ [Cảnh báo - SIMULATOR] Bất thường sức khỏe:';

    await this.notifyHorseSafe(
      horse.id,
      { roles: [Role.VETERINARIAN, Role.CLUB_MANAGER], trainer: true, groom: true },
      {
        email: {
          eventCode: 'INCIDENT_REPORTED',
          body: {
            ...incidentReported(incident, horse, { name: reporter.fullName }),
            refId: incident.id,
          },
        },
        type: isCritical ? 'CRITICAL_INCIDENT_REPORTED' : 'HEALTH_ANOMALY_LOGGED',
        category: 'MEDICAL',
        title: `${titlePrefix} ${horse.name} (${horse.horseCode || ''})`,
        message: `${reporter.fullName} ghi nhận từ Simulator: ${symptomsList.join(', ')}. Mô tả: ${description}`,
        params: {
          incidentNumber,
          horseId: horse.id,
          horseName: horse.name,
          severity,
        },
        link: '/incidents',
        senderName: reporter.fullName,
      },
    );

    return incident;
  }

  /**
   * Lấy danh sách sự cố theo bộ lọc
   */
  async findAll(query: QueryIncidentsDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.horseId) {
      where.horseId = query.horseId;
    }

    if (query.zoneId) {
      where.stallZoneId = query.zoneId;
    }

    if (query.severity) {
      where.severity = query.severity;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(`${query.startDate}T00:00:00.000Z`);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(`${query.endDate}T23:59:59.999Z`);
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.incidentReport.findMany({
        where,
        include: {
          horse: {
            select: {
              id: true,
              name: true,
              horseCode: true,
              avatarUrl: true,
              status: true,
              isMedicalLocked: true,
            },
          },
          stallZone: { select: { id: true, code: true, name: true } },
          reportedBy: { select: { id: true, fullName: true, role: true } },
          reviewedBy: { select: { id: true, fullName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.incidentReport.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Lấy chi tiết một sự cố
   */
  async findOne(id: string) {
    const incident = await this.prisma.incidentReport.findUnique({
      where: { id },
      include: {
        horse: {
          select: {
            id: true,
            name: true,
            horseCode: true,
            avatarUrl: true,
            status: true,
            isMedicalLocked: true,
            stallAllocations: {
              where: { isActive: true },
              include: { stall: true },
            },
          },
        },
        stallZone: { select: { id: true, code: true, name: true } },
        reportedBy: { select: { id: true, fullName: true, role: true } },
        reviewedBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    if (!incident) {
      throw new NotFoundException('Không tìm thấy sự cố báo cáo.');
    }

    return incident;
  }

  /**
   * Bác sĩ thú y đánh giá và cập nhật trạng thái sự cố (CR-001: chỉ Vet mới có quyền xác nhận lâm sàng)
   */
  async review(id: string, dto: ReviewIncidentDto, reviewer: CurrentUserPayload) {
    if (reviewer.role !== Role.VETERINARIAN) {
      throw new ForbiddenException(
        'Chỉ Bác sĩ thú y mới có quyền đánh giá và xử lý báo cáo sự cố lâm sàng.',
      );
    }

    const incident = await this.prisma.incidentReport.findUnique({
      where: { id },
      include: { horse: true, reportedBy: true },
    });

    if (!incident) {
      throw new NotFoundException('Không tìm thấy sự cố.');
    }

    assertIncidentTransition(incident.status, dto.status);
    if (
      incident.status === IncidentStatus.RESOLVED ||
      incident.status === IncidentStatus.DISMISSED
    ) {
      throw new BadRequestException(
        'Báo cáo sự cố đã hoàn thành xử lý hoặc bị bác bỏ, không thể thay đổi trạng thái nữa.',
      );
    }
    if (
      dto.status === IncidentStatus.RESOLVED ||
      dto.status === IncidentStatus.MERGED_INTO_TREATMENT
    ) {
      throw new BadRequestException('Use treatment resolution with a recovered medical record.');
    }
    if (
      dto.status === IncidentStatus.DISMISSED &&
      (await this.prisma.medicalLock.findFirst({ where: { sourceIncidentId: id, isLocked: true } }))
    ) {
      throw new BadRequestException(
        'A safety lock requires veterinary treatment/release before dismissal.',
      );
    }

    const updated = await this.prisma.incidentReport.update({
      where: { id },
      data: {
        status: dto.status,
        vetNotes: dto.vetNotes ? dto.vetNotes.trim() : incident.vetNotes,
        reviewedById: reviewer.userId,
        reviewedAt: effectiveNow(),
      },
      include: {
        horse: true,
        reportedBy: { select: { id: true, fullName: true } },
        reviewedBy: { select: { id: true, fullName: true } },
      },
    });

    // Thông báo phản hồi lại cho Groom đã báo cáo
    if (incident.reportedById) {
      await this.notifications.notifyUsers([incident.reportedById], {
        type: 'INCIDENT_REVIEWED',
        category: 'MEDICAL',
        title: `Báo cáo sự cố ${incident.incidentNumber} đã được cập nhật`,
        message: `Bác sĩ ${reviewer.fullName} đã chuyển trạng thái thành "${dto.status}". Ghi chú: ${dto.vetNotes || 'Không có ghi chú thêm.'}`,
        link: '/incidents',
        senderName: reviewer.fullName,
      });
    }

    await this.auditService.record(
      { id: reviewer.userId, name: reviewer.fullName } as any,
      'REVIEW_INCIDENT',
      `Đánh giá sự cố ${incident.incidentNumber} -> ${dto.status}`,
      incident.id,
      {
        entityName: 'IncidentReport',
        newValues: {
          incidentNumber: incident.incidentNumber,
          newStatus: dto.status,
          vetNotes: dto.vetNotes,
        },
      },
    );

    return updated;
  }
}
