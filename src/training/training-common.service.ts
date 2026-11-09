import { HttpStatus, Injectable } from '@nestjs/common';
import { PlanStatus, Role, WorkoutStatus } from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';
import {
  addDays,
  clubDate,
  clubTime,
  LATE_RESULT_DAYS,
  startOfClubDay,
  workoutLoad,
} from './training-rules';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

type MissedWorkout = {
  id: string;
  scheduledDate: Date;
  horse: { name: string };
  trainingPlan: { id: string; trainer: { id: string; fullName: string } };
};

/** dd/mm theo giờ câu lạc bộ. */
function dayMonth(d: Date): string {
  const [, m, day] = clubDate(d).split('-');
  return `${day}/${m}`;
}

/** dd/mm HH:MM theo giờ câu lạc bộ. */
function dayTime(d: Date): string {
  const { hour, minute } = clubTime(d);
  return `${dayMonth(d)} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Phần dùng chung của Flow 2: kiểm Khóa huấn luyện, dọn quá hạn (BR-2.02), tiến độ và điểm tải. */
@Injectable()
export class TrainingCommonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Checks whether a horse is under an active Medical Lock (RULE-MED-01).
   */
  async checkMedicalLock(
    horseId: string,
  ): Promise<{ isLocked: boolean; reason?: string; lockCode?: string }> {
    const horse = await this.prisma.horse.findUnique({
      where: { id: horseId, deletedAt: null },
      include: {
        medicalLocks: {
          where: { isLocked: true },
          orderBy: { lockedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!horse) {
      throw apiError(HttpStatus.NOT_FOUND, 'HORSE_NOT_FOUND', 'Target horse not found.');
    }

    const activeLock = horse.medicalLocks[0];
    const isLocked = horse.isMedicalLocked || !!activeLock;

    return {
      isLocked,
      reason:
        activeLock?.lockReason ||
        (horse.isMedicalLocked ? 'Active medical hold placed by veterinary staff' : undefined),
      lockCode: activeLock?.lockCode ?? undefined,
    };
  }

  /**
   * Việc "hệ thống tự làm" của Flow 2 (§4.1, §4.2), chạy mỗi lần đọc danh sách:
   * - Buổi Đã lên lịch hết ngày tập (0 giờ hôm sau) mà chưa ghi kết quả -> Bỏ lỡ.
   * - Giáo án Đang áp dụng qua ngày kết thúc 1 ngày -> Hoàn thành; buổi Đã lên lịch / Bị chặn -> Đã hủy.
   *   Buổi Bỏ lỡ giữ nguyên để HT còn ghi bù trong 7 ngày (LATE_RESULT_DAYS).
   * Dự án chưa có bộ lập lịch (cron) nên làm "lười" ở đây; kết quả giống nhau dù chạy bao nhiêu lần.
   */
  async sweepOverdue(now = new Date()): Promise<void> {
    const today = startOfClubDay(now);
    // Buổi của giáo án Nháp chưa phải lịch thật nên không bị tính Bỏ lỡ.
    const missed: MissedWorkout[] = await this.prisma.workoutSession.findMany({
      where: {
        status: WorkoutStatus.SCHEDULED,
        scheduledDate: { lt: today },
        trainingPlan: { status: { not: PlanStatus.DRAFT } },
      },
      select: {
        id: true,
        scheduledDate: true,
        horse: { select: { name: true } },
        trainingPlan: {
          select: { id: true, trainer: { select: { id: true, fullName: true } } },
        },
      },
      orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }],
    });
    if (missed.length > 0) {
      const { count } = await this.prisma.workoutSession.updateMany({
        where: { id: { in: missed.map((w) => w.id) }, status: WorkoutStatus.SCHEDULED },
        data: { status: WorkoutStatus.MISSED },
      });
      if (count > 0) await this.notifyMissed(missed);
    }

    const overdue = await this.prisma.trainingPlan.findMany({
      where: { status: PlanStatus.ACTIVE, endDate: { lt: addDays(today, -1) } },
      select: { id: true },
    });
    for (const plan of overdue) {
      await this.prisma.$transaction([
        this.prisma.trainingPlan.update({
          where: { id: plan.id },
          data: {
            status: PlanStatus.COMPLETED,
            completionSummary: 'Hệ thống tự hoàn thành vì đã quá ngày kết thúc.',
          },
        }),
        this.prisma.workoutSession.updateMany({
          where: {
            trainingPlanId: plan.id,
            status: { in: [WorkoutStatus.SCHEDULED, WorkoutStatus.BLOCKED] },
          },
          data: { status: WorkoutStatus.CANCELLED, statusReason: 'Giáo án đã kết thúc' },
        }),
      ]);
    }
  }

  /**
   * Báo buổi tập vừa chuyển Bỏ lỡ: mỗi HLV phụ trách nhận danh sách buổi của mình (để ghi bù),
   * Quản lý CLB nhận 1 tin tổng hợp theo HLV. dedupeKey theo buổi đầu tiên của nhóm để 2 lần quét
   * chạy song song không gửi trùng.
   */
  private async notifyMissed(rows: MissedWorkout[]): Promise<void> {
    const listOf = (items: MissedWorkout[]) => {
      const shown = items.slice(0, 5).map((w) => `${w.horse.name} ${dayTime(w.scheduledDate)}`);
      return items.length > 5 ? `${shown.join(', ')} (+${items.length - 5})` : shown.join(', ');
    };
    const byTrainer = new Map<string, { name: string; items: MissedWorkout[] }>();
    for (const w of rows) {
      const t = w.trainingPlan.trainer;
      const group = byTrainer.get(t.id) ?? { name: t.fullName, items: [] };
      group.items.push(w);
      byTrainer.set(t.id, group);
    }

    for (const [trainerId, group] of byTrainer) {
      const first = group.items[0];
      const deadline = dayMonth(addDays(startOfClubDay(first.scheduledDate), LATE_RESULT_DAYS));
      const planIds = new Set(group.items.map((w) => w.trainingPlan.id));
      const list = listOf(group.items);
      await this.notifications.notifyUsers([trainerId], {
        type: 'WORKOUT_MISSED',
        category: 'TRAINING',
        title: 'Missed workouts',
        message: `${group.items.length} workout(s) missed: ${list}. Record late results by ${deadline}.`,
        params: { count: group.items.length, list, deadline },
        link:
          planIds.size === 1
            ? `/training/plans/${first.trainingPlan.id}?status=OVERDUE`
            : `/training/calendar?status=MISSED&date=${clubDate(first.scheduledDate)}`,
        senderName: 'EquiFlow',
        dedupeKey: `WORKOUT_MISSED:${first.id}`,
      });
    }

    const summary = [...byTrainer.values()].map((g) => `${g.name}: ${g.items.length}`).join(', ');
    await this.notifications.notifyRoles([Role.CLUB_MANAGER], {
      type: 'WORKOUT_MISSED_SUMMARY',
      category: 'TRAINING',
      title: 'Missed workouts summary',
      message: `${rows.length} workout(s) missed by trainer: ${summary}.`,
      params: { count: rows.length, summary },
      link: `/training/calendar?status=MISSED&date=${clubDate(rows[0].scheduledDate)}`,
      senderName: 'EquiFlow',
      dedupeKey: `WORKOUT_MISSED_SUMMARY:${rows[0].id}`,
    });
  }

  /**
   * Tiến độ = số buổi Hoàn thành / tổng buổi của giáo án (không tính buổi đã hủy). Dùng cho SC-2.01, SC-2.02, SC-2.04.
   * - completed: số buổi đã hoàn thành
   * - total: tổng số buổi của giáo án (không tính CANCELLED)
   * - due: số buổi đã đến hạn (scheduledDate <= now, không tính CANCELLED)
   * - overdue: số buổi đã đến hạn mà chưa ghi kết quả (SCHEDULED | MISSED)
   */
  async progressOf(planIds: string[]) {
    if (!planIds.length) {
      return new Map<string, { completed: number; total: number; due: number; overdue: number }>();
    }
    const now = new Date();
    const [allRows, dueRows] = await Promise.all([
      this.prisma.workoutSession.groupBy({
        by: ['trainingPlanId', 'status'],
        where: {
          trainingPlanId: { in: planIds },
          status: { not: WorkoutStatus.CANCELLED },
        },
        _count: { _all: true },
      }),
      this.prisma.workoutSession.groupBy({
        by: ['trainingPlanId', 'status'],
        where: {
          trainingPlanId: { in: planIds },
          scheduledDate: { lte: now },
          status: { not: WorkoutStatus.CANCELLED },
        },
        _count: { _all: true },
      }),
    ]);

    const result = new Map<
      string,
      { completed: number; total: number; due: number; overdue: number }
    >();

    for (const r of allRows) {
      const cur = result.get(r.trainingPlanId) ?? { completed: 0, total: 0, due: 0, overdue: 0 };
      cur.total += r._count._all;
      if (r.status === WorkoutStatus.COMPLETED) {
        cur.completed += r._count._all;
      }
      result.set(r.trainingPlanId, cur);
    }

    for (const r of dueRows) {
      const cur = result.get(r.trainingPlanId) ?? { completed: 0, total: 0, due: 0, overdue: 0 };
      cur.due += r._count._all;
      if (r.status === WorkoutStatus.SCHEDULED || r.status === WorkoutStatus.MISSED) {
        cur.overdue += r._count._all;
      }
      result.set(r.trainingPlanId, cur);
    }

    return result;
  }

  sumLoad(
    rows: {
      scheduledDate: Date;
      distanceMeters: number;
      actualDistanceMeters: number | null;
      repetitions: number;
      intensity: string | null;
    }[],
    from: Date,
    to: Date,
  ): number {
    const total = rows
      .filter((w) => w.scheduledDate > from && w.scheduledDate <= to)
      .reduce((sum, w) => sum + workoutLoad(w), 0);
    return Math.round(total * 10) / 10;
  }
}
