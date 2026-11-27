import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { AdmissionStatus, HorseStatus, Role, UserStatus } from '@prisma/client';
import { HorsesService } from './horses.service';
import { HorseHistoryService } from './horse-history.service';
import { HorseLifecycleService } from './horse-lifecycle.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CounterService } from '../audit/counter.service';
import { HorseCatalogsService } from '../horse-catalogs/horse-catalogs.service';
import { UserRole } from '../common/enums/role.enum';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { notificationsMock } from '../notifications/notifications.testing';
import { BusinessMailService } from '../business-mail/business-mail.service';

describe('HorsesService', () => {
  let service: HorsesService;
  let history: HorseHistoryService;
  let lifecycle: HorseLifecycleService;
  let prisma: any;
  let audit: any;
  let counter: { next: jest.Mock };
  let catalogs: { resolveName: jest.Mock };
  let businessMail: { emit: jest.Mock };

  const placement = {
    stallId: 'stall-1',
    assignedGroomUserId: 'groom-1',
    receivingGroomUserId: 'groom-1',
  };
  const mockManager: CurrentUserPayload = {
    userId: 'manager-1',
    email: 'manager@gmail.com',
    fullName: 'Manager User',
    role: UserRole.CLUB_MANAGER,
  };

  const mockOwner: CurrentUserPayload = {
    userId: 'owner-1',
    email: 'owner@gmail.com',
    fullName: 'Owner User',
    role: UserRole.HORSE_OWNER,
  };

  const mockGroom: CurrentUserPayload = {
    userId: 'groom-1',
    email: 'groom@gmail.com',
    fullName: 'Groom User',
    role: UserRole.GROOM,
  };

  beforeEach(async () => {
    prisma = {
      // $transaction chạy callback với chính đối tượng giả; $queryRaw (FOR UPDATE) trả rỗng
      $transaction: jest.fn((fn: (tx: any) => unknown) => fn(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'stall-1', code: 'A01' }]),
      horse: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      horseAdmissionRecord: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: 'adm-1',
            admissionCode: 'ADM-2026-001',
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        update: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: args.where?.id || 'adm-1',
            admissionCode: 'ADM-2026-001',
            horse: {
              id: 'h-1',
              name: 'Mock Horse',
              horseCode: 'HRS-2026-001',
              microchip: '123456789012345',
              status: HorseStatus.PENDING_ADMISSION,
            },
            owner: { id: 'owner-1', fullName: 'Owner User', email: 'owner@gmail.com' },
            ...args.data,
          }),
        ),
      },
      admissionHealthReview: { create: jest.fn().mockResolvedValue({}) },
      dailyCareTask: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      shiftRoster: {
        findMany: jest.fn().mockImplementation(async () => {
          const date = new Date(
            new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10) + 'T00:00:00Z',
          );
          return [
            {
              date,
              shiftId: 'shift',
              groomUserId: 'groom-1',
              dutyTypes: ['HORSE_CARE'],
              shift: { startTime: '00:00', endTime: '00:00', isOvernight: true },
            },
          ];
        }),
      },
      admissionHistoryLog: {
        create: jest
          .fn()
          .mockImplementation((args) =>
            Promise.resolve({ id: 'log-1', ...args.data, createdAt: new Date() }),
          ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'manager-1', role: Role.CLUB_MANAGER },
          { id: 'vet-1', role: Role.VETERINARIAN },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          id: 'owner-1',
          role: Role.HORSE_OWNER,
          status: UserStatus.ACTIVE,
          isBadDebtFlagged: false,
        }),
      },
      stallAllocation: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'allocation-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      staffWorkItem: { findFirst: jest.fn().mockResolvedValue(null) },
      stall: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'stall-1', zoneId: 'zone-1' }),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      medicalLock: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      trainingPlan: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      workoutSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    audit = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    let seq = 0;
    counter = { next: jest.fn(() => Promise.resolve(++seq)) };
    // Danh mục Giống / Màu lông: trả lại đúng tên được gửi lên (mục đang dùng).
    catalogs = { resolveName: jest.fn((_type: string, value: string) => Promise.resolve(value)) };
    businessMail = { emit: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HorsesService,
        HorseHistoryService,
        HorseLifecycleService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: CounterService, useValue: counter },
        { provide: HorseCatalogsService, useValue: catalogs },
        { provide: BusinessMailService, useValue: businessMail },
        notificationsMock(),
      ],
    }).compile();

    service = module.get<HorsesService>(HorsesService);
    history = module.get(HorseHistoryService);
    lifecycle = module.get(HorseLifecycleService);
  });

  describe('generateHorseCode', () => {
    it('should take the next number from the shared counter (C1-01)', async () => {
      prisma.horse.findUnique.mockResolvedValue(null);

      const code = await service.generateHorseCode();
      expect(code).toBe('HR-000001');
      expect(counter.next).toHaveBeenCalledWith('horse_code');
      expect(prisma.horse.count).not.toHaveBeenCalled();
    });

    it('should skip numbers already used by older records', async () => {
      prisma.horse.findUnique.mockResolvedValueOnce({ id: 'exists' }).mockResolvedValueOnce(null);

      const code = await service.generateHorseCode();
      expect(code).toBe('HR-000002');
    });
  });

  describe('create', () => {
    it('should create horse with default status PENDING_ADMISSION and auto code', async () => {
      prisma.horse.findFirst.mockResolvedValue(null);
      prisma.horse.findUnique.mockResolvedValue(null);
      prisma.horse.count.mockResolvedValue(0);

      const createdMock = {
        id: 'h-1',
        horseCode: 'HR-000001',
        name: 'Thunderbolt',
        breed: 'Thoroughbred',
        dob: new Date('2021-01-01'),
        gender: 'Colt',
        color: 'Bay',
        microchip: '123456789012345',
        microchipRfid: '123456789012345',
        status: HorseStatus.PENDING_ADMISSION,
        isMedicalLocked: false,
        stallAllocations: [],
      };
      prisma.horse.create.mockResolvedValue(createdMock);

      const res = await service.create(
        {
          name: 'Thunderbolt',
          breed: 'Thoroughbred',
          dob: '2021-01-01',
          weightKg: 490,
          gender: 'Colt',
          color: 'Bay',
          microchip: '123456789012345',
          ownerId: 'owner-1',
        },
        mockManager,
      );

      expect(res.horseCode).toBe('HR-000001');
      expect(res.status).toBe(HorseStatus.PENDING_ADMISSION);
      expect(prisma.horseAdmissionRecord.create).toHaveBeenCalled();
      expect(prisma.admissionHistoryLog.create).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalled();
    });

    it('should reject horse older than 12 years (INVALID_DOB)', async () => {
      await expect(
        service.create(
          {
            name: 'Old Horse',
            breed: 'Thoroughbred',
            dob: '2010-01-01',
            weightKg: 490,
            gender: 'Stallion',
            color: 'Bay',
            microchip: '123456789012345',
            ownerId: 'owner-1',
          },
          mockManager,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_DOB' }),
      });
    });

    it('should reject future date of birth (INVALID_DOB)', async () => {
      await expect(
        service.create(
          {
            name: 'Future Horse',
            breed: 'Thoroughbred',
            dob: '2099-01-01',
            weightKg: 490,
            gender: 'Stallion',
            color: 'Bay',
            microchip: '123456789012345',
            ownerId: 'owner-1',
          },
          mockManager,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_DOB' }),
      });
    });

    it('should reject if microchip is missing (MICROCHIP_REQUIRED)', async () => {
      await expect(
        service.create(
          {
            name: 'No Chip Horse',
            breed: 'Thoroughbred',
            dob: '2023-01-01',
            weightKg: 490,
            gender: 'Stallion',
            color: 'Bay',
            microchip: '',
            ownerId: 'owner-1',
          },
          mockManager,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'MICROCHIP_REQUIRED' }),
      });
    });

    it('registers the horse for the signed-in owner and leaves stall assignment to the club', async () => {
      prisma.horse.findFirst.mockResolvedValue(null);
      prisma.horse.findUnique.mockResolvedValue(null);
      prisma.horse.create.mockResolvedValue({ id: 'h-2', name: 'Gió Bấc', stallAllocations: [] });

      await service.create(
        {
          name: 'Gió Bấc',
          breed: 'Thoroughbred',
          dob: '2021-01-01',
          weightKg: 490,
          gender: 'Colt',
          color: 'Bay',
          microchip: '123456789012346',
          ownerId: 'someone-else',
        },
        mockOwner,
      );

      const data = prisma.horse.create.mock.calls[0][0].data;
      expect(data.ownerId).toBe('owner-1');
      expect(data.stallAllocations).toBeUndefined();
    });

    it('should reject creating horse for an owner flagged with bad debt', async () => {
      prisma.horse.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'bad-owner',
        role: Role.HORSE_OWNER,
        status: UserStatus.ACTIVE,
        isBadDebtFlagged: true,
      });

      await expect(
        service.create(
          {
            name: 'New Horse',
            breed: 'Thoroughbred',
            dob: '2021-01-01',
            weightKg: 490,
            gender: 'Colt',
            color: 'Bay',
            microchip: '123456789012346',
            ownerId: 'bad-owner',
          },
          mockManager,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OWNER_BAD_DEBT' }),
      });
    });

    it('should reject creating horse if owner has invalid role (INVALID_OWNER_ROLE)', async () => {
      prisma.horse.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'not-an-owner',
        role: Role.GROOM,
        status: UserStatus.ACTIVE,
        isBadDebtFlagged: false,
      });

      await expect(
        service.create(
          {
            name: 'New Horse',
            breed: 'Thoroughbred',
            dob: '2021-01-01',
            weightKg: 490,
            gender: 'Colt',
            color: 'Bay',
            microchip: '123456789012346',
            ownerId: 'not-an-owner',
          },
          mockManager,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_OWNER_ROLE' }),
      });
    });

    it('should reject creating horse if owner is inactive (OWNER_INACTIVE)', async () => {
      prisma.horse.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'inactive-owner',
        role: Role.HORSE_OWNER,
        status: UserStatus.INACTIVE,
        isBadDebtFlagged: false,
      });

      await expect(
        service.create(
          {
            name: 'New Horse',
            breed: 'Thoroughbred',
            dob: '2021-01-01',
            weightKg: 490,
            gender: 'Colt',
            color: 'Bay',
            microchip: '123456789012346',
            ownerId: 'inactive-owner',
          },
          mockManager,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OWNER_INACTIVE' }),
      });
    });

    it('should throw 409 DUPLICATE_NAME if horse name exists', async () => {
      prisma.horse.findFirst
        .mockResolvedValueOnce(null) // microchip check ok
        .mockResolvedValueOnce({ id: 'h-existing', name: 'Thunderbolt' }); // name check duplicate

      await expect(
        service.create(
          {
            name: 'Thunderbolt',
            breed: 'Thoroughbred',
            dob: '2021-01-01',
            weightKg: 490,
            gender: 'Colt',
            color: 'Bay',
            microchip: '123456789012345',
            ownerId: 'owner-1',
          },
          mockManager,
        ),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: expect.objectContaining({ code: 'DUPLICATE_NAME' }),
      });
    });

    it('should throw 409 DUPLICATE_MICROCHIP if microchip exists', async () => {
      prisma.horse.findFirst.mockResolvedValueOnce({
        id: 'h-existing',
        name: 'Existing Horse',
        microchip: '123456789012345',
        ownerId: 'diff-owner',
        status: HorseStatus.ACTIVE,
      });

      await expect(
        service.create(
          {
            name: 'New Horse',
            breed: 'Thoroughbred',
            dob: '2021-01-01',
            weightKg: 490,
            gender: 'Colt',
            color: 'Bay',
            microchip: '123456789012345',
            ownerId: 'owner-1',
          },
          mockManager,
        ),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: expect.objectContaining({ code: 'DUPLICATE_MICROCHIP' }),
      });
    });
  });

  describe('findOne and Role Policy', () => {
    it('should mask microchip with last 4 digits for GROOM', async () => {
      const horse = {
        id: 'h-1',
        name: 'Thunderbolt',
        microchip: '123456789012345',
        microchipRfid: '123456789012345',
        stallAllocations: [
          { stall: { zoneId: 'zone-a' }, assignedGroomUserId: 'groom-1', isActive: true },
        ],
      };
      prisma.horse.findUnique.mockResolvedValue(horse);
      prisma.shiftRoster = { findMany: jest.fn().mockResolvedValue([{ zoneId: 'zone-a' }]) };

      const res = await service.findOne('h-1', mockGroom);
      expect(res.microchip).toBe('***********2345');
      expect(res.microchipRfid).toBe('***********2345');
    });

    it('does not expose an unassigned horse merely because the Groom is rostered in its zone', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        id: 'h-1',
        stallAllocations: [
          { isActive: true, assignedGroomUserId: 'other', stall: { zoneId: 'zone-a' } },
        ],
      });
      prisma.dailyCareTask.findFirst = jest.fn().mockResolvedValue(null);
      await expect(service.findOne('h-1', mockGroom)).rejects.toMatchObject({
        response: { code: 'HORSE_NOT_FOUND' },
      });
    });
    it('allows a receiving Groom to view the horse assigned through the daily checklist', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        id: 'h-1',
        microchip: '123456789012345',
        stallAllocations: [{ isActive: true, assignedGroomUserId: 'other' }],
      });
      prisma.dailyCareTask.findFirst = jest.fn().mockResolvedValue({ id: 'handover' });
      await expect(service.findOne('h-1', mockGroom)).resolves.toMatchObject({
        id: 'h-1',
        microchip: '***********2345',
      });
    });

    it('should expose stallCode and hide raw stallAllocations for HORSE_OWNER', async () => {
      const horse = {
        id: 'h-1',
        name: 'Thunderbolt',
        ownerId: 'owner-1',
        microchip: '123456789012345',
        stallAllocations: [{ stall: { code: 'A-01', zone: 'Zone 1' }, isActive: true }],
      };
      prisma.horse.findUnique.mockResolvedValue(horse);

      const res = await service.findOne('h-1', mockOwner);
      expect(res.stallCode).toBe('A-01');
      expect(res.stallAllocations).toBeUndefined();
    });

    it('should throw 404 if Owner accesses horse they do not own', async () => {
      const horse = {
        id: 'h-2',
        name: 'Other Horse',
        ownerId: 'owner-999',
        stallAllocations: [],
      };
      prisma.horse.findUnique.mockResolvedValue(horse);

      await expect(service.findOne('h-2', mockOwner)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: expect.objectContaining({ code: 'HORSE_NOT_FOUND' }),
      });
    });
  });

  describe('remove (soft delete)', () => {
    const cleanHorse = {
      id: 'h-clean',
      name: 'Clean Horse',
      horseCode: 'HR-000009',
      isMedicalLocked: false,
      workoutSessions: [],
      trainingPlans: [],
      medicalRecords: [],
      injuryLogs: [],
      medicalLocks: [],
      preventiveSchedules: [],
      nutritionPlans: [],
      dailyGroomingLogs: [],
      tournamentRegistrations: [],
      financialInvoices: [],
    };
    const dto = { reason: 'Hồ sơ tạo nhầm, trùng ngựa khác', confirmName: '  clean   HORSE ' };

    it('should mark deletedAt, free the stall and keep the row (no hard delete)', async () => {
      prisma.horse.findUnique.mockResolvedValue(cleanHorse);
      prisma.stallAllocation.findMany.mockResolvedValue([
        { stallId: 'st-1', stall: { id: 'st-1', code: 'A-01' } },
      ]);
      prisma.horse.update.mockResolvedValue({ ...cleanHorse, deletedAt: new Date() });

      const res = await lifecycle.remove('h-clean', dto, mockManager);

      expect(res.success).toBe(true);
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.horse.delete).not.toHaveBeenCalled();
      expect(prisma.horse.update).toHaveBeenCalledWith({
        where: { id: 'h-clean' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          deletedById: 'manager-1',
          deleteReason: 'Hồ sơ tạo nhầm, trùng ngựa khác',
        }),
      });
      expect(prisma.stall.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['st-1'] } },
        data: { status: 'AVAILABLE' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        'HORSE_DELETED',
        expect.stringContaining('Soft-deleted'),
        'h-clean',
        expect.objectContaining({ entityName: 'Horse' }),
        prisma,
      );
    });

    it('should throw 400 CONFIRM_NAME_MISMATCH when the typed name is different', async () => {
      prisma.horse.findUnique.mockResolvedValue(cleanHorse);

      await expect(
        lifecycle.remove('h-clean', { ...dto, confirmName: 'Other Horse' }, mockManager),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: expect.objectContaining({ code: 'CONFIRM_NAME_MISMATCH' }),
      });
      expect(prisma.horse.update).not.toHaveBeenCalled();
    });

    it('should throw 400 HAS_DEPENDENT_DATA if horse has grooming, medical or training data', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        ...cleanHorse,
        dailyGroomingLogs: [{ id: 'g' }],
      });

      await expect(lifecycle.remove('h-clean', dto, mockManager)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: expect.objectContaining({ code: 'HAS_DEPENDENT_DATA' }),
      });
    });

    it('should throw 400 HORSE_LOCKED if horse is medical locked', async () => {
      prisma.horse.findUnique.mockResolvedValue({ ...cleanHorse, isMedicalLocked: true });

      await expect(lifecycle.remove('h-clean', dto, mockManager)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: expect.objectContaining({ code: 'HORSE_LOCKED' }),
      });
    });
  });

  describe('restore', () => {
    const deletedHorse = {
      id: 'h-del',
      name: 'Sao Mai',
      horseCode: 'HR-000010',
      deletedAt: new Date(),
      deletedById: 'manager-1',
      deleteReason: 'Tạo nhầm hồ sơ',
    };

    it('should undo a delete made seconds ago with the automatic reason', async () => {
      prisma.horse.findUnique.mockResolvedValue(deletedHorse);
      prisma.horse.findFirst.mockResolvedValue(null);
      prisma.horse.update.mockResolvedValue({ ...deletedHorse, deletedAt: null });

      const res = await lifecycle.restore('h-del', { undo: true }, mockManager);

      expect(res.success).toBe(true);
      expect(prisma.horse.update).toHaveBeenCalledWith({
        where: { id: 'h-del' },
        data: { deletedAt: null, deletedById: null, deleteReason: null },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        'HORSE_RESTORED',
        expect.stringContaining('Hoàn tác thao tác xóa'),
        'h-del',
        expect.objectContaining({ entityName: 'Horse' }),
        prisma,
      );
    });

    it('should refuse undo after the undo window (UNDO_EXPIRED)', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        ...deletedHorse,
        deletedAt: new Date(Date.now() - 5 * 60 * 1000),
      });

      await expect(lifecycle.restore('h-del', { undo: true }, mockManager)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'UNDO_EXPIRED' }),
      });
    });

    it('should require a reason for a normal restore', async () => {
      prisma.horse.findUnique.mockResolvedValue(deletedHorse);

      await expect(lifecycle.restore('h-del', {}, mockManager)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'REASON_REQUIRED' }),
      });
    });

    it('should throw 409 RESTORE_CONFLICT when another active horse now uses the name', async () => {
      prisma.horse.findUnique.mockResolvedValue(deletedHorse);
      prisma.horse.findFirst.mockResolvedValue({ id: 'h-other', name: 'sao mai' });

      await expect(
        lifecycle.restore('h-del', { reason: 'Xóa nhầm, cần khôi phục lại' }, mockManager),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: expect.objectContaining({ code: 'RESTORE_CONFLICT' }),
      });
    });

    it('should throw 404 when the horse is not in the deleted list', async () => {
      prisma.horse.findUnique.mockResolvedValue({ ...deletedHorse, deletedAt: null });

      await expect(
        lifecycle.restore('h-del', { reason: 'Xóa nhầm, cần khôi phục lại' }, mockManager),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });
  });

  describe('findDeleted', () => {
    it('should list only soft-deleted horses, newest first, with an inclusive date range', async () => {
      prisma.horse.findMany.mockResolvedValue([
        {
          ...{ id: 'h-del', name: 'Sao Mai', horseCode: 'HR-000010', microchip: '1' },
          status: HorseStatus.RESTING,
          deletedAt: new Date('2026-10-01T03:00:00Z'),
          deletedBy: { id: 'manager-1', fullName: 'Manager User' },
          deleteReason: 'Tạo nhầm hồ sơ',
        },
      ]);
      prisma.horse.count.mockResolvedValue(1);

      const res = await lifecycle.findDeleted({ from: '2026-10-01', to: '2026-10-01' });

      expect(res.total).toBe(1);
      expect(res.items[0].deletedBy).toEqual({ id: 'manager-1', fullName: 'Manager User' });
      const args = prisma.horse.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual({ deletedAt: 'desc' });
      expect(args.where.deletedAt).toEqual({
        not: null,
        gte: new Date('2026-10-01'),
        lt: new Date('2026-10-02'),
      });
    });
  });

  describe('changeStatus', () => {
    const mockTrainer: CurrentUserPayload = {
      userId: 'ht-1',
      email: 'ht@gmail.com',
      fullName: 'Head Trainer',
      role: UserRole.HEAD_TRAINER,
    };
    const base = {
      id: 'h-1',
      name: 'Thunder',
      status: HorseStatus.IN_TRAINING,
      isMedicalLocked: false,
      ownerId: 'owner-1',
      retireReason: null,
    };

    it('HT can move IN_TRAINING -> ACTIVE without a reason', async () => {
      prisma.horse.findUnique.mockResolvedValue(base);
      prisma.horse.update.mockResolvedValue({ ...base, status: HorseStatus.ACTIVE });

      const res = await lifecycle.changeStatus('h-1', { status: HorseStatus.ACTIVE }, mockTrainer);

      expect(res.success).toBe(true);
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        'HORSE_STATUS_CHANGED',
        expect.any(String),
        'h-1',
        expect.objectContaining({
          entityName: 'Horse',
          newValues: expect.objectContaining({ oldStatus: 'IN_TRAINING', newStatus: 'ACTIVE' }),
        }),
        prisma,
      );
    });

    it('CM can no longer set operational statuses directly (ROLE_RESTRICTION)', async () => {
      prisma.horse.findUnique.mockResolvedValue(base);

      await expect(
        lifecycle.changeStatus(
          'h-1',
          { status: HorseStatus.RESTING, reason: 'Cho ngựa nghỉ một tuần' },
          mockManager,
        ),
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ROLE_RESTRICTION' }) });
    });

    it('CM retiring as SOLD frees the stall and ends ownership', async () => {
      prisma.horse.findUnique.mockResolvedValue(base);
      prisma.stallAllocation.findMany.mockResolvedValue([
        { stallId: 'st-1', stall: { id: 'st-1', code: 'A-01' } },
      ]);
      prisma.horse.update.mockResolvedValue({ ...base, status: HorseStatus.RETIRED });

      const res = await lifecycle.changeStatus(
        'h-1',
        { status: HorseStatus.RETIRED, retireReason: 'SOLD', reason: 'Đã bán cho CLB Phú Thọ' },
        mockManager,
      );

      expect(prisma.horse.update).toHaveBeenCalledWith({
        where: { id: 'h-1' },
        data: { status: 'RETIRED', retireReason: 'SOLD', owner: { disconnect: true } },
      });
      expect(prisma.stall.updateMany).toHaveBeenCalled();
      expect(res.effects).toEqual(['Trả ô chuồng A-01', 'Kết thúc sở hữu của 1 chủ sở hữu']);
    });

    it('retiring cancels draft / active training plans and pending workouts (Flow 2)', async () => {
      prisma.horse.findUnique.mockResolvedValue(base);
      prisma.trainingPlan.updateMany.mockResolvedValue({ count: 1 });
      prisma.horse.update.mockResolvedValue({ ...base, status: HorseStatus.RETIRED });

      const res = await lifecycle.changeStatus(
        'h-1',
        { status: HorseStatus.RETIRED, retireReason: 'RETIRED', reason: 'Giải nghệ sau mùa giải' },
        mockManager,
      );

      expect(prisma.trainingPlan.updateMany).toHaveBeenCalledWith({
        where: { horseId: 'h-1', status: { in: ['DRAFT', 'ACTIVE'] } },
        data: { status: 'CANCELLED', cancelReason: 'Ngựa ngừng quản lý' },
      });
      expect(prisma.workoutSession.updateMany).toHaveBeenCalledWith({
        where: { horseId: 'h-1', status: { in: ['SCHEDULED', 'BLOCKED', 'MISSED'] } },
        data: { status: 'CANCELLED', statusReason: 'Ngựa ngừng quản lý' },
      });
      expect(res.effects).toContain('Hủy 1 giáo án và các buổi tập chưa diễn ra');
    });

    it('CM retiring a locked horse as DECEASED also ends the training lock', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        ...base,
        status: HorseStatus.INJURED,
        isMedicalLocked: true,
      });
      prisma.horse.update.mockResolvedValue({ ...base, status: HorseStatus.RETIRED });

      await lifecycle.changeStatus(
        'h-1',
        {
          status: HorseStatus.RETIRED,
          retireReason: 'DECEASED',
          reason: 'Ngựa chết do biến chứng',
        },
        mockManager,
      );

      expect(prisma.medicalLock.updateMany).toHaveBeenCalledWith({
        where: { horseId: 'h-1', isLocked: true },
        data: expect.objectContaining({ isLocked: false }),
      });
      expect(prisma.horse.update).toHaveBeenCalledWith({
        where: { id: 'h-1' },
        data: expect.objectContaining({ isMedicalLocked: false, retireReason: 'DECEASED' }),
      });
    });

    it('CM reactivation clears retireReason and goes back to RESTING', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        ...base,
        status: HorseStatus.RETIRED,
        retireReason: 'RETIRED',
      });
      prisma.horse.update.mockResolvedValue({ ...base, status: HorseStatus.RESTING });

      await lifecycle.changeStatus(
        'h-1',
        { status: HorseStatus.RESTING, reason: 'Ngựa quay lại thi đấu mùa sau' },
        mockManager,
      );

      expect(prisma.horse.update).toHaveBeenCalledWith({
        where: { id: 'h-1' },
        data: { status: 'RESTING', retireReason: null },
      });
    });

    it('should return 404 for a soft-deleted horse', async () => {
      prisma.horse.findUnique.mockResolvedValue(null);

      await expect(
        lifecycle.changeStatus('h-1', { status: HorseStatus.ACTIVE }, mockTrainer),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
      expect(prisma.horse.findUnique).toHaveBeenCalledWith({
        where: { id: 'h-1', deletedAt: null },
      });
    });
  });

  describe('getHistory', () => {
    it('should aggregate unified history and timeline correctly', async () => {
      const mockHistoryHorse = {
        id: 'h-1',
        horseCode: 'HR-000001',
        name: 'Thunderbolt Swift',
        breed: 'Thoroughbred',
        status: HorseStatus.ACTIVE,
        isMedicalLocked: false,
        createdAt: new Date('2026-01-01'),
        owner: { id: 'owner-1', fullName: 'Owner User' },
        stallAllocations: [
          {
            id: 'sa-1',
            stall: { code: 'STALL-A01', zone: 'Zone A' },
            assignedGroom: { fullName: 'Groom User' },
            startDate: new Date('2026-01-02'),
            endDate: null,
            isActive: true,
          },
        ],
        medicalRecords: [
          {
            id: 'mr-1',
            examinationDate: new Date('2026-02-01'),
            clinicalDiagnosis: 'Mild tendon sensitivity',
            symptoms: 'Heat in foreleg',
            treatmentProtocol: 'Cold compress',
            veterinarian: { fullName: 'Dr. Sarah Connor' },
          },
        ],
        injuryLogs: [],
        incidents: [
          {
            id: 'incident-1',
            incidentNumber: 'INC-20260201-0001',
            description: 'Simulator fracture',
            severity: 'CRITICAL',
            status: 'REPORTED',
            createdAt: new Date('2026-02-01'),
          },
        ],
        medicalLocks: [
          {
            id: 'ml-1',
            lockCode: 'KH-000001',
            lockedAt: new Date('2026-02-01'),
            lockReason: 'Rest period',
            isLocked: false,
            unlockedAt: new Date('2026-02-10'),
            unlockReason: 'Recovered',
            veterinarian: { fullName: 'Dr. Sarah Connor' },
            unlockVet: { fullName: 'Dr. Sarah Connor' },
          },
        ],
        trainingPlans: [
          {
            id: 'tp-1',
            phaseName: 'Base Conditioning',
            targetSpeed: 40,
            targetDistance: 1200,
            trackSurface: 'TURF',
            startDate: new Date('2026-03-01'),
            endDate: new Date('2026-03-30'),
            status: 'APPROVED',
            createdAt: new Date('2026-03-01'),
            trainer: { fullName: 'David Nguyen' },
            workoutSessions: [{ status: 'COMPLETED' }],
          },
        ],
        tournamentRegistrations: [],
      };

      prisma.horse.findUnique.mockResolvedValue(mockHistoryHorse);
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'aud-1',
          action: 'HORSE_STATUS_CHANGED',
          timestamp: new Date('2026-02-01'),
          user: { fullName: 'Dr. Sarah Connor' },
          newValuesJson: JSON.stringify({ oldStatus: 'ACTIVE', newStatus: 'UNDER_OBSERVATION' }),
        },
        {
          id: 'aud-2',
          action: 'HORSE_STATUS_CHANGED',
          timestamp: new Date('2026-02-10'),
          user: { fullName: 'Dr. Sarah Connor' },
          newValuesJson: JSON.stringify({
            oldStatus: 'INJURED',
            newStatus: 'RESTING',
            reason: 'Recovered',
            source: 'MEDICAL_LOCK',
          }),
        },
      ]);

      const result = await history.getHistory('h-1', mockManager);
      expect(result).toBeDefined();
      expect(result.horse.name).toBe('Thunderbolt Swift');
      // Lịch sử trạng thái lấy từ nhật ký của ngựa; lần đổi do Khóa huấn luyện có nguồn riêng (CL-1.08).
      expect(result.statusHistory.map((h) => h.source)).toEqual(['MANUAL', 'MEDICAL_LOCK']);
      expect(result.statusHistory[1]).toMatchObject({ oldStatus: 'INJURED', newStatus: 'RESTING' });
      expect(result.stallHistory).toHaveLength(1);
      expect(result.medicalHistory.records).toHaveLength(1);
      expect(result.simulatorIncidents).toEqual(mockHistoryHorse.incidents);
      expect(result.horse).not.toHaveProperty('incidents');
      expect(result.trainingHistory).toHaveLength(1);
      const categories = new Set(result.timeline.map((t) => t.category));
      expect([...categories]).toEqual(
        expect.arrayContaining(['IDENTITY', 'STATUS', 'STALL', 'MEDICAL', 'TRAINING']),
      );
      expect(result.timeline.find((t) => t.id === 'med-mr-1')?.link).toBe('/medical/records/mr-1');
    });

    it('should hide stall events from the owner timeline', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        id: 'h-1',
        name: 'Thunderbolt Swift',
        breed: 'Thoroughbred',
        ownerId: mockOwner.userId,
        createdAt: new Date('2026-01-01'),
        stallAllocations: [
          {
            id: 'sa-1',
            stall: { code: 'STALL-A01', zone: 'Zone A' },
            startDate: new Date('2026-01-02'),
            endDate: null,
            isActive: true,
          },
        ],
        medicalRecords: [],
        injuryLogs: [],
        medicalLocks: [],
        trainingPlans: [],
        tournamentRegistrations: [],
      });

      const result = await history.getHistory('h-1', mockOwner);
      expect(prisma.horse.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ include: expect.objectContaining({ incidents: false }) }),
      );
      expect(result.simulatorIncidents).toEqual([]);
      expect(result.timeline.some((t) => t.category === 'STALL')).toBe(false);
      expect(result.stallHistory).toEqual([]);
    });

    it('should throw 404 HORSE_NOT_FOUND if horse does not exist', async () => {
      prisma.horse.findUnique.mockResolvedValue(null);
      await expect(history.getHistory('non-existent', mockManager)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  describe('findAll - ownership scope', () => {
    it('should scope query to ownerId for HORSE_OWNER', async () => {
      prisma.horse.findMany.mockResolvedValue([]);
      prisma.horse.count.mockResolvedValue(0);

      await service.findAll({}, mockOwner);

      expect(prisma.horse.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            ownerId: mockOwner.userId,
          }),
        }),
      );
      expect(prisma.horse.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            ownerId: mockOwner.userId,
          }),
        }),
      );
    });

    it('should preserve GROOM assigned-only scope even when search query is provided', async () => {
      prisma.horse.findMany.mockResolvedValue([]);
      prisma.horse.count.mockResolvedValue(0);

      await service.findAll({ search: 'Thunder' }, mockGroom);

      const callWhere = prisma.horse.findMany.mock.calls[0][0].where;
      expect(Array.isArray(callWhere.AND)).toBe(true);
      expect(callWhere.AND).toHaveLength(2);
      expect(callWhere.AND[0].OR).toEqual([
        { stallAllocations: { some: { isActive: true, assignedGroomUserId: mockGroom.userId } } },
        {
          dailyCareTasks: {
            some: {
              date: expect.any(Date),
              assignedGroomUserId: mockGroom.userId,
              cancelledAt: null,
            },
          },
        },
      ]);
      expect(callWhere.AND[1].OR).toEqual(
        expect.arrayContaining([{ name: { contains: 'Thunder', mode: 'insensitive' } }]),
      );
    });
  });

  describe('findOne - ownership isolation', () => {
    it('should return horse details when accessed by its owner', async () => {
      const ownedHorse = {
        id: 'h-1',
        name: 'Thunderbolt Swift',
        ownerId: mockOwner.userId,
        microchip: '123456789012345',
        microchipRfid: '123456789012345',
        status: HorseStatus.ACTIVE,
        stallAllocations: [],
        medicalLocks: [],
      };
      prisma.horse.findUnique.mockResolvedValue(ownedHorse);

      const result = await service.findOne('h-1', mockOwner);
      expect(result.id).toBe('h-1');
      expect(result.name).toBe('Thunderbolt Swift');
    });

    it('should throw 404 HORSE_NOT_FOUND without data leakage when owner accesses a foreign horse', async () => {
      const foreignHorse = {
        id: 'h-foreign',
        name: 'Ironclad Titan',
        ownerId: 'different-owner-id',
        status: HorseStatus.ACTIVE,
        stallAllocations: [],
        medicalLocks: [],
      };
      prisma.horse.findUnique.mockResolvedValue(foreignHorse);

      await expect(service.findOne('h-foreign', mockOwner)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: expect.objectContaining({
          code: 'HORSE_NOT_FOUND',
          message: 'Không tìm thấy hồ sơ ngựa hoặc bạn không có quyền xem.',
        }),
      });
    });
  });

  describe('admissions pipeline and business rules (ADM-01, ADM-02, ADM-03)', () => {
    describe('create & reapply flow', () => {
      it('prevents chip takeover when microchip belongs to another owner', async () => {
        prisma.horse.findFirst.mockResolvedValue({
          id: 'h-other',
          ownerId: 'another-owner-id',
          microchip: '985111111111111',
          deletedAt: null,
          status: HorseStatus.RESTING,
        });

        await expect(
          service.create(
            {
              name: 'Duplicate Chip Horse',
              breed: 'Thoroughbred',
              dob: '2022-01-01',
              gender: 'Colt',
              color: 'Bay',
              weightKg: 480,
              microchip: '985111111111111',
              ownerId: mockOwner.userId,
            },
            mockOwner,
          ),
        ).rejects.toMatchObject({
          status: HttpStatus.CONFLICT,
          response: expect.objectContaining({
            code: 'DUPLICATE_MICROCHIP',
          }),
        });
      });

      it('rejects reapply if the horse was soft-deleted', async () => {
        prisma.horse.findFirst.mockResolvedValue({
          id: 'h-deleted',
          ownerId: mockOwner.userId,
          microchip: '985222222222222',
          deletedAt: new Date(),
          status: HorseStatus.REJECTED,
        });

        await expect(
          service.create(
            {
              name: 'Deleted Reapply Horse',
              breed: 'Thoroughbred',
              dob: '2022-01-01',
              gender: 'Colt',
              color: 'Bay',
              weightKg: 480,
              microchip: '985222222222222',
              ownerId: mockOwner.userId,
            },
            mockOwner,
          ),
        ).rejects.toMatchObject({
          status: HttpStatus.CONFLICT,
          response: expect.objectContaining({
            code: 'DUPLICATE_MICROCHIP',
          }),
        });
      });

      it('blocks reapply if horse already has an active admission in progress', async () => {
        prisma.horse.findFirst.mockResolvedValue({
          id: 'h-pending',
          ownerId: mockOwner.userId,
          microchip: '985333333333333',
          deletedAt: null,
          status: HorseStatus.PENDING_ADMISSION,
        });
        prisma.horseAdmissionRecord.count.mockResolvedValue(1);

        await expect(
          service.create(
            {
              name: 'Active Admission Horse',
              breed: 'Thoroughbred',
              dob: '2022-01-01',
              gender: 'Colt',
              color: 'Bay',
              weightKg: 480,
              microchip: '985333333333333',
              ownerId: mockOwner.userId,
            },
            mockOwner,
          ),
        ).rejects.toMatchObject({
          status: HttpStatus.CONFLICT,
          response: expect.objectContaining({
            code: 'ACTIVE_ADMISSION_EXISTS',
          }),
        });
      });

      it('allows reapply for same owner when previous record was REJECTED', async () => {
        const rejectedHorse = {
          id: 'h-rejected',
          horseCode: 'HR-000099',
          name: 'Phoenix Dawn',
          ownerId: mockOwner.userId,
          microchip: '985444444444444',
          microchipRfid: '985444444444444',
          deletedAt: null,
          status: HorseStatus.REJECTED,
          breed: 'Thoroughbred',
          dob: new Date('2022-01-01'),
          gender: 'Stallion',
          color: 'Chestnut',
        };
        prisma.horse.findFirst.mockResolvedValue(rejectedHorse);
        prisma.horseAdmissionRecord.count.mockResolvedValue(0);
        prisma.horse.update.mockResolvedValue({
          ...rejectedHorse,
          status: HorseStatus.PENDING_ADMISSION,
        });

        const res = await service.create(
          {
            name: 'Phoenix Dawn',
            breed: 'Thoroughbred',
            dob: '2022-01-01',
            gender: 'Stallion',
            color: 'Chestnut',
            weightKg: 480,
            microchip: '985444444444444',
            ownerId: mockOwner.userId,
          },
          mockOwner,
        );

        expect(res.status).toBe(HorseStatus.PENDING_ADMISSION);
        expect(prisma.horse.update).toHaveBeenCalled();
        expect(prisma.horseAdmissionRecord.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              horseId: 'h-rejected',
              ownerId: mockOwner.userId,
              status: AdmissionStatus.PENDING_VERIFICATION,
            }),
          }),
        );
        expect(businessMail.emit).toHaveBeenCalledWith(
          expect.objectContaining({
            eventCode: 'ADMISSION_REQUEST_RECEIVED',
            recipients: expect.arrayContaining([
              expect.objectContaining({
                userId: mockOwner.userId,
                body: expect.objectContaining({
                  refId: 'adm-1',
                  milestone: 'reapply-adm-1',
                }),
              }),
            ]),
          }),
        );
      });

      it('allows reapply for same owner when previous record was CANCELLED', async () => {
        const cancelledHorse = {
          id: 'h-cancelled',
          horseCode: 'HR-000098',
          name: 'Solar Flare',
          ownerId: mockOwner.userId,
          microchip: '985555555555555',
          microchipRfid: '985555555555555',
          deletedAt: null,
          status: HorseStatus.PENDING_ADMISSION,
          breed: 'Thoroughbred',
          dob: new Date('2022-01-01'),
          gender: 'Colt',
          color: 'Bay',
        };
        prisma.horse.findFirst.mockResolvedValue(cancelledHorse);
        prisma.horseAdmissionRecord.count.mockResolvedValue(0); // Không còn admission active (trước đó là CANCELLED)
        prisma.horse.update.mockResolvedValue({
          ...cancelledHorse,
          status: HorseStatus.PENDING_ADMISSION,
        });

        const res = await service.create(
          {
            name: 'Solar Flare',
            breed: 'Thoroughbred',
            dob: '2022-01-01',
            gender: 'Colt',
            color: 'Bay',
            weightKg: 490,
            microchip: '985555555555555',
            ownerId: mockOwner.userId,
          },
          mockOwner,
        );

        expect(res.status).toBe(HorseStatus.PENDING_ADMISSION);
        expect(prisma.horse.update).toHaveBeenCalled();
        expect(prisma.horseAdmissionRecord.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              horseId: 'h-cancelled',
              ownerId: mockOwner.userId,
              status: AdmissionStatus.PENDING_VERIFICATION,
            }),
          }),
        );
      });

      it('maps genuine microchip P2002 conflict to 409 ACTIVE_ADMISSION_EXISTS when horse has active admission', async () => {
        prisma.horse.findFirst
          .mockResolvedValueOnce(null) // chip check ban đầu
          .mockResolvedValueOnce(null); // name check ban đầu
        prisma.horse.create.mockRejectedValueOnce({
          code: 'P2002',
          meta: { target: ['microchip'] },
        });
        // Sau conflict, service query horse & active count
        prisma.horse.findFirst.mockResolvedValueOnce({
          id: 'h-conflict',
          ownerId: 'diff-owner',
        });
        prisma.horseAdmissionRecord.count.mockResolvedValueOnce(1); // Có active admission

        await expect(
          service.create(
            {
              name: 'Racing Chip Horse',
              breed: 'Thoroughbred',
              dob: '2022-01-01',
              gender: 'Colt',
              color: 'Bay',
              weightKg: 490,
              microchip: '985666666666666',
              ownerId: mockOwner.userId,
            },
            mockOwner,
          ),
        ).rejects.toMatchObject({
          status: HttpStatus.CONFLICT,
          response: expect.objectContaining({ code: 'ACTIVE_ADMISSION_EXISTS' }),
        });
      });

      it('maps genuine microchip P2002 conflict to 409 DUPLICATE_MICROCHIP when no active admission', async () => {
        prisma.horse.findFirst
          .mockResolvedValueOnce(null) // chip check ban đầu
          .mockResolvedValueOnce(null); // name check ban đầu
        prisma.horse.create.mockRejectedValueOnce({
          code: 'P2002',
          meta: { target: ['microchipRfid'] },
        });
        prisma.horse.findFirst.mockResolvedValueOnce({
          id: 'h-conflict-2',
          ownerId: 'diff-owner',
        });
        prisma.horseAdmissionRecord.count.mockResolvedValueOnce(0);

        await expect(
          service.create(
            {
              name: 'Racing Chip Horse 2',
              breed: 'Thoroughbred',
              dob: '2022-01-01',
              gender: 'Colt',
              color: 'Bay',
              weightKg: 490,
              microchip: '985777777777777',
              ownerId: mockOwner.userId,
            },
            mockOwner,
          ),
        ).rejects.toMatchObject({
          status: HttpStatus.CONFLICT,
          response: expect.objectContaining({ code: 'DUPLICATE_MICROCHIP' }),
        });
      });

      it('rethrows raw P2002 on horseCode without mislabeling as microchip conflict', async () => {
        prisma.horse.findFirst
          .mockResolvedValueOnce(null) // chip check ban đầu
          .mockResolvedValueOnce(null); // name check ban đầu
        const codeConflictError = {
          code: 'P2002',
          meta: { target: ['horseCode'] },
        };
        prisma.horse.create.mockRejectedValueOnce(codeConflictError);

        await expect(
          service.create(
            {
              name: 'Code Collision Horse',
              breed: 'Thoroughbred',
              dob: '2022-01-01',
              gender: 'Colt',
              color: 'Bay',
              weightKg: 490,
              microchip: '985888888888888',
              ownerId: mockOwner.userId,
            },
            mockOwner,
          ),
        ).rejects.toEqual(codeConflictError);
      });
    });

    describe('scheduleAdmission', () => {
      it('schedules appointment, logs history and emits email with refId and appointment milestone', async () => {
        const appointmentDate = new Date(Date.now() + 86400000).toISOString();
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-10',
          admissionCode: 'ADM-2026-010',
          horseId: 'h-10',
          ownerId: mockOwner.userId,
          status: AdmissionStatus.PENDING_VERIFICATION,
          horse: { id: 'h-10', name: 'Thunder Storm', horseCode: 'HR-000010' },
          owner: { id: mockOwner.userId, fullName: 'Owner User', email: 'owner@gmail.com' },
        });

        const res = await service.scheduleAdmission(
          'adm-10',
          { appointmentDate, veterinarianUserId: 'vet-1', appointmentNotes: 'Cổng tiếp nhận A' },
          mockManager,
        );

        expect(res.status).toBe(AdmissionStatus.APPOINTED);
        const notificationService = (
          service as unknown as { notifications: { notifyUsers: jest.Mock } }
        ).notifications;
        expect(notificationService.notifyUsers).toHaveBeenCalledWith(
          ['vet-1'],
          expect.objectContaining({
            link: '/medical/admissions?inspection=adm-10',
          }),
        );
        expect(prisma.horseAdmissionRecord.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: AdmissionStatus.APPOINTED,
              appointmentDate: new Date(appointmentDate),
              appointmentNotes: 'Cổng tiếp nhận A',
            }),
          }),
        );
        expect(prisma.admissionHistoryLog.create).toHaveBeenCalled();
        expect(businessMail.emit).toHaveBeenCalledWith(
          expect.objectContaining({
            eventCode: 'ADMISSION_APPOINTMENT_SCHEDULED',
            recipients: expect.arrayContaining([
              expect.objectContaining({
                body: expect.objectContaining({
                  refId: 'adm-10',
                  milestone: expect.stringContaining('scheduled-adm-10-'),
                }),
              }),
            ]),
          }),
        );
      });

      it('blocks scheduling terminal admission records', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-approved',
          status: AdmissionStatus.APPROVED,
          horse: { id: 'h-1', name: 'Horse 1' },
          owner: { id: 'o-1' },
        });

        await expect(
          service.scheduleAdmission(
            'adm-approved',
            {
              appointmentDate: new Date(Date.now() + 86400000).toISOString(),
              veterinarianUserId: 'vet-1',
            },
            mockManager,
          ),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: expect.objectContaining({ code: 'ADMISSION_TERMINAL' }),
        });
      });

      it('rolls back and aborts email emission when admission history creation throws inside transaction', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-rollback',
          admissionCode: 'ADM-2026-011',
          horseId: 'h-11',
          ownerId: mockOwner.userId,
          status: AdmissionStatus.PENDING_VERIFICATION,
          horse: { id: 'h-11', name: 'Rollback Horse', horseCode: 'HR-000011' },
          owner: { id: mockOwner.userId, fullName: 'Owner User', email: 'owner@gmail.com' },
        });
        prisma.admissionHistoryLog.create.mockRejectedValueOnce(
          new Error('Admission history log table write failure'),
        );

        await expect(
          service.scheduleAdmission(
            'adm-rollback',
            {
              appointmentDate: new Date(Date.now() + 86400000).toISOString(),
              veterinarianUserId: 'vet-1',
            },
            mockManager,
          ),
        ).rejects.toThrow('Admission history log table write failure');

        // Email tuyệt đối không được gửi đi khi transaction bị rollback
        expect(businessMail.emit).not.toHaveBeenCalled();
      });
    });

    describe('inspectAdmission', () => {
      it('audits and logs history when inspect is called in same-state INSPECTION_IN_PROGRESS', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-insp-same',
          admissionCode: 'ADM-2026-022',
          horseId: 'h-22',
          status: AdmissionStatus.INSPECTION_IN_PROGRESS,
          declaredMicrochip: '985123456789012',
          microchipVerified: true,
          legalVerified: false,
          horse: { id: 'h-22', name: 'Inspection Horse', microchip: '985123456789012' },
          owner: { id: 'o-1' },
        });

        await service.inspectAdmission(
          'adm-insp-same',
          { legalVerified: true, legalDocumentsNote: 'Bổ sung giấy ủy quyền' },
          mockManager,
        );

        expect(prisma.admissionHistoryLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              fromStatus: AdmissionStatus.INSPECTION_IN_PROGRESS,
              toStatus: AdmissionStatus.INSPECTION_IN_PROGRESS,
            }),
          }),
        );
        expect(audit.record).toHaveBeenCalledWith(
          expect.anything(),
          'ADMISSION_INSPECTED',
          expect.any(String),
          'adm-insp-same',
          expect.objectContaining({
            entityName: 'HorseAdmissionRecord',
          }),
          expect.anything(),
        );
      });

      it('acquires row locks in safe order: Horse lock precedes HorseAdmissionRecord lock', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-order',
          admissionCode: 'ADM-2026-023',
          horseId: 'h-23',
          status: AdmissionStatus.APPOINTED,
          declaredMicrochip: '985123456789012',
          horse: { id: 'h-23', name: 'Ordered Lock Horse', microchip: '985123456789012' },
          owner: { id: 'o-1' },
        });

        await service.inspectAdmission(
          'adm-order',
          { scannedMicrochip: '985123456789012' },
          mockManager,
        );

        expect(prisma.$queryRaw).toHaveBeenNthCalledWith(1, expect.anything(), 'h-23');
        expect(prisma.$queryRaw).toHaveBeenNthCalledWith(2, expect.anything(), 'adm-order');
      });
      it('manager update: computes microchipVerified true on exact match', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-insp',
          admissionCode: 'ADM-2026-020',
          horseId: 'h-20',
          status: AdmissionStatus.APPOINTED,
          declaredMicrochip: '985123456789012',
          horse: { id: 'h-20', name: 'Speedy', microchip: '985123456789012' },
          owner: { id: 'o-1' },
        });

        await service.inspectAdmission(
          'adm-insp',
          { scannedMicrochip: '985123456789012', legalVerified: true },
          mockManager,
        );

        expect(prisma.horseAdmissionRecord.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              scannedMicrochip: '985123456789012',
              microchipVerified: true,
              legalVerified: true,
              status: AdmissionStatus.INSPECTION_IN_PROGRESS,
            }),
          }),
        );
      });

      it('manager update: computes microchipVerified false on mismatched chip', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-insp-2',
          admissionCode: 'ADM-2026-021',
          horseId: 'h-21',
          status: AdmissionStatus.APPOINTED,
          declaredMicrochip: '985123456789012',
          horse: { id: 'h-21', name: 'Speedy 2', microchip: '985123456789012' },
          owner: { id: 'o-1' },
        });

        await service.inspectAdmission(
          'adm-insp-2',
          { scannedMicrochip: '985999999999999' },
          mockManager,
        );

        expect(prisma.horseAdmissionRecord.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              scannedMicrochip: '985999999999999',
              microchipVerified: false,
            }),
          }),
        );
      });

      it('rejects field spoofing: manager attempting to submit vet findings', async () => {
        await expect(
          service.inspectAdmission('adm-insp-3', { isHealthEligible: true }, mockManager),
        ).rejects.toMatchObject({
          status: HttpStatus.FORBIDDEN,
          response: expect.objectContaining({ code: 'FORBIDDEN_FIELD_SPOOFING' }),
        });
      });

      it('rejects field spoofing: vet attempting to submit legal/microchip findings', async () => {
        const mockVet: CurrentUserPayload = {
          userId: 'vet-1',
          email: 'vet@gmail.com',
          fullName: 'Dr. Vet',
          role: UserRole.VETERINARIAN,
        };

        await expect(
          service.inspectAdmission('adm-insp-4', { scannedMicrochip: '985123456789012' }, mockVet),
        ).rejects.toMatchObject({
          status: HttpStatus.FORBIDDEN,
          response: expect.objectContaining({ code: 'FORBIDDEN_FIELD_SPOOFING' }),
        });
      });
    });

    describe('immutable medical conclusion', () => {
      const vet = {
        userId: 'vet-1',
        email: 'vet@example.com',
        fullName: 'Bác sĩ',
        role: UserRole.VETERINARIAN,
      };
      const record = {
        id: 'immutable',
        horseId: 'horse',
        status: AdmissionStatus.INSPECTION_IN_PROGRESS,
        veterinarianUserId: 'vet-1',
        horse: { id: 'horse', status: HorseStatus.PENDING_ADMISSION },
        owner: { id: 'owner' },
      };
      it.each([true, false])('locks a finalized %s conclusion, including notes', async (result) => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          ...record,
          isHealthEligible: result,
          healthFinalizedAt: new Date(),
        });
        await expect(
          service.inspectAdmission('immutable', { healthCheckNotes: 'Ghi đè kết quả' }, vet),
        ).rejects.toMatchObject({ response: { code: 'ADMISSION_HEALTH_FINALIZED' } });
        expect(prisma.horseAdmissionRecord.update).not.toHaveBeenCalled();
      });
      it('requires explicit confirmation and writes an immutable review snapshot', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue(record);
        await expect(
          service.inspectAdmission(
            'immutable',
            { isHealthEligible: true, healthCheckNotes: 'Đã khám' },
            vet,
          ),
        ).rejects.toMatchObject({ response: { code: 'HEALTH_CONFIRMATION_REQUIRED' } });
        await service.inspectAdmission(
          'immutable',
          { isHealthEligible: false, healthCheckNotes: 'Cần cách ly', finalizeHealth: true },
          vet,
        );
        expect(prisma.admissionHealthReview.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            admissionId: 'immutable',
            isHealthEligible: false,
            notes: 'Cần cách ly',
            reason: null,
          }),
        });
      });
      it('records a new review with reason while keeping the previous review', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          ...record,
          isHealthEligible: false,
          healthFinalizedAt: new Date(),
        });
        await service.inspectAdmission(
          'immutable',
          { isHealthEligible: true, healthCheckNotes: 'Đã hồi phục', finalizeHealth: true },
          vet,
          'Khám lại sau thời gian cách ly',
        );
        expect(prisma.admissionHealthReview.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            reason: 'Khám lại sau thời gian cách ly',
            isHealthEligible: true,
          }),
        });
      });
    });

    describe('approveAdmission', () => {
      it('approves admission atomically, sets horse to RESTING and returns fresh resting status', async () => {
        const mockRecord = {
          id: 'adm-appr',
          admissionCode: 'ADM-2026-030',
          horseId: 'h-30',
          ownerId: mockOwner.userId,
          status: AdmissionStatus.INSPECTION_IN_PROGRESS,
          microchipVerified: true,
          legalVerified: true,
          isHealthEligible: true,
          healthFinalizedAt: new Date(),
          declaredMicrochip: '985123456789012',
          scannedMicrochip: '985123456789012',
          horse: {
            id: 'h-30',
            name: 'Gallant Star',
            horseCode: 'HR-000030',
            status: HorseStatus.PENDING_ADMISSION,
            isMedicalLocked: false,
          },
          owner: { id: mockOwner.userId, fullName: 'Owner User', email: 'owner@gmail.com' },
          veterinarian: { id: 'vet-1', fullName: 'Dr. Vet', email: 'vet@gmail.com' },
        };
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue(mockRecord);
        prisma.horse.findUnique.mockResolvedValue({
          ...mockRecord.horse,
          status: HorseStatus.RESTING,
        });

        prisma.user.findUnique.mockResolvedValue({
          id: 'groom-1',
          role: 'GROOM',
          status: 'ACTIVE',
        });
        const res = await service.approveAdmission('adm-appr', mockManager, placement);

        expect(res.status).toBe(AdmissionStatus.APPROVED);
        expect(prisma.horse.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'h-30' },
            data: { status: HorseStatus.RESTING },
          }),
        );
        expect(prisma.horseAdmissionRecord.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'adm-appr' },
            data: expect.objectContaining({
              status: AdmissionStatus.APPROVED,
              approvedBy: { connect: { id: mockManager.userId } },
            }),
          }),
        );
        expect(businessMail.emit).toHaveBeenCalledWith(
          expect.objectContaining({
            eventCode: 'HORSE_ADMISSION_CONFIRMED',
            recipients: expect.arrayContaining([
              expect.objectContaining({
                body: expect.objectContaining({
                  refId: 'adm-appr',
                  milestone: 'approved',
                }),
              }),
            ]),
          }),
        );
      });

      it('blocks approval when criteria are not met', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-unmet',
          horseId: 'h-31',
          status: AdmissionStatus.INSPECTION_IN_PROGRESS,
          microchipVerified: false, // CHƯA KHỚP
          legalVerified: true,
          isHealthEligible: true,
          healthFinalizedAt: new Date(),
          horse: { id: 'h-31', status: HorseStatus.PENDING_ADMISSION, isMedicalLocked: false },
          owner: { id: 'o-1' },
        });

        await expect(
          service.approveAdmission('adm-unmet', mockManager, placement),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: expect.objectContaining({ code: 'ADMISSION_CRITERIA_NOT_MET' }),
        });
      });

      it('acquires row locks in safe order: Horse lock precedes HorseAdmissionRecord lock and uses safe user projection', async () => {
        const mockRecord = {
          id: 'adm-lock-order',
          admissionCode: 'ADM-2026-031',
          horseId: 'h-31',
          ownerId: mockOwner.userId,
          status: AdmissionStatus.INSPECTION_IN_PROGRESS,
          microchipVerified: true,
          legalVerified: true,
          isHealthEligible: true,
          healthFinalizedAt: new Date(),
          declaredMicrochip: '985123456789012',
          scannedMicrochip: '985123456789012',
          horse: {
            id: 'h-31',
            name: 'Gallant Star 2',
            horseCode: 'HR-000031',
            status: HorseStatus.PENDING_ADMISSION,
            isMedicalLocked: false,
          },
          owner: { id: mockOwner.userId, fullName: 'Owner User', email: 'owner@gmail.com' },
          veterinarian: { id: 'vet-1', fullName: 'Dr. Vet', email: 'vet@gmail.com' },
        };
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue(mockRecord);
        prisma.horse.findUnique.mockResolvedValue({
          ...mockRecord.horse,
          status: HorseStatus.RESTING,
        });

        prisma.user.findUnique.mockResolvedValue({
          id: 'groom-1',
          role: 'GROOM',
          status: 'ACTIVE',
        });
        await service.approveAdmission('adm-lock-order', mockManager, placement);

        // Thứ tự khóa an toàn chống deadlock
        expect(prisma.$queryRaw).toHaveBeenNthCalledWith(3, expect.anything(), 'h-31');
        expect(prisma.$queryRaw).toHaveBeenNthCalledWith(4, expect.anything(), 'adm-lock-order');

        // Chiếu an toàn không làm rò rỉ passwordHash/permissions
        expect(prisma.horseAdmissionRecord.update).toHaveBeenCalledWith(
          expect.objectContaining({
            include: expect.objectContaining({
              owner: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  phoneNumber: true,
                },
              },
            }),
          }),
        );
      });
    });

    describe('rejectAdmission', () => {
      it('rejects admission atomically with trimmed reason and updates horse to REJECTED', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-rej',
          admissionCode: 'ADM-2026-040',
          horseId: 'h-40',
          ownerId: mockOwner.userId,
          status: AdmissionStatus.INSPECTION_IN_PROGRESS,
          horse: {
            id: 'h-40',
            name: 'Shadow Runner',
            horseCode: 'HR-000040',
            status: HorseStatus.PENDING_ADMISSION,
            isMedicalLocked: false,
          },
          owner: { id: mockOwner.userId, fullName: 'Owner User', email: 'owner@gmail.com' },
        });

        const res = await service.rejectAdmission(
          'adm-rej',
          { rejectionReason: 'Không đạt tiêu chuẩn kiểm dịch thú y do có dấu hiệu sốt cao.' },
          mockManager,
        );

        expect(res.status).toBe(AdmissionStatus.REJECTED);
        expect(prisma.horse.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'h-40' },
            data: { status: HorseStatus.REJECTED },
          }),
        );
        expect(prisma.horseAdmissionRecord.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'adm-rej' },
            data: expect.objectContaining({
              status: AdmissionStatus.REJECTED,
              rejectionReason: 'Không đạt tiêu chuẩn kiểm dịch thú y do có dấu hiệu sốt cao.',
            }),
          }),
        );
        expect(businessMail.emit).toHaveBeenCalledWith(
          expect.objectContaining({
            eventCode: 'HORSE_ADMISSION_REJECTED',
            recipients: expect.arrayContaining([
              expect.objectContaining({
                body: expect.objectContaining({
                  refId: 'adm-rej',
                }),
              }),
            ]),
          }),
        );
      });
    });

    describe('cancelAdmission', () => {
      it('owner cancels own admission in PENDING_VERIFICATION', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-cnl',
          admissionCode: 'ADM-2026-050',
          horseId: 'h-50',
          ownerId: mockOwner.userId,
          status: AdmissionStatus.PENDING_VERIFICATION,
          horse: { id: 'h-50', name: 'Sky Walker' },
          owner: { id: mockOwner.userId, fullName: 'Owner User', email: 'owner@gmail.com' },
        });

        await service.cancelAdmission('adm-cnl', { reason: 'Tôi xin rút đơn' }, mockOwner);

        expect(prisma.horseAdmissionRecord.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'adm-cnl' },
            data: { status: AdmissionStatus.CANCELLED },
          }),
        );
      });

      it('manager cancellation fails if appointment is not 3 days overdue', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-not-overdue',
          admissionCode: 'ADM-2026-051',
          horseId: 'h-51',
          ownerId: mockOwner.userId,
          status: AdmissionStatus.APPOINTED,
          appointmentDate: new Date(), // hôm nay, chưa quá hạn 3 ngày
          horse: { id: 'h-51', name: 'Sky Walker 2' },
          owner: { id: mockOwner.userId },
        });

        await expect(
          service.cancelAdmission('adm-not-overdue', {}, mockManager),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: expect.objectContaining({ code: 'CANCELLATION_NOT_OVERDUE' }),
        });
      });

      it('forbids owner from cancelling foreign admission record', async () => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'adm-foreign',
          admissionCode: 'ADM-2026-052',
          horseId: 'h-52',
          ownerId: 'other-owner-id',
          status: AdmissionStatus.PENDING_VERIFICATION,
          horse: { id: 'h-52', name: 'Foreign Horse' },
          owner: { id: 'other-owner-id' },
        });

        await expect(service.cancelAdmission('adm-foreign', {}, mockOwner)).rejects.toMatchObject({
          status: HttpStatus.FORBIDDEN,
          response: expect.objectContaining({ code: 'NOT_ADMISSION_OWNER' }),
        });
      });
    });

    describe('listAdmissions', () => {
      it('filters by status and searches across horse, chip, owner, admissionCode', async () => {
        prisma.horseAdmissionRecord.count.mockResolvedValueOnce(1);
        prisma.horseAdmissionRecord.findMany.mockResolvedValueOnce([
          {
            id: 'adm-list-1',
            admissionCode: 'ADM-2026-001',
            status: AdmissionStatus.PENDING_VERIFICATION,
          },
        ]);

        const res = await service.listAdmissions(
          {
            search: 'Phoenix',
            status: AdmissionStatus.PENDING_VERIFICATION,
            page: 1,
            pageSize: 10,
          },
          mockManager,
        );

        expect(res.total).toBe(1);
        expect(res.data).toHaveLength(1);
        expect(prisma.horseAdmissionRecord.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: AdmissionStatus.PENDING_VERIFICATION,
              OR: expect.arrayContaining([
                { admissionCode: { contains: 'Phoenix', mode: 'insensitive' } },
                { declaredMicrochip: { contains: 'Phoenix', mode: 'insensitive' } },
                { scannedMicrochip: { contains: 'Phoenix', mode: 'insensitive' } },
                { horse: { name: { contains: 'Phoenix', mode: 'insensitive' } } },
                { horse: { horseCode: { contains: 'Phoenix', mode: 'insensitive' } } },
                { horse: { microchip: { contains: 'Phoenix', mode: 'insensitive' } } },
                { owner: { fullName: { contains: 'Phoenix', mode: 'insensitive' } } },
                { owner: { email: { contains: 'Phoenix', mode: 'insensitive' } } },
              ]),
            }),
          }),
        );
      });

      it('filters recent7Days: true based on approved status and recent admittedAt', async () => {
        prisma.horseAdmissionRecord.count.mockResolvedValueOnce(2);
        prisma.horseAdmissionRecord.findMany.mockResolvedValueOnce([
          { id: 'adm-rec-1', status: AdmissionStatus.APPROVED },
          { id: 'adm-rec-2', status: AdmissionStatus.APPROVED },
        ]);

        const res = await service.listAdmissions({ recent7Days: true }, mockManager);

        expect(res.total).toBe(2);
        expect(prisma.horseAdmissionRecord.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: AdmissionStatus.APPROVED,
              admittedAt: expect.objectContaining({ gte: expect.any(Date) }),
            }),
          }),
        );
      });

      it('supports pagination returning total, page, pageSize and totalPages', async () => {
        prisma.horseAdmissionRecord.count.mockResolvedValueOnce(35);
        prisma.horseAdmissionRecord.findMany.mockResolvedValueOnce(
          new Array(10).fill({ id: 'adm-item' }),
        );

        const res = await service.listAdmissions({ page: 2, pageSize: 10 }, mockManager);

        expect(res.total).toBe(35);
        expect(res.page).toBe(2);
        expect(res.pageSize).toBe(10);
        expect(res.totalPages).toBe(4);
        expect(prisma.horseAdmissionRecord.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            skip: 10,
            take: 10,
          }),
        );
      });
    });

    describe('microchip immutability & active admission', () => {
      it('blocks updating microchip when horse has an active admission', async () => {
        prisma.horse.findUnique.mockResolvedValue({
          id: 'h-lock-chip',
          name: 'Lock Chip Horse',
          ownerId: mockOwner.userId,
          status: HorseStatus.PENDING_ADMISSION,
          microchip: '985111111111111',
          stallAllocations: [],
        });
        prisma.horseAdmissionRecord.findFirst.mockResolvedValue({
          id: 'adm-active',
          status: AdmissionStatus.INSPECTION_IN_PROGRESS,
        });

        await expect(
          service.update('h-lock-chip', { microchip: '985999999999999' }, mockOwner),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: expect.objectContaining({ code: 'ADMISSION_IN_PROGRESS' }),
        });
      });

      it('interleaving regression: acquires row lock on Horse and checks active admissions inside tx, blocking chip edit after concurrent reapply', async () => {
        const horseId = 'h-interleave';
        // Giả lập trạng thái sau khi reapply vừa commit: Horse status REJECTED nhưng đã có active admission
        prisma.horse.findUnique.mockResolvedValue({
          id: horseId,
          name: 'Interleaved Horse',
          ownerId: mockOwner.userId,
          status: HorseStatus.REJECTED,
          microchip: '985111111111111',
          stallAllocations: [],
        });
        prisma.horseAdmissionRecord.findFirst.mockResolvedValue({
          id: 'adm-concurrent-reapply',
          horseId,
          status: AdmissionStatus.PENDING_VERIFICATION,
        });

        await expect(
          service.update(horseId, { microchip: '985222222222222' }, mockOwner),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: expect.objectContaining({ code: 'ADMISSION_IN_PROGRESS' }),
        });

        // Xác nhận row lock đã được acquire TRƯỚC KHI kiểm tra admission đang xử lý
        expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.anything(), horseId);
        // Không gọi horse.update vì đã bị chặn
        expect(prisma.horse.update).not.toHaveBeenCalled();
      });

      it('preserves audit atomicity by passing transaction client to auditService.record', async () => {
        const horseId = 'h-audit-tx';
        prisma.horse.findUnique.mockResolvedValue({
          id: horseId,
          name: 'Audit Horse',
          ownerId: mockOwner.userId,
          status: HorseStatus.REJECTED,
          microchip: '985333333333333',
          stallAllocations: [],
        });
        prisma.horseAdmissionRecord.findFirst.mockResolvedValue(null);
        prisma.horse.update.mockResolvedValue({
          id: horseId,
          name: 'Audit Horse Renamed',
          ownerId: mockOwner.userId,
          status: HorseStatus.REJECTED,
          microchip: '985333333333333',
        });

        await service.update(horseId, { name: 'Audit Horse Renamed' }, mockOwner);

        // auditService.record nhận đối tượng tx ở tham số thứ 6 (bảo toàn tính nguyên tử)
        expect(audit.record).toHaveBeenCalledWith(
          expect.anything(),
          'HORSE_UPDATED',
          expect.any(String),
          horseId,
          expect.objectContaining({ entityName: 'Horse' }),
          expect.anything(), // tx
        );
      });
    });

    describe('email failure resilience', () => {
      it('logs SMTP failure and does not rollback or throw during approval', async () => {
        businessMail.emit.mockRejectedValue(new Error('SMTP Network Timeout'));

        const mockRecord = {
          id: 'adm-mail-fail',
          admissionCode: 'ADM-2026-060',
          horseId: 'h-60',
          ownerId: mockOwner.userId,
          status: AdmissionStatus.INSPECTION_IN_PROGRESS,
          microchipVerified: true,
          legalVerified: true,
          isHealthEligible: true,
          healthFinalizedAt: new Date(),
          declaredMicrochip: '985123456789012',
          scannedMicrochip: '985123456789012',
          horse: {
            id: 'h-60',
            name: 'Resilient Runner',
            horseCode: 'HR-000060',
            status: HorseStatus.PENDING_ADMISSION,
            isMedicalLocked: false,
          },
          owner: { id: mockOwner.userId, fullName: 'Owner User', email: 'owner@gmail.com' },
          veterinarian: { id: 'vet-1', fullName: 'Dr. Vet', email: 'vet@gmail.com' },
        };
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue(mockRecord);
        prisma.horse.findUnique.mockResolvedValue({
          ...mockRecord.horse,
          status: HorseStatus.RESTING,
        });

        // Không ném lỗi dù SMTP gặp sự cố mạng
        prisma.user.findUnique.mockResolvedValue({
          id: 'groom-1',
          role: 'GROOM',
          status: 'ACTIVE',
        });
        await expect(
          service.approveAdmission('adm-mail-fail', mockManager, placement),
        ).resolves.toBeDefined();
        expect(prisma.horseAdmissionRecord.update).toHaveBeenCalled();
        expect(prisma.horse.update).toHaveBeenCalled();
      });
    });
  });
  describe('admission capacity safeguards', () => {
    it('blocks inspection without writing when no usable stall remains', async () => {
      prisma.stall.count.mockResolvedValue(0);
      prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
        id: 'a',
        horseId: 'h',
        status: AdmissionStatus.APPOINTED,
      });
      await expect(
        service.inspectAdmission('a', { legalVerified: true }, mockManager),
      ).rejects.toMatchObject({ response: { code: 'ADMISSION_NO_STALL' } });
      expect(prisma.horseAdmissionRecord.update).not.toHaveBeenCalled();
    });
    it('defers an appointment without rejection and emits one capacity email on repeated clicks', async () => {
      prisma.stall.count.mockResolvedValue(0);
      const record = {
        id: 'a',
        horseId: 'h',
        ownerId: 'owner-1',
        admissionCode: 'ADM-1',
        status: AdmissionStatus.APPOINTED,
        appointmentDate: new Date('2026-12-01T02:00:00Z'),
        capacityDeferredAt: null,
        createdAt: new Date(),
        horse: { id: 'h', name: 'Ngựa A' },
        owner: { id: 'owner-1', fullName: 'Chủ ngựa' },
      };
      prisma.horseAdmissionRecord.findUnique.mockImplementation(async () => ({ ...record }));
      prisma.horseAdmissionRecord.update.mockImplementation(async (args) =>
        Object.assign(record, args.data),
      );
      await service.deferAdmissionForCapacity('a', mockManager);
      await service.deferAdmissionForCapacity('a', mockManager);
      expect(record.status).toBe(AdmissionStatus.PENDING_VERIFICATION);
      expect(record.appointmentDate).toBeNull();
      expect(businessMail.emit).toHaveBeenCalledTimes(1);
      expect(businessMail.emit).toHaveBeenCalledWith(
        expect.objectContaining({ eventCode: 'ADMISSION_CAPACITY_DEFERRED' }),
      );
    });
    it('does not defer or send mail while capacity is available', async () => {
      prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
        id: 'a',
        status: AdmissionStatus.APPOINTED,
      });
      await expect(service.deferAdmissionForCapacity('a', mockManager)).rejects.toMatchObject({
        response: { code: 'ADMISSION_HAS_CAPACITY' },
      });
      expect(businessMail.emit).not.toHaveBeenCalled();
    });
  });
  describe('assigned veterinarian admissions', () => {
    const vet = {
      userId: 'vet-1',
      role: UserRole.VETERINARIAN,
      fullName: 'Bác sĩ',
      email: 'vet@gmail.com',
      permissions: {},
    } as CurrentUserPayload;
    it('scopes list and count to the current veterinarian, including search and pagination', async () => {
      await service.listAdmissions({ search: 'Atlas', page: 2, pageSize: 10 }, vet);
      expect(prisma.horseAdmissionRecord.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ veterinarianUserId: 'vet-1' }),
        }),
      );
      expect(prisma.horseAdmissionRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ veterinarianUserId: 'vet-1' }),
          skip: 10,
        }),
      );
    });
    it('does not restrict the manager to a veterinarian assignment', async () => {
      await service.listAdmissions({}, mockManager);
      expect(prisma.horseAdmissionRecord.findMany.mock.calls[0][0].where).not.toHaveProperty(
        'veterinarianUserId',
      );
    });
    it('does not expose another doctor admission through a direct history/detail URL', async () => {
      prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
        id: 'other',
        veterinarianUserId: 'other-vet',
      });
      await expect(service.getAdmissionHistory('other', vet)).rejects.toMatchObject({
        response: { code: 'ADMISSION_NOT_FOUND' },
      });
      expect(prisma.admissionHistoryLog.findMany).not.toHaveBeenCalled();
    });
    it('lets the assigned doctor load their admission and history', async () => {
      prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
        id: 'mine',
        veterinarianUserId: 'vet-1',
      });
      const result = await service.getAdmissionHistory('mine', vet);
      expect(result.admission.id).toBe('mine');
      expect(result.history).toEqual([]);
    });
    it.each([null, 'other-vet'])(
      'rejects health updates when assigned doctor is %s',
      async (assigned) => {
        prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
          id: 'a',
          horseId: 'h',
          status: AdmissionStatus.APPOINTED,
          veterinarianUserId: assigned,
        });
        await expect(
          service.inspectAdmission('a', { isHealthEligible: true }, vet),
        ).rejects.toMatchObject({ response: { code: 'ADMISSION_VET_MISMATCH' } });
        expect(prisma.horseAdmissionRecord.update).not.toHaveBeenCalled();
      },
    );
    it('allows the assigned doctor to save health fields without changing legal verification', async () => {
      prisma.horseAdmissionRecord.findUnique.mockResolvedValue({
        id: 'mine',
        horseId: 'h',
        status: AdmissionStatus.APPOINTED,
        veterinarianUserId: 'vet-1',
        horse: { name: 'Atlas' },
        owner: { id: 'owner' },
      });
      await service.inspectAdmission(
        'mine',
        { isHealthEligible: true, healthCheckNotes: 'Đã khám', finalizeHealth: true },
        vet,
      );
      const data = prisma.horseAdmissionRecord.update.mock.calls[0][0].data;
      expect(data.isHealthEligible).toBe(true);
      expect(data).not.toHaveProperty('legalVerified');
      expect(data).not.toHaveProperty('microchipVerified');
    });
  });
});
