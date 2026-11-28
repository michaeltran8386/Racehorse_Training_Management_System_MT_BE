import { effectiveNow } from '../common/utils/demo-clock';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationCategory,
  OtpPurpose,
  PlanStatus,
  Prisma,
  Role,
  TrainerAssignmentStatus,
  User,
  UserStatus,
  WorkoutStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import { AuthService, loginAttemptsOf } from '../auth/auth.service';
import { OtpService, otpTimes } from '../auth/otp.service';
import { apiError } from '../common/exceptions/api-error';
import { EMAIL_RE, normEmail, str } from '../common/utils/input';
import { fullNameError } from '../common/utils/name';
import { normalizePermissions, PERMISSIONS, ROLE_LABEL, ROLES } from '../users/permissions';
import { permissionsOf, toPublicUser } from '../users/public-user';
import {
  AssignTrainerBarnDto,
  InviteAccountDto,
  ReasonDto,
  UpdateAccountDto,
} from './dto/accounts.dto';
import { NotificationsService } from '../notifications/notifications.service';
import {
  MAX_HORSES_PER_TRAINER,
  MAX_TRAINERS_PER_BARN,
  MAX_GROOMS_PER_BARN,
} from '../training/training-rules';
import { MAX_CARE_STALLS } from '../stalls/groom-care.rules';

export type AccountAction = 'approve' | 'decline' | 'lock' | 'unlock' | 'deactivate' | 'reactivate';

const REASON_MAX = 300;
const REASON_MIN = 10;
const REASON_REQUIRED: AccountAction[] = ['decline', 'lock', 'deactivate'];

// Chỉ xóa hẳn được tài khoản CHƯA TỪNG hoạt động; tài khoản đã dùng thì vô hiệu hóa để giữ lịch sử.
const DELETABLE: UserStatus[] = [UserStatus.INVITED, UserStatus.PENDING_EMAIL, UserStatus.REJECTED];

