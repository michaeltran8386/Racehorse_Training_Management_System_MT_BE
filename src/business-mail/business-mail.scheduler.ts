import { effectiveNow, isDemoClockActive } from '../common/utils/demo-clock';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DailyTaskType,
  HandoverStatus,
  HorseStatus,
  InvoiceStatus,
  PlanStatus,
  Prisma,
  Role,
  TrainerAssignmentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessMailService } from './business-mail.service';
import { dueDay, dueSoon, overdue3, overdue7 } from './templates/billing-templates';
import { repeatOverdue, taskDueSoon, taskOverdue } from './templates/violation-templates';
import { STALL_HANDOVER_PREFIX } from '../daily-tasks/daily-schedule';

const DAY = 86400000;
const clubDay = (date: Date) => Math.floor((date.getTime() + 7 * 3600000) / DAY);
const activeHorse = { deletedAt: null, status: { not: HorseStatus.RETIRED } };
const taskInclude = {
  assignedGroom: true,
  horse: {
    include: {
      stallAllocations: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        include: { stall: true },
      },
    },
  },
} satisfies Prisma.DailyCareTaskInclude;
type ReminderTask = Prisma.DailyCareTaskGetPayload<{ include: typeof taskInclude }>;

@Injectable()
export class BusinessMailScheduler {
  private readonly logger = new Logger(BusinessMailScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: BusinessMailService,
  ) {}

  @Cron('0 7 * * *', { name: 'business-mail.reminders', timeZone: 'Asia/Ho_Chi_Minh' })
  async remind(fromDemoClock = false): Promise<void> {
    if (isDemoClockActive() && !fromDemoClock) return;
    // Separate sweeps: a failed invoice query must not suppress care alerts or delivery retries.
    for (const work of [
      () => this.invoices(),
      () => this.tasks(),
      () => this.handovers(),
      () => this.mail.retryFailed(),
    ]) {
      await this.safely(work);
    }
  }

