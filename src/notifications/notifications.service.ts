import { effectiveNow } from '../common/utils/demo-clock';
import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { BusinessMailBody, BusinessMailService } from '../business-mail/business-mail.service';
import { NotificationCategory, Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { zoneGroomIds } from '../shift-rosters/groom-zones';
import { LIVE_TRAINER_PLAN_STATUSES } from '../training/trainer-zones';
import { apiError } from '../common/exceptions/api-error';
import { defaultNotify, NotifyKey } from '../users/permissions';

export interface NotifyInput {
  type: string; // mã sự kiện, FE dịch theo mã này
  category: NotificationCategory;
  title: string; // bản tiếng Anh dự phòng
  message: string;
  params?: Record<string, string | number>;
  link?: string;
  senderName?: string;
  dedupeKey?: string; // sự kiện chỉ báo 1 lần cho mỗi người nhận
  email?: { eventCode: string; body: BusinessMailBody };
}

// Sự kiện gắn với công tắc thông báo của người dùng (trang Notification settings).
const SETTING_OF: Record<string, NotifyKey> = {
  WORKOUT_ABNORMAL: 'thresholdAlert',
  LOCK_LIFTED: 'lockLifted',
  TOURNAMENT_COMPLETED: 'raceResults',
  RACE_RESULTS_PUBLISHED: 'raceResults',
};

/**
 * Thông báo trong ứng dụng (C-01). Các service khác gọi notify…() SAU khi ghi DB thành công.
 * Gửi thông báo là việc phụ: lỗi chỉ ghi log, không làm hỏng thao tác chính.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly businessMail?: BusinessMailService,
  ) {}

  async notifyUsers(
    userIds: (string | null | undefined)[],
    input: NotifyInput,
    excludeUserId?: string | null,
  ) {
    try {
      const ids = [...new Set(userIds.filter((id): id is string => !!id && id !== excludeUserId))];
      if (ids.length === 0) return true;
      const recipients = await this.prisma.user.findMany({
        where: { id: { in: ids }, status: UserStatus.ACTIVE },
        select: { id: true, role: true, notify: true },
      });
      const settingKey = SETTING_OF[input.type];
      const allowed = recipients.filter((u) => {
        if (!settingKey) return true;
        const stored = (u.notify ?? {}) as Partial<Record<NotifyKey, boolean>>;
        return stored[settingKey] ?? defaultNotify(u.role)[settingKey];
      });
      if (allowed.length === 0) return true;
      await this.prisma.notification.createMany({
        data: allowed.map((u) => ({
          userId: u.id,
          type: input.type,
          category: input.category,
          title: input.title,
          message: input.message,
          params: input.params,
          link: input.link,
          senderName: input.senderName,
          dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${u.id}` : undefined,
        })),
        skipDuplicates: true,
      });
      if (input.email && this.businessMail) {
        try {
          await this.businessMail.emit({
            eventCode: input.email.eventCode,
            recipients: allowed.map((user) => ({ userId: user.id, body: input.email!.body })),
          });
        } catch (err) {
          this.logger.warn(`Could not queue business email: ${(err as Error).message}`);
        }
      }
      return true;
    } catch (err) {
      this.logger.warn(`Could not send notification ${input.type}: ${(err as Error).message}`);
      return false;
    }
  }

  async notifyRoles(roles: Role[], input: NotifyInput, excludeUserId?: string | null) {
    try {
      const users = await this.prisma.user.findMany({
        where: { role: { in: roles }, status: UserStatus.ACTIVE },
        select: { id: true },
      });
      await this.notifyUsers(
        users.map((u) => u.id),
        input,
        excludeUserId,
      );
    } catch (err) {
      this.logger.warn(`Could not send notification ${input.type}: ${(err as Error).message}`);
    }
  }

  /** Người liên quan tới 1 con ngựa: các vai trò được chọn + chủ ngựa + groom đang trực khu của ngựa hôm nay (tùy chọn). */
  async horseAudience(
    horseId: string,
    opts: { roles?: Role[]; owner?: boolean; groom?: boolean; trainer?: boolean },
  ) {
    const horse = await this.prisma.horse.findUnique({
      where: { id: horseId },
      select: {
        ownerId: true,
        stallAllocations: {
          where: { isActive: true },
          select: { stall: { select: { zoneId: true } } },
        },
      },
    });
    const ids: (string | null | undefined)[] = [];
    if (opts.roles?.length) {
      const staff = await this.prisma.user.findMany({
        where: { role: { in: opts.roles }, status: UserStatus.ACTIVE },
        select: { id: true },
      });
      ids.push(...staff.map((u) => u.id));
    }
    if (opts.trainer && horse) {
      const plans = await this.prisma.trainingPlan.findMany({
        where: { horseId, status: { in: LIVE_TRAINER_PLAN_STATUSES } },
        select: { trainerUserId: true },
      });
      ids.push(...plans.map((plan) => plan.trainerUserId));
    }
    if (opts.owner && horse?.ownerId) ids.push(horse.ownerId);
    if (opts.groom && horse?.stallAllocations?.length) {
      ids.push(...(await zoneGroomIds(this.prisma, horse.stallAllocations[0].stall?.zoneId)));
    }
    return ids;
  }

  async notifyHorse(
    horseId: string,
    opts: { roles?: Role[]; owner?: boolean; groom?: boolean; trainer?: boolean },
    input: NotifyInput,
    excludeUserId?: string | null,
  ) {
    try {
      return await this.notifyUsers(await this.horseAudience(horseId, opts), input, excludeUserId);
    } catch (err) {
      this.logger.warn(`Could not send notification ${input.type}: ${(err as Error).message}`);
      return false;
    }
  }

  // ------------------------------------------------------------------ API của người nhận

  async list(userId: string, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 200);
    const [notifications, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { notifications: notifications.map(toPublic), unreadCount };
  }

  async markRead(userId: string, ids: string[]) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION',
        'ids must be a list of notification ids',
      );
    }
    await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids }, readAt: null },
      data: { readAt: effectiveNow() },
    });
    return this.list(userId);
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: effectiveNow() },
    });
    return this.list(userId);
  }

  async clear(userId: string) {
    await this.prisma.notification.deleteMany({ where: { userId } });
    return { notifications: [], unreadCount: 0 };
  }
}

// Hình dạng FE đọc (khớp AppNotification ở FE src/shared/lib/notifications.ts).
function toPublic(n: Prisma.NotificationGetPayload<object>) {
  return {
    id: n.id,
    type: n.type,
    category: n.category,
    title: n.title,
    message: n.message,
    params: n.params ?? undefined,
    link: n.link ?? undefined,
    senderName: n.senderName ?? undefined,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
  };
}
