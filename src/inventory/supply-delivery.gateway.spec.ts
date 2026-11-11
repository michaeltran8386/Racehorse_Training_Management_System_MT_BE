import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  SupplyDeliveryGateway,
  getAllowedSupplyOrigins,
  isAllowedSupplyOrigin,
} from './supply-delivery.gateway';
import { InventoryService } from './inventory.service';

describe('SupplyDeliveryGateway', () => {
  let gateway: SupplyDeliveryGateway;
  let inventoryService: Partial<InventoryService>;
  let mockServer: { emit: jest.Mock };

  beforeEach(async () => {
    mockServer = { emit: jest.fn() };
    inventoryService = {
      setGateway: jest.fn(),
      getActiveDeliveriesWithCapabilities: jest.fn().mockResolvedValue([
        {
          requestId: 'req-1',
          requestNumber: 'REQ-001',
          zoneId: 'z-1',
          supplyId: 's-1',
          supplyCode: 'SUP_OATS',
          supplyName: 'Oats',
          category: 'FEED_GRAIN',
          unit: 'KG',
          approvedQuantity: 20,
          dispatchedAt: new Date().toISOString(),
          animationEndsAt: new Date(Date.now() + 8000).toISOString(),
          fallbackAt: new Date(Date.now() + 20000).toISOString(),
          ackCapability: 'test.capability',
        },
      ]),
      handleSimulatorAck: jest.fn().mockResolvedValue({ success: true, requestId: 'req-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplyDeliveryGateway,
        {
          provide: InventoryService,
          useValue: inventoryService,
        },
      ],
    }).compile();

    gateway = module.get<SupplyDeliveryGateway>(SupplyDeliveryGateway);
    gateway.server = mockServer as any;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('should register itself with inventory service on afterInit', () => {
    gateway.afterInit();
    expect(inventoryService.setGateway).toHaveBeenCalledWith(gateway);
  });

  it('should emit sys:active_deliveries to client on connection', async () => {
    const mockClient = { id: 'client-123', emit: jest.fn() };
    await gateway.handleConnection(mockClient as any);
    expect(inventoryService.getActiveDeliveriesWithCapabilities).toHaveBeenCalled();
    expect(mockClient.emit).toHaveBeenCalledWith(
      'sys:active_deliveries',
      expect.arrayContaining([expect.objectContaining({ requestId: 'req-1' })]),
    );
  });

  it('should broadcast sys:supply_delivery_start to all connected clients', () => {
    const payload = {
      requestId: 'req-2',
      requestNumber: 'REQ-002',
      zoneId: 'z-1',
      supplyId: 's-1',
      supplyCode: 'SUP_OATS',
      supplyName: 'Oats',
      category: 'FEED_GRAIN',
      unit: 'KG',
      approvedQuantity: 15,
      dispatchedAt: new Date().toISOString(),
      animationEndsAt: new Date(Date.now() + 8000).toISOString(),
      fallbackAt: new Date(Date.now() + 20000).toISOString(),
      ackCapability: 'cap-2',
    };
    gateway.broadcastDeliveryStart(payload);
    expect(mockServer.emit).toHaveBeenCalledWith('sys:supply_delivery_start', payload);
  });

  it('should broadcast sys:supply_delivery_completed to all connected clients', () => {
    const payload = {
      requestId: 'req-2',
      zoneId: 'z-1',
      supplyId: 's-1',
      status: 'DELIVERED' as const,
      balance: 100,
    };
    gateway.broadcastDeliveryCompleted(payload);
    expect(mockServer.emit).toHaveBeenCalledWith('sys:supply_delivery_completed', payload);
  });

  it('should validate and delegate sim:supply_delivery_ack to inventory service', async () => {
    const mockClient = { id: 'client-1' };
    const res = await gateway.handleAck(mockClient as any, {
      requestId: 'req-1',
      ackCapability: 'signed-token',
    });
    expect(inventoryService.handleSimulatorAck).toHaveBeenCalledWith('req-1', 'signed-token');
    expect(res).toEqual({ success: true, requestId: 'req-1' });
  });

  it('should reject invalid payload in sim:supply_delivery_ack', async () => {
    const mockClient = { id: 'client-1' };
    const res = await gateway.handleAck(mockClient as any, {
      requestId: '',
      ackCapability: '',
    });
    expect(res).toEqual({ success: false, error: 'INVALID_PAYLOAD' });
    expect(inventoryService.handleSimulatorAck).not.toHaveBeenCalled();
  });

  it('allows direct Simulator origin (port 5175) and SIMULATOR_URL in CORS helper', () => {
    const prevSim = process.env.SIMULATOR_URL;
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      process.env.SIMULATOR_URL = 'https://sim.equiflow.test/';
      process.env.NODE_ENV = 'production';
      const origins = getAllowedSupplyOrigins();
      expect(origins).toContain('https://sim.equiflow.test');
      expect(isAllowedSupplyOrigin('https://sim.equiflow.test')).toBe(true);
      expect(isAllowedSupplyOrigin('https://evil.example.com')).toBe(false);

      process.env.NODE_ENV = 'development';
      expect(isAllowedSupplyOrigin('http://localhost:5175')).toBe(true);
      expect(isAllowedSupplyOrigin('http://localhost:5173')).toBe(true);
    } finally {
      if (prevSim === undefined) delete process.env.SIMULATOR_URL;
      else process.env.SIMULATOR_URL = prevSim;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it('allows direct Simulator connection without JWT in non-test environments and marks isDirectSimulator', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const mockClient = {
        id: 'sim-direct-1',
        handshake: { headers: { origin: 'http://localhost:5175' }, auth: {} },
        data: {} as Record<string, unknown>,
        emit: jest.fn(),
        disconnect: jest.fn(),
      };
      await gateway.handleConnection(mockClient as any);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
      expect(mockClient.data.isDirectSimulator).toBe(true);
      expect(mockClient.emit).toHaveBeenCalledWith('sys:active_deliveries', expect.any(Array));
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it('rejects connections from disallowed Origin headers or with invalid JWT tokens', async () => {
    const disallowedClient = {
      id: 'bad-origin-1',
      handshake: { headers: { origin: 'https://evil.example.com' }, auth: {} },
      data: {},
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    await gateway.handleConnection(disallowedClient as any);
    expect(disallowedClient.disconnect).toHaveBeenCalledWith(true);

    const jwtGateway = new SupplyDeliveryGateway(
      inventoryService as InventoryService,
      {
        verifyAsync: jest.fn().mockRejectedValue(new Error('invalid token')),
      } as unknown as JwtService,
    );
    const invalidJwtClient = {
      id: 'bad-jwt-1',
      handshake: {
        headers: { origin: 'http://localhost:5173' },
        auth: { token: 'forged.jwt.token' },
      },
      data: {},
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
    await jwtGateway.handleConnection(invalidJwtClient as any);
    expect(invalidJwtClient.disconnect).toHaveBeenCalledWith(true);
  });
});
