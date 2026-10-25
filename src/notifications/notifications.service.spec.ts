import { NotificationCategory, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const prisma = {
    user: { findMany: jest.fn() },
    horse: { findUnique: jest.fn() },
    notification: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const service = new NotificationsService(prisma as unknown as PrismaService);
  const input = {
    type: 'LOCK_LIFTED',
    category: NotificationCategory.LOCK,
    title: 'Training Lock Lifted',
    message: 'Horse is released from medical lock',
  };

  beforeEach(() => jest.clearAllMocks());

  describe('notifyUsers', () => {
    it('should not notify the person who did the action', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u2', role: Role.HEAD_TRAINER, notify: null }]);
      await service.notifyUsers(['u1', 'u2', null], input, 'u1');
      expect(prisma.user.findMany.mock.calls[0][0].where.id.in).toEqual(['u2']);
      expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
    });

    it('should skip users who switched the matching notification off', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: Role.HEAD_TRAINER, notify: { lockLifted: false } },
        { id: 'u2', role: Role.HEAD_TRAINER, notify: null },
      ]);
      await service.notifyUsers(['u1', 'u2'], input);
      const rows = prisma.notification.createMany.mock.calls[0][0].data;
      expect(rows.map((r: { userId: string }) => r.userId)).toEqual(['u2']);
    });

    it('should respect raceResults toggle for TOURNAMENT_COMPLETED', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', role: Role.HORSE_OWNER, notify: { raceResults: false } },
        { id: 'u2', role: Role.HORSE_OWNER, notify: { raceResults: true } },
      ]);
      await service.notifyUsers(['u1', 'u2'], {
        type: 'TOURNAMENT_COMPLETED',
        category: NotificationCategory.TRAINING,
        title: 'Results locked',
        message: 'Tournament official results locked',
      });
      const rows = prisma.notification.createMany.mock.calls[0][0].data;
      expect(rows.map((r: { userId: string }) => r.userId)).toEqual(['u2']);
    });

    it('should query only ACTIVE users from the database', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u1', role: Role.GROOM, notify: null }]);
      await service.notifyUsers(['u1', 'u2'], input);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['u1', 'u2'] }, status: UserStatus.ACTIVE },
        select: { id: true, role: true, notify: true },
      });
    });

    it('should give each recipient its own dedupe key', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u1', role: Role.VETERINARIAN, notify: null }]);
      await service.notifyUsers(['u1'], {
        ...input,
        type: 'PREVENTIVE_DUE',
        dedupeKey: 'PREVENTIVE_DUE:s1',
      });
      const call = prisma.notification.createMany.mock.calls[0][0];
      expect(call.data[0].dedupeKey).toBe('PREVENTIVE_DUE:s1:u1');
      expect(call.skipDuplicates).toBe(true);
    });

    it('should do nothing when all recipient ids are empty or match excludeUserId', async () => {
      await service.notifyUsers(['u1', null, undefined], input, 'u1');
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('should never throw when the database fails', async () => {
      prisma.user.findMany.mockRejectedValue(new Error('db down'));
      await expect(service.notifyUsers(['u1'], input)).resolves.toBeUndefined();
    });
  });

  describe('horseAudience & notifyHorse', () => {
    it('returns owning owner and assigned active groom when requested', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        id: 'horse-1',
        ownerId: 'owner-1',
        stallAllocations: [{ assignedGroomUserId: 'groom-1' }],
      });
      prisma.user.findMany.mockResolvedValue([{ id: 'ht-1' }]);

      const audience = await service.horseAudience('horse-1', {
        roles: [Role.HEAD_TRAINER],
        owner: true,
        groom: true,
      });

      expect(prisma.horse.findUnique).toHaveBeenCalledWith({
        where: { id: 'horse-1' },
        select: {
          ownerId: true,
          stallAllocations: { where: { isActive: true }, select: { assignedGroomUserId: true } },
        },
      });
      expect(audience).toEqual(['ht-1', 'owner-1', 'groom-1']);
    });

    it('negative: foreign owner and unassigned grooms are never returned', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        id: 'horse-1',
        ownerId: 'owner-1',
        stallAllocations: [{ assignedGroomUserId: 'groom-1' }],
      });

      const audience = await service.horseAudience('horse-1', { owner: true, groom: true });

      expect(audience).toContain('owner-1');
      expect(audience).toContain('groom-1');
      expect(audience).not.toContain('owner-2');
      expect(audience).not.toContain('groom-2');
    });

    it('negative: inactive stall allocations are not returned by the query', async () => {
      // Prisma query includes { where: { isActive: true } } so inactive grooms are never selected
      prisma.horse.findUnique.mockResolvedValue({
        id: 'horse-2',
        ownerId: 'owner-2',
        stallAllocations: [], // no active allocation
      });

      const audience = await service.horseAudience('horse-2', { owner: true, groom: true });
      expect(audience).toEqual(['owner-2']);
      expect(audience).not.toContain('groom-past');
    });

    it('negative: opts.owner: false or opts.groom: false excludes respective actor', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        id: 'horse-1',
        ownerId: 'owner-1',
        stallAllocations: [{ assignedGroomUserId: 'groom-1' }],
      });

      const ownerOnly = await service.horseAudience('horse-1', { owner: true, groom: false });
      expect(ownerOnly).toEqual(['owner-1']);

      const groomOnly = await service.horseAudience('horse-1', { owner: false, groom: true });
      expect(groomOnly).toEqual(['groom-1']);
    });

    it('negative: handles non-existent horse or null owner/groom gracefully', async () => {
      prisma.horse.findUnique.mockResolvedValue(null);
      const emptyAudience = await service.horseAudience('non-existent', {
        owner: true,
        groom: true,
      });
      expect(emptyAudience).toEqual([]);

      prisma.horse.findUnique.mockResolvedValue({
        id: 'horse-3',
        ownerId: null,
        stallAllocations: [],
      });
      const nullAudience = await service.horseAudience('horse-3', { owner: true, groom: true });
      expect(nullAudience).toEqual([]);
    });

    it('notifyHorse routes to exact horse audience and excludes actor', async () => {
      prisma.horse.findUnique.mockResolvedValue({
        id: 'horse-1',
        ownerId: 'owner-1',
        stallAllocations: [{ assignedGroomUserId: 'groom-1' }],
      });
      prisma.user.findMany.mockResolvedValue([
        { id: 'owner-1', role: Role.HORSE_OWNER, notify: null },
      ]);

      await service.notifyHorse(
        'horse-1',
        { owner: true, groom: true },
        {
          type: 'HORSE_STATUS_CHANGED',
          category: NotificationCategory.HORSE,
          title: 'Status changed',
          message: 'Status changed to ACTIVE',
        },
        'groom-1', // actor is groom-1
      );

      // notifyUsers should be called without groom-1
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['owner-1'] }, status: UserStatus.ACTIVE },
        select: { id: true, role: true, notify: true },
      });
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ userId: 'owner-1', type: 'HORSE_STATUS_CHANGED' })],
        skipDuplicates: true,
      });
    });
  });

  describe('notifyRoles', () => {
    it('routes only to users of specified active roles and excludes actor', async () => {
      prisma.user.findMany
        .mockResolvedValueOnce([{ id: 'cm-1' }, { id: 'cm-2' }]) // notifyRoles user query
        .mockResolvedValueOnce([{ id: 'cm-2', role: Role.CLUB_MANAGER, notify: null }]); // notifyUsers query

      await service.notifyRoles(
        [Role.CLUB_MANAGER],
        {
          type: 'RESTOCK_REQUEST_CREATED',
          category: NotificationCategory.SYSTEM,
          title: 'Restock request created',
          message: 'Groom requested feed',
        },
        'cm-1', // actor is cm-1
      );

      expect(prisma.user.findMany).toHaveBeenNthCalledWith(1, {
        where: { role: { in: [Role.CLUB_MANAGER] }, status: UserStatus.ACTIVE },
        select: { id: true },
      });
      expect(prisma.user.findMany).toHaveBeenNthCalledWith(2, {
        where: { id: { in: ['cm-2'] }, status: UserStatus.ACTIVE },
        select: { id: true, role: true, notify: true },
      });
    });
  });

  describe('inbox API (list, markRead, markAllRead, clear)', () => {
    it('list returns notifications and unreadCount in descending order', async () => {
      const now = new Date();
      prisma.$transaction.mockResolvedValue([
        [
          {
            id: 'n-1',
            userId: 'u-1',
            type: 'LOCK_LIFTED',
            category: NotificationCategory.LOCK,
            title: 'T',
            message: 'M',
            params: null,
            link: null,
            senderName: null,
            readAt: null,
            createdAt: now,
          },
        ],
        1,
      ]);

      const res = await service.list('u-1', 20);
      expect(res.unreadCount).toBe(1);
      expect(res.notifications).toHaveLength(1);
      expect(res.notifications[0]).toEqual({
        id: 'n-1',
        type: 'LOCK_LIFTED',
        category: NotificationCategory.LOCK,
        title: 'T',
        message: 'M',
        params: undefined,
        link: undefined,
        senderName: undefined,
        read: false,
        createdAt: now.toISOString(),
      });
    });

    it('markRead marks specified notifications read and returns refreshed list', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.markRead('u-1', ['n-1']);
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-1', id: { in: ['n-1'] }, readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });

    it('markRead rejects invalid ids input', async () => {
      await expect(service.markRead('u-1', 'not-array' as unknown as string[])).rejects.toThrow();
    });

    it('markAllRead marks all unread notifications read', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);
      await service.markAllRead('u-1');
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });

    it('clear deletes all user notifications and returns empty list', async () => {
      const res = await service.clear('u-1');
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-1' } });
      expect(res).toEqual({ notifications: [], unreadCount: 0 });
    });
  });
});
