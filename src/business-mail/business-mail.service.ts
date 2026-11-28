import { effectiveNow } from '../common/utils/demo-clock';
import { STALL_HANDOVER_PREFIX } from '../daily-tasks/daily-schedule';
import { Injectable, Logger } from '@nestjs/common';
import { BusinessMailing, MailingStatus, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

export interface BusinessMailBody {
  subject: string;
  text: string;
  html?: string;
  /** Mốc nhắc (due-3d, task-overdue…) — cùng sự kiện + người nhận + mốc chỉ gửi 1 lần. */
  milestone?: string;
  /**
   * Tham chiếu đối tượng (id hóa đơn, id task…) để 1 người nhận có thể nhận
   * nhiều mail cùng sự kiện + mốc cho TỪNG đối tượng riêng (VD: 2 hóa đơn quá
   * hạn cùng chu kỳ). Không có → tham gia dedupeKey bằng '-' (mốc duy nhất).
   */
  refId?: string;
}

export interface BusinessMailEvent {
  eventCode: string;
  recipients: Array<{ userId: string; body: BusinessMailBody }>;
}

/** Kết quả emit cho 1 người nhận (bản ghi BusinessMailing đã tạo hoặc tồn tại). */
export interface EmittedMailing {
  id: string;
  eventCode: string;
  userId: string;
  toEmail: string;
  dedupeKey: string;
  status: MailingStatus;
  accepted: boolean;
}

/**
 * Gửi mail nghiệp vụ (nhắc nợ, cảnh báo, chứng từ) — SAU khi ghi DB thành công.
 * - Mỗi người nhận được gửi RIÊNG (không CC) và ghi 1 bản BusinessMailing (chống trùng theo mốc).
 * - Lỗi gửi KHÔNG throw: ghi log, status=FAILED để retryFailed() chạy lại (≤ 3 lần).
 */
@Injectable()
export class BusinessMailService {
  private readonly logger = new Logger(BusinessMailService.name);
  private readonly maxAttempts = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async emit(event: BusinessMailEvent): Promise<EmittedMailing[]> {
    if (!event.recipients?.length) return [];
    const emitted: EmittedMailing[] = [];

    // Lấy email + trạng thái người nhận (bỏ người dùng không có email hoặc không ACTIVE).
    const userIds = [...new Set(event.recipients.map((r) => r.userId).filter(Boolean))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, status: true },
    });
    const emailOf = new Map(users.map((u) => [u.id, u]));

    for (const recipient of event.recipients) {
      const user = emailOf.get(recipient.userId);
      if (!user || !user.email || user.status !== UserStatus.ACTIVE) continue;

      const milestone = recipient.body.milestone ?? null;
      const dedupeKey = this.dedupeKey(
        event.eventCode,
        milestone,
        recipient.userId,
        recipient.body.refId,
      );

      // Chống trùng: đã gửi sự kiện + mốc này cho người nhận thì bỏ qua.
      const existing = await this.prisma.businessMailing.findUnique({
        where: { dedupeKey },
        select: { id: true, status: true, accepted: true, toEmail: true },
      });
      if (existing) {
        emitted.push({
          id: existing.id,
          eventCode: event.eventCode,
          userId: recipient.userId,
          toEmail: existing.toEmail,
          dedupeKey,
          status: existing.status,
          accepted: existing.accepted,
        });
        continue;
      }

      if (
        !(await this.isCurrent(
          event.eventCode,
          recipient.body.refId,
          recipient.body.milestone,
          recipient.userId,
        ))
      )
        continue;
      let record: BusinessMailing;
      try {
        record = await this.prisma.businessMailing.create({
          data: {
            eventCode: event.eventCode,
            milestone,
            refId: recipient.body.refId,
            userId: recipient.userId,
            toEmail: user.email,
            subject: recipient.body.subject,
            bodyText: recipient.body.text,
            bodyHtml: recipient.body.html,
            dedupeKey,
            status: MailingStatus.PENDING,
            accepted: false,
            attempts: 1,
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') continue;
        throw error;
      }
      record = await this.deliver(record);

      emitted.push({
        id: record.id,
        eventCode: record.eventCode,
        userId: record.userId,
        toEmail: record.toEmail,
        dedupeKey,
        status: record.status,
        accepted: record.accepted,
      });
    }

    return emitted;
  }

  /** Chạy lại các mail FAILED chưa đến ngưỡng; tăng attempts. Không tạo thêm giao dịch/task. */
  async retryFailed(): Promise<number> {
    const failed = await this.prisma.businessMailing.findMany({
      where: {
        status: MailingStatus.FAILED,
        attempts: { lt: this.maxAttempts },
      },
    });
    let retried = 0;
    for (const m of failed) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { id: m.userId },
          select: { email: true, status: true },
        });
        if (
          !user ||
          user.status !== UserStatus.ACTIVE ||
          user.email !== m.toEmail ||
          !(await this.isCurrent(
            m.eventCode,
            m.refId ?? undefined,
            m.milestone ?? undefined,
            m.userId,
          ))
        ) {
          await this.prisma.businessMailing.updateMany({
            where: { id: m.id, status: MailingStatus.FAILED },
            data: {
              attempts: this.maxAttempts,
              lastError: 'Cancelled retry: source or recipient changed',
            },
          });
          continue;
        }
        const claim = await this.prisma.businessMailing.updateMany({
          where: { id: m.id, status: MailingStatus.FAILED, attempts: m.attempts },
          data: { status: MailingStatus.PENDING, attempts: { increment: 1 } },
        });
        if (!claim.count) continue;
        if ((await this.deliver(m)).accepted) retried++;
      } catch (error) {
        this.logger.warn('Mail retry failed: ' + (error as Error).message);
      }
    }
    return retried;
  }

  private async deliver(record: BusinessMailing): Promise<BusinessMailing> {
    let accepted = false;
    let lastError: string | null = null;
    try {
      accepted = await this.mail.sendBusiness(
        record.toEmail,
        record.subject,
        record.bodyText,
        record.bodyHtml ?? undefined,
      );
      if (!accepted) lastError = 'Provider did not accept the message';
    } catch (error) {
      lastError = (error as Error).message;
    }
    return this.prisma.businessMailing.update({
      where: { id: record.id },
      data: { status: accepted ? MailingStatus.SENT : MailingStatus.FAILED, accepted, lastError },
    });
  }

  /** Revalidate reminder sources before both first delivery and retry. */
  private async isCurrent(
    eventCode: string,
    refId: string | undefined,
    milestone: string | undefined,
    userId: string,
  ): Promise<boolean> {
    const invoiceEvents = [
      'DUE_SOON',
      'OVERDUE_3D',
      'OVERDUE_7D',
      'INVOICE_OVERDUE',
      'MANUAL_REMIND',
    ];
    const taskEvents = [
      'TASK_ASSIGNED',
      'TASK_DUE_SOON',
      'TASK_OVERDUE',
      'TASK_UNASSIGNED_OVERDUE',
      'REPEAT_OVERDUE',
    ];
    if (
      ['COMPLAINT_FILED', 'COMPLAINT_RECEIVED', 'REVIEW_REQUESTED', 'VIOLATION_CONFIRMED'].includes(
        eventCode,
      )
    ) {
      if (!refId) return false;
      const [complaint, recipient] = await Promise.all([
        this.prisma.complaint.findUnique({ where: { id: refId } }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { role: true, status: true },
        }),
      ]);
      if (!complaint || !recipient || recipient.status !== UserStatus.ACTIVE) return false;
      if (eventCode === 'COMPLAINT_RECEIVED') return complaint.reporterId === userId;
      if (eventCode === 'REVIEW_REQUESTED')
        return complaint.status === 'UNDER_REVIEW' && complaint.subjectUserId === userId;
      if (eventCode === 'VIOLATION_CONFIRMED')
        return (
          complaint.status === 'VIOLATION_CONFIRMED' &&
          (complaint.subjectUserId === userId || recipient.role === Role.CLUB_MANAGER)
        );
      return (
        [Role.CLUB_MANAGER, Role.VETERINARIAN].includes(
          recipient.role as 'CLUB_MANAGER' | 'VETERINARIAN',
        ) &&
        complaint.reporterId !== userId &&
        complaint.subjectUserId !== userId
      );
    }
    if (eventCode === 'FOLLOW_UP_DUE') {
      if (!refId) return false;
      const record = await this.prisma.medicalRecord.findUnique({
        where: { id: refId },
        include: { horse: true },
      });
      return (
        !!record &&
        record.status === 'OPEN' &&
        !record.horse.deletedAt &&
        !!record.followUpDate &&
        new Date(record.followUpDate.getTime() + 7 * 3600000).toISOString().slice(0, 10) ===
          milestone
      );
    }
    if (eventCode === 'LOCK_CHANGED') {
      if (!refId) return false;
      const lock = await this.prisma.medicalLock.findUnique({ where: { id: refId } });
      if (!lock) return false;
      if (milestone === 'released') return !lock.isLocked;
      return (
        lock.isLocked &&
        (milestone === 'placed' ||
          milestone === 'extended:' + lock.recheckDate?.toISOString().slice(0, 10))
      );
    }
    if (['STALL_HANDOVER_DONE', 'TASK_REJECTED'].includes(eventCode)) {
      if (!refId) return false;
      const task = await this.prisma.dailyCareTask.findUnique({ where: { id: refId } });
      return !!task && (eventCode === 'STALL_HANDOVER_DONE' ? task.isCompleted : !task.isCompleted);
    }
    if (!invoiceEvents.includes(eventCode) && !taskEvents.includes(eventCode)) return true;
    if (!refId) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) return false;
    if (invoiceEvents.includes(eventCode)) {
      const invoice = await this.prisma.financialInvoice.findUnique({ where: { id: refId } });
      if (
        !invoice ||
        !['SENT', 'OVERDUE'].includes(invoice.status) ||
        Number(invoice.netAmount) <= 0
      )
        return false;
      if (
        invoice.ownerId !== userId &&
        !(user.role === Role.CLUB_MANAGER && eventCode === 'OVERDUE_7D')
      )
        return false;
      if (eventCode === 'MANUAL_REMIND') return true;
      if (!invoice.dueAt) return false;
      const day = (date: Date) => Math.floor((date.getTime() + 7 * 3600000) / 86400000);
      const days = day(invoice.dueAt) - day(effectiveNow());
      if (eventCode === 'INVOICE_OVERDUE') return invoice.dueAt < effectiveNow();
      if (milestone === 'due-3d') return days > 0 && days <= 3;
      if (milestone === 'due-day') return days <= 0 && days > -3;
      if (milestone === 'overdue-3d') return days <= -3 && days > -7;
      return milestone === 'overdue-7d' && days <= -7;
    }
    const task = await this.prisma.dailyCareTask.findUnique({
      where: { id: refId },
      include: {
        horse: {
          include: {
            stallAllocations: { where: { isActive: true }, take: 1, include: { stall: true } },
          },
        },
      },
    });
    if (!task || task.isCompleted || task.horse.deletedAt || task.horse.status === 'RETIRED')
      return false;
    const date = task.date.toISOString().slice(0, 10);
    const today = new Date(effectiveNow().getTime() + 7 * 3600000).toISOString().slice(0, 10);
    if (eventCode === 'TASK_DUE_SOON') {
      const due = new Date(date + 'T' + task.scheduledTime + ':00+07:00').getTime();
      if (
        date !== today ||
        !Number.isFinite(due) ||
        due < effectiveNow().getTime() ||
        due > effectiveNow().getTime() + 3 * 3600000
      )
        return false;
    } else if (eventCode !== 'TASK_ASSIGNED' && date >= today) return false;
    const stall = task.horse.stallAllocations[0]?.stall;
    const roster =
      task.assignedGroomUserId &&
      task.shiftId &&
      task.stallZoneId &&
      (task.taskCode?.startsWith(STALL_HANDOVER_PREFIX) ||
        (stall?.zoneId === task.stallZoneId && (!task.stallId || stall.id === task.stallId)))
        ? await this.prisma.shiftRoster.findFirst({
            where: {
              date: task.date,
              zoneId: task.stallZoneId,
              shiftId: task.shiftId,
              groomUserId: task.assignedGroomUserId,
              shift: { isActive: true },
              groom: { status: UserStatus.ACTIVE, role: Role.GROOM },
            },
            select: { id: true },
          })
        : null;
    if (eventCode === 'TASK_UNASSIGNED_OVERDUE')
      return (
        !roster &&
        (user.role === Role.CLUB_MANAGER ||
          (user.role === Role.VETERINARIAN &&
            ['MEDICATION', 'ICE_BOOT_REST', 'PHYSICAL_THERAPY'].includes(task.taskType)))
      );
    if (user.role === Role.GROOM) return !!roster && task.assignedGroomUserId === userId;
    if (['TASK_ASSIGNED', 'TASK_DUE_SOON'].includes(eventCode)) return false;
    return (
      user.role === Role.CLUB_MANAGER ||
      (user.role === Role.VETERINARIAN &&
        ['MEDICATION', 'ICE_BOOT_REST', 'PHYSICAL_THERAPY'].includes(task.taskType))
    );
  }

  private dedupeKey(
    eventCode: string,
    milestone: string | null,
    userId: string,
    refId?: string,
  ): string {
    const legacyKey = `${eventCode}:${milestone ?? 'once'}:${userId}`;
    return refId ? `${legacyKey}:${refId}` : legacyKey;
  }
}
