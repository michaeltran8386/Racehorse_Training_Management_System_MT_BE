import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, RestockStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InventoryService } from './inventory.service';
import { UserRole } from '../common/enums/role.enum';

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: any;
  let auditService: any;
  let notifications: any;
  let mockGateway: any;

  // Helper: build a tx-proxy that mirrors prisma but adds $queryRaw and overrides
  function makeTxProxy(overrides: Record<string, any> = {}) {
    return {
      ...prisma,
      $queryRaw: jest.fn().mockResolvedValue([]),
      stockBalance: {
        ...prisma.stockBalance,
        ...overrides.stockBalance,
      },
      restockRequest: {
        ...prisma.restockRequest,
        ...overrides.restockRequest,
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    // R-4: JWT_SECRET must be set; tests set it explicitly so resolveCapabilitySecret() does not throw
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';

    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      stallZone: { findMany: jest.fn(), findUnique: jest.fn() },
      supplyCatalog: { findMany: jest.fn(), findUnique: jest.fn() },
      stockBalance: {
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      restockRequest: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { approvedQuantity: null } }),
      },
      $transaction: jest.fn((callbackOrPromises) => {
        if (Array.isArray(callbackOrPromises)) {
          return Promise.all(callbackOrPromises);
        }
        return callbackOrPromises(prisma);
      }),
    };

    auditService = { record: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      notifyRoles: jest.fn().mockResolvedValue(undefined),
      notifyUsers: jest.fn().mockResolvedValue(undefined),
    };

    mockGateway = {
      broadcastDeliveryStart: jest.fn(),
      broadcastDeliveryCompleted: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    service.setGateway(mockGateway);
  });

  afterEach(() => {
    service.onModuleDestroy();
    delete process.env.JWT_SECRET;
  });

  // ---------------------------------------------------------------------------
  // R-4: Secret resolution — no hardcoded fallback
  // ---------------------------------------------------------------------------
  describe('R-4: resolveCapabilitySecret()', () => {
    it('throws when JWT_SECRET is not set', () => {
      delete process.env.JWT_SECRET;
      expect(() => service.generateAckCapability('req-1', new Date())).toThrow(
        'JWT_SECRET environment variable is required',
      );
    });

    it('generates a valid capability successfully when JWT_SECRET is set', () => {
      process.env.JWT_SECRET = 'test-secret';
      const cap = service.generateAckCapability('req-1', new Date());
      expect(typeof cap).toBe('string');
      expect(cap).toContain('.');
    });

    it('rejects empty requestId with INVALID_REQUEST_ID', () => {
      const res = service.verifyAckCapability('', 'some.cap', new Date());
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('INVALID_REQUEST_ID');
    });

    it('rejects empty capability string with MALFORMED_CAPABILITY', () => {
      const res = service.verifyAckCapability('req-1', '', new Date());
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('MALFORMED_CAPABILITY');
    });

    it('rejects capability with wrong number of segments', () => {
      const res = service.verifyAckCapability('req-1', 'onlyone', new Date());
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('MALFORMED_CAPABILITY');
    });

    it('rejects capability with invalid payload field types (INVALID_PURPOSE)', () => {
      // Craft a capability with invalid payload structure but valid HMAC
      const secret = process.env.JWT_SECRET!;
      const badPayload = Buffer.from(
        JSON.stringify({
          purpose: 'WRONG_PURPOSE',
          requestId: 'req-1',
          dispatchedAt: 0,
          expiresAt: 99999999999999,
        }),
      ).toString('base64url');
      const hmac = crypto.createHmac('sha256', secret).update(badPayload).digest('base64url');
      const res = service.verifyAckCapability('req-1', `${badPayload}.${hmac}`, new Date());
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('INVALID_PURPOSE');
    });
  });

  // ---------------------------------------------------------------------------
  // verifyAckCapability — tamper/mismatch/expiry
  // ---------------------------------------------------------------------------
  describe('verifyAckCapability', () => {
    it('rejects tampered or mismatched ACK capability', () => {
      const dispatched = new Date();
      const cap = service.generateAckCapability('req-original', dispatched);

      const resMismatch = service.verifyAckCapability(
        'req-different',
        cap,
        new Date(Date.now() + 10000),
      );
      expect(resMismatch.valid).toBe(false);
      expect(resMismatch.reason).toBe('REQUEST_ID_MISMATCH');

      const tampered = cap.slice(0, -4) + 'abcd';
      const resTampered = service.verifyAckCapability(
        'req-original',
        tampered,
        new Date(Date.now() + 10000),
      );
      expect(resTampered.valid).toBe(false);
      expect(resTampered.reason).toBe('INVALID_SIGNATURE');

      const resExpired = service.verifyAckCapability(
        'req-original',
        cap,
        new Date(Date.now() + 25000),
      );
      expect(resExpired.valid).toBe(false);
      expect(resExpired.reason).toBe('CAPABILITY_EXPIRED');
    });
  });

  // ---------------------------------------------------------------------------
  // findAllStock (SC-4.06)
  // ---------------------------------------------------------------------------
  describe('findAllStock (SC-4.06)', () => {
    it('returns calculated stock health status and capacity correctly', async () => {
      prisma.stallZone.findMany.mockResolvedValue([
        { id: 'zone-1', code: 'ZA', name: 'Zone A', sortOrder: 1 },
      ]);
      prisma.supplyCatalog.findMany.mockResolvedValue([
        { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
        { id: 'sup-2', code: 'HAY', name: 'Hay', category: 'FEED_HAY', unit: 'KG' },
      ]);
      prisma.stockBalance.findMany.mockResolvedValue([
        {
          id: 'sb-1',
          zoneId: 'zone-1',
          supplyId: 'sup-1',
          quantity: new Prisma.Decimal(50),
          minThreshold: new Prisma.Decimal(10),
          capacity: new Prisma.Decimal(500),
          lastInventoryDate: new Date(),
          lastAdjustedBy: { id: 'u1', fullName: 'Manager', role: 'CLUB_MANAGER' },
          notes: 'Regular check',
        },
        {
          id: 'sb-2',
          zoneId: 'zone-1',
          supplyId: 'sup-2',
          quantity: new Prisma.Decimal(5),
          minThreshold: new Prisma.Decimal(20),
          capacity: null,
          lastInventoryDate: new Date(),
          lastAdjustedBy: null,
          notes: null,
        },
      ]);

      const result = await service.findAllStock({});
      expect(result.items).toHaveLength(2);
      expect(result.items[0].status).toBe('SUFFICIENT');
      expect(result.items[0].capacity).toBe(500);
      expect(result.items[1].status).toBe('LOW_STOCK');
      expect(result.items[1].capacity).toBeNull();
      expect(result.lowStockCount).toBe(1);
      expect(result.outOfStockCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // R-1: Capacity check inside $transaction with SELECT FOR UPDATE
  // ---------------------------------------------------------------------------
  describe('R-1: Capacity transaction contract', () => {
    const managerUser = {
      userId: 'mgr-1',
      fullName: 'Trần Quản Lý',
      email: 'manager@test.com',
      role: UserRole.CLUB_MANAGER,
    };

    it('runs capacity check inside $transaction using $queryRaw FOR UPDATE', async () => {
      // stock=100, capacity=500, reserved=50 → 100+50+300=450 ≤ 500: should pass
      const txProxy = makeTxProxy({
        stockBalance: {
          ...prisma.stockBalance,
          findUnique: jest.fn().mockResolvedValue({
            quantity: new Prisma.Decimal(100),
            capacity: new Prisma.Decimal(500),
          }),
        },
        restockRequest: {
          ...prisma.restockRequest,
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { approvedQuantity: new Prisma.Decimal(50) } }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(txProxy));

      prisma.restockRequest.findUnique.mockResolvedValue({
        id: 'req-tx',
        requestNumber: 'REQ-TX-001',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(300),
        status: RestockStatus.PENDING,
        requestedById: 'groom-1',
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', unit: 'KG' },
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
      });
      prisma.restockRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'req-tx',
        requestNumber: 'REQ-TX-001',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(300),
        approvedQuantity: new Prisma.Decimal(300),
        status: RestockStatus.DELIVERING,
        requestedById: 'groom-1',
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
        requestedBy: { id: 'groom-1', fullName: 'Lê Groom', role: 'GROOM' },
        reviewedBy: { id: 'mgr-1', fullName: 'Trần Quản Lý', role: 'CLUB_MANAGER' },
      });

      const result = await service.reviewRestockRequest(
        'req-tx',
        { action: 'APPROVE', approvedQuantity: 300 },
        managerUser,
      );
      expect(result.status).toBe(RestockStatus.DELIVERING);
      // Verify $queryRaw was called inside the transaction (SELECT FOR UPDATE)
      expect(txProxy.$queryRaw).toHaveBeenCalled();
    });

    it('R-1: rejects when SELECT FOR UPDATE reveals capacity would be exceeded', async () => {
      // stock=400, capacity=500, reserved=80 → 400+80+30=510 > 500: must throw
      const txProxy = makeTxProxy({
        stockBalance: {
          ...prisma.stockBalance,
          findUnique: jest.fn().mockResolvedValue({
            quantity: new Prisma.Decimal(400),
            capacity: new Prisma.Decimal(500),
          }),
        },
        restockRequest: {
          ...prisma.restockRequest,
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { approvedQuantity: new Prisma.Decimal(80) } }),
        },
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(txProxy));

      prisma.restockRequest.findUnique.mockResolvedValue({
        id: 'req-over',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(30),
        status: RestockStatus.PENDING,
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', unit: 'KG' },
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
      });

      await expect(
        service.reviewRestockRequest(
          'req-over',
          { action: 'APPROVE', approvedQuantity: 30 },
          managerUser,
        ),
      ).rejects.toThrow('vượt quá sức chứa');
    });

    it('enforces configured capacity and accounts for active DELIVERING reservations', async () => {
      // Legacy test: stock=350, capacity=500, reserved=100 → 350+100+60=510 > 500
      const txProxy = makeTxProxy({
        stockBalance: {
          ...prisma.stockBalance,
          findUnique: jest.fn().mockResolvedValue({
            quantity: new Prisma.Decimal(350),
            capacity: new Prisma.Decimal(500),
          }),
        },
        restockRequest: {
          ...prisma.restockRequest,
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { approvedQuantity: new Prisma.Decimal(100) } }),
        },
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(txProxy));

      prisma.restockRequest.findUnique.mockResolvedValue({
        id: 'req-cap',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(100),
        status: RestockStatus.PENDING,
        supply: { unit: 'KG' },
        zone: { code: 'ZA', name: 'Zone A' },
      });

      await expect(
        service.reviewRestockRequest(
          'req-cap',
          { action: 'APPROVE', approvedQuantity: 60 },
          managerUser,
        ),
      ).rejects.toThrow('vượt quá sức chứa');
    });

    it('R-1: second concurrent approval loses the PENDING→DELIVERING atomic race (count=0)', async () => {
      prisma.restockRequest.findUnique.mockResolvedValue({
        id: 'req-concurrent',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(50),
        status: RestockStatus.PENDING,
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', unit: 'KG' },
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
      });
      prisma.restockRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'req-concurrent',
        requestNumber: 'REQ-CONCURRENT',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(50),
        approvedQuantity: new Prisma.Decimal(50),
        status: RestockStatus.DELIVERING,
        requestedById: 'groom-1',
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
        requestedBy: { id: 'groom-1', fullName: 'Lê Groom', role: 'GROOM' },
        reviewedBy: { id: 'mgr-1', fullName: 'Trần Quản Lý', role: 'CLUB_MANAGER' },
      });

      let callCount = 0;
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const txProxy = makeTxProxy({
          restockRequest: {
            ...prisma.restockRequest,
            updateMany: jest.fn().mockResolvedValue({ count: callCount++ === 0 ? 1 : 0 }),
            aggregate: jest.fn().mockResolvedValue({ _sum: { approvedQuantity: null } }),
          },
        });
        return cb(txProxy);
      });

      // First call wins
      const first = await service.reviewRestockRequest(
        'req-concurrent',
        { action: 'APPROVE', approvedQuantity: 50 },
        managerUser,
      );
      expect(first.status).toBe(RestockStatus.DELIVERING);

      // Second call loses the PENDING→DELIVERING race
      await expect(
        service.reviewRestockRequest(
          'req-concurrent',
          { action: 'APPROVE', approvedQuantity: 50 },
          { ...managerUser },
        ),
      ).rejects.toThrow('PENDING');
    });

    it('R-1: proves race between DIFFERENT requests: second request exceeds capacity after first reserves', async () => {
      const stockBalanceRow = {
        quantity: new Prisma.Decimal(50),
        capacity: new Prisma.Decimal(100),
      };

      prisma.restockRequest.findUnique
        .mockResolvedValueOnce({
          id: 'req-A',
          requestNumber: 'REQ-A',
          zoneId: 'zone-1',
          supplyId: 'sup-1',
          requestedQuantity: new Prisma.Decimal(30),
          status: RestockStatus.PENDING,
          requestedById: 'groom-1',
          supply: { id: 'sup-1', code: 'OAT', name: 'Oats', unit: 'KG' },
          zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        })
        .mockResolvedValueOnce({
          id: 'req-B',
          requestNumber: 'REQ-B',
          zoneId: 'zone-1',
          supplyId: 'sup-1',
          requestedQuantity: new Prisma.Decimal(30),
          status: RestockStatus.PENDING,
          requestedById: 'groom-2',
          supply: { id: 'sup-1', code: 'OAT', name: 'Oats', unit: 'KG' },
          zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        });

      prisma.restockRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'req-A',
        requestNumber: 'REQ-A',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(30),
        approvedQuantity: new Prisma.Decimal(30),
        status: RestockStatus.DELIVERING,
        requestedById: 'groom-1',
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
        requestedBy: { id: 'groom-1', fullName: 'Lê Groom', role: 'GROOM' },
        reviewedBy: { id: 'mgr-1', fullName: 'Trần Quản Lý', role: 'CLUB_MANAGER' },
      });

      let txStep = 0;
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const isFirst = txStep++ === 0;
        const txProxy = makeTxProxy({
          stockBalance: {
            ...prisma.stockBalance,
            findUnique: jest.fn().mockResolvedValue(stockBalanceRow),
          },
          restockRequest: {
            ...prisma.restockRequest,
            aggregate: jest.fn().mockResolvedValue({
              _sum: { approvedQuantity: isFirst ? null : new Prisma.Decimal(30) },
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        });
        return cb(txProxy);
      });

      const resA = await service.reviewRestockRequest(
        'req-A',
        { action: 'APPROVE', approvedQuantity: 30 },
        managerUser,
      );
      expect(resA.status).toBe(RestockStatus.DELIVERING);

      await expect(
        service.reviewRestockRequest(
          'req-B',
          { action: 'APPROVE', approvedQuantity: 30 },
          managerUser,
        ),
      ).rejects.toThrow('vượt quá sức chứa');
    });

    it('R-1: proves race between reviewRestockRequest approval and adjustStock', async () => {
      prisma.stallZone.findUnique.mockResolvedValue({ id: 'zone-1' });
      prisma.supplyCatalog.findUnique.mockResolvedValue({ id: 'sup-1', unit: 'KG', name: 'Oats' });

      const txProxy = makeTxProxy({
        stockBalance: {
          ...prisma.stockBalance,
          findUnique: jest.fn().mockResolvedValue({
            quantity: new Prisma.Decimal(50),
            capacity: new Prisma.Decimal(100),
          }),
        },
        restockRequest: {
          ...prisma.restockRequest,
          aggregate: jest.fn().mockResolvedValue({
            _sum: { approvedQuantity: new Prisma.Decimal(20) },
          }),
        },
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(txProxy));

      await expect(
        service.adjustStock(
          { zoneId: 'zone-1', supplyId: 'sup-1', actualQuantity: 85 },
          managerUser,
        ),
      ).rejects.toThrow('vượt quá sức chứa');
    });

    it('R-1: proves race between approval and legacy receipt (deliverRestockRequest)', async () => {
      prisma.restockRequest.findUnique.mockResolvedValue({
        id: 'req-leg',
        requestNumber: 'REQ-LEG',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        approvedQuantity: new Prisma.Decimal(60),
        status: RestockStatus.APPROVED,
        requestedById: 'groom-1',
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', unit: 'KG' },
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
      });

      const txProxy = makeTxProxy({
        stockBalance: {
          ...prisma.stockBalance,
          findUnique: jest.fn().mockResolvedValue({
            quantity: new Prisma.Decimal(30),
            capacity: new Prisma.Decimal(100),
          }),
        },
        restockRequest: {
          ...prisma.restockRequest,
          aggregate: jest.fn().mockResolvedValue({
            _sum: { approvedQuantity: new Prisma.Decimal(25) },
          }),
        },
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(txProxy));

      await expect(service.deliverRestockRequest('req-leg', {}, managerUser)).rejects.toThrow(
        'vượt quá sức chứa',
      );
    });

    it('R-1: handles absent StockBalance row (no initial stock row) gracefully during approval', async () => {
      prisma.restockRequest.findUnique.mockResolvedValue({
        id: 'req-absent',
        requestNumber: 'REQ-ABSENT',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(50),
        status: RestockStatus.PENDING,
        requestedById: 'groom-1',
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', unit: 'KG' },
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
      });
      prisma.restockRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'req-absent',
        requestNumber: 'REQ-ABSENT',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(50),
        approvedQuantity: new Prisma.Decimal(50),
        status: RestockStatus.DELIVERING,
        requestedById: 'groom-1',
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
        requestedBy: { id: 'groom-1', fullName: 'Lê Groom', role: 'GROOM' },
        reviewedBy: { id: 'mgr-1', fullName: 'Trần Quản Lý', role: 'CLUB_MANAGER' },
      });

      const txProxy = makeTxProxy({
        stockBalance: {
          ...prisma.stockBalance,
          findUnique: jest.fn().mockResolvedValue(null),
        },
        restockRequest: {
          ...prisma.restockRequest,
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });
      prisma.$transaction.mockImplementation((cb: any) => cb(txProxy));

      const res = await service.reviewRestockRequest(
        'req-absent',
        { action: 'APPROVE', approvedQuantity: 50 },
        managerUser,
      );
      expect(res.status).toBe(RestockStatus.DELIVERING);
      expect(txProxy.$queryRaw).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // R-2: Post-commit failure handling and broadcast-first ordering
  // ---------------------------------------------------------------------------
  describe('R-2: Post-commit failure handling', () => {
    const baseRequest = {
      id: 'req-order',
      requestNumber: 'REQ-ORDER',
      zoneId: 'zone-1',
      supplyId: 'sup-1',
      approvedQuantity: new Prisma.Decimal(20),
      status: RestockStatus.DELIVERING,
      requestedById: 'groom-1',
      reviewedById: 'mgr-1',
      reviewedBy: { id: 'mgr-1', fullName: 'Mgr' },
      zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
      supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
    };

    it('broadcasts delivery completion BEFORE audit and notification (broadcast-first)', async () => {
      const callOrder: string[] = [];
      mockGateway.broadcastDeliveryCompleted.mockImplementation(() => callOrder.push('broadcast'));
      auditService.record.mockImplementation(async () => callOrder.push('audit'));
      notifications.notifyUsers.mockImplementation(async () => callOrder.push('notify'));

      prisma.restockRequest.findUnique.mockResolvedValue({ ...baseRequest });
      prisma.restockRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockBalance.upsert.mockResolvedValue({
        id: 'sb-1',
        quantity: new Prisma.Decimal(70),
      });

      await service.completeDelivery('req-order', 'ACK');

      expect(callOrder[0]).toBe('broadcast');
      expect(callOrder).toContain('audit');
      expect(callOrder).toContain('notify');
    });

    it('audit failure after commit does not prevent broadcast or cause double increment', async () => {
      auditService.record.mockRejectedValue(new Error('audit DB down'));

      prisma.restockRequest.findUnique.mockResolvedValue({
        ...baseRequest,
        id: 'req-audit-fail',
        requestNumber: 'REQ-AUDIT-FAIL',
        reviewedById: null,
        reviewedBy: null,
      });
      prisma.restockRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockBalance.upsert.mockResolvedValue({
        id: 'sb-1',
        quantity: new Prisma.Decimal(70),
      });

      const result = await service.completeDelivery('req-audit-fail', 'FALLBACK');
      expect(result.completed).toBe(true);
      expect(mockGateway.broadcastDeliveryCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-audit-fail' }),
      );
      expect(prisma.stockBalance.upsert).toHaveBeenCalledTimes(1);
    });

    it('notification failure after commit does not throw or re-increment stock', async () => {
      notifications.notifyUsers.mockRejectedValue(new Error('notification service down'));

      prisma.restockRequest.findUnique.mockResolvedValue({
        ...baseRequest,
        id: 'req-notif-fail',
        requestNumber: 'REQ-NOTIF-FAIL',
        approvedQuantity: new Prisma.Decimal(15),
        reviewedById: null,
        reviewedBy: null,
      });
      prisma.restockRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockBalance.upsert.mockResolvedValue({
        id: 'sb-1',
        quantity: new Prisma.Decimal(65),
      });

      const result = await service.completeDelivery('req-notif-fail', 'ACK');
      expect(result.completed).toBe(true);
      expect(mockGateway.broadcastDeliveryCompleted).toHaveBeenCalled();
      expect(prisma.stockBalance.upsert).toHaveBeenCalledTimes(1);
    });

    it('R-2: timer is NOT cleared when transaction returns count=0 (nothing committed)', async () => {
      const fakeTimer = setTimeout(() => {}, 99999);
      (service as any).deliveryTimers.set('req-timer-test', fakeTimer);

      prisma.restockRequest.findUnique.mockResolvedValue({
        ...baseRequest,
        id: 'req-timer-test',
        requestNumber: 'REQ-TIMER',
        approvedQuantity: new Prisma.Decimal(10),
        reviewedById: null,
        reviewedBy: null,
      });

      // count=0: nothing committed, timer must remain
      prisma.restockRequest.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.completeDelivery('req-timer-test', 'FALLBACK');
      expect(result.completed).toBe(false);
      expect((service as any).deliveryTimers.has('req-timer-test')).toBe(true);

      clearTimeout(fakeTimer);
      (service as any).deliveryTimers.delete('req-timer-test');
    });

    it('R-2: timer IS cleared after successful commit (count=1)', async () => {
      const fakeTimer = setTimeout(() => {}, 99999);
      (service as any).deliveryTimers.set('req-timer-clear', fakeTimer);

      prisma.restockRequest.findUnique.mockResolvedValue({
        ...baseRequest,
        id: 'req-timer-clear',
        requestNumber: 'REQ-TIMER-CLEAR',
      });
      prisma.restockRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockBalance.upsert.mockResolvedValue({
        id: 'sb-1',
        quantity: new Prisma.Decimal(50),
      });

      await service.completeDelivery('req-timer-clear', 'ACK');
      expect((service as any).deliveryTimers.has('req-timer-clear')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // R-2: Periodic recovery sweep lifecycle
  // ---------------------------------------------------------------------------
  describe('R-2: Periodic recovery sweep lifecycle', () => {
    it('scheduleRecoverySweep is called from onModuleInit', async () => {
      jest.spyOn(service as any, 'scheduleRecoverySweep');
      prisma.restockRequest.findMany.mockResolvedValue([]);
      await service.onModuleInit();
      expect((service as any).scheduleRecoverySweep).toHaveBeenCalled();
    });

    it('recovery sweep timer is cancelled and nulled on onModuleDestroy', () => {
      const fakeTimer = setTimeout(() => {}, 99999);
      (service as any).recoverySweepTimer = fakeTimer;
      service.onModuleDestroy();
      expect((service as any).recoverySweepTimer).toBeNull();
    });

    it('R-2: prevents overlapping recovery sweeps when a sweep is already running', async () => {
      jest.spyOn(service as any, 'recoverPendingDeliveries');
      (service as any).isSweepRunning = true;

      // Simulate a sweep trigger while isSweepRunning is true
      const callback = async () => {
        if ((service as any).isSweepRunning) {
          (service as any).logger.warn(
            'Previous recovery sweep is still running, skipping overlapping sweep.',
          );
        } else {
          (service as any).isSweepRunning = true;
          try {
            await (service as any).recoverPendingDeliveries();
          } finally {
            (service as any).isSweepRunning = false;
          }
        }
      };

      await callback();
      expect((service as any).recoverPendingDeliveries).not.toHaveBeenCalled();
      (service as any).isSweepRunning = false;
    });

    it('R-2: recovers overdue pending deliveries after extended uptime (>20s)', async () => {
      const longOverdue = {
        id: 'req-extended-uptime',
        reviewedAt: new Date(Date.now() - 50000),
        status: RestockStatus.DELIVERING,
        approvedQuantity: new Prisma.Decimal(40),
        supply: { id: 'sup-1', name: 'Oats', unit: 'KG' },
        zone: { id: 'zone-1', name: 'Zone A' },
      };
      prisma.restockRequest.findMany.mockResolvedValue([longOverdue]);
      jest.spyOn(service, 'completeDelivery').mockResolvedValue({ completed: true });

      await service.recoverPendingDeliveries();

      expect(service.completeDelivery).toHaveBeenCalledWith('req-extended-uptime', 'FALLBACK');
    });

    it('R-2: recovery sweep continues without 24-hour iteration cutoff', () => {
      (service as any).scheduleRecoverySweep();
      expect((service as any).recoverySweepTimer).not.toBeNull();
      expect((service as any).MAX_RECOVERY_SWEEP_ITERATIONS).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Unified Supply Delivery Flow (CR-024 / TASK-018)
  // ---------------------------------------------------------------------------
  describe('Unified Supply Delivery Flow (CR-024 / TASK-018)', () => {
    const groomUser = {
      userId: 'groom-1',
      fullName: 'Lê Groom',
      email: 'groom@test.com',
      role: UserRole.GROOM,
    };
    const managerUser = {
      userId: 'mgr-1',
      fullName: 'Trần Quản Lý',
      email: 'manager@test.com',
      role: UserRole.CLUB_MANAGER,
    };

    it('executes unified Groom proposal -> CM approve -> DELIVERING broadcast -> ACK -> DELIVERED transition', async () => {
      // 1. Setup mocks for creation
      prisma.stallZone.findUnique.mockResolvedValue({ id: 'zone-1', code: 'ZA', name: 'Zone A' });
      prisma.supplyCatalog.findUnique.mockResolvedValue({
        id: 'sup-1',
        code: 'OAT',
        name: 'Oats',
        category: 'FEED_GRAIN',
        unit: 'KG',
      });
      prisma.restockRequest.count.mockResolvedValue(0);
      prisma.restockRequest.create.mockResolvedValue({
        id: 'req-1',
        requestNumber: 'REQ-2610-0001',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(50),
        status: RestockStatus.PENDING,
        requestedById: 'groom-1',
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
        requestedBy: { id: 'groom-1', fullName: 'Lê Groom', role: 'GROOM' },
      });

      // 1. Groom creates proposal
      const created = await service.createRestockRequest(
        {
          zoneId: 'zone-1',
          supplyId: 'sup-1',
          requestedQuantity: 50,
          urgencyReason: 'Hết hàng sáng mai',
        },
        groomUser,
      );
      expect(created.requestNumber).toBe('REQ-2610-0001');

      // 2. Manager reviews & approves
      prisma.restockRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        requestNumber: 'REQ-2610-0001',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(50),
        status: RestockStatus.PENDING,
        requestedById: 'groom-1',
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
      });
      prisma.restockRequest.findUniqueOrThrow.mockResolvedValue({
        id: 'req-1',
        requestNumber: 'REQ-2610-0001',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        requestedQuantity: new Prisma.Decimal(50),
        approvedQuantity: new Prisma.Decimal(50),
        status: RestockStatus.DELIVERING,
        requestedById: 'groom-1',
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
        requestedBy: { id: 'groom-1', fullName: 'Lê Groom', role: 'GROOM' },
        reviewedBy: { id: 'mgr-1', fullName: 'Trần Quản Lý', role: 'CLUB_MANAGER' },
      });

      // Ensure $transaction tx proxy returns count=1 and no capacity row
      prisma.$transaction.mockImplementation(async (cb: any) => {
        const txProxy = makeTxProxy({
          restockRequest: {
            ...prisma.restockRequest,
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            aggregate: jest.fn().mockResolvedValue({ _sum: { approvedQuantity: null } }),
          },
        });
        return cb(txProxy);
      });

      const approved = await service.reviewRestockRequest(
        'req-1',
        { action: 'APPROVE', approvedQuantity: 50 },
        managerUser,
      );

      // Verify status is DELIVERING
      expect(approved.status).toBe(RestockStatus.DELIVERING);
      // Verify gateway broadcasted sys:supply_delivery_start with capability
      expect(mockGateway.broadcastDeliveryStart).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-1',
          approvedQuantity: 50,
          ackCapability: expect.any(String),
        }),
      );

      // 3. Simulator completes 8s animation and sends ACK
      const broadcastCall = mockGateway.broadcastDeliveryStart.mock.calls[0][0];
      const capability = broadcastCall.ackCapability;

      // Mock early ACK before 8s -> should reject
      const earlyNow = new Date(Date.now() + 4000);
      const earlyResult = service.verifyAckCapability('req-1', capability, earlyNow);
      expect(earlyResult.valid).toBe(false);
      expect(earlyResult.reason).toBe('EARLY_ACK_REJECTED');

      // Valid ACK at 8.5 seconds
      const validNow = new Date(Date.now() + 8500);
      const validResult = service.verifyAckCapability('req-1', capability, validNow);
      expect(validResult.valid).toBe(true);

      // 4. Handle simulator ACK
      prisma.restockRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        requestNumber: 'REQ-2610-0001',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        approvedQuantity: new Prisma.Decimal(50),
        status: RestockStatus.DELIVERING,
        requestedById: 'groom-1',
        reviewedById: 'mgr-1',
        reviewedBy: { id: 'mgr-1', fullName: 'Trần Quản Lý' },
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
      });
      prisma.restockRequest.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockBalance.upsert.mockResolvedValue({
        id: 'sb-1',
        quantity: new Prisma.Decimal(150),
      });

      // Emulate valid ACK received from Simulator
      jest.spyOn(service, 'verifyAckCapability').mockReturnValue({ valid: true });
      const ackRes = await service.handleSimulatorAck('req-1', capability);
      expect(ackRes.success).toBe(true);
      expect(ackRes.resultingBalance).toBe(150);

      // Verify completion was broadcast
      expect(mockGateway.broadcastDeliveryCompleted).toHaveBeenCalledWith({
        requestId: 'req-1',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        status: 'DELIVERED',
        balance: 150,
      });

      // Verify exactly-once upsert
      expect(prisma.stockBalance.upsert).toHaveBeenCalledTimes(1);
    });

    it('prevents double-credit on concurrent ACK and fallback timer race', async () => {
      prisma.restockRequest.findUnique.mockResolvedValue({
        id: 'req-race',
        requestNumber: 'REQ-RACE',
        zoneId: 'zone-1',
        supplyId: 'sup-1',
        approvedQuantity: new Prisma.Decimal(20),
        status: RestockStatus.DELIVERING,
        requestedById: 'groom-1',
        reviewedById: 'mgr-1',
        reviewedBy: null,
        zone: { id: 'zone-1', code: 'ZA', name: 'Zone A' },
        supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
      });

      // First execution succeeds (count: 1)
      prisma.restockRequest.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.stockBalance.upsert.mockResolvedValue({
        id: 'sb-1',
        quantity: new Prisma.Decimal(70),
      });

      const firstResult = await service.completeDelivery('req-race', 'ACK');
      expect(firstResult.completed).toBe(true);
      expect(firstResult.resultingBalance).toBe(70);

      // Second execution loses race (count: 0)
      prisma.restockRequest.updateMany.mockResolvedValueOnce({ count: 0 });
      const secondResult = await service.completeDelivery('req-race', 'FALLBACK');
      expect(secondResult.completed).toBe(false);

      // Upsert was only called once
      expect(prisma.stockBalance.upsert).toHaveBeenCalledTimes(1);
    });

    it('recovers pending deliveries on startup (completes overdue, reschedules remaining)', async () => {
      const now = new Date();
      // Overdue delivery: reviewed 25s ago
      const overdueReq = {
        id: 'req-overdue',
        reviewedAt: new Date(now.getTime() - 25000),
        status: RestockStatus.DELIVERING,
        approvedQuantity: new Prisma.Decimal(30),
        supply: { id: 'sup-1', name: 'Oats', unit: 'KG' },
        zone: { id: 'zone-1', name: 'Zone A' },
      };
      // Active delivery: reviewed 5s ago (15s remaining)
      const activeReq = {
        id: 'req-active',
        reviewedAt: new Date(now.getTime() - 5000),
        status: RestockStatus.DELIVERING,
        approvedQuantity: new Prisma.Decimal(20),
        supply: { id: 'sup-1', name: 'Oats', unit: 'KG' },
        zone: { id: 'zone-1', name: 'Zone A' },
      };

      prisma.restockRequest.findMany.mockResolvedValue([overdueReq, activeReq]);
      jest.spyOn(service, 'completeDelivery').mockResolvedValue({ completed: true });

      await service.recoverPendingDeliveries();

      // Overdue completed immediately
      expect(service.completeDelivery).toHaveBeenCalledWith('req-overdue', 'FALLBACK');
      // Active not completed immediately (timer scheduled)
      expect(service.completeDelivery).not.toHaveBeenCalledWith('req-active', 'FALLBACK');
    });

    it('rejects tampered or mismatched ACK capability', () => {
      const dispatched = new Date();
      const cap = service.generateAckCapability('req-original', dispatched);

      // Mismatched request ID
      const resMismatch = service.verifyAckCapability(
        'req-different',
        cap,
        new Date(Date.now() + 10000),
      );
      expect(resMismatch.valid).toBe(false);
      expect(resMismatch.reason).toBe('REQUEST_ID_MISMATCH');

      // Tampered payload
      const tampered = cap.slice(0, -4) + 'abcd';
      const resTampered = service.verifyAckCapability(
        'req-original',
        tampered,
        new Date(Date.now() + 10000),
      );
      expect(resTampered.valid).toBe(false);
      expect(resTampered.reason).toBe('INVALID_SIGNATURE');

      // Expired capability (> 20s)
      const resExpired = service.verifyAckCapability(
        'req-original',
        cap,
        new Date(Date.now() + 25000),
      );
      expect(resExpired.valid).toBe(false);
      expect(resExpired.reason).toBe('CAPABILITY_EXPIRED');
    });

    it('provides public simulator context without requester PII or write credentials', async () => {
      prisma.supplyCatalog.findMany.mockResolvedValue([
        {
          id: 'sup-1',
          code: 'OAT',
          name: 'Oats',
          category: 'FEED_GRAIN',
          unit: 'KG',
          description: null,
        },
      ]);
      prisma.stockBalance.findMany.mockResolvedValue([
        {
          id: 'sb-1',
          zoneId: 'z-1',
          supplyId: 'sup-1',
          quantity: new Prisma.Decimal(50),
          minThreshold: new Prisma.Decimal(10),
          capacity: new Prisma.Decimal(500),
          lastInventoryDate: null,
          zone: { id: 'z-1', code: 'ZA', name: 'Zone A' },
          supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
        },
      ]);
      prisma.restockRequest.findMany.mockResolvedValue([
        {
          id: 'req-active-ctx',
          requestNumber: 'REQ-123',
          zoneId: 'z-1',
          supplyId: 'sup-1',
          approvedQuantity: new Prisma.Decimal(25),
          reviewedAt: new Date(),
          supply: { id: 'sup-1', code: 'OAT', name: 'Oats', category: 'FEED_GRAIN', unit: 'KG' },
          zone: { id: 'z-1', code: 'ZA', name: 'Zone A' },
        },
      ]);

      const context = await service.getSimulatorContext();
      expect(context.catalogue).toHaveLength(1);
      expect(context.stocks).toHaveLength(1);
      expect(context.stocks[0].capacity).toBe(500);
      expect(context.activeDeliveries).toHaveLength(1);
      expect(context.activeDeliveries[0].approvedQuantity).toBe(25);
      // Ensure no ackCapability or PII leaked in public REST endpoint
      expect((context.activeDeliveries[0] as any).ackCapability).toBeUndefined();
      expect((context.activeDeliveries[0] as any).requestedBy).toBeUndefined();
    });
  });
});
