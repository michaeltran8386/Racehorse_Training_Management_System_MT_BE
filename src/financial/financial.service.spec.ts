import { Test, TestingModule } from '@nestjs/testing';
import { FinancialService } from './financial.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoiceStatus } from '@prisma/client';

describe('FinancialService', () => {
  let service: FinancialService;
  let prisma: any;
  let audit: any;
  let notifications: any;

  beforeEach(async () => {
    prisma = {
      financialInvoice: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      stallAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            startDate: new Date('2026-10-01T00:00:00+07:00'),
            endDate: new Date('2026-11-01T00:00:00+07:00'),
          },
        ]),
      },
      horse: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
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
        FinancialService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<FinancialService>(FinancialService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('payInvoice', () => {
    const owner = { id: 'owner-1', name: 'Owner', role: 'HORSE_OWNER' };
    const invoice = {
      id: 'inv-pay',
      ownerId: 'owner-1',
      status: InvoiceStatus.SENT,
      netAmount: 100,
      boardingFee: 100,
      medicalFee: 0,
      trainingFee: 0,
      prizeCredit: 0,
      billingPeriod: '2026-11',
      horse: { name: 'Horse' },
    };

    it.each([InvoiceStatus.SENT, InvoiceStatus.OVERDUE])(
      'pays an owned %s invoice by bank transfer',
      async (status) => {
        prisma.financialInvoice.findUnique.mockResolvedValue({ ...invoice, status });
        prisma.financialInvoice.update.mockResolvedValue({
          ...invoice,
          status: InvoiceStatus.PAID,
        });
        const paid = await service.payInvoice(
          invoice.id,
          { paymentMethod: 'BANK_TRANSFER' },
          owner,
        );
        expect(paid.status).toBe(InvoiceStatus.PAID);
        expect(audit.record).toHaveBeenCalledWith(
          expect.anything(),
          'INVOICE_PAID',
          expect.any(String),
          invoice.id,
          expect.objectContaining({
            newValues: { status: InvoiceStatus.PAID, paymentMethod: 'BANK_TRANSFER' },
          }),
        );
      },
    );

    it('rejects paying another owner invoice', async () => {
      prisma.financialInvoice.findUnique.mockResolvedValue({ ...invoice, ownerId: 'other-owner' });
      await expect(service.payInvoice(invoice.id, {}, owner)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'FORBIDDEN' }),
      });
      expect(prisma.financialInvoice.update).not.toHaveBeenCalled();
    });

    it.each([InvoiceStatus.DRAFT, InvoiceStatus.PAID, InvoiceStatus.CANCELLED])(
      'rejects %s invoices',
      async (status) => {
        prisma.financialInvoice.findUnique.mockResolvedValue({ ...invoice, status });
        await expect(service.payInvoice(invoice.id, {}, owner)).rejects.toMatchObject({
          response: expect.objectContaining({ code: 'INVALID_STATUS' }),
        });
        expect(prisma.financialInvoice.update).not.toHaveBeenCalled();
      },
    );

    it.each([0, -100])('rejects non-positive balance %s', async (netAmount) => {
      prisma.financialInvoice.findUnique.mockResolvedValue({ ...invoice, netAmount });
      await expect(service.payInvoice(invoice.id, {}, owner)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'INVALID_AMOUNT' }),
      });
      expect(prisma.financialInvoice.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated invoices for manager', async () => {
      prisma.financialInvoice.findMany.mockResolvedValue([
        { id: 'inv-1', billingPeriod: '2026-10', status: InvoiceStatus.DRAFT },
      ]);
      prisma.financialInvoice.count.mockResolvedValue(1);

      const user = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };
      const res = await service.findAll({ billingPeriod: '2026-10', page: 1, limit: 10 }, user);

      expect(res.items).toHaveLength(1);
      expect(res.total).toBe(1);
    });

    it('should enforce ownerId filter for HORSE_OWNER', async () => {
      prisma.financialInvoice.findMany.mockResolvedValue([]);
      prisma.financialInvoice.count.mockResolvedValue(0);

      const user = { id: 'u-owner', name: 'Owner', role: 'HORSE_OWNER' };
      await service.findAll({ page: 1, limit: 10 }, user);

      expect(prisma.financialInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ownerId: 'u-owner' }),
        }),
      );
    });

    it('should ignore foreign ownerId query param passed by HORSE_OWNER', async () => {
      prisma.financialInvoice.findMany.mockResolvedValue([]);
      prisma.financialInvoice.count.mockResolvedValue(0);

      const user = { id: 'u-owner', name: 'Owner', role: 'HORSE_OWNER' };
      await service.findAll({ ownerId: 'foreign-owner-id', page: 1, limit: 10 }, user);

      expect(prisma.financialInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ ownerId: 'u-owner' }),
        }),
      );
    });
  });

  describe('create', () => {
    it('should correctly calculate netAmount = boarding + medical + training - prizeCredit', async () => {
      const dto = {
        horseId: 'h-1',
        ownerId: 'o-1',
        billingPeriod: '2026-10',
        boardingFee: 6000000,
        medicalFee: 2000000,
        trainingFee: 4000000,
        prizeCredit: 5000000,
      };
      const user = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };

      prisma.financialInvoice.create.mockResolvedValue({
        id: 'inv-1',
        ...dto,
        netAmount: 7000000,
        status: InvoiceStatus.DRAFT,
        horse: { name: 'Thunder' },
        owner: { fullName: 'Owner A' },
      });

      const res = await service.create(dto, user);
      expect(res.netAmount).toBe(7000000);
      expect(audit.record).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return invoice when authorized', async () => {
      prisma.financialInvoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        ownerId: 'o-1',
        horse: { name: 'Thunder' },
        owner: { fullName: 'Owner A' },
      });

      const user = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };
      const res = await service.findOne('inv-1', user);
      expect(res.id).toBe('inv-1');
    });

    it('should forbid HORSE_OWNER from viewing another owner invoice', async () => {
      prisma.financialInvoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        ownerId: 'other-owner',
        boardingFee: 5000000,
        medicalFee: 0,
        trainingFee: 0,
        prizeCredit: 0,
        netAmount: 5000000,
      });

      const user = { id: 'my-owner-id', name: 'Owner', role: 'HORSE_OWNER' };

      await expect(service.findOne('inv-1', user)).rejects.toThrow(
        'You can only view financial statements for your own horses',
      );
    });
  });

  describe('update & changeStatus', () => {
    it('links an invoice notification to the highlighted statement', async () => {
      prisma.financialInvoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        ownerId: 'owner-1',
        status: InvoiceStatus.DRAFT,
        billingPeriod: '2026-11',
        horse: { name: 'Thunder' },
      });
      prisma.financialInvoice.update.mockResolvedValue({ id: 'inv-1', status: InvoiceStatus.SENT });
      await service.changeStatus('inv-1', InvoiceStatus.SENT, {
        id: 'manager',
        name: 'Manager',
        role: 'CLUB_MANAGER',
      });
      expect(notifications.notifyUsers).toHaveBeenCalledWith(
        ['owner-1'],
        expect.objectContaining({ link: '/owner/financial-reports?highlight=inv-1' }),
        'manager',
      );
    });
    it('should update invoice fields', async () => {
      prisma.financialInvoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        boardingFee: 5000000,
        medicalFee: 1000000,
        trainingFee: 2000000,
        prizeCredit: 500000,
      });

      prisma.financialInvoice.update.mockResolvedValue({
        id: 'inv-1',
        boardingFee: 6000000,
        netAmount: 8500000,
      });

      const user = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };
      const res = await service.update('inv-1', { boardingFee: 6000000 }, user);
      expect(res.id).toBe('inv-1');
    });

    it('should update invoice status via changeStatus', async () => {
      prisma.financialInvoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.DRAFT,
        horse: { name: 'Thunder' },
      });

      prisma.financialInvoice.update.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.PAID,
      });

      const user = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };
      const res = await service.changeStatus('inv-1', InvoiceStatus.PAID, user);
      expect(res.status).toBe(InvoiceStatus.PAID);
    });
  });

  describe('generateMonthlyDrafts', () => {
    it('should generate draft invoices for active owned horses', async () => {
      prisma.horse.findMany.mockResolvedValue([
        {
          id: 'h-1',
          ownerId: 'o-1',
          name: 'Thunder',
          stallAllocations: [
            {
              startDate: new Date('2020-11-01T00:00:00+07:00'),
              endDate: new Date('2020-12-01T00:00:00+07:00'),
            },
          ],
        },
      ]);
      prisma.financialInvoice.findFirst.mockResolvedValue(null);
      prisma.financialInvoice.create.mockResolvedValue({ id: 'new-inv' });

      const user = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };
      const res = await service.generateMonthlyDrafts('2020-11', user);
      expect(res.createdCount).toBe(1);
    });
  });

  describe('getOwnerSummary', () => {
    it('should aggregate financial totals for owner', async () => {
      prisma.financialInvoice.findMany.mockResolvedValue([
        {
          boardingFee: 5000000,
          medicalFee: 1000000,
          trainingFee: 2000000,
          prizeCredit: 3000000,
          netAmount: 5000000,
          status: InvoiceStatus.SENT,
          horse: { id: 'h-1', name: 'Thunder', horseCode: 'HR-001' },
        },
      ]);

      const summary = await service.getOwnerSummary('o-1');

      expect(summary.totalBoarding).toBe(5000000);
      expect(summary.totalPrizeCredit).toBe(3000000);
      expect(summary.totalNet).toBe(5000000);
    });
  });

  describe('sweepOverdue & debt impound enforcement', () => {
    it('should find overdue candidates, impound horses and flag bad debt on owners', async () => {
      prisma.financialInvoice.findMany.mockResolvedValue([
        { id: 'inv-od-1', horseId: 'h-1', ownerId: 'o-1' },
      ]);
      prisma.financialInvoice.updateMany.mockResolvedValue({ count: 1 });

      const count = await service.sweepOverdue();

      expect(count).toBe(1);
      expect(prisma.financialInvoice.updateMany).toHaveBeenCalledWith({
        where: {
          status: InvoiceStatus.SENT,
          dueAt: { lt: expect.any(Date) },
          netAmount: { gt: 0 },
        },
        data: { status: InvoiceStatus.OVERDUE },
      });
      expect(prisma.horse.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['h-1'] } },
        data: expect.objectContaining({
          isDebtImpounded: true,
          debtImpoundReason: expect.any(String),
        }),
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['o-1'] } },
        data: expect.objectContaining({
          isBadDebtFlagged: true,
          badDebtReason: expect.any(String),
        }),
      });
    });

    it('should automatically release horse impound and clear owner bad debt when all overdue invoices are paid', async () => {
      const owner = { id: 'o-1', name: 'Owner', role: 'HORSE_OWNER' };
      const invoice = {
        id: 'inv-od-1',
        horseId: 'h-1',
        ownerId: 'o-1',
        status: InvoiceStatus.OVERDUE,
        netAmount: 1000000,
        boardingFee: 1000000,
        medicalFee: 0,
        trainingFee: 0,
        prizeCredit: 0,
        billingPeriod: '2026-10',
        horse: { name: 'Thunder' },
      };

      prisma.financialInvoice.findUnique.mockResolvedValue(invoice);
      prisma.financialInvoice.update.mockResolvedValue({ ...invoice, status: InvoiceStatus.PAID });
      prisma.financialInvoice.count.mockResolvedValue(0); // 0 remaining overdue

      await service.payInvoice('inv-od-1', { paymentMethod: 'VIETQR' }, owner);

      expect(prisma.horse.update).toHaveBeenCalledWith({
        where: { id: 'h-1' },
        data: {
          isDebtImpounded: false,
          debtImpoundedAt: null,
          debtImpoundReason: null,
        },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'o-1' },
        data: {
          isBadDebtFlagged: false,
          badDebtFlaggedAt: null,
          badDebtReason: null,
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        'HORSE_DEBT_RELEASED',
        expect.any(String),
        'h-1',
        expect.anything(),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        'OWNER_BAD_DEBT_CLEARED',
        expect.any(String),
        'o-1',
        expect.anything(),
      );
    });
  });
});
