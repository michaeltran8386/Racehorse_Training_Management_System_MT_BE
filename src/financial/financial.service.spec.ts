import { Test, TestingModule } from '@nestjs/testing';
import { FinancialService } from './financial.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoiceStatus, RestockStatus } from '@prisma/client';

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
      tournamentResult: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      restockRequest: {
        findMany: jest.fn().mockResolvedValue([]),
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
    it('should automatically calculate boarding, training, medical, prizeCredit and ignore manual fees', async () => {
      prisma.medicalRecord = { count: jest.fn().mockResolvedValue(2) };
      prisma.preventiveSchedule = { count: jest.fn().mockResolvedValue(1) };
      prisma.trainingPlan = { count: jest.fn().mockResolvedValue(1) };
      prisma.workoutSession = { count: jest.fn().mockResolvedValue(3) };
      prisma.tournamentResult.findMany.mockResolvedValue([
        { netOwnerPayout: 5000000, prizeMoneyWon: 6000000 },
      ]);
      prisma.financialInvoice.create.mockImplementation(({ data }: { data: any }) =>
        Promise.resolve({
          id: 'inv-1',
          ...data,
          horse: { name: 'Thunder' },
          owner: { fullName: 'Owner A' },
        }),
      );

      const dto = {
        horseId: 'h-1',
        ownerId: 'o-1',
        billingPeriod: '2026-10',
        boardingFee: 999,
        medicalFee: 999,
        trainingFee: 999,
        prizeCredit: 999,
      };
      const user = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };

      const res = await service.create(dto, user);
      expect(res.boardingFee).toBe(6000000);
      expect(res.medicalFee).toBe(1000000);
      expect(res.trainingFee).toBe(4000000);
      expect(res.prizeCredit).toBe(5000000);
      expect(res.netAmount).toBe(6000000);
      expect(audit.record).toHaveBeenCalled();
    });

    it('should derive ownerId from horse record and default optional fees to zero when horse had no stay or events', async () => {
      prisma.stallAllocation.findMany.mockResolvedValue([]);
      prisma.horse.findUnique = jest.fn().mockResolvedValue({
        id: 'h-1',
        ownerId: 'o-derived',
        name: 'Comet',
        status: 'ACTIVE',
      });
      prisma.medicalRecord = { count: jest.fn().mockResolvedValue(0) };
      prisma.preventiveSchedule = { count: jest.fn().mockResolvedValue(0) };
      prisma.trainingPlan = { count: jest.fn().mockResolvedValue(0) };
      prisma.workoutSession = { count: jest.fn().mockResolvedValue(0) };
      prisma.tournamentResult.findMany.mockResolvedValue([]);
      prisma.financialInvoice.create.mockImplementation(({ data }: { data: any }) =>
        Promise.resolve({
          id: 'inv-2',
          ...data,
          horse: { name: 'Comet' },
          owner: { fullName: 'Owner Derived' },
        }),
      );

      const user = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };
      const res = await service.create({ horseId: 'h-1', billingPeriod: '2026-10' }, user);
      expect(res.ownerId).toBe('o-derived');
      expect(res.boardingFee).toBe(0);
      expect(res.medicalFee).toBe(0);
      expect(res.trainingFee).toBe(0);
      expect(res.prizeCredit).toBe(0);
      expect(res.netAmount).toBe(0);
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
        status: InvoiceStatus.SENT,
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

  describe('getOwnerStatementBreakdown (2-tier progressive disclosure)', () => {
    it('aggregates summary level 1 and provides drilldown level 2', async () => {
      prisma.financialInvoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          horseId: 'h-1',
          billingPeriod: '2026-10',
          boardingFee: 7000000,
          boardingDays: 30,
          medicalFee: 1500000,
          trainingFee: 2000000,
          prizeCredit: 15000000,
          netAmount: -4500000,
          status: InvoiceStatus.SENT,
          horse: { id: 'h-1', name: 'Thunder', horseCode: 'HR-001' },
          owner: { id: 'o-1', fullName: 'John Doe', email: 'owner@gmail.com' },
        },
      ]);

      prisma.tournamentResult = {
        findMany: jest.fn().mockResolvedValue([
          {
            finalRank: 1,
            grossPrize: 20000000,
            trainerCut: 2000000,
            jockeyCut: 1000000,
            entryFeeDeducted: 2000000,
            netOwnerPayout: 15000000,
            registration: {
              tournament: { id: 't-1', name: 'Autumn Cup', raceDate: new Date('2026-10-15') },
              horse: { id: 'h-1', name: 'Thunder' },
            },
          },
        ]),
      } as any;

      const breakdown = await service.getOwnerStatementBreakdown('o-1', '2026-10');

      expect(breakdown.summary.totalExpense).toBe(10500000);
      expect(breakdown.summary.totalRaceNet).toBe(15000000);
      expect(breakdown.summary.finalBalanceDue).toBe(-4500000);
      expect(breakdown.summary.isSurplus).toBe(true);
      expect(breakdown.summary.surplusAmount).toBe(4500000);

      expect(breakdown.drilldown.invoices).toHaveLength(1);
      expect(breakdown.drilldown.raceSettlements).toHaveLength(1);
      expect(breakdown.drilldown.raceSettlements[0].tournamentName).toBe('Autumn Cup');
      expect(breakdown.drilldown.raceSettlements[0].netOwnerPayout).toBe(15000000);
    });

    it('isolates prize settlements so Owner B does not see tournament winnings belonging to Owner A', async () => {
      prisma.financialInvoice.findMany.mockResolvedValue([
        {
          id: 'inv-b-1',
          horseId: 'h-1',
          ownerId: 'o-2',
          billingPeriod: '2026-11',
          boardingFee: 3000000,
          boardingDays: 15,
          medicalFee: 0,
          trainingFee: 0,
          prizeCredit: 0,
          netAmount: 3000000,
          status: InvoiceStatus.SENT,
          horse: { id: 'h-1', name: 'Thunder', horseCode: 'HR-001' },
          owner: { id: 'o-2', fullName: 'Owner B', email: 'owner_b@gmail.com' },
        },
      ]);

      prisma.tournamentResult = {
        findMany: jest.fn().mockImplementation(({ where }) => {
          if (where?.registration?.horse?.ownerId === 'o-2') {
            return Promise.resolve([]);
          }
          return Promise.resolve([
            {
              finalRank: 1,
              grossPrize: 20000000,
              netOwnerPayout: 17000000,
              registration: {
                horseId: 'h-1',
                tournament: { id: 't-old', name: 'Past Cup', raceDate: new Date('2026-10-15') },
                horse: { id: 'h-1', name: 'Thunder', horseCode: 'HR-001', ownerId: 'o-1' },
              },
            },
          ]);
        }),
      };

      const breakdown = await service.getOwnerStatementBreakdown('o-2', '2026-11');
      expect(breakdown.summary.totalRaceNet).toBe(0);
      expect(breakdown.drilldown.raceSettlements).toHaveLength(0);
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

    it('should release horse impound and owner bad debt when an OVERDUE invoice is CANCELLED', async () => {
      const mgr = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };
      const invoice = {
        id: 'inv-od-cancel',
        horseId: 'h-1',
        ownerId: 'o-1',
        status: InvoiceStatus.OVERDUE,
        netAmount: 3000000,
        boardingFee: 3000000,
        medicalFee: 0,
        trainingFee: 0,
        prizeCredit: 0,
        billingPeriod: '2026-10',
        horse: { name: 'Thunder' },
      };

      prisma.financialInvoice.findUnique.mockResolvedValue(invoice);
      prisma.financialInvoice.update.mockResolvedValue({
        ...invoice,
        status: InvoiceStatus.CANCELLED,
      });
      prisma.financialInvoice.count.mockResolvedValue(0);

      const res = await service.changeStatus('inv-od-cancel', InvoiceStatus.CANCELLED, mgr);

      expect(res.status).toBe(InvoiceStatus.CANCELLED);
      expect(prisma.horse.update).toHaveBeenCalledWith({
        where: { id: 'h-1' },
        data: {
          isDebtImpounded: false,
          debtImpoundedAt: null,
          debtImpoundReason: null,
        },
      });
    });
  });

  describe('invoice workflow guards & club cashflow', () => {
    it('should reject fee edits on non-DRAFT invoices', async () => {
      const mgr = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };
      prisma.financialInvoice.findUnique.mockResolvedValue({
        id: 'inv-sent',
        status: InvoiceStatus.SENT,
        boardingFee: 6000000,
        medicalFee: 0,
        trainingFee: 4000000,
        prizeCredit: 0,
        billingPeriod: '2026-10',
      });

      await expect(service.update('inv-sent', { medicalFee: 500000 }, mgr)).rejects.toThrow(
        'Only DRAFT invoices can have service fees edited.',
      );
    });

    it('should reject duplicate manual invoice creation when non-cancelled statement exists for period', async () => {
      const mgr = { id: 'u-mgr', name: 'Manager', role: 'CLUB_MANAGER' };
      prisma.financialInvoice.findFirst.mockResolvedValue({ id: 'inv-existing' });

      await expect(
        service.create(
          {
            horseId: '11111111-1111-4111-8111-111111111111',
            ownerId: '22222222-2222-4222-8222-222222222222',
            billingPeriod: '2026-10',
            medicalFee: 500000,
          },
          mgr,
        ),
      ).rejects.toThrow('An active statement already exists for this horse in period 2026-10.');
    });

    it('should separate paid revenue, receivables, draft invoices, delivered supply imports, and surplus payouts in getClubCashflow', async () => {
      prisma.financialInvoice.findMany.mockResolvedValue([
        {
          id: 'inv-paid',
          billingPeriod: '2026-10',
          boardingFee: 6000000,
          medicalFee: 1000000,
          trainingFee: 4000000,
          prizeCredit: 0,
          netAmount: 11000000,
          status: InvoiceStatus.PAID,
          horse: { id: 'h-1', name: 'A', horseCode: 'HR-01', breed: 'Thoroughbred' },
          owner: { id: 'o-1', fullName: 'Owner 1', email: 'o1@test.com' },
        },
        {
          id: 'inv-sent',
          billingPeriod: '2026-10',
          boardingFee: 6000000,
          medicalFee: 0,
          trainingFee: 4000000,
          prizeCredit: 0,
          netAmount: 10000000,
          status: InvoiceStatus.SENT,
          horse: { id: 'h-2', name: 'B', horseCode: 'HR-02', breed: 'Thoroughbred' },
          owner: { id: 'o-1', fullName: 'Owner 1', email: 'o1@test.com' },
        },
        {
          id: 'inv-surplus',
          billingPeriod: '2026-10',
          boardingFee: 6000000,
          medicalFee: 0,
          trainingFee: 4000000,
          prizeCredit: 15000000,
          netAmount: -5000000,
          status: InvoiceStatus.SENT,
          horse: { id: 'h-3', name: 'C', horseCode: 'HR-03', breed: 'Thoroughbred' },
          owner: { id: 'o-2', fullName: 'Owner 2', email: 'o2@test.com' },
        },
        {
          id: 'inv-draft',
          billingPeriod: '2026-10',
          boardingFee: 6000000,
          medicalFee: 0,
          trainingFee: 4000000,
          prizeCredit: 0,
          netAmount: 10000000,
          status: InvoiceStatus.DRAFT,
          horse: { id: 'h-4', name: 'D', horseCode: 'HR-04', breed: 'Thoroughbred' },
          owner: { id: 'o-2', fullName: 'Owner 2', email: 'o2@test.com' },
        },
        {
          id: 'inv-cancelled',
          billingPeriod: '2026-10',
          boardingFee: 6000000,
          medicalFee: 0,
          trainingFee: 4000000,
          prizeCredit: 0,
          netAmount: 10000000,
          status: InvoiceStatus.CANCELLED,
          horse: { id: 'h-5', name: 'E', horseCode: 'HR-05', breed: 'Thoroughbred' },
          owner: { id: 'o-2', fullName: 'Owner 2', email: 'o2@test.com' },
        },
      ]);

      prisma.restockRequest.findMany.mockResolvedValue([
        {
          id: 'req-10',
          requestNumber: 'REQ-SUP-004',
          status: RestockStatus.DELIVERED,
          approvedQuantity: 300,
          requestedQuantity: 300,
          deliveredAt: new Date('2026-10-15T10:00:00+07:00'),
          supplyId: 's-oats',
          supply: {
            id: 's-oats',
            code: 'OATS',
            name: 'Cám yến mạch',
            unit: 'KG',
            category: 'FEED_GRAIN',
            unitPrice: 24000,
          },
          zone: { id: 'z-a', code: 'A', name: 'Khu A' },
          requestedBy: { id: 'g-1', fullName: 'Groom 1' },
        },
        {
          id: 'req-11',
          requestNumber: 'REQ-SUP-009',
          status: RestockStatus.DELIVERED,
          approvedQuantity: 10,
          requestedQuantity: 10,
          deliveredAt: new Date('2026-11-05T10:00:00+07:00'),
          supplyId: 's-elec',
          supply: {
            id: 's-elec',
            code: 'ELECTROLYTE',
            name: 'Điện giải',
            unit: 'PACKET',
            category: 'SUPPLEMENT_ELECTROLYTE',
            unitPrice: 45000,
          },
          zone: { id: 'z-b', code: 'B', name: 'Khu B' },
          requestedBy: { id: 'g-2', fullName: 'Groom 2' },
        },
      ]);

      const oct = await service.getClubCashflow('2026-10');

      expect(oct.periods).toEqual(['2026-11', '2026-10']);
      expect(oct.summary.actualRevenuePaid).toBe(11000000);
      expect(oct.summary.pendingReceivable).toBe(10000000);
      expect(oct.summary.draftBillingTotal).toBe(10000000);
      expect(oct.summary.supplyImportExpense).toBe(7200000);
      expect(oct.summary.ownerSurplusPayoutExpense).toBe(5000000);
      expect(oct.summary.totalActualExpense).toBe(12200000);
      expect(oct.summary.netCashflow).toBe(-1200000);
      expect(oct.summary.deliveredRestockCount).toBe(1);
      expect(oct.supplyExpenses[0]).toEqual(
        expect.objectContaining({
          requestNumber: 'REQ-SUP-004',
          supplyCode: 'OATS',
          quantity: 300,
          unitPrice: 24000,
          totalCost: 7200000,
        }),
      );
    });
  });
});
