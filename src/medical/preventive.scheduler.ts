import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PreventiveStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DAY_MS, getClubDateBounds } from './preventive-care.service';

// Lịch không gắn danh mục: nhắc trước 7 ngày đồng bộ với cửa sổ "Sắp đến hạn" (hoặc theo advanceNoticeDays của danh mục).
const DEFAULT_NOTICE_DAYS = 7;

/**
 * C-02 / FR-3.15: 06:00 giờ CLB mỗi ngày, nhắc lịch tiêm phòng / tẩy giun / móng sắp đến hạn hoặc quá hạn
 * cho Bác sĩ thú y và groom đang chăm ngựa. Mỗi lịch × mỗi hạn × mỗi người chỉ nhắc 1 lần (dedupeKey).
 */
@Injectable()
export class PreventiveScheduler {
  private readonly logger = new Logger(PreventiveScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 6 * * *', { name: 'preventive-reminders', timeZone: 'Asia/Ho_Chi_Minh' })
  async dailyReminders(now = new Date()): Promise<number> {
    try {
      const { startOfTodayClub, endOfTodayClub, endOf30Days } = getClubDateBounds(now);
      const schedules = await this.prisma.preventiveSchedule.findMany({
        where: {
          status: { not: PreventiveStatus.COMPLETED },
          dueDate: { lte: endOf30Days },
          horse: { deletedAt: null },
        },
        include: {
          horse: { select: { id: true, name: true } },
          typeCatalog: { select: { name: true, advanceNoticeDays: true } },
        },
      });

      let sent = 0;
      for (const s of schedules) {
        const noticeDays = s.typeCatalog?.advanceNoticeDays ?? DEFAULT_NOTICE_DAYS;
        const noticeHorizon = new Date(endOfTodayClub.getTime() + noticeDays * DAY_MS);
        if (s.dueDate > noticeHorizon) continue;
        const overdue = s.dueDate < startOfTodayClub;
        const due = s.dueDate.toISOString().slice(0, 10);
        const task = s.typeCatalog?.name ?? s.scheduleType;
        await this.notifications.notifyHorse(
          s.horseId,
          { roles: [Role.VETERINARIAN], groom: true },
          {
            type: overdue ? 'PREVENTIVE_OVERDUE' : 'PREVENTIVE_DUE',
            category: 'MEDICAL',
            title: overdue ? 'Preventive care overdue' : 'Preventive care due soon',
            message: `${s.horse.name}: ${task} ${overdue ? 'was due' : 'is due'} on ${due}.`,
            params: { horse: s.horse.name, task, date: due },
            link: '/vaccine',
            senderName: 'TMEC',
            // Quá hạn nhắc thêm 1 lần riêng, sau đó không nhắc lại cho tới khi có hạn mới.
            dedupeKey: `${overdue ? 'PREVENTIVE_OVERDUE' : 'PREVENTIVE_DUE'}:${s.id}:${due}`,
          },
        );
        sent += 1;
      }
      return sent;
    } catch (err) {
      this.logger.error(`Preventive reminders failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
