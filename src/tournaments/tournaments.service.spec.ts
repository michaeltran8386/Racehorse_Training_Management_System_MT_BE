import { Test, TestingModule } from '@nestjs/testing';
import { TournamentsService } from './tournaments.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  HorseStatus,
  Prisma,
  RegistrationStatus,
  TournamentStatus,
  TrackSurface,
} from '@prisma/client';
import { UserRole } from '../common/enums/role.enum';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

describe('TournamentsService', () => {
  let service: TournamentsService;
  let prisma: any;
  let audit: any;
  let notifications: any;

  beforeEach(async () => {
    prisma = {
      tournament: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      tournamentRegistration: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      tournamentResult: {
        upsert: jest.fn(),
        findMany: jest.fn(),
      },
      horse: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      financialInvoice: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      workoutSession: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((callbackOrPromises) => {
        if (typeof callbackOrPromises === 'function') {
          return callbackOrPromises(prisma);
        }
        return Promise.all(callbackOrPromises);
      }),
    };

    audit = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    notifications = {
      notifyUsers: jest.fn().mockResolvedValue(undefined),
      notifyRoles: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TournamentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<TournamentsService>(TournamentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated tournaments with filters', async () => {
      prisma.tournament.findMany.mockResolvedValue([
        {
          id: 't-1',
          name: 'Grand Cup',
          status: TournamentStatus.UPCOMING,
          prizePool: 50000000,
          _count: { registrations: 2 },
        },
      ]);
      prisma.tournament.count.mockResolvedValue(1);

      const res = await service.findAll({
        status: TournamentStatus.UPCOMING,
        trackType: TrackSurface.TURF,
        search: 'Grand',
        page: 1,
        limit: 10,
      });

      expect(res.items).toHaveLength(1);
      expect(res.total).toBe(1);
    });
  });

  describe('findOne', () => {
    const staffUser: CurrentUserPayload = {
      userId: 'staff-1',
      email: 'manager@gmail.com',
      role: UserRole.CLUB_MANAGER,
      fullName: 'Club Manager',
    };

    it('should return a tournament if found', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup',
        prizePool: 10000000,
        registrations: [],
      });
      const res = await service.findOne('t-1', staffUser);
      expect(res.id).toBe('t-1');
    });

    it('should throw NOT_FOUND if tournament does not exist', async () => {
      prisma.tournament.findUnique.mockResolvedValue(null);
      await expect(service.findOne('invalid', staffUser)).rejects.toThrow();
    });
  });

  describe('create', () => {
    it('should reject when registration deadline is after race date', async () => {
      const dto = {
        name: 'Spring Cup',
        raceDate: '2026-11-10T08:00:00Z',
        location: 'Racecourse',
        distanceMeters: 1600,
        registrationDeadline: '2026-11-15T08:00:00Z',
      };
      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };

      await expect(service.create(dto as any, actor)).rejects.toThrow();
    });

    it('should successfully create tournament when data is valid', async () => {
      const dto = {
        name: 'Spring Cup',
        raceDate: '2026-11-20T08:00:00Z',
        location: 'Racecourse',
        distanceMeters: 1600,
        trackType: TrackSurface.TURF,
        prizePool: 100000000,
        registrationDeadline: '2026-11-15T08:00:00Z',
      };
      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };

      prisma.tournament.create.mockResolvedValue({
        id: 'tourney-1',
        ...dto,
        raceDate: new Date(dto.raceDate),
        registrationDeadline: new Date(dto.registrationDeadline),
        status: TournamentStatus.UPCOMING,
      });

      const result = await service.create(dto as any, actor);
      expect(result.id).toBe('tourney-1');
      expect(audit.record).toHaveBeenCalled();
    });

    it('should reject creating tournament directly in COMPLETED status', async () => {
      const dto = {
        name: 'Direct Completed Cup',
        raceDate: '2026-11-20T08:00:00Z',
        registrationDeadline: '2026-11-15T08:00:00Z',
        status: TournamentStatus.COMPLETED,
      };
      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      await expect(service.create(dto as any, actor)).rejects.toThrow(
        'Tournaments cannot be directly created as COMPLETED',
      );
      expect(prisma.tournament.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('should reject creating tournament directly in CANCELLED or CLOSED_REGISTRATION status', async () => {
      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      await expect(
        service.create(
          {
            name: 'Direct Cancelled',
            raceDate: '2026-11-20T08:00:00Z',
            registrationDeadline: '2026-11-15T08:00:00Z',
            status: TournamentStatus.CANCELLED,
          } as any,
          actor,
        ),
      ).rejects.toThrow('Cannot create a tournament directly in CANCELLED status');

      await expect(
        service.create(
          {
            name: 'Direct Closed',
            raceDate: '2026-11-20T08:00:00Z',
            registrationDeadline: '2026-11-15T08:00:00Z',
            status: TournamentStatus.CLOSED_REGISTRATION,
          } as any,
          actor,
        ),
      ).rejects.toThrow('Cannot create a tournament directly in CLOSED_REGISTRATION status');
    });
  });

  describe('update & changeStatus', () => {
    it('should update tournament details', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        status: TournamentStatus.UPCOMING,
        raceDate: new Date('2026-11-20'),
        registrationDeadline: new Date('2026-11-10'),
      });
      prisma.tournament.update.mockResolvedValue({
        id: 't-1',
        name: 'Updated Cup',
        prizePool: 10000000,
      });

      const res = await service.update(
        't-1',
        { name: 'Updated Cup' },
        { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
      );
      expect(res.name).toBe('Updated Cup');
    });

    it('should reject updating tournament directly to COMPLETED via update()', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        status: TournamentStatus.OPEN_REGISTRATION,
        raceDate: new Date('2026-11-20'),
        registrationDeadline: new Date('2026-11-10'),
      });
      await expect(
        service.update('t-1', { status: TournamentStatus.COMPLETED } as any, {
          id: 'u1',
          name: 'Mgr',
          role: 'CLUB_MANAGER',
        }),
      ).rejects.toThrow('Tournaments cannot be directly marked as COMPLETED');
      expect(prisma.tournament.update).not.toHaveBeenCalled();
    });

    it('should update tournament status via changeStatus', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.UPCOMING,
        registrationDeadline: new Date('2026-11-10'),
        raceDate: new Date('2026-11-20'),
      });
      prisma.tournament.update.mockResolvedValue({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.OPEN_REGISTRATION,
        prizePool: 10000000,
      });

      const res = await service.changeStatus(
        't-1',
        { status: TournamentStatus.OPEN_REGISTRATION },
        { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
      );
      expect(res.status).toBe(TournamentStatus.OPEN_REGISTRATION);
    });

    it('should reject direct changeStatus to COMPLETED', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.CLOSED_REGISTRATION,
      });

      await expect(
        service.changeStatus(
          't-1',
          { status: TournamentStatus.COMPLETED },
          { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow('Tournaments cannot be directly marked as COMPLETED');
      expect(prisma.tournament.update).not.toHaveBeenCalled();
    });

    it('should reject changeStatus to OPEN_REGISTRATION when registration deadline has passed', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.UPCOMING,
        registrationDeadline: new Date(Date.now() - 3600000), // past
      });

      await expect(
        service.changeStatus(
          't-1',
          { status: TournamentStatus.OPEN_REGISTRATION },
          { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow(
        'Cannot set Open for Registration when registration deadline is in the past',
      );
      expect(prisma.tournament.update).not.toHaveBeenCalled();
    });

    it('should reject invalid status transitions (UPCOMING to CLOSED, CANCELLED to UPCOMING, OPEN to UPCOMING)', async () => {
      prisma.tournament.findUnique.mockResolvedValueOnce({
        id: 't-1',
        status: TournamentStatus.UPCOMING,
        registrationDeadline: new Date('2026-11-10'),
        raceDate: new Date('2026-11-20'),
      });
      await expect(
        service.changeStatus(
          't-1',
          { status: TournamentStatus.CLOSED_REGISTRATION },
          { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow('Cannot transition tournament status from UPCOMING to CLOSED_REGISTRATION');

      prisma.tournament.findUnique.mockResolvedValueOnce({
        id: 't-2',
        status: TournamentStatus.CANCELLED,
        registrationDeadline: new Date('2026-11-10'),
        raceDate: new Date('2026-11-20'),
      });
      await expect(
        service.changeStatus(
          't-2',
          { status: TournamentStatus.UPCOMING },
          { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow('Cannot transition tournament status from CANCELLED to UPCOMING');

      prisma.tournament.findUnique.mockResolvedValueOnce({
        id: 't-3',
        status: TournamentStatus.OPEN_REGISTRATION,
        registrationDeadline: new Date('2026-11-10'),
        raceDate: new Date('2026-11-20'),
      });
      await expect(
        service.changeStatus(
          't-3',
          { status: TournamentStatus.UPCOMING },
          { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow('Cannot transition tournament status from OPEN_REGISTRATION to UPCOMING');
      expect(prisma.tournament.update).not.toHaveBeenCalled();
    });

    it('should allow changing status to CLOSED_REGISTRATION or CANCELLED', async () => {
      prisma.tournament.findUnique.mockResolvedValueOnce({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.OPEN_REGISTRATION,
      });
      prisma.tournament.update.mockResolvedValueOnce({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.CLOSED_REGISTRATION,
        prizePool: 10000000,
      });

      const res1 = await service.changeStatus(
        't-1',
        { status: TournamentStatus.CLOSED_REGISTRATION },
        { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
      );
      expect(res1.status).toBe(TournamentStatus.CLOSED_REGISTRATION);

      prisma.tournament.findUnique.mockResolvedValueOnce({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.OPEN_REGISTRATION,
      });
      prisma.tournament.update.mockResolvedValueOnce({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.CANCELLED,
        prizePool: 10000000,
      });

      const res2 = await service.changeStatus(
        't-1',
        { status: TournamentStatus.CANCELLED },
        { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
      );
      expect(res2.status).toBe(TournamentStatus.CANCELLED);
    });

    it('should reject reopening CLOSED_REGISTRATION to OPEN_REGISTRATION', async () => {
      prisma.tournament.findUnique.mockResolvedValueOnce({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.CLOSED_REGISTRATION,
        registrationDeadline: new Date('2026-11-10'),
        raceDate: new Date('2026-11-20'),
      });
      await expect(
        service.changeStatus(
          't-1',
          { status: TournamentStatus.OPEN_REGISTRATION },
          { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow(
        'Cannot transition tournament status from CLOSED_REGISTRATION to OPEN_REGISTRATION',
      );
      expect(prisma.tournament.update).not.toHaveBeenCalled();
    });

    it('should reject reopening CANCELLED to OPEN_REGISTRATION (CANCELLED is terminal)', async () => {
      prisma.tournament.findUnique.mockResolvedValueOnce({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.CANCELLED,
        registrationDeadline: new Date('2026-11-10'),
        raceDate: new Date('2026-11-20'),
      });
      await expect(
        service.changeStatus(
          't-1',
          { status: TournamentStatus.OPEN_REGISTRATION },
          { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow('Cannot transition tournament status from CANCELLED to OPEN_REGISTRATION');
      expect(prisma.tournament.update).not.toHaveBeenCalled();
    });

    it('should allow transitioning CLOSED_REGISTRATION to CANCELLED', async () => {
      prisma.tournament.findUnique.mockResolvedValueOnce({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.CLOSED_REGISTRATION,
      });
      prisma.tournament.update.mockResolvedValueOnce({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.CANCELLED,
        prizePool: 10000000,
      });

      const res = await service.changeStatus(
        't-1',
        { status: TournamentStatus.CANCELLED },
        { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' },
      );
      expect(res.status).toBe(TournamentStatus.CANCELLED);
    });
  });

  describe('delete', () => {
    it('should delete upcoming tournament without registrations', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.UPCOMING,
        _count: { registrations: 0 },
      });
      prisma.tournament.delete.mockResolvedValue({ id: 't-1' });

      await service.delete('t-1', { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' });
      expect(audit.record).toHaveBeenCalled();
    });

    it('should prevent deleting tournament with existing registrations', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        status: TournamentStatus.UPCOMING,
        _count: { registrations: 2 },
      });

      await expect(
        service.delete('t-1', { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' }),
      ).rejects.toThrow('Cannot delete tournament with existing horse registrations');
      expect(prisma.tournament.delete).not.toHaveBeenCalled();
    });

    it('should prevent deleting completed tournament', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        status: TournamentStatus.COMPLETED,
        _count: { registrations: 0 },
      });

      await expect(
        service.delete('t-1', { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' }),
      ).rejects.toThrow('Cannot delete a completed tournament');
      expect(prisma.tournament.delete).not.toHaveBeenCalled();
    });

    it('should prevent deleting cancelled tournament to preserve audit history', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        status: TournamentStatus.CANCELLED,
        _count: { registrations: 0 },
      });

      await expect(
        service.delete('t-1', { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' }),
      ).rejects.toThrow(
        'Cannot delete a cancelled tournament. Cancelled tournaments must be preserved for audit history.',
      );
      expect(prisma.tournament.delete).not.toHaveBeenCalled();
    });

    it('should prevent deleting closed registration tournament', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        status: TournamentStatus.CLOSED_REGISTRATION,
        _count: { registrations: 0 },
      });

      await expect(
        service.delete('t-1', { id: 'u1', name: 'Mgr', role: 'CLUB_MANAGER' }),
      ).rejects.toThrow('Cannot delete a closed tournament');
      expect(prisma.tournament.delete).not.toHaveBeenCalled();
    });
  });

  describe('registerHorse & cancelRegistration', () => {
    it('should block registration when horse is under Medical Lock', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.OPEN_REGISTRATION,
        registrationDeadline: new Date(Date.now() + 86400000),
      });

      prisma.horse.findUnique.mockResolvedValue({
        id: 'h-locked',
        name: 'Thunderbolt',
        isMedicalLocked: true,
        deletedAt: null,
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };

      await expect(service.registerHorse('t-1', { horseId: 'h-locked' }, actor)).rejects.toThrow(
        'Medical Lock is currently in force',
      );
    });

    it('should allow registering an eligible horse', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.OPEN_REGISTRATION,
        registrationDeadline: new Date(Date.now() + 86400000),
        registrations: [],
      });

      prisma.horse.findUnique.mockResolvedValue({
        id: 'h-ok',
        name: 'Champion',
        isMedicalLocked: false,
        deletedAt: null,
      });

      prisma.tournamentRegistration.findUnique.mockResolvedValue(null);
      prisma.tournamentRegistration.create.mockResolvedValue({
        id: 'reg-1',
        tournamentId: 't-1',
        horseId: 'h-ok',
        status: RegistrationStatus.CONFIRMED,
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      const res = await service.registerHorse('t-1', { horseId: 'h-ok' }, actor);
      expect(res.id).toBe('reg-1');
    });

    // RULE-CONC-01: hai lượt đăng ký cùng ngựa chạy đồng thời đều qua bước kiểm tra trùng.
    it('registers inside a transaction and answers a concurrent duplicate with 409 ALREADY_REGISTERED', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup',
        status: TournamentStatus.OPEN_REGISTRATION,
        registrationDeadline: new Date(Date.now() + 86400000),
      });
      prisma.horse.findUnique.mockResolvedValue({
        id: 'h-ok',
        name: 'Champion',
        isMedicalLocked: false,
        deletedAt: null,
      });
      prisma.tournamentRegistration.findUnique.mockResolvedValue(null);
      prisma.tournamentRegistration.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(service.registerHorse('t-1', { horseId: 'h-ok' }, actor)).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: 'ALREADY_REGISTERED' }),
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(notifications.notifyUsers).not.toHaveBeenCalled();
    });

    it('should reject registration when tournament is in UPCOMING status', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-upcoming',
        status: TournamentStatus.UPCOMING,
        registrationDeadline: new Date(Date.now() + 86400000),
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(service.registerHorse('t-upcoming', { horseId: 'h-1' }, actor)).rejects.toThrow(
        'registration is only permitted in OPEN_REGISTRATION',
      );
    });

    it('should reject registration when tournament is in CLOSED_REGISTRATION status', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-closed',
        status: TournamentStatus.CLOSED_REGISTRATION,
        registrationDeadline: new Date(Date.now() + 86400000),
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(service.registerHorse('t-closed', { horseId: 'h-1' }, actor)).rejects.toThrow(
        'registration is only permitted in OPEN_REGISTRATION',
      );
    });

    it('should reject registration when deadline has passed', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-open',
        status: TournamentStatus.OPEN_REGISTRATION,
        registrationDeadline: new Date(Date.now() - 86400000),
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(service.registerHorse('t-open', { horseId: 'h-1' }, actor)).rejects.toThrow(
        'Registration deadline for this tournament has passed',
      );
    });

    it('should reject cancelRegistration without a reason', async () => {
      prisma.tournamentRegistration.findUnique.mockResolvedValue({
        id: 'reg-1',
        tournamentId: 't-1',
        horse: { name: 'Champion' },
        tournament: { name: 'Cup', status: TournamentStatus.OPEN_REGISTRATION },
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(service.cancelRegistration('t-1', 'reg-1', '', actor)).rejects.toThrow(
        'A reason is required to scratch a horse from a tournament',
      );
    });

    it('should reject cancelRegistration when tournament is in CANCELLED status', async () => {
      prisma.tournamentRegistration.findUnique.mockResolvedValue({
        id: 'reg-1',
        tournamentId: 't-1',
        horse: { name: 'Champion' },
        tournament: { name: 'Cup', status: TournamentStatus.CANCELLED },
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(
        service.cancelRegistration('t-1', 'reg-1', 'Vet scratch', actor),
      ).rejects.toThrow('Cannot scratch a horse from a cancelled or completed tournament');
    });

    it('should reject cancelRegistration when tournament is in UPCOMING status', async () => {
      prisma.tournamentRegistration.findUnique.mockResolvedValue({
        id: 'reg-1',
        tournamentId: 't-1',
        horse: { name: 'Champion' },
        tournament: { name: 'Cup', status: TournamentStatus.UPCOMING },
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(
        service.cancelRegistration('t-1', 'reg-1', 'Vet scratch', actor),
      ).rejects.toThrow('Cannot scratch a horse from an upcoming tournament');
    });

    it('should allow cancelRegistration in CLOSED_REGISTRATION status', async () => {
      prisma.tournamentRegistration.findUnique.mockResolvedValue({
        id: 'reg-1',
        tournamentId: 't-1',
        status: RegistrationStatus.REGISTERED,
        horse: { name: 'Champion' },
        tournament: { name: 'Cup', status: TournamentStatus.CLOSED_REGISTRATION },
      });
      prisma.tournamentRegistration.update.mockResolvedValue({
        id: 'reg-1',
        status: RegistrationStatus.SCRATCHED_MEDICAL,
      });

      const res = await service.cancelRegistration('t-1', 'reg-1', 'Vet scratch before race', {
        id: 'u2',
        name: 'Trainer',
        role: 'HEAD_TRAINER',
      });
      expect(res.status).toBe(RegistrationStatus.SCRATCHED_MEDICAL);
    });

    it('should cancel registration in OPEN_REGISTRATION', async () => {
      prisma.tournamentRegistration.findUnique.mockResolvedValue({
        id: 'reg-1',
        tournamentId: 't-1',
        status: RegistrationStatus.REGISTERED,
        horse: { name: 'Champion' },
        tournament: { name: 'Cup', status: TournamentStatus.OPEN_REGISTRATION },
      });
      prisma.tournamentRegistration.update.mockResolvedValue({
        id: 'reg-1',
        status: RegistrationStatus.SCRATCHED_MEDICAL,
      });

      const res = await service.cancelRegistration('t-1', 'reg-1', 'Scratch', {
        id: 'u1',
        name: 'M',
        role: 'CLUB_MANAGER',
      });
      expect(res.status).toBe(RegistrationStatus.SCRATCHED_MEDICAL);
    });

    it('should reject cancelRegistration with whitespace-only reason without updating DB or audit (R-1)', async () => {
      prisma.tournamentRegistration.findUnique.mockResolvedValue({
        id: 'reg-1',
        tournamentId: 't-1',
        status: RegistrationStatus.REGISTERED,
        horse: { name: 'Champion' },
        tournament: { name: 'Cup', status: TournamentStatus.OPEN_REGISTRATION },
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(service.cancelRegistration('t-1', 'reg-1', '    ', actor)).rejects.toThrow(
        'A reason is required to scratch a horse from a tournament',
      );
      expect(prisma.tournamentRegistration.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('should reject cancelRegistration on SCRATCHED_MEDICAL registration without mutating DB or audit (R-2)', async () => {
      prisma.tournamentRegistration.findUnique.mockResolvedValue({
        id: 'reg-scratched',
        tournamentId: 't-1',
        status: RegistrationStatus.SCRATCHED_MEDICAL,
        horse: { name: 'Champion' },
        tournament: { name: 'Cup', status: TournamentStatus.OPEN_REGISTRATION },
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(
        service.cancelRegistration('t-1', 'reg-scratched', 'Second scratch', actor),
      ).rejects.toThrow('Cannot scratch registration reg-scratched with status SCRATCHED_MEDICAL');
      expect(prisma.tournamentRegistration.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('should reject cancelRegistration on DISQUALIFIED registration without mutating DB or audit (R-2)', async () => {
      prisma.tournamentRegistration.findUnique.mockResolvedValue({
        id: 'reg-dq',
        tournamentId: 't-1',
        status: RegistrationStatus.DISQUALIFIED,
        horse: { name: 'Champion' },
        tournament: { name: 'Cup', status: TournamentStatus.OPEN_REGISTRATION },
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(
        service.cancelRegistration('t-1', 'reg-dq', 'Late scratch', actor),
      ).rejects.toThrow('Cannot scratch registration reg-dq with status DISQUALIFIED');
      expect(prisma.tournamentRegistration.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('recordResults & lockResults', () => {
    it('should reject recording results on CANCELLED tournament', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-cancelled',
        status: TournamentStatus.CANCELLED,
        registrations: [],
      });

      await expect(
        service.recordResults(
          't-cancelled',
          { results: [] },
          { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow('Cannot record results for a cancelled tournament');
    });

    it('should reject recording results on COMPLETED tournament (already locked)', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-completed',
        status: TournamentStatus.COMPLETED,
        registrations: [],
      });

      await expect(
        service.recordResults(
          't-completed',
          { results: [] },
          { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow('Results for this tournament have already been locked by the Club Manager');
    });

    it('should reject recording results on OPEN_REGISTRATION tournament', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-open',
        status: TournamentStatus.OPEN_REGISTRATION,
        raceDate: new Date(Date.now() - 3600000),
        registrations: [],
      });

      await expect(
        service.recordResults(
          't-open',
          { results: [] },
          { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow('Results can only be recorded after registration has closed');
    });

    it('should reject recording results before race date', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-future',
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() + 86400000),
        registrations: [],
      });

      await expect(
        service.recordResults(
          't-future',
          { results: [] },
          { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' },
        ),
      ).rejects.toThrow('Results cannot be recorded before the race has occurred');
    });

    it('should reject recording results with lockResults=true for non-Club Manager', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup 2026',
        distanceMeters: 1600,
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() - 3600000),
        registrations: [{ id: 'reg-1' }],
      });
      prisma.tournamentResult.upsert.mockResolvedValue({
        id: 'res-1',
        registrationId: 'reg-1',
        finalRank: 1,
        finishTimeSeconds: 100,
        prizeMoneyWon: 1000,
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(
        service.recordResults(
          't-1',
          {
            results: [{ registrationId: 'reg-1', finalRank: 1, finishTimeSeconds: 100 }],
            lockResults: true,
          },
          actor,
        ),
      ).rejects.toThrow(
        'Only the Club Manager has the authority to record or edit tournament results',
      );
      expect(prisma.tournamentResult.upsert).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('should reject recording draft results (lockResults=false) for non-Club Manager without mutating DB or audit', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup 2026',
        distanceMeters: 1600,
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() - 3600000),
        registrations: [{ id: 'reg-1' }],
      });
      prisma.tournamentResult.upsert.mockResolvedValue({
        id: 'res-1',
        registrationId: 'reg-1',
        finalRank: 1,
        finishTimeSeconds: 100,
        prizeMoneyWon: 1000,
      });

      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };
      await expect(
        service.recordResults(
          't-1',
          {
            results: [{ registrationId: 'reg-1', finalRank: 1, finishTimeSeconds: 100 }],
            lockResults: false,
          },
          actor,
        ),
      ).rejects.toThrow(
        'Only the Club Manager has the authority to record or edit tournament results',
      );
      expect(prisma.tournamentResult.upsert).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('should allow Club Manager to record draft results in CLOSED_REGISTRATION after race date without locking', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup 2026',
        distanceMeters: 1600,
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() - 3600000),
        registrations: [{ id: 'reg-1', status: RegistrationStatus.REGISTERED }],
      });
      prisma.tournamentResult.upsert.mockResolvedValue({
        id: 'res-1',
        registrationId: 'reg-1',
        finalRank: 1,
        finishTimeSeconds: 100,
        prizeMoneyWon: 1000,
      });

      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      const res: any = await service.recordResults(
        't-1',
        {
          results: [{ registrationId: 'reg-1', finalRank: 1, finishTimeSeconds: 100 }],
          lockResults: false,
        },
        actor,
      );

      expect(res.success).toBe(true);
      expect(res.results).toHaveLength(1);
      expect(audit.record).toHaveBeenCalled();
    });

    it('should reject recordResults containing SCRATCHED_MEDICAL registration without mutating DB or audit (R-3)', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup 2026',
        distanceMeters: 1600,
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() - 3600000),
        registrations: [{ id: 'reg-scratched', status: RegistrationStatus.SCRATCHED_MEDICAL }],
      });

      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      await expect(
        service.recordResults(
          't-1',
          {
            results: [{ registrationId: 'reg-scratched', finalRank: 1, finishTimeSeconds: 100 }],
            lockResults: false,
          },
          actor,
        ),
      ).rejects.toThrow(
        'Cannot record result for registration reg-scratched with status SCRATCHED_MEDICAL',
      );
      expect(prisma.tournamentResult.upsert).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('should reject recordResults containing DISQUALIFIED registration without mutating DB or audit (R-3)', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup 2026',
        distanceMeters: 1600,
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() - 3600000),
        registrations: [{ id: 'reg-dq', status: RegistrationStatus.DISQUALIFIED }],
      });

      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      await expect(
        service.recordResults(
          't-1',
          {
            results: [{ registrationId: 'reg-dq', finalRank: 1, finishTimeSeconds: 100 }],
            lockResults: false,
          },
          actor,
        ),
      ).rejects.toThrow('Cannot record result for registration reg-dq with status DISQUALIFIED');
      expect(prisma.tournamentResult.upsert).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('should reject recordResults with lockResults=true when results are incomplete leaving results, tournament, horses, and audit untouched (R-4)', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-1',
        name: 'Cup 2026',
        distanceMeters: 1600,
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() - 3600000),
        registrations: [
          { id: 'reg-1', status: RegistrationStatus.REGISTERED, result: null },
          { id: 'reg-2', status: RegistrationStatus.REGISTERED, result: null },
        ],
      });

      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      await expect(
        service.recordResults(
          't-1',
          {
            results: [{ registrationId: 'reg-1', finalRank: 1, finishTimeSeconds: 100 }],
            lockResults: true,
          },
          actor,
        ),
      ).rejects.toThrow('Cannot lock results: 1 registered horse(s) still lack finish results');

      expect(prisma.tournamentResult.upsert).not.toHaveBeenCalled();
      expect(prisma.tournament.update).not.toHaveBeenCalled();
      expect(prisma.horse.update).not.toHaveBeenCalled();
      expect(prisma.financialInvoice.create).not.toHaveBeenCalled();
      expect(prisma.financialInvoice.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('should atomically upsert results and lock tournament with lockResults=true in a single transaction (R-4)', async () => {
      const mockTourney: any = {
        id: 't-1',
        name: 'Cup 2026',
        distanceMeters: 1600,
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() - 3600000),
        prizePool: 100000000,
        registrations: [
          {
            id: 'reg-1',
            horseId: 'h-1',
            status: RegistrationStatus.REGISTERED,
            horse: { id: 'h-1', ownerId: 'o-1' },
            result: null,
          },
        ],
      };

      prisma.tournament.findUnique.mockImplementation(() => Promise.resolve(mockTourney));
      prisma.tournament.update.mockImplementation(({ data }: any) => {
        Object.assign(mockTourney, data);
        return Promise.resolve(mockTourney);
      });
      prisma.tournamentResult.upsert.mockResolvedValue({
        id: 'res-1',
        registrationId: 'reg-1',
        finalRank: 1,
        finishTimeSeconds: 100,
        prizeMoneyWon: 10000000,
      });
      prisma.horse.update.mockResolvedValue({});
      prisma.financialInvoice.findFirst.mockResolvedValue(null);
      prisma.financialInvoice.create.mockResolvedValue({});

      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      const res: any = await service.recordResults(
        't-1',
        {
          results: [
            {
              registrationId: 'reg-1',
              finalRank: 1,
              finishTimeSeconds: 100,
              prizeMoneyWon: 10000000,
            },
          ],
          lockResults: true,
        },
        actor,
      );

      expect(res.status).toBe(TournamentStatus.COMPLETED);
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.tournament.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: TournamentStatus.COMPLETED } }),
      );
      expect(prisma.horse.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: HorseStatus.RESTING } }),
      );
      expect(prisma.financialInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerId: 'o-1',
            prizeCredit: 7000000,
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        'TOURNAMENT_RESULTS_LOCKED',
        expect.any(String),
        't-1',
        expect.anything(),
      );
    });

    it('should forbid non-Club Manager from locking tournament results directly', async () => {
      const actor = { id: 'u2', name: 'Trainer', role: 'HEAD_TRAINER' };

      await expect(service.lockResults('t-1', actor)).rejects.toThrow(
        'Only the Club Manager has the authority to lock tournament results',
      );
    });

    it('should reject locking results on CANCELLED tournament', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-cancelled',
        status: TournamentStatus.CANCELLED,
        registrations: [],
      });

      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      await expect(service.lockResults('t-cancelled', actor)).rejects.toThrow(
        'Cannot lock results for a cancelled tournament',
      );
    });

    it('should reject locking results on OPEN_REGISTRATION tournament', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-open',
        status: TournamentStatus.OPEN_REGISTRATION,
        raceDate: new Date(Date.now() - 3600000),
        registrations: [],
      });

      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      await expect(service.lockResults('t-open', actor)).rejects.toThrow(
        'Results can only be locked when tournament is in CLOSED_REGISTRATION status',
      );
    });

    it('should reject locking results before race date', async () => {
      prisma.tournament.findUnique.mockResolvedValue({
        id: 't-future',
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() + 86400000),
        registrations: [],
      });

      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      await expect(service.lockResults('t-future', actor)).rejects.toThrow(
        'Results cannot be locked before the race date',
      );
    });

    it('should allow Club Manager to lock official tournament results in CLOSED_REGISTRATION after race date', async () => {
      const mockTourney: any = {
        id: 't-1',
        name: 'Cup 2026',
        status: TournamentStatus.CLOSED_REGISTRATION,
        raceDate: new Date(Date.now() - 3600000),
        prizePool: 100000000,
        registrations: [
          {
            id: 'reg-1',
            horseId: 'h-1',
            horse: { id: 'h-1', ownerId: 'o-1' },
            status: RegistrationStatus.CONFIRMED,
            result: { id: 'res-1', rank: 1, finishTimeSeconds: 120 },
          },
        ],
      };

      prisma.tournament.findUnique.mockImplementation(() => Promise.resolve(mockTourney));
      prisma.tournament.update.mockImplementation(({ data }: any) => {
        Object.assign(mockTourney, data);
        return Promise.resolve(mockTourney);
      });

      prisma.tournamentRegistration.findMany.mockResolvedValue([
        {
          id: 'reg-1',
          horseId: 'h-1',
          horse: { id: 'h-1', ownerId: 'o-1' },
          result: { id: 'res-1', rank: 1, finishTimeSeconds: 120 },
        },
      ]);

      prisma.tournamentResult.upsert.mockResolvedValue({});
      prisma.horse.update.mockResolvedValue({});

      const actor = { id: 'u1', name: 'Manager', role: 'CLUB_MANAGER' };
      const res = await service.lockResults('t-1', actor);
      expect(res.status).toBe(TournamentStatus.COMPLETED);
    });
  });

  describe('findOne - ownership scoping & PII protection (CR-011 / TASK-007)', () => {
    const mockTournament = {
      id: 'tourn-1',
      name: 'Autumn Championship',
      code: 'TOURN-AUTUMN-2026',
      status: TournamentStatus.OPEN_REGISTRATION,
      prizePool: '100000000',
      raceDate: new Date('2026-11-01'),
      registrationDeadline: new Date('2026-10-31'),
    };

    it('scopes registrations to owned horses at Prisma query level when caller is HORSE_OWNER', async () => {
      const ownerUser = {
        userId: 'owner-1',
        email: 'owner1@gmail.com',
        role: UserRole.HORSE_OWNER,
        fullName: 'Owner One',
      };

      prisma.tournament.findUnique.mockImplementation(async (args: any) => {
        expect(args.where).toEqual({ id: 'tourn-1' });
        expect(args.include.registrations.where).toEqual({
          horse: { ownerId: 'owner-1' },
        });

        return {
          ...mockTournament,
          registrations: [
            {
              id: 'reg-owner-1',
              horseId: 'h-owned',
              registrationDate: new Date('2026-10-20'),
              horse: {
                id: 'h-owned',
                name: 'Owned Runner',
                horseCode: 'HC-001',
                breed: 'Thoroughbred',
                avatarUrl: null,
                status: 'ACTIVE',
                isMedicalLocked: false,
                ownerId: 'owner-1',
                owner: { id: 'owner-1', fullName: 'Owner One', email: 'owner1@gmail.com' },
              },
              registeredByTrainer: {
                id: 'tr-1',
                fullName: 'Trainer John',
                email: 'trainer@gmail.com',
              },
              result: { id: 'res-1', rank: 1, prizeMoneyWon: '50000000' },
            },
          ],
        };
      });

      const result = await service.findOne('tourn-1', ownerUser);

      expect(prisma.tournament.findUnique).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('tourn-1');
      expect(result.registrations).toHaveLength(1);
      expect(result.registrations[0].horse.ownerId).toBe('owner-1');
      expect(result.registrations[0].horse.owner?.email).toBe('owner1@gmail.com');

      // Negative assertions: ensure no foreign owner PII or foreign registrations exist
      const hasForeignOwner = result.registrations.some((r: any) => r.horse.ownerId !== 'owner-1');
      expect(hasForeignOwner).toBe(false);
      const foreignEmails = result.registrations
        .map((r: any) => r.horse.owner?.email)
        .filter((e: string) => e !== 'owner1@gmail.com');
      expect(foreignEmails).toEqual([]);
    });

    it('does not scope registrations when caller is staff (CLUB_MANAGER / HEAD_TRAINER)', async () => {
      const managerUser = {
        userId: 'mgr-1',
        email: 'manager@gmail.com',
        role: UserRole.CLUB_MANAGER,
        fullName: 'Club Manager',
      };

      prisma.tournament.findUnique.mockImplementation(async (args: any) => {
        expect(args.include.registrations.where).toBeUndefined();
        return {
          ...mockTournament,
          registrations: [
            {
              id: 'reg-owner-1',
              horse: { id: 'h-1', ownerId: 'owner-1', owner: { email: 'owner1@gmail.com' } },
              result: null,
            },
            {
              id: 'reg-owner-2',
              horse: { id: 'h-2', ownerId: 'owner-2', owner: { email: 'owner2@gmail.com' } },
              result: null,
            },
          ],
        };
      });

      const result = await service.findOne('tourn-1', managerUser);
      expect(result.registrations).toHaveLength(2);
    });

    it('throws 404 NOT_FOUND when tournament does not exist', async () => {
      prisma.tournament.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne('non-existent', {
          userId: 'owner-1',
          email: 'owner@gmail.com',
          role: UserRole.HORSE_OWNER,
          fullName: 'Owner',
        }),
      ).rejects.toThrow('Tournament non-existent not found');
    });
  });
});
