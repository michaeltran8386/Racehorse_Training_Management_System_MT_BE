import { Test, TestingModule } from '@nestjs/testing';
import { SupplyDeliveryGateway } from './supply-delivery.gateway';
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
});
