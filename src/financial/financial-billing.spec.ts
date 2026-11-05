import { InvoiceStatus } from '@prisma/client';
import { FinancialService } from './financial.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('Financial billing lifecycle', () => {
  const manager = { id: 'manager', name: 'Manager', role: 'CLUB_MANAGER' };
  const owner = { id: 'owner', name: 'Owner', role: 'HORSE_OWNER' };
  const now = new Date('2027-01-01T03:00:00Z');
  const base = {
    id: 'invoice',
    horseId: 'horse',
    ownerId: 'owner',
    billingPeriod: '2026-11',
    boardingFee: 6000000,
    trainingFee: 0,
    medicalFee: 0,
    prizeCredit: 0,
    netAmount: 6000000,
    horse: { name: 'Thunder' },
    status: InvoiceStatus.DRAFT,
    dueAt: null,
  };
  let db: any;
  let service: FinancialService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    db = {
      horse: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'horse',
            ownerId: 'owner',
            stallAllocations: [{ startDate: new Date('2026-10-01'), endDate: null }],
          },
        ]),
      },
      stallAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            startDate: new Date('2026-11-01T00:00:00+07:00'),
            endDate: new Date('2026-11-11T00:00:00+07:00'),
          },
        ]),
      },
      financialInvoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(base),
        create: jest.fn().mockImplementation(({ data }) => ({ ...base, ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ ...base, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((fn) => fn(db)),
    };
    service = new FinancialService(
      db as PrismaService,
      { record: jest.fn() } as unknown as AuditService,
      { notifyUsers: jest.fn() } as unknown as NotificationsService,
    );
  });
  afterEach(() => jest.useRealTimers());

  it('creates independent monthly snapshots and does not duplicate a paid period', async () => {
    db.financialInvoice.findFirst.mockImplementation(({ where }) =>
      where.billingPeriod === '2026-10' ? { ...base, status: 'PAID' } : null,
    );
    expect((await service.generateMonthlyDrafts('2026-10', manager)).createdCount).toBe(0);
    expect((await service.generateMonthlyDrafts('2026-11', manager)).createdCount).toBe(1);
    expect(db.financialInvoice.create.mock.calls[0][0].data).toMatchObject({
      billingPeriod: '2026-11',
      boardingDays: 30,
      boardingMonthlyRate: 6000000,
      boardingFee: 6000000,
      status: 'DRAFT',
    });
    db.financialInvoice.findFirst.mockResolvedValue(base);
    expect((await service.generateMonthlyDrafts('2026-11', manager)).createdCount).toBe(0);
  });
  it('rejects an unfinished billing period', async () => {
    await expect(service.generateMonthlyDrafts('2027-01', manager)).rejects.toMatchObject({
      response: { code: 'BILLING_PERIOD_NOT_CLOSED' },
    });
    expect(db.financialInvoice.create).not.toHaveBeenCalled();
  });
  it('calculates snapshots for manually created invoices instead of trusting a client fee', async () => {
    const result = await service.create(
      {
        horseId: 'horse',
        ownerId: 'owner',
        billingPeriod: '2026-11',
        boardingFee: 1,
        status: InvoiceStatus.SENT,
      },
      manager,
    );
    expect(result.boardingDays).toBe(10);
    expect(result.boardingMonthlyRate).toBe(6000000);
    expect(result.boardingFee).toBe(2000000);
    expect(result.dueAt).toEqual(new Date('2027-01-08T03:00:00Z'));
  });
  it('does not let an edit invalidate the boarding calculation snapshot', async () => {
    db.financialInvoice.findUnique.mockResolvedValue({
      ...base,
      boardingDays: 30,
      boardingMonthlyRate: 6000000,
    });
    await expect(service.update('invoice', { boardingFee: 1 }, manager)).rejects.toMatchObject({
      response: { code: 'BOARDING_FEE_READ_ONLY' },
    });
    await expect(
      service.update('invoice', { billingPeriod: '2026-12' }, manager),
    ).rejects.toMatchObject({ response: { code: 'BOARDING_FEE_READ_ONLY' } });
    expect(db.financialInvoice.update).not.toHaveBeenCalled();
  });
  it('sets exactly seven days on first issue, never extends an existing deadline', async () => {
    const issued = await service.changeStatus('invoice', InvoiceStatus.SENT, manager);
    expect(issued.dueAt).toEqual(new Date('2027-01-08T03:00:00Z'));
    const dueAt = new Date('2026-12-10T03:00:00Z');
    db.financialInvoice.findUnique.mockResolvedValue({ ...base, status: 'SENT', dueAt });
    await service.changeStatus('invoice', InvoiceStatus.SENT, manager);
    expect(db.financialInvoice.update.mock.calls[1][0].data.dueAt).toBeUndefined();
  });
  it('sweeps only positive SENT invoices strictly after the deadline', async () => {
    expect(await service.sweepOverdue()).toBe(1);
    expect(db.financialInvoice.updateMany).toHaveBeenCalledWith({
      where: { status: 'SENT', dueAt: { lt: now }, netAmount: { gt: 0 } },
      data: { status: 'OVERDUE' },
    });
  });
  it('totals positive issued debts only, excluding credits and paid/unissued/cancelled invoices', async () => {
    db.financialInvoice.findMany.mockResolvedValue([
      { ...base, status: 'SENT', netAmount: 6000000 },
      { ...base, status: 'OVERDUE', netAmount: 3000000 },
      { ...base, status: 'SENT', netAmount: -2000000 },
      ...['PAID', 'DRAFT', 'CANCELLED'].map((status) => ({ ...base, status })),
    ]);
    expect((await service.getOwnerSummary('owner')).outstandingDebt).toBe(9000000);
  });
  it('keeps paid invoices immutable through status and update routes', async () => {
    db.financialInvoice.findUnique.mockResolvedValue({ ...base, status: 'PAID' });
    await expect(service.changeStatus('invoice', InvoiceStatus.SENT, manager)).rejects.toThrow();
    await expect(service.update('invoice', { medicalFee: 1 }, manager)).rejects.toThrow();
    expect(db.financialInvoice.update).not.toHaveBeenCalled();
  });
  it('still permits an owner to pay an overdue invoice without a penalty', async () => {
    db.financialInvoice.findUnique.mockResolvedValue({ ...base, status: 'OVERDUE' });
    const result = await service.payInvoice('invoice', {}, owner);
    expect(result.status).toBe('PAID');
    expect(result.netAmount).toBe(6000000);
  });
});