/** Quản lý tài khoản — chỉ người có quyền manageAccounts (controller đã chặn). */
@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  list(): Promise<User[]> {
    return this.prisma.user.findMany({
      include: { assignedBarn: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async find(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { assignedBarn: true },
    });
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Account not found');
    return user;
  }

  // ------------------------------------------------------------------ mời nhân viên

  /** Tạo tài khoản INVITED (chưa có mật khẩu) + gửi email kèm mã mời 48 giờ. */
  async invite(actor: AuditActor, dto: InviteAccountDto): Promise<User> {
    const email = normEmail(dto.email);
    const fullName = str(dto.fullName);
    const role = dto.role as Role;
    if (fullNameError(fullName) || !EMAIL_RE.test(email) || !ROLES.includes(role)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'Invalid input');
    }
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw apiError(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'Email taken');
    }

    if (role === Role.HEAD_TRAINER) {
      if (!dto.assignedBarnId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'BARN_REQUIRED',
          'Vui lòng chọn Khu chuồng phụ trách cho Huấn luyện viên trưởng.',
        );
      }
      const barn = await this.prisma.stallZone.findUnique({ where: { id: dto.assignedBarnId } });
      if (!barn) {
        throw apiError(HttpStatus.NOT_FOUND, 'BARN_NOT_FOUND', 'Khu chuồng không tồn tại.');
      }
      const countTrainers = await this.prisma.user.count({
        where: {
          assignedBarnId: dto.assignedBarnId,
          role: Role.HEAD_TRAINER,
          status: { notIn: [UserStatus.LOCKED, UserStatus.REJECTED] },
        },
      });
      if (countTrainers >= MAX_TRAINERS_PER_BARN) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'BARN_TRAINER_CAPACITY_EXCEEDED',
          `Khu chuồng này đã đủ tối đa ${MAX_TRAINERS_PER_BARN} Huấn luyện viên phụ trách.`,
        );
      }
    }

    if (role === Role.GROOM) {
      if (!dto.assignedBarnId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'BARN_REQUIRED',
          'Vui lòng chọn Khu chuồng phụ trách cho nhân viên Groom.',
        );
      }
      const barn = await this.prisma.stallZone.findUnique({ where: { id: dto.assignedBarnId } });
      if (!barn) {
        throw apiError(HttpStatus.NOT_FOUND, 'BARN_NOT_FOUND', 'Khu chuồng không tồn tại.');
      }
      const countGrooms = await this.prisma.user.count({
        where: {
          assignedBarnId: dto.assignedBarnId,
          role: Role.GROOM,
          status: { notIn: [UserStatus.LOCKED, UserStatus.REJECTED] },
        },
      });
      if (countGrooms >= MAX_GROOMS_PER_BARN) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'BARN_GROOM_CAPACITY_EXCEEDED',
          `Khu chuồng này đã đủ tối đa ${MAX_GROOMS_PER_BARN} Groom phụ trách.`,
        );
      }
    }

    const user = await this.prisma.user.create({
      data: {
        fullName,
        email,
        role,
        assignedBarnId:
          role === Role.HEAD_TRAINER || role === Role.GROOM ? dto.assignedBarnId : null,
        status: UserStatus.INVITED,
        invitedBy: actor.name,
      },
      include: { assignedBarn: true },
    });
    await this.otp.issue(email, OtpPurpose.INVITE, true);
    await this.audit.record(
      actor,
      'ACCOUNT_INVITED',
      `${fullName} invited as ${ROLE_LABEL[role]}`,
      user.id,
    );
    return user;
  }

  /** Gửi lại email mời (mã mới, mã cũ hết hiệu lực). */
  async resendInvite(actor: AuditActor, id: string) {
    const target = await this.find(id);
    if (target.status !== UserStatus.INVITED) {
      throw apiError(HttpStatus.CONFLICT, 'INVALID_STATE', 'Not an open invitation');
    }
    await this.otp.assertCooldown(target.email, OtpPurpose.INVITE);
    const record = await this.otp.issue(target.email, OtpPurpose.INVITE, true);
    await this.audit.record(actor, 'INVITE_RESENT', target.fullName, target.id);
    return { account: target, ...otpTimes(record) };
  }

  // ------------------------------------------------------------------ sửa thông tin

  /** Sửa họ tên + số điện thoại. Email (tên đăng nhập) và vai trò không đổi ở đây. */
  async update(actor: AuditActor, id: string, dto: UpdateAccountDto): Promise<User> {
    const fullName = str(dto.fullName);
    const phone = str(dto.phone);
    if (fullNameError(fullName)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', fullNameError(fullName), {
        field: 'fullName',
      });
    }
    if (phone && !/^0[35789]\d{8}$/.test(phone)) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION',
        'Phone number must be a valid 10-digit Vietnamese mobile number.',
        {
          field: 'phone',
        },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const target = await this.lockAccount(tx, id);
      const oldPhone = target.phoneNumber ?? '';
      const changes: string[] = [];
      if (fullName !== target.fullName) changes.push(`name ${target.fullName} → ${fullName}`);
      if (phone !== oldPhone) changes.push(`phone ${oldPhone || '—'} → ${phone || '—'}`);
      if (changes.length === 0) return target;

      const user = await tx.user.update({
        where: { id: target.id },
        data: { fullName, phoneNumber: phone || null },
      });
      await this.audit.record(
        actor,
        'ACCOUNT_EDITED',
        `${target.fullName}: ${changes.join(', ')}`,
        target.id,
        {
          oldValues: { fullName: target.fullName, phoneNumber: target.phoneNumber },
          newValues: { fullName, phoneNumber: phone || null },
        },
        tx,
      );
      return user;
    });
  }

  // ------------------------------------------------------------------ đổi trạng thái

  /** Không tự khóa / vô hiệu hóa / xóa chính mình; CLB luôn còn ít nhất 1 Club Manager hoạt động. */
  private async assertCanRemove(actor: AuditActor, target: User, selfCode: string) {
    if (target.id === actor.id) {
      throw apiError(HttpStatus.CONFLICT, selfCode, 'Not allowed on your own account');
    }
    if (target.role === Role.CLUB_MANAGER && target.status === UserStatus.ACTIVE) {
      const activeManagers = await this.prisma.user.count({
        where: { role: Role.CLUB_MANAGER, status: UserStatus.ACTIVE },
      });
      if (activeManagers <= 1) throw apiError(HttpStatus.CONFLICT, 'LAST_MANAGER', 'Last manager');
    }
  }

  /** approve / decline / lock / unlock / deactivate / reactivate — body có thể kèm { reason }. */
  async changeStatus(
    actor: AuditActor,
    id: string,
    action: AccountAction,
    dto: ReasonDto,
  ): Promise<User> {
    const reason = str(dto.reason);
    if (reason.length > REASON_MAX) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION',
        `Reason must be at most ${REASON_MAX} characters.`,
        { field: 'reason' },
      );
    }
    // Từ chối / khóa / vô hiệu hóa phải có lý do: người bị ảnh hưởng thấy lý do khi đăng nhập, nhật ký có căn cứ.
    if (REASON_REQUIRED.includes(action) && reason.length < REASON_MIN) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION',
        `Reason must be ${REASON_MIN} to ${REASON_MAX} characters.`,
        { field: 'reason' },
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const target = await this.lockAccount(tx, id);
      let data: Prisma.UserUpdateInput;

      switch (action) {
        case 'approve':
        case 'decline':
          if (target.status !== UserStatus.PENDING_APPROVAL) {
            throw apiError(HttpStatus.CONFLICT, 'INVALID_STATE', 'Not waiting for approval');
          }
          data =
            action === 'approve'
              ? { status: UserStatus.ACTIVE, statusReason: null }
              : { status: UserStatus.REJECTED, statusReason: reason || null };
          break;
        case 'lock':
          if (target.status !== UserStatus.ACTIVE) {
            throw apiError(
              HttpStatus.CONFLICT,
              'INVALID_STATE',
              'Only an active account can be locked',
            );
          }
          await this.assertCanRemove(actor, target, 'CANNOT_LOCK_SELF');
          await this.assertNoPendingAssignments(tx, target, dto.confirmedActiveAssignments);
          data = { status: UserStatus.LOCKED, lockedAt: new Date(), statusReason: reason || null };
          break;
        case 'unlock':
          if (target.status !== UserStatus.LOCKED) {
            throw apiError(HttpStatus.CONFLICT, 'INVALID_STATE', 'Not locked');
          }
          data = { status: UserStatus.ACTIVE, lockedAt: null, statusReason: null };
          break;
        case 'deactivate':
          if (target.status !== UserStatus.ACTIVE && target.status !== UserStatus.LOCKED) {
            throw apiError(
              HttpStatus.CONFLICT,
              'INVALID_STATE',
              'Only an active or locked account can be deactivated',
            );
          }
          await this.assertCanRemove(actor, target, 'CANNOT_CHANGE_SELF');
          await this.assertNoPendingAssignments(tx, target, dto.confirmedActiveAssignments);
          data = { status: UserStatus.INACTIVE, lockedAt: null, statusReason: reason || null };
          break;
        case 'reactivate':
          if (target.status !== UserStatus.INACTIVE) {
            throw apiError(HttpStatus.CONFLICT, 'INVALID_STATE', 'Not inactive');
          }
          data = { status: UserStatus.ACTIVE, statusReason: null };
          break;
      }

      const changed = await tx.user.update({
        where: { id: target.id },
        data: { ...data, statusChangedAt: new Date(), statusChangedBy: actor.name },
      });
      await this.audit.record(
        actor,
        `ACCOUNT_${action.toUpperCase()}`,
        reason ? `${target.fullName} — ${reason}` : target.fullName,
        target.id,
        {
          oldValues: { status: target.status, statusReason: target.statusReason },
          newValues: { status: changed.status, statusReason: changed.statusReason },
        },
        tx,
      );
      return changed;
    });
    // Inactive accounts are rejected by JwtStrategy even if session cleanup fails.
    if (updated.status !== UserStatus.ACTIVE) await this.auth.revokeAllTokens(updated.id);
    if (action === 'approve') await this.mailApproved(updated);
    if (action === 'decline') await this.mailDeclined(updated);
    if (action === 'approve' || action === 'unlock' || action === 'reactivate') {
      const titles: Record<string, string> = {
        approve: 'Tài khoản đã được phê duyệt',
        unlock: 'Tài khoản đã được mở khóa',
        reactivate: 'Tài khoản đã được kích hoạt lại',
      };
      const messages: Record<string, string> = {
        approve: `Tài khoản của bạn đã được phê duyệt với vai trò ${ROLE_LABEL[updated.role]}.`,
        unlock: `Tài khoản của bạn đã được mở khóa bởi ${actor.name}.`,
        reactivate: `Tài khoản của bạn đã được kích hoạt lại bởi ${actor.name}.`,
      };
      await this.notifications.notifyUsers(
        [updated.id],
        {
          type: 'ACCOUNT_STATUS_CHANGED',
          category: NotificationCategory.ACCOUNT,
          title: titles[action] || 'Cập nhật trạng thái tài khoản',
          message: messages[action] || `Trạng thái tài khoản: ${updated.status}.`,
          link: '/profile',
          senderName: actor.name,
          params: { status: updated.status, role: updated.role },
        },
        actor.id,
      );
    }
    return updated;
  }

  private appUrl(): string {
    return (this.config.get<string>('FRONTEND_URL') || 'http://localhost:5173').replace(/\/+$/, '');
  }

  private async mailApproved(user: User): Promise<void> {
    await this.mail.send(
      user.email,
      'Tài khoản TMEC của bạn đã được phê duyệt',
      `Kính gửi ${user.fullName},\n\n` +
        `Ban Quản lý Câu lạc bộ đã phê duyệt yêu cầu tài khoản với vai trò ${ROLE_LABEL[user.role]} (mã yêu cầu: ${user.requestCode ?? '—'}).\n` +
        `Quý khách hiện có thể đăng nhập vào hệ thống tại ${this.appUrl()}/login bằng email và mật khẩu đã đăng ký.`,
    );
  }

  private async mailDeclined(user: User): Promise<void> {
    await this.mail.send(
      user.email,
      'Thông báo về yêu cầu tài khoản TMEC',
      `Kính gửi ${user.fullName},\n\n` +
        `Ban Quản lý Câu lạc bộ đã từ chối yêu cầu đăng ký tài khoản ${user.requestCode ?? ''}.\n` +
        (user.statusReason ? `Lý do: ${user.statusReason}\n` : '') +
        `\nNếu cần chỉnh sửa thông tin, Quý khách có thể gửi yêu cầu mới tại ${this.appUrl()}/sign-up.`,
    );
  }

  // ------------------------------------------------------------------ xóa hẳn

  async remove(actor: AuditActor, id: string): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const target = await this.lockAccount(tx, id);
      if (target.id === actor.id) {
        throw apiError(
          HttpStatus.CONFLICT,
          'CANNOT_CHANGE_SELF',
          'Not allowed on your own account',
        );
      }
      if (!DELETABLE.includes(target.status)) {
        throw apiError(
          HttpStatus.CONFLICT,
          'CANNOT_DELETE_USED',
          'This account has been used; deactivate it instead',
        );
      }
      // Dọn dữ liệu phụ theo email (không có khóa ngoại tới User).
      await tx.otpCode.deleteMany({ where: { email: target.email } });
      await tx.resetToken.deleteMany({ where: { email: target.email } });
      await tx.loginAttempt.deleteMany({ where: loginAttemptsOf(target.email) });
      await tx.user.delete({ where: { id: target.id } });
      await this.audit.record(
        actor,
        'ACCOUNT_DELETED',
        `${target.fullName} (${target.email}, ${target.status})`,
        target.id,
        { oldValues: { fullName: target.fullName, email: target.email, status: target.status } },
        tx,
      );
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ quyền

  async updatePermissions(actor: AuditActor, id: string, incoming: Record<string, unknown>) {
    const result = await this.prisma.$transaction(async (tx) => {
      const target = await this.lockAccount(tx, id);
      const current = permissionsOf(target);
      const next = normalizePermissions(target.role, { ...current, ...incoming });

      let granted = 0;
      let revoked = 0;
      for (const { key } of PERMISSIONS) {
        if (next[key] && !current[key]) granted += 1;
        if (!next[key] && current[key]) revoked += 1;
      }

      const changed = await tx.user.update({
        where: { id: target.id },
        data: {
          permissions: next,
          permissionsChangedAt: new Date(),
          permissionsChangedBy: actor.name,
        },
      });
      await this.audit.record(
        actor,
        'PERMISSIONS_CHANGED',
        `${target.fullName}: ${granted} granted, ${revoked} revoked`,
        target.id,
        { oldValues: current, newValues: next },
        tx,
      );
      return { user: changed, granted, revoked };
    });

    await this.notifications.notifyUsers(
      [result.user.id],
      {
        type: 'ACCOUNT_PERMISSIONS_CHANGED',
        category: NotificationCategory.ACCOUNT,
        title: 'Quyền tài khoản được cập nhật',
        message: `Quyền của bạn đã được cập nhật bởi ${actor.name} (${result.granted} cấp mới, ${result.revoked} thu hồi).`,
        link: '/profile',
        senderName: actor.name,
        params: { granted: result.granted, revoked: result.revoked },
      },
      actor.id,
    );

    return result;
  }

  private async lockAccount(tx: Prisma.TransactionClient, id: string): Promise<User> {
    // Read after acquiring the row lock: before-values must reflect the last committed writer.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id } });
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Account not found');
    return user;
  }

  private async assertNoPendingAssignments(
    tx: Prisma.TransactionClient,
    target: User,
    confirmed?: boolean,
  ): Promise<void> {
    if (confirmed) return;

    const today = new Date(effectiveNow().toDateString());
    const [activeStalls, upcomingWorkouts, upcomingShifts, activePlans] = await Promise.all([
      (tx as any).stallAllocation?.count
        ? (tx as any).stallAllocation.count({
            where: { assignedGroomUserId: target.id, isActive: true },
          })
        : 0,
      (tx as any).workoutSession?.count
        ? (tx as any).workoutSession.count({
            where: {
              assignedStaffUserId: target.id,
              scheduledDate: { gte: effectiveNow() },
              status: WorkoutStatus.SCHEDULED,
            },
          })
        : 0,
      (tx as any).shiftRoster?.count
        ? (tx as any).shiftRoster.count({
            where: { groomUserId: target.id, date: { gte: today } },
          })
        : 0,
      (tx as any).trainingPlan?.count
        ? (tx as any).trainingPlan.count({
            where: { trainerUserId: target.id, status: PlanStatus.ACTIVE },
          })
        : 0,
    ]);

    const total = activeStalls + upcomingWorkouts + upcomingShifts + activePlans;
    if (total > 0) {
      const parts: string[] = [];
      if (activeStalls > 0) parts.push(`${activeStalls} ô chuồng đang phụ trách`);
      if (upcomingWorkouts > 0) parts.push(`${upcomingWorkouts} buổi tập sắp tới`);
      if (upcomingShifts > 0) parts.push(`${upcomingShifts} ca trực sắp tới`);
      if (activePlans > 0) parts.push(`${activePlans} giáo án đang kích hoạt`);

      throw apiError(
        HttpStatus.CONFLICT,
        'USER_HAS_ACTIVE_ASSIGNMENTS',
        `Nhân viên ${target.fullName} đang có: ${parts.join(', ')}. Vui lòng kiểm tra chuyển giao công việc hoặc xác nhận để tiếp tục.`,
        {
          activeAssignments: {
            activeStalls,
            upcomingWorkouts,
            upcomingShifts,
            activePlans,
          },
        },
      );
    }
  }

  async getActiveAssignments(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User not found');

    const today = new Date(effectiveNow().toDateString());
    const [stalls, workouts, shifts, plans] = await Promise.all([
      this.prisma.stallAllocation
        ? this.prisma.stallAllocation.findMany({
            where: { assignedGroomUserId: userId, isActive: true },
            include: {
              horse: { select: { id: true, name: true, horseCode: true } },
              stall: { select: { id: true, code: true, zone: true } },
            },
          })
        : [],
      this.prisma.workoutSession
        ? this.prisma.workoutSession.findMany({
            where: {
              OR: [{ assignedStaffUserId: userId }, { trainingPlan: { trainerUserId: userId } }],
              scheduledDate: { gte: effectiveNow() },
              status: WorkoutStatus.SCHEDULED,
            },
            include: { horse: { select: { id: true, name: true, horseCode: true } } },
            orderBy: { scheduledDate: 'asc' },
            take: 15,
          })
        : [],
      this.prisma.shiftRoster
        ? this.prisma.shiftRoster.findMany({
            where: { groomUserId: userId, date: { gte: today } },
            include: { shift: true, zone: true },
          })
        : [],
      this.prisma.trainingPlan
        ? this.prisma.trainingPlan
            .findMany({
              where: { trainerUserId: userId, status: PlanStatus.ACTIVE },
              include: {
                horse: { select: { id: true, name: true, horseCode: true } },
              },
            })
            .then((items) =>
              items.map((p) => ({
                id: p.id,
                planCode: p.planCode,
                phaseName: p.phaseName ?? 'Đang thực hiện',
                startDate: p.startDate,
                endDate: p.endDate,
                horse: p.horse,
              })),
            )
        : [],
    ]);

    return {
      userId,
      hasAssignments:
        stalls.length > 0 || workouts.length > 0 || shifts.length > 0 || plans.length > 0,
      stalls,
      workouts,
      shifts,
      plans,
    };
  }

  /** Lấy danh sách định mức nhân sự HLV & Groom của tất cả các Barn kèm tải hiện tại. */
  async getBarnStaffing() {
    const zones = await this.prisma.stallZone.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        assignedTrainers: {
          where: {
            role: { in: [Role.HEAD_TRAINER, Role.GROOM] },
            status: { notIn: [UserStatus.LOCKED, UserStatus.REJECTED] },
          },
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    const trainerIds = zones.flatMap((z) =>
      z.assignedTrainers.filter((t) => t.role === Role.HEAD_TRAINER).map((t) => t.id),
    );
    const groomIds = zones.flatMap((z) =>
      z.assignedTrainers.filter((t) => t.role === Role.GROOM).map((t) => t.id),
    );

    const [horseCounts, stallCounts] = await Promise.all([
      trainerIds.length > 0
        ? this.prisma.horse.groupBy({
            by: ['assignedTrainerId'],
            where: {
              assignedTrainerId: { in: trainerIds },
              deletedAt: null,
            },
            _count: { id: true },
          })
        : Promise.resolve([]),
      groomIds.length > 0
        ? this.prisma.stallAllocation.groupBy({
            by: ['assignedGroomUserId'],
            where: {
              assignedGroomUserId: { in: groomIds },
              isActive: true,
            },
            _count: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const horseCountMap = new Map<string, number>();
    (horseCounts as any[]).forEach((hc: any) => {
      if (hc.assignedTrainerId) horseCountMap.set(hc.assignedTrainerId, hc._count?.id ?? 0);
    });

    const stallCountMap = new Map<string, number>();
    (stallCounts as any[]).forEach((sc: any) => {
      if (sc.assignedGroomUserId) stallCountMap.set(sc.assignedGroomUserId, sc._count?.id ?? 0);
    });

    return zones.map((z) => {
      const barnTrainers = z.assignedTrainers.filter((u) => u.role === Role.HEAD_TRAINER);
      const barnGrooms = z.assignedTrainers.filter((u) => u.role === Role.GROOM);

      return {
        id: z.id,
        code: z.code,
        name: z.name,
        // HLV
        trainersCount: barnTrainers.length,
        maxTrainers: MAX_TRAINERS_PER_BARN,
        isFull: barnTrainers.length >= MAX_TRAINERS_PER_BARN,
        trainers: barnTrainers.map((t) => ({
          ...t,
          currentLoad: horseCountMap.get(t.id) ?? 0,
          maxCapacity: MAX_HORSES_PER_TRAINER,
        })),
        // Groom
        groomsCount: barnGrooms.length,
        maxGrooms: MAX_GROOMS_PER_BARN,
        isGroomFull: barnGrooms.length >= MAX_GROOMS_PER_BARN,
        grooms: barnGrooms.map((g) => ({
          ...g,
          currentLoad: stallCountMap.get(g.id) ?? 0,
          maxCapacity: MAX_CARE_STALLS,
        })),
      };
    });
  }

  /** Lấy danh sách các chiến mã đang ở trong ô chuồng nhưng chưa có HLV phụ trách (ngựa tồn đọng do điều chuyển hoặc mới vào). */
  async getOrphanedHorses() {
    const allocations = await this.prisma.stallAllocation.findMany({
      where: {
        isActive: true,
        horse: {
          deletedAt: null,
          OR: [{ assignedTrainerId: null }, { trainerAssignmentStatus: 'UNASSIGNED' }],
        },
      },
      include: {
        stall: {
          include: { zoneRef: { select: { id: true, name: true, code: true } } },
        },
        horse: {
          select: {
            id: true,
            name: true,
            horseCode: true,
            status: true,
            isMedicalLocked: true,
            avatarUrl: true,
            trainingPlans: {
              where: { status: { in: [PlanStatus.DRAFT, PlanStatus.ACTIVE] } },
              orderBy: { updatedAt: 'desc' },
              take: 1,
              select: { id: true, planCode: true, phaseName: true, status: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return allocations.map((a) => ({
      horseId: a.horse.id,
      horseName: a.horse.name,
      horseCode: a.horse.horseCode,
      avatarUrl: a.horse.avatarUrl,
      status: a.horse.status,
      isMedicalLocked: a.horse.isMedicalLocked,
      stallCode: a.stall.code,
      zoneName: a.stall.zoneRef?.name ?? a.stall.zone ?? '',
      zoneId: a.stall.zoneId,
      latestPlan: a.horse.trainingPlans[0] ?? null,
    }));
  }

  /** Điều chuyển Khu chuồng cho HLV (kèm xử lý bàn giao chia tách thông minh nếu HLV đang có ngựa). */
  async assignTrainerBarn(actor: AuditActor, trainerId: string, dto: AssignTrainerBarnDto) {
    const trainer = await this.find(trainerId);
    if (trainer.role !== Role.HEAD_TRAINER) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'NOT_A_TRAINER',
        'Chỉ có thể phân công Khu chuồng cho Huấn luyện viên trưởng.',
      );
    }

    const targetBarn = await this.prisma.stallZone.findUnique({
      where: { id: dto.targetBarnId },
    });
    if (!targetBarn) {
      throw apiError(HttpStatus.NOT_FOUND, 'BARN_NOT_FOUND', 'Khu chuồng đích không tồn tại.');
    }

    if (trainer.assignedBarnId === dto.targetBarnId) {
      return { trainer: toPublicUser(trainer), message: 'Huấn luyện viên đã ở khu chuồng này.' };
    }

    // Kiểm tra trần 2 HLV ở Barn đích
    const countInTarget = await this.prisma.user.count({
      where: {
        assignedBarnId: dto.targetBarnId,
        role: Role.HEAD_TRAINER,
        id: { not: trainerId },
        status: { notIn: [UserStatus.LOCKED, UserStatus.REJECTED] },
      },
    });
    if (countInTarget >= MAX_TRAINERS_PER_BARN) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'BARN_TRAINER_CAPACITY_EXCEEDED',
        `Khu chuồng ${targetBarn.name} đã đủ tối đa ${MAX_TRAINERS_PER_BARN} Huấn luyện viên phụ trách.`,
      );
    }

    // Đếm số ngựa hiện tại HLV đang phụ trách (giáo án Active hoặc Draft)
    const activeOrDraftPlans = await this.prisma.trainingPlan.findMany({
      where: {
        trainerUserId: trainerId,
        status: { in: [PlanStatus.DRAFT, PlanStatus.ACTIVE] },
        horse: { deletedAt: null },
      },
      include: { horse: true },
    });

    if (activeOrDraftPlans.length > 0) {
      if (!dto.handoverTrainerId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'HANDOVER_TRAINER_REQUIRED',
          `Huấn luyện viên đang phụ trách ${activeOrDraftPlans.length} chiến mã. Vui lòng chọn Huấn luyện viên đồng nghiệp trong cùng khu chuồng để bàn giao trước khi chuyển khu.`,
        );
      }

      if (dto.handoverTrainerId === trainerId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'CANNOT_HANDOVER_TO_SELF',
          'Không thể tự bàn giao cho chính mình.',
        );
      }

      const handoverTrainer = await this.find(dto.handoverTrainerId);
      if (
        handoverTrainer.role !== Role.HEAD_TRAINER ||
        handoverTrainer.status !== UserStatus.ACTIVE
      ) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'INVALID_HANDOVER_RECIPIENT',
          'Người nhận bàn giao phải là Huấn luyện viên trưởng đang hoạt động.',
        );
      }

      if (handoverTrainer.assignedBarnId !== trainer.assignedBarnId) {
        throw apiError(
          HttpStatus.BAD_REQUEST,
          'TRAINER_NOT_IN_SAME_BARN',
          'Huấn luyện viên nhận bàn giao phải cùng phụ trách trong khu chuồng hiện tại.',
        );
      }

      // Kiểm tra sức chứa của HLV nhận bàn giao (tối đa 8 con)
      const rawPlanCount = await this.prisma.trainingPlan.count({
        where: {
          trainerUserId: dto.handoverTrainerId,
          status: { in: [PlanStatus.DRAFT, PlanStatus.ACTIVE] },
          horse: { deletedAt: null },
        },
      });
      const recipientPlanCount = Number(rawPlanCount) || 0;

      let recipientHorseCount = 0;
      try {
        if (this.prisma.horse?.count) {
          const c = await this.prisma.horse.count({
            where: {
              assignedTrainerId: dto.handoverTrainerId,
              trainerAssignmentStatus: {
                in: [TrainerAssignmentStatus.ASSIGNED, TrainerAssignmentStatus.PENDING_ACCEPTANCE],
              },
              deletedAt: null,
            },
          });
          recipientHorseCount = Number(c) || 0;
        }
      } catch {
        recipientHorseCount = 0;
      }

      const currentLoad = Math.max(recipientPlanCount, recipientHorseCount);
      const availableSlots = Math.max(0, MAX_HORSES_PER_TRAINER - currentLoad);
      // Cơ chế Bàn giao Chia tách Thông minh (Smart Split Handover)
      const toHandoverPlans = activeOrDraftPlans.slice(0, availableSlots);
      const excessPlans = activeOrDraftPlans.slice(availableSlots);

      // Thực hiện bàn giao chia tách và đổi Barn trong transaction
      await this.prisma.$transaction(async (tx) => {
        // Nhóm 1: Bàn giao sang HLV nhận (tối đa bằng số slot còn trống)
        if (toHandoverPlans.length > 0) {
          const handoverPlanIds = toHandoverPlans.map((p) => p.id);
          const handoverHorseIds = toHandoverPlans.map((p) => p.horseId);

          // Cập nhật người phụ trách của giáo án
          await tx.trainingPlan.updateMany({
            where: { id: { in: handoverPlanIds } },
            data: { trainerUserId: dto.handoverTrainerId },
          });

          // Cập nhật assignedTrainerId trên bảng Horse
          await tx.horse.updateMany({
            where: { id: { in: handoverHorseIds } },
            data: {
              assignedTrainerId: dto.handoverTrainerId,
              trainerAssignmentStatus: 'ASSIGNED',
              trainerAssignedAt: effectiveNow(),
            },
          });

          // Đồng bộ các buổi tập từ ngày mai trở đi sang HLV mới (buổi tập hôm nay HLV cũ hoàn thành nốt ca trực)
          const startOfTomorrow = effectiveNow();
          startOfTomorrow.setHours(24, 0, 0, 0);
          if (tx.workoutSession) {
            await tx.workoutSession.updateMany({
              where: {
                trainingPlanId: { in: handoverPlanIds },
                scheduledDate: { gte: startOfTomorrow },
                status: WorkoutStatus.SCHEDULED,
              },
              data: { assignedStaffUserId: dto.handoverTrainerId },
            });
          }
        }

        // Nhóm 2: Các chiến mã dôi dư (HLV nhận không đủ slot gánh) -> chuyển về Chờ phân công HLV mới
        if (excessPlans.length > 0) {
          const excessHorseIds = excessPlans.map((p) => p.horseId);
          await tx.horse.updateMany({
            where: { id: { in: excessHorseIds } },
            data: {
              assignedTrainerId: null,
              trainerAssignmentStatus: 'UNASSIGNED',
              trainerAssignedAt: null,
            },
          });
        }

        // Chuyển Barn cho HLV cũ
        await tx.user.update({
          where: { id: trainerId },
          data: { assignedBarnId: dto.targetBarnId },
        });

        await this.audit.record(
          actor,
          'TRAINER_BARN_REASSIGNED_WITH_SMART_HANDOVER',
          `Đã chuyển HLV ${trainer.fullName} sang khu ${targetBarn.name}. Bàn giao ${toHandoverPlans.length} chiến mã sang HLV ${handoverTrainer.fullName}${excessPlans.length > 0 ? `, ${excessPlans.length} chiến mã dôi dư chuyển về trạng thái Chờ phân công` : ''}.`,
          trainerId,
          {
            entityName: 'User',
            newValues: {
              assignedBarnId: dto.targetBarnId,
              handedOverCount: toHandoverPlans.length,
              excessCount: excessPlans.length,
            },
          },
          tx,
        );
      });

      // Bắn thông báo Kênh kép cho HLV tiếp nhận
      if (this.notifications && toHandoverPlans.length > 0) {
        await this.notifications.notifyUsers([dto.handoverTrainerId], {
          type: 'TRAINER_HANDOVER_ASSIGNMENT',
          category: NotificationCategory.SYSTEM,
          title: 'Yêu cầu tiếp nhận bàn giao chiến mã',
          message: `Quản lý đã bàn giao ${toHandoverPlans.length} chiến mã từ HLV ${trainer.fullName} cho bạn. Vui lòng xem giáo án và xác nhận tiếp nhận.`,
          link: '/dashboard',
          dedupeKey: `trainer-handover:${dto.handoverTrainerId}:${Date.now()}`,
        });
      }
    } else {
      // HLV có 0 con ngựa -> đổi Barn tức thì
      await this.prisma.user.update({
        where: { id: trainerId },
        data: { assignedBarnId: dto.targetBarnId },
      });

      await this.audit.record(
        actor,
        'TRAINER_BARN_REASSIGNED',
        `Đã chuyển HLV ${trainer.fullName} sang khu ${targetBarn.name}`,
        trainerId,
        { entityName: 'User', newValues: { assignedBarnId: dto.targetBarnId } },
      );
    }

    const updated = await this.find(trainerId);
    return {
      trainer: toPublicUser(updated),
      message: `Đã chuyển sang khu ${targetBarn.name} thành công.`,
    };
  }
}