  private async safely(work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn(`Reminder failed: ${(error as Error).message}`);
    }
  }

  private staff(role: Role) {
    return this.prisma.user.findMany({
      where: { role, status: 'ACTIVE' },
      select: { id: true, fullName: true },
    });
  }

  private async invoices(): Promise<void> {
    const candidates = await this.prisma.financialInvoice.findMany({
      where: {
        status: { in: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE] },
        netAmount: { gt: 0 },
        dueAt: { not: null },
      },
      select: { id: true },
    });
    for (const candidate of candidates)
      await this.safely(async () => {
        const invoice = await this.prisma.financialInvoice.findUnique({
          where: { id: candidate.id },
          include: { horse: true, owner: true },
        });
        if (
          !invoice ||
          !invoice.dueAt ||
          Number(invoice.netAmount) <= 0 ||
          !([InvoiceStatus.SENT, InvoiceStatus.OVERDUE] as InvoiceStatus[]).includes(invoice.status)
        )
          return;
        const days = clubDay(invoice.dueAt) - clubDay(effectiveNow());
        const milestone =
          days >= 1 && days <= 3
            ? 'due-3d'
            : days <= 0 && days > -3
              ? 'due-day'
              : days <= -3 && days > -7
                ? 'overdue-3d'
                : days <= -7
                  ? 'overdue-7d'
                  : null;
        if (!milestone) return;
        const inv = {
          ...invoice,
          boardingFee: Number(invoice.boardingFee),
          medicalFee: Number(invoice.medicalFee),
          trainingFee: Number(invoice.trainingFee),
          prizeCredit: Number(invoice.prizeCredit),
          netAmount: Number(invoice.netAmount),
        };
        const reminders =
          milestone === 'overdue-7d'
            ? await this.prisma.businessMailing.findMany({
                where: {
                  refId: invoice.id,
                  userId: invoice.ownerId,
                  status: 'SENT',
                  accepted: true,
                  eventCode: { in: ['DUE_SOON', 'OVERDUE_3D', 'OVERDUE_7D', 'INVOICE_OVERDUE'] },
                },
                select: { milestone: true },
                distinct: ['milestone'],
              })
            : [];
        const content =
          milestone === 'due-3d'
            ? dueSoon(inv, invoice.horse, invoice.owner)
            : milestone === 'due-day'
              ? dueDay(inv, invoice.horse, invoice.owner)
              : milestone === 'overdue-3d'
                ? overdue3(inv, invoice.owner)
                : overdue7(inv, invoice.owner, reminders.length);
        const recipients = [invoice.ownerId];
        if (milestone === 'overdue-7d')
          recipients.push(...(await this.staff(Role.CLUB_MANAGER)).map((user) => user.id));
        await this.mail.emit({
          eventCode: milestone.startsWith('due-')
            ? 'DUE_SOON'
            : milestone === 'overdue-3d'
              ? 'OVERDUE_3D'
              : 'OVERDUE_7D',
          recipients: [...new Set(recipients)].map((userId) => ({
            userId,
            body: { ...content, refId: invoice.id, milestone },
          })),
        });
      });
  }

  /** A stored worker ID is insufficient after a move or roster reassignment. */
  private async assignee(task: ReminderTask) {
    const groom = task.assignedGroom;
    const stall = task.horse.stallAllocations[0]?.stall;
    if (
      !groom ||
      groom.status !== 'ACTIVE' ||
      groom.role !== Role.GROOM ||
      !task.stallZoneId ||
      !task.shiftId ||
      (!task.taskCode?.startsWith(STALL_HANDOVER_PREFIX) &&
        (!stall ||
          stall.zoneId !== task.stallZoneId ||
          (task.stallId && stall.id !== task.stallId)))
    )
      return null;
    const roster = await this.prisma.shiftRoster.findFirst({
      where: {
        date: task.date,
        zoneId: task.stallZoneId,
        shiftId: task.shiftId,
        groomUserId: groom.id,
        shift: { isActive: true },
      },
      select: { id: true },
    });
    return roster ? groom : null;
  }

  private async tasks(): Promise<void> {
    const now = effectiveNow();
    // SQL DATE values encode the local calendar date at UTC midnight.
    const today = new Date(
      `${new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10)}T00:00:00Z`,
    );
    const candidates = await this.prisma.dailyCareTask.findMany({
      where: { isCompleted: false, date: { lte: today }, horse: activeHorse },
      select: { id: true },
    });
    for (const candidate of candidates)
      await this.safely(async () => {
        const task = await this.prisma.dailyCareTask.findUnique({
          where: { id: candidate.id },
          include: taskInclude,
        });
        if (
          !task ||
          task.isCompleted ||
          task.horse.deletedAt ||
          task.horse.status === HorseStatus.RETIRED
        )
          return;
        const date = task.date.toISOString().slice(0, 10);
        const overdue = task.date.getTime() < today.getTime();
        const dueAt = /^([01]\d|2[0-3]):[0-5]\d$/.test(task.scheduledTime ?? '')
          ? new Date(`${date}T${task.scheduledTime}:00+07:00`).getTime()
          : NaN;
        if (
          !overdue &&
          (task.date.getTime() !== today.getTime() ||
            !(dueAt >= now.getTime() && dueAt <= now.getTime() + 3 * 3600000))
        )
          return;
        const groom = await this.assignee(task);
        if (!overdue && !groom) return;
        const managers = overdue && !groom ? await this.staff(Role.CLUB_MANAGER) : [];
        const recipients = groom ? [groom.id] : managers.map((user) => user.id);
        if (
          overdue &&
          (
            [
              DailyTaskType.MEDICATION,
              DailyTaskType.ICE_BOOT_REST,
              DailyTaskType.PHYSICAL_THERAPY,
            ] as DailyTaskType[]
          ).includes(task.taskType)
        ) {
          recipients.push(...(await this.staff(Role.VETERINARIAN)).map((user) => user.id));
        }
        const view = {
          ...task,
          date,
          taskCode: task.taskCode ?? task.id,
          scheduledTime: task.scheduledTime ?? undefined,
        };
        const content = overdue
          ? taskOverdue(
              view,
              groom ? { name: groom.fullName } : null,
              'Đối chiếu phân công và ca trực hiện tại; xem lịch sử trong công việc.',
            )
          : taskDueSoon(view, { name: groom!.fullName });
        await this.mail.emit({
          eventCode: overdue
            ? groom
              ? 'TASK_OVERDUE'
              : 'TASK_UNASSIGNED_OVERDUE'
            : 'TASK_DUE_SOON',
          recipients: [...new Set(recipients)].map((userId) => ({
            userId,
            body: {
              ...content,
              milestone: overdue ? 'task-overdue' : 'due-soon',
              refId: task.id,
            },
          })),
        });
        if (overdue && groom) await this.repeat(task, groom);
      });
  }

  private async repeat(
    task: ReminderTask,
    groom: NonNullable<ReminderTask['assignedGroom']>,
  ): Promise<void> {
    const records = await this.prisma.businessMailing.findMany({
      where: { eventCode: 'TASK_OVERDUE', userId: groom.id, status: 'SENT', accepted: true },
      select: { refId: true },
    });
    // A task may have several recipients and provider attempts; neither is another missed task.
    const ids = new Set(records.flatMap((record) => (record.refId ? [record.refId] : [])));
    ids.add(task.id);
    if (ids.size < 2) return;
    const managers = await this.staff(Role.CLUB_MANAGER);
    const content = repeatOverdue({ name: groom.fullName }, ids.size, {
      name: managers.map((manager) => manager.fullName).join(', ') || 'Quản lý CLB',
    });
    await this.mail.emit({
      eventCode: 'REPEAT_OVERDUE',
      recipients: [groom.id, ...managers.map((manager) => manager.id)].map((userId) => ({
        userId,
        body: { ...content, milestone: 'repeat-overdue', refId: task.id },
      })),
    });
  }

  /**
   * Quét SLA 48h cho yêu cầu phân công chiến mã & SLA Lũy tiến cho lập giáo án
   */
  async handovers(): Promise<void> {
    const now = effectiveNow();

    // 1. Quét yêu cầu phân công quá hạn 48h chưa phản hồi
    const expiredHandovers = await this.prisma.horseHandoverRequest.findMany({
      where: {
        status: HandoverStatus.PENDING,
        expiresAt: { lt: now },
      },
      include: {
        horse: true,
        toTrainer: true,
        fromManager: true,
      },
    });

    for (const req of expiredHandovers) {
      await this.safely(async () => {
        await this.prisma.$transaction(async (tx) => {
          await tx.horseHandoverRequest.update({
            where: { id: req.id },
            data: { status: HandoverStatus.EXPIRED },
          });
          await tx.horse.update({
            where: { id: req.horseId },
            data: {
              trainerAssignmentStatus: TrainerAssignmentStatus.DECLINED,
              trainerDeclineReason: 'Hết hạn phản hồi 48h (Hệ thống tự động hủy)',
              trainerRespondedAt: now,
            },
          });
        });

        // Báo cáo Quản lý
        await this.mail.emit({
          eventCode: 'HORSE_HANDOVER_EXPIRED',
          recipients: [
            {
              userId: req.fromManagerId,
              body: {
                subject: `[TMEC Cảnh báo] Quá hạn 48h: HLV chưa tiếp nhận chiến mã ${req.horse.name}`,
                text: `Yêu cầu phân công chiến mã ${req.horse.name} (${req.horse.horseCode}) cho HLV ${req.toTrainer.fullName} đã hết hạn 48 giờ mà chưa được xác nhận.\nHệ thống đã tự động hủy yêu cầu. Vui lòng phân công lại.`,
                milestone: 'handover-expired',
                refId: req.id,
              },
            },
          ],
        });
      });
    }

    // 2. Quét chiến mã đã tiếp nhận (ACCEPTED) nhưng quá hạn SLA Lũy tiến (planDeadlineAt) mà chưa có giáo án ACTIVE
    const overduePlans = await this.prisma.horseHandoverRequest.findMany({
      where: {
        status: HandoverStatus.ACCEPTED,
        planDeadlineAt: { lt: now },
        horse: {
          trainingPlans: { none: { status: PlanStatus.ACTIVE } },
          deletedAt: null,
        },
      },
      include: {
        horse: true,
        toTrainer: true,
        fromManager: true,
      },
    });

    for (const req of overduePlans) {
      await this.safely(async () => {
        // Cảnh báo HLV và Quản lý
        const recipients = [req.toTrainerId, req.fromManagerId];
        await this.mail.emit({
          eventCode: 'PLAN_SLA_OVERDUE',
          recipients: recipients.map((userId) => ({
            userId,
            body: {
              subject: `[TMEC Cảnh báo KPI] Quá hạn lập giáo án cho chiến mã ${req.horse.name}`,
              text: `Chiến mã ${req.horse.name} (${req.horse.horseCode}) đã được tiếp nhận ngày ${req.acceptedAt?.toLocaleDateString('vi-VN')} nhưng quá hạn hoàn thành giáo án (${req.planDeadlineAt?.toLocaleDateString('vi-VN')}) mà chưa kích hoạt giáo án.\nVui lòng hoàn tất và kích hoạt giáo án ngay.`,
              milestone: 'plan-overdue',
              refId: req.id,
            },
          })),
        });
      });
    }
  }
}
