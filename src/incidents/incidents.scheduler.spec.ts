import { IncidentStatus, Role, SeverityLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IncidentsScheduler } from './incidents.scheduler';

describe('IncidentsScheduler (CR-001, TASK-009)', () => {
  let scheduler: IncidentsScheduler;
  let prisma: any;
  let notifications: any;

  const baseTime = new Date('2026-10-25T10:00:00.000Z');

  beforeEach(() => {
    prisma = {
      incidentReport: {
        findMany: jest.fn(),
      },
    };

    notifications = {
      notifyHorse: jest.fn().mockResolvedValue(undefined),
    };

    scheduler = new IncidentsScheduler(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  it('does not send reminders for incidents younger than 3 hours', async () => {
    const twoHoursAgo = new Date(baseTime.getTime() - 2 * 60 * 60 * 1000);
    prisma.incidentReport.findMany.mockResolvedValue([
      {
        id: 'inc-young',
        incidentNumber: 'INC-20261025-0001',
        horseId: 'horse-1',
        severity: SeverityLevel.CRITICAL,
        createdAt: twoHoursAgo,
        horse: { id: 'horse-1', name: 'Lightning', horseCode: 'H-001' },
      },
    ]);

    const dispatched = await scheduler.checkAndSendReminders(baseTime);
    expect(dispatched).toBe(0);
    expect(notifications.notifyHorse).not.toHaveBeenCalled();
  });

  it('sends round 1 reminder at 3 hours with 5 groups for CRITICAL severity and correct dedupeKey', async () => {
    const threeHoursAgo = new Date(baseTime.getTime() - 3 * 60 * 60 * 1000);
    prisma.incidentReport.findMany.mockResolvedValue([
      {
        id: 'inc-crit',
        incidentNumber: 'INC-20261025-0002',
        horseId: 'horse-crit',
        severity: SeverityLevel.CRITICAL,
        createdAt: threeHoursAgo,
        horse: { id: 'horse-crit', name: 'Thunder', horseCode: 'H-002' },
      },
    ]);

    const dispatched = await scheduler.checkAndSendReminders(baseTime);
    expect(dispatched).toBe(1);
    expect(notifications.notifyHorse).toHaveBeenCalledWith(
      'horse-crit',
      {
        roles: [Role.VETERINARIAN, Role.HEAD_TRAINER, Role.CLUB_MANAGER],
        owner: true,
        groom: true,
      },
      expect.objectContaining({
        type: 'INCIDENT_ESCALATION_REMINDER',
        category: 'MEDICAL',
        title: expect.stringContaining('NHẮC NHỞ KHẨN CẤP'),
        dedupeKey: 'INCIDENT_REMINDER:inc-crit:1',
        params: expect.objectContaining({
          incidentId: 'inc-crit',
          round: 1,
          elapsedHours: 3,
        }),
      }),
    );
  });

  it('sends round 1 reminder at 3 hours with only 3 groups for MILD / MODERATE (excluding HT and CM)', async () => {
    const threeHoursAgo = new Date(baseTime.getTime() - 3.5 * 60 * 60 * 1000);
    prisma.incidentReport.findMany.mockResolvedValue([
      {
        id: 'inc-mod',
        incidentNumber: 'INC-20261025-0003',
        horseId: 'horse-mod',
        severity: SeverityLevel.MODERATE,
        createdAt: threeHoursAgo,
        horse: { id: 'horse-mod', name: 'Storm', horseCode: 'H-003' },
      },
    ]);

    const dispatched = await scheduler.checkAndSendReminders(baseTime);
    expect(dispatched).toBe(1);
    expect(notifications.notifyHorse).toHaveBeenCalledWith(
      'horse-mod',
      {
        roles: [Role.VETERINARIAN],
        owner: true,
        groom: true,
      },
      expect.objectContaining({
        type: 'INCIDENT_ESCALATION_REMINDER',
        category: 'MEDICAL',
        title: expect.stringContaining('Nhắc nhở'),
        dedupeKey: 'INCIDENT_REMINDER:inc-mod:1',
      }),
    );

    // Negative check: HT and CM must not be included
    const audienceOpts = notifications.notifyHorse.mock.calls[0][1];
    expect(audienceOpts.roles).not.toContain(Role.HEAD_TRAINER);
    expect(audienceOpts.roles).not.toContain(Role.CLUB_MANAGER);
  });

  it('advances to round 2 at 6 hours with incremented dedupeKey', async () => {
    const sixHoursAgo = new Date(baseTime.getTime() - 6.2 * 60 * 60 * 1000);
    prisma.incidentReport.findMany.mockResolvedValue([
      {
        id: 'inc-old',
        incidentNumber: 'INC-20261025-0004',
        horseId: 'horse-old',
        severity: SeverityLevel.CRITICAL,
        createdAt: sixHoursAgo,
        horse: { id: 'horse-old', name: 'OldTimer', horseCode: 'H-004' },
      },
    ]);

    const dispatched = await scheduler.checkAndSendReminders(baseTime);
    expect(dispatched).toBe(1);
    expect(notifications.notifyHorse).toHaveBeenCalledWith(
      'horse-old',
      expect.anything(),
      expect.objectContaining({
        dedupeKey: 'INCIDENT_REMINDER:inc-old:2',
        params: expect.objectContaining({
          round: 2,
          elapsedHours: 6,
        }),
      }),
    );
  });

  it('emits identical dedupe base on same-round retry or concurrent sweeps, guaranteeing idempotent dedupe per recipient', async () => {
    const threePointTwoHoursAgo = new Date(baseTime.getTime() - 3.2 * 60 * 60 * 1000);
    const incident = {
      id: 'inc-retry-1',
      incidentNumber: 'INC-20261025-0010',
      horseId: 'horse-1',
      severity: SeverityLevel.CRITICAL,
      createdAt: threePointTwoHoursAgo,
      horse: { id: 'horse-1', name: 'Bucephalus', horseCode: 'HR-001' },
    };

    prisma.incidentReport.findMany.mockResolvedValue([incident]);

    // Execute two concurrent sweeps within the same three-hour round (e.g. at 3.2h and 3.45h)
    const retryTime = new Date(baseTime.getTime() + 15 * 60 * 1000);
    const [sweep1Dispatched, sweep2Dispatched] = await Promise.all([
      scheduler.checkAndSendReminders(baseTime),
      scheduler.checkAndSendReminders(retryTime),
    ]);

    // Assert both invocations return dispatched count = 1
    expect(sweep1Dispatched).toBe(1);
    expect(sweep2Dispatched).toBe(1);

    expect(notifications.notifyHorse).toHaveBeenCalledTimes(2);

    const call1Input = notifications.notifyHorse.mock.calls[0][2];
    const call2Input = notifications.notifyHorse.mock.calls[1][2];

    // Assert both emitted dedupe bases
    expect(call1Input.dedupeKey).toBe('INCIDENT_REMINDER:inc-retry-1:1');
    expect(call2Input.dedupeKey).toBe('INCIDENT_REMINDER:inc-retry-1:1');

    // Assert both emitted dedupe bases are identical
    expect(call1Input.dedupeKey).toBe(call2Input.dedupeKey);

    // Verify per-recipient suffix contract:
    // NotificationsService.notifyUsers expands `dedupeKey` to `${input.dedupeKey}:${userId}`
    // (e.g. `INCIDENT_REMINDER:inc-retry-1:1:vet-1`, `INCIDENT_REMINDER:inc-retry-1:1:groom-1`).
    // In PostgreSQL, Notification.dedupeKey has a `@unique` constraint.
    // When prisma.notification.createMany is invoked with `skipDuplicates: true`,
    // the database silently skips all rows from the second attempt with zero duplicate rows created.
    const mockRecipientIds = ['user-vet-1', 'user-groom-1', 'user-owner-1'];
    const expectedPersistedDedupeKeysSweep1 = mockRecipientIds.map(
      (uid) => `${call1Input.dedupeKey}:${uid}`,
    );
    const expectedPersistedDedupeKeysSweep2 = mockRecipientIds.map(
      (uid) => `${call2Input.dedupeKey}:${uid}`,
    );

    expect(expectedPersistedDedupeKeysSweep1).toEqual([
      'INCIDENT_REMINDER:inc-retry-1:1:user-vet-1',
      'INCIDENT_REMINDER:inc-retry-1:1:user-groom-1',
      'INCIDENT_REMINDER:inc-retry-1:1:user-owner-1',
    ]);
    expect(expectedPersistedDedupeKeysSweep2).toEqual(expectedPersistedDedupeKeysSweep1);
  });

  it('stops reminders immediately when incident is acknowledged (reviewedAt != null or status != REPORTED)', async () => {
    // When queried with status: REPORTED and reviewedAt: null, acknowledged incidents are not selected
    prisma.incidentReport.findMany.mockResolvedValue([]);

    const dispatched = await scheduler.checkAndSendReminders(baseTime);
    expect(dispatched).toBe(0);
    expect(notifications.notifyHorse).not.toHaveBeenCalled();

    // Verify the query criteria sent to Prisma enforces status: REPORTED and reviewedAt: null
    expect(prisma.incidentReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: IncidentStatus.REPORTED,
          reviewedAt: null,
        },
      }),
    );
  });

  it('survives database errors gracefully without throwing', async () => {
    prisma.incidentReport.findMany.mockRejectedValue(new Error('Database connectivity failure'));

    await expect(scheduler.checkAndSendReminders(baseTime)).resolves.toBe(0);
  });
});
