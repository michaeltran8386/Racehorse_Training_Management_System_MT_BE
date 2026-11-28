import { effectiveNow } from '../common/utils/demo-clock';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Complaint, ComplaintStatus, Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { BusinessMailEvent, BusinessMailService } from '../business-mail/business-mail.service';
import { linkBase, renderMail } from '../business-mail/templates/html';
import {
  ConfirmViolationDto,
  CreateComplaintDto,
  DismissComplaintDto,
  QueryComplaintsDto,
  ReviewComplaintDto,
} from './dto/complaint.dto';

const HANDLERS: string[] = [Role.CLUB_MANAGER, Role.VETERINARIAN];
const REPORTERS: string[] = [Role.GROOM, Role.HEAD_TRAINER, Role.VETERINARIAN];
const STAFF = [Role.CLUB_MANAGER, Role.VETERINARIAN, Role.GROOM, Role.HEAD_TRAINER];
const INCLUDE = { subject: { select: { id: true, fullName: true, role: true } } } as const;
type ComplaintRow = Complaint & { subject: { id: string; fullName: string; role: Role } };

@Injectable()
export class ComplaintsService {
  private readonly logger = new Logger(ComplaintsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: BusinessMailService,
  ) {}

  private independent(user: CurrentUserPayload, row: Complaint) {
    return (
      HANDLERS.includes(user.role) &&
      user.userId !== row.reporterId &&
      user.userId !== row.subjectUserId
    );
  }

