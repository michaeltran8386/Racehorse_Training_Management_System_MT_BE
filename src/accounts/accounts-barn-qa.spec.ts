import { ConfigService } from '@nestjs/config';
import { Role, UserStatus, WorkoutStatus } from '@prisma/client';
import { AccountsService } from './accounts.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { OtpService } from '../auth/otp.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('AccountsService - Barn Staffing & Reassignment QA', () => {
  const actor = { id: 'mgr-1', name: 'Manager' };

  let mockPrisma: any;
  let service: AccountsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = {
      $queryRaw: jest.fn(),
      $transaction: jest.fn((work: (tx: any) => any) => work(mockPrisma)),
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      stallZone: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      horse: {
        count: jest.fn(),
        updateMany: jest.fn(),
      },
      trainingPlan: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn(),
      },
      workoutSession: {
        updateMany: jest.fn(),
      },
      otpCode: { deleteMany: jest.fn() },
      resetToken: { deleteMany: jest.fn() },
      loginAttempt: { deleteMany: jest.fn() },
    };

    const mockMail = { send: jest.fn() };
    const mockAudit = { record: jest.fn() };
    const mockAuth = { revokeAllTokens: jest.fn() };
    const mockOtp = {
      issue: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      assertCooldown: jest.fn(),
    };
    const mockNotifications = { notifyUsers: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn() } as unknown as ConfigService;

    service = new AccountsService(
      mockPrisma as unknown as PrismaService,
      mockMail as unknown as MailService,
      mockAudit as unknown as AuditService,
      mockAuth as unknown as AuthService,
      mockOtp as unknown as OtpService,
      config,
      mockNotifications as unknown as NotificationsService,
    );
  });

  describe('Invite Trainer Barn Constraints', () => {
    it('QA-BARN-01: Thất bại khi tạo HLV mà không chọn Barn', async () => {
      await expect(
        service.invite(actor, {
          fullName: 'Nguyễn Văn Huấn',
          email: 'huan@gmail.com',
          role: Role.HEAD_TRAINER,
        } as any),
      ).rejects.toThrow('Vui lòng chọn Khu chuồng phụ trách cho Huấn luyện viên trưởng.');
    });

    it('QA-BARN-02: Thất bại khi tạo HLV vào Barn đã đủ 2/2 HLV', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.stallZone.findUnique.mockResolvedValue({ id: 'zone-a', name: 'Khu chuồng A' });
      mockPrisma.user.count.mockResolvedValue(2); // Đã đủ 2 HLV

      await expect(
        service.invite(actor, {
          fullName: 'Nguyễn Văn Huấn',
          email: 'huan@gmail.com',
          role: Role.HEAD_TRAINER,
          assignedBarnId: 'zone-a',
        } as any),
      ).rejects.toThrow('Khu chuồng này đã đủ tối đa 2 Huấn luyện viên phụ trách.');
    });

    it('QA-BARN-03: Thành công tạo HLV khi Barn mới có 1/2 HLV', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.stallZone.findUnique.mockResolvedValue({ id: 'zone-a', name: 'Khu chuồng A' });
      mockPrisma.user.count.mockResolvedValue(1); // 1 HLV
      mockPrisma.user.create.mockResolvedValue({
        id: 'trainer-2',
        fullName: 'Nguyễn Văn Huấn',
        email: 'huan@gmail.com',
        role: Role.HEAD_TRAINER,
        assignedBarnId: 'zone-a',
        status: UserStatus.INVITED,
      });

      const result = await service.invite(actor, {
        fullName: 'Nguyễn Văn Huấn',
        email: 'huan@gmail.com',
        role: Role.HEAD_TRAINER,
        assignedBarnId: 'zone-a',
      } as any);

      expect(result.id).toBe('trainer-2');
      expect(result.assignedBarnId).toBe('zone-a');
    });

    it('QA-BARN-10: Thất bại khi tạo Groom mà không chọn Barn', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.invite(actor, {
          fullName: 'Nguyễn Văn Groom',
          email: 'groom@gmail.com',
          role: Role.GROOM,
        } as any),
      ).rejects.toThrow('Vui lòng chọn Khu chuồng phụ trách cho nhân viên Groom.');
    });

    it('QA-BARN-11: Thất bại khi tạo Groom vào Barn đã đủ 4/4 Groom', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.stallZone.findUnique.mockResolvedValue({ id: 'zone-a', name: 'Khu chuồng A' });
      mockPrisma.user.count.mockResolvedValue(4); // Barn A đã đủ 4 Groom

      await expect(
        service.invite(actor, {
          fullName: 'Nguyễn Văn Groom',
          email: 'groom@gmail.com',
          role: Role.GROOM,
          assignedBarnId: 'zone-a',
        } as any),
      ).rejects.toThrow('Khu chuồng này đã đủ tối đa 4 Groom phụ trách.');
    });

    it('QA-BARN-12: Thành công tạo Groom khi Barn mới có 3/4 Groom', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.stallZone.findUnique.mockResolvedValue({ id: 'zone-a', name: 'Khu chuồng A' });
      mockPrisma.user.count.mockResolvedValue(3); // 3 Groom
      mockPrisma.user.create.mockResolvedValue({
        id: 'groom-4',
        fullName: 'Nguyễn Văn Bốn',
        email: 'groom4@gmail.com',
        role: Role.GROOM,
        assignedBarnId: 'zone-a',
        status: UserStatus.INVITED,
      });

      const result = await service.invite(actor, {
        fullName: 'Nguyễn Văn Bốn',
        email: 'groom4@gmail.com',
        role: Role.GROOM,
        assignedBarnId: 'zone-a',
      } as any);

      expect(result.id).toBe('groom-4');
      expect(result.assignedBarnId).toBe('zone-a');
    });
  });

  describe('Reassign Trainer Barn Constraints', () => {
    const currentTrainer = {
      id: 'trainer-1',
      fullName: 'HLV Tuấn',
      email: 'tuan@tmec.vn',
      role: Role.HEAD_TRAINER,
      assignedBarnId: 'zone-a',
      status: UserStatus.ACTIVE,
    };

    it('QA-BARN-04: Thất bại khi chuyển HLV sang Barn đã đủ 2/2 HLV', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(currentTrainer);
      mockPrisma.stallZone.findUnique.mockResolvedValue({ id: 'zone-b', name: 'Khu chuồng B' });
      mockPrisma.user.count.mockResolvedValue(2); // Barn B đã đủ 2 HLV

      await expect(
        service.assignTrainerBarn(actor, 'trainer-1', {
          targetBarnId: 'zone-b',
        }),
      ).rejects.toThrow('Khu chuồng Khu chuồng B đã đủ tối đa 2 Huấn luyện viên phụ trách.');
    });

    it('QA-BARN-05: Thất bại khi HLV đang có ngựa mà không chỉ định HLV nhận bàn giao cùng Barn', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(currentTrainer);
      mockPrisma.stallZone.findUnique.mockResolvedValue({ id: 'zone-b', name: 'Khu chuồng B' });
      mockPrisma.user.count.mockResolvedValue(1); // Barn B mới có 1 HLV
      mockPrisma.trainingPlan.findMany.mockResolvedValue([
        { id: 'p1' },
        { id: 'p2' },
        { id: 'p3' },
      ]); // Đang có 3 ngựa

      await expect(
        service.assignTrainerBarn(actor, 'trainer-1', {
          targetBarnId: 'zone-b',
        }),
      ).rejects.toThrow(
        'Vui lòng chọn Huấn luyện viên đồng nghiệp trong cùng khu chuồng để bàn giao',
      );
    });

    it('QA-BARN-06: Thành công chia tách bàn giao thông minh khi HLV nhận chỉ còn trống 2 chỗ (3 con -> 2 con bàn giao, 1 con dôi dư)', async () => {
      const colleagueTrainer = {
        id: 'trainer-colleague',
        fullName: 'HLV Quân',
        role: Role.HEAD_TRAINER,
        assignedBarnId: 'zone-a',
        status: UserStatus.ACTIVE,
      };

      mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'trainer-1') return Promise.resolve(currentTrainer);
        if (where.id === 'trainer-colleague') return Promise.resolve(colleagueTrainer);
        return Promise.resolve(null);
      });
      mockPrisma.stallZone.findUnique.mockResolvedValue({ id: 'zone-b', name: 'Khu chuồng B' });
      mockPrisma.user.count.mockResolvedValue(1); // Barn B mới có 1 HLV
      mockPrisma.trainingPlan.findMany.mockResolvedValue([
        { id: 'p1', horseId: 'h1' },
        { id: 'p2', horseId: 'h2' },
        { id: 'p3', horseId: 'h3' },
      ]); // HLV Tuấn có 3 ngựa
      mockPrisma.trainingPlan.count.mockResolvedValue(6); // Đồng nghiệp đã có 6 con -> còn 2 chỗ trống!
      mockPrisma.user.update.mockResolvedValue({
        ...currentTrainer,
        assignedBarnId: 'zone-b',
      });

      const res = await service.assignTrainerBarn(actor, 'trainer-1', {
        targetBarnId: 'zone-b',
        handoverTrainerId: 'trainer-colleague',
      });

      expect(res.trainer.id).toBe('trainer-1');
      // Nhóm 1: 2 con đầu (h1, h2) được bàn giao sang HLV Quân
      expect(mockPrisma.horse.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['h1', 'h2'] } },
        data: expect.objectContaining({
          assignedTrainerId: 'trainer-colleague',
          trainerAssignmentStatus: 'ASSIGNED',
        }),
      });
      // Nhóm 2: con thứ 3 (h3) dôi dư chuyển về UNASSIGNED
      expect(mockPrisma.horse.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['h3'] } },
        data: expect.objectContaining({
          assignedTrainerId: null,
          trainerAssignmentStatus: 'UNASSIGNED',
        }),
      });
      // Đồng bộ các buổi tập từ ngày mai trở đi
      expect(mockPrisma.workoutSession.updateMany).toHaveBeenCalledWith({
        where: {
          trainingPlanId: { in: ['p1', 'p2'] },
          scheduledDate: { gte: expect.any(Date) },
          status: WorkoutStatus.SCHEDULED,
        },
        data: { assignedStaffUserId: 'trainer-colleague' },
      });
    });

    it('QA-BARN-07: Thành công điều chuyển Barn và bàn giao toàn bộ chiến mã trong transaction', async () => {
      const colleagueTrainer = {
        id: 'trainer-colleague',
        fullName: 'HLV Quân',
        role: Role.HEAD_TRAINER,
        assignedBarnId: 'zone-a',
        status: UserStatus.ACTIVE,
      };

      mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
        if (where.id === 'trainer-1') return Promise.resolve(currentTrainer);
        if (where.id === 'trainer-colleague') return Promise.resolve(colleagueTrainer);
        return Promise.resolve(null);
      });
      mockPrisma.stallZone.findUnique.mockResolvedValue({ id: 'zone-b', name: 'Khu chuồng B' });
      mockPrisma.user.count.mockResolvedValue(1); // Barn B mới có 1 HLV
      mockPrisma.trainingPlan.findMany.mockResolvedValue([
        { id: 'p1', horseId: 'h1' },
        { id: 'p2', horseId: 'h2' },
      ]); // HLV Tuấn có 2 ngựa
      mockPrisma.trainingPlan.count.mockResolvedValue(3); // Đồng nghiệp có 3 con -> 3 + 2 = 5 <= 8 (Hợp lệ)
      mockPrisma.user.update.mockResolvedValue({
        ...currentTrainer,
        assignedBarnId: 'zone-b',
      });

      const res = await service.assignTrainerBarn(actor, 'trainer-1', {
        targetBarnId: 'zone-b',
        handoverTrainerId: 'trainer-colleague',
      });

      expect(res.trainer.id).toBe('trainer-1');
      expect(mockPrisma.horse.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['h1', 'h2'] } },
        data: expect.objectContaining({
          assignedTrainerId: 'trainer-colleague',
          trainerAssignmentStatus: 'ASSIGNED',
        }),
      });
      expect(mockPrisma.trainingPlan.updateMany).toHaveBeenCalled();
    });

    it('QA-BARN-08: Lấy danh sách chiến mã tồn đọng (orphaned horses) chưa có HLV', async () => {
      mockPrisma.stallAllocation = {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'alloc-1',
            stall: {
              code: 'A-07',
              zone: 'Barn A',
              zoneRef: { id: 'z1', name: 'Barn A', code: 'BARN-A' },
            },
            horse: {
              id: 'h-orphan-1',
              name: 'Thần Phong',
              horseCode: 'HR-DEMO-A07',
              status: 'RESTING',
              isMedicalLocked: false,
              avatarUrl: '/images/horses/horse-07.jpg',
              trainingPlans: [
                { id: 'p1', planCode: 'GA-DEMO-A07', phaseName: 'Giai đoạn 1', status: 'DRAFT' },
              ],
            },
          },
        ]),
      };

      const result = await service.getOrphanedHorses();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        horseId: 'h-orphan-1',
        horseName: 'Thần Phong',
        stallCode: 'A-07',
        zoneName: 'Barn A',
      });
    });

    it('QA-BARN-09: Lấy định mức Barn kèm tải hiện tại của từng HLV (currentLoad)', async () => {
      mockPrisma.stallZone.findMany.mockResolvedValue([
        {
          id: 'z-a',
          code: 'BARN-A',
          name: 'Barn A',
          assignedTrainers: [
            {
              id: 't-1',
              fullName: 'HLV Tuấn',
              email: 'tuan@tmec.vn',
              role: Role.HEAD_TRAINER,
              status: UserStatus.ACTIVE,
            },
            {
              id: 't-2',
              fullName: 'HLV Quân',
              email: 'quan@tmec.vn',
              role: Role.HEAD_TRAINER,
              status: UserStatus.ACTIVE,
            },
          ],
        },
      ]);
      mockPrisma.horse.groupBy = jest.fn().mockResolvedValue([
        { assignedTrainerId: 't-1', _count: { id: 8 } },
        { assignedTrainerId: 't-2', _count: { id: 2 } },
      ]);

      const barns = await service.getBarnStaffing();
      expect(barns).toHaveLength(1);
      expect(barns[0].trainersCount).toBe(2);
      expect(barns[0].isFull).toBe(true);
      expect(barns[0].trainers[0].currentLoad).toBe(8);
      expect(barns[0].trainers[1].currentLoad).toBe(2);
    });
  });
});