  private view(row: ComplaintRow, user: CurrentUserPayload) {
    if (row.reporterId === user.userId || this.independent(user, row)) return row;
    // Subject receives only the handler-approved summary, never the original report/evidence.
    return {
      id: row.id,
      code: row.code,
      subjectUserId: row.subjectUserId,
      subject: row.subject,
      reason: row.reviewNote,
      status: row.status,
      reviewNote: row.reviewNote,
      responseDueAt: row.responseDueAt,
      conclusion: row.conclusion,
      regulation: row.regulation,
      measures: row.measures,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async subjects(user: CurrentUserPayload) {
    if (!REPORTERS.includes(user.role)) throw new ForbiddenException();
    return this.prisma.user.findMany({
      where: { id: { not: user.userId }, role: { in: STAFF }, status: UserStatus.ACTIVE },
      select: { id: true, fullName: true, role: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
      take: 500,
    });
  }

  async list(query: QueryComplaintsDto, user: CurrentUserPayload) {
    if (![...REPORTERS, Role.CLUB_MANAGER].includes(user.role)) throw new ForbiddenException();
    if (query.reporterRole && !HANDLERS.includes(user.role))
      throw new ForbiddenException(
        'Reporter-role filtering is limited to independent case handlers.',
      );
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const scopes: Prisma.ComplaintWhereInput[] = [
      { reporterId: user.userId },
      { subjectUserId: user.userId, status: { not: ComplaintStatus.OPEN } },
    ];
    if (HANDLERS.includes(user.role))
      scopes.push({ reporterId: { not: user.userId }, subjectUserId: { not: user.userId } });
    const where: Prisma.ComplaintWhereInput = {
      OR: query.reporterRole
        ? [{ reporterId: { not: user.userId }, subjectUserId: { not: user.userId } }]
        : scopes,
      ...(query.reporterRole && { reporter: { role: query.reporterRole } }),
      ...(query.targetRole && { subject: { role: query.targetRole } }),
      ...(query.status && { status: query.status }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.complaint.count({ where }),
    ]);
    return { items: rows.map((row) => this.view(row, user)), total, page, pageSize };
  }

  async create(dto: CreateComplaintDto, user: CurrentUserPayload) {
    if (!REPORTERS.includes(user.role)) throw new ForbiddenException();
    if (user.userId === dto.subjectUserId) throw new BadRequestException('Cannot report yourself');
    const subject = await this.prisma.user.findFirst({
      where: { id: dto.subjectUserId, role: { in: STAFF }, status: UserStatus.ACTIVE },
      select: { id: true },
    });
    if (!subject) throw new BadRequestException('Subject must be an active staff member');
    const row = await this.prisma.$transaction(async (tx) => {
      const dateStr = effectiveNow().toISOString().slice(0, 10).replaceAll('-', '');
      const countToday = await tx.complaint.count({
        where: { code: { startsWith: `CMP-${dateStr}-` } },
      });
      let seq = countToday + 1;
      const existingToday = await tx.complaint.findMany({
        where: { code: { startsWith: `CMP-${dateStr}-` } },
        select: { code: true },
      });
      const existingCodes = new Set(existingToday.map((c) => c.code));
      while (existingCodes.has(`CMP-${dateStr}-${String(seq).padStart(3, '0')}`)) {
        seq++;
      }
      const code = `CMP-${dateStr}-${String(seq).padStart(3, '0')}`;

      const created = await tx.complaint.create({
        data: {
          code,
          subjectUserId: dto.subjectUserId,
          reporterId: user.userId,
          reason: dto.reason,
          evidenceJson: dto.evidenceUrls ?? [],
        },
        include: INCLUDE,
      });
      await this.audit.record(
        { id: user.userId, name: user.fullName },
        'COMPLAINT_FILED',
        'Internal complaint filed',
        created.id,
        { entityName: 'Complaint', newValues: { status: created.status } },
        tx,
      );
      return created;
    });
    await this.notify(async () => {
      const handlers = await this.prisma.user.findMany({
        where: {
          role: { in: [Role.CLUB_MANAGER, Role.VETERINARIAN] },
          status: UserStatus.ACTIVE,
          id: { notIn: [row.reporterId, row.subjectUserId] },
        },
        select: { id: true },
      });
      // Filter again to keep test doubles and recipient construction privacy-safe.
      const recipients = handlers.filter(
        (handler) => ![row.reporterId, row.subjectUserId].includes(handler.id),
      );
      await this.emit(
        'COMPLAINT_FILED',
        row,
        recipients.map((handler) => handler.id),
        'Tiếp nhận phản ánh nội bộ',
        row.reason,
      );
    });
    await this.notify(() =>
      this.emit(
        'COMPLAINT_RECEIVED',
        row,
        [row.reporterId],
        'Đã tiếp nhận phản ánh',
        'Phản ánh đã được tiếp nhận để xem xét; chưa phải kết luận vi phạm.',
      ),
    );
    return this.view(row, user);
  }

  review(id: string, dto: ReviewComplaintDto, user: CurrentUserPayload) {
    if (dto.responseDueAt && new Date(dto.responseDueAt) <= effectiveNow())
      throw new BadRequestException('Response deadline must be in the future');
    return this.transition(
      id,
      ComplaintStatus.OPEN,
      ComplaintStatus.UNDER_REVIEW,
      {
        reviewNote: dto.reviewNote,
        responseDueAt: dto.responseDueAt ? new Date(dto.responseDueAt) : null,
      },
      user,
    );
  }

  confirm(id: string, dto: ConfirmViolationDto, user: CurrentUserPayload) {
    return this.transition(
      id,
      ComplaintStatus.UNDER_REVIEW,
      ComplaintStatus.VIOLATION_CONFIRMED,
      { conclusion: dto.conclusion, regulation: dto.regulation, measures: dto.measures },
      user,
    );
  }

  dismiss(id: string, dto: DismissComplaintDto, user: CurrentUserPayload) {
    return this.transition(
      id,
      [ComplaintStatus.OPEN, ComplaintStatus.UNDER_REVIEW],
      ComplaintStatus.DISMISSED,
      { conclusion: dto.conclusion },
      user,
    );
  }

  private async transition(
    id: string,
    from: ComplaintStatus | ComplaintStatus[],
    to: ComplaintStatus,
    data: Partial<
      Pick<Complaint, 'reviewNote' | 'responseDueAt' | 'conclusion' | 'regulation' | 'measures'>
    >,
    user: CurrentUserPayload,
  ) {
    if (!HANDLERS.includes(user.role)) throw new ForbiddenException();
    const allowed = Array.isArray(from) ? from : [from];
    const row = await this.prisma.$transaction(async (tx) => {
      const before = await tx.complaint.findUnique({ where: { id }, include: INCLUDE });
      if (!before) throw new NotFoundException('Complaint not found');
      if (!this.independent(user, before))
        throw new ForbiddenException('Involved staff cannot handle this complaint');
      if (!allowed.includes(before.status))
        throw new ConflictException('Complaint cannot transition from its current status');
      const reviewedAt = effectiveNow();
      const updated = await tx.complaint.updateMany({
        where: { id, status: before.status },
        data: { ...data, status: to, reviewedById: user.userId, reviewedAt },
      });
      if (updated.count !== 1)
        throw new ConflictException('Complaint was changed by another handler');
      await this.audit.record(
        { id: user.userId, name: user.fullName },
        `COMPLAINT_${to}`,
        `Complaint moved to ${to}`,
        id,
        {
          entityName: 'Complaint',
          oldValues: { status: before.status },
          newValues: { status: to },
        },
        tx,
      );
      // Values used for mail must match the winning transition, not a subsequent handler's write.
      return {
        ...before,
        ...data,
        status: to,
        reviewedById: user.userId,
        reviewedAt,
      };
    });
    if (to === ComplaintStatus.UNDER_REVIEW) {
      await this.notify(() =>
        this.emit(
          'REVIEW_REQUESTED',
          row,
          [row.subjectUserId],
          'Yêu cầu giải trình',
          `${row.reviewNote}\nHạn phản hồi: ${row.responseDueAt?.toISOString() ?? 'Liên hệ người xử lý'}`,
        ),
      );
    } else if (to === ComplaintStatus.VIOLATION_CONFIRMED) {
      await this.notify(async () => {
        const managers = await this.prisma.user.findMany({
          where: { role: Role.CLUB_MANAGER, status: UserStatus.ACTIVE },
          select: { id: true },
        });
        await this.emit(
          'VIOLATION_CONFIRMED',
          row,
          [row.subjectUserId, ...managers.map((manager) => manager.id)],
          'Kết luận vi phạm đã xác nhận',
          `${row.conclusion}\nQuy định: ${row.regulation}\nBiện pháp: ${row.measures}\nNgười xác nhận: ${user.fullName}`,
        );
      });
    }
    return this.view(row, user);
  }

  private emit(
    eventCode: string,
    row: ComplaintRow,
    ids: string[],
    title: string,
    content: string,
  ) {
    const body = renderMail(`${title}: ${row.code}`, [
      { label: 'Mã phản ánh', value: row.code },
      { label: 'Nội dung', value: content },
      { label: 'Xem chi tiết theo quyền truy cập', value: `${linkBase()}/complaints` },
    ]);
    const event: BusinessMailEvent = {
      eventCode,
      recipients: [...new Set(ids)].map((userId) => ({ userId, body: { ...body, refId: row.id } })),
    };
    return this.mail.emit(event);
  }

  private async notify(send: () => Promise<unknown>) {
    try {
      await send();
    } catch {
      this.logger.warn('Complaint mail failed after commit');
    }
  }
}
