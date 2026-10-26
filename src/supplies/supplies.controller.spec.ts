import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { SuppliesController } from './supplies.controller';
import { SuppliesService } from './supplies.service';
import { UserRole } from '../common/enums/role.enum';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { SupplyCategory, SupplyUnit } from '@prisma/client';

describe('SuppliesController', () => {
  let controller: SuppliesController;
  let service: SuppliesService;
  let reflector: Reflector;

  const mockUser: CurrentUserPayload = {
    userId: 'user-cm-1',
    email: 'manager@equiflow.com',
    role: UserRole.CLUB_MANAGER,
    fullName: 'Club Manager',
  };

  const mockService = {
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: 'supply-1' }),
    create: jest.fn().mockResolvedValue({ id: 'supply-1' }),
    update: jest.fn().mockResolvedValue({ id: 'supply-1' }),
    setStatus: jest.fn().mockResolvedValue({ id: 'supply-1', status: 'INACTIVE' }),
  };

  beforeEach(async () => {
    reflector = new Reflector();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SuppliesController],
      providers: [
        {
          provide: SuppliesService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<SuppliesController>(SuppliesController);
    service = module.get<SuppliesService>(SuppliesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Role & Guard Boundary Metadata (ADR-004 / CR-002)', () => {
    const managerMutationHandlers = ['create', 'update', 'setStatus'];

    it.each(managerMutationHandlers)(
      '%s must be strictly guarded with @Roles(UserRole.CLUB_MANAGER)',
      (handlerName) => {
        const handler = (controller as any)[handlerName];
        expect(handler).toBeDefined();

        const roles = reflector.get<string[]>(ROLES_KEY, handler);
        expect(roles).toEqual([UserRole.CLUB_MANAGER]);
        expect(roles).not.toContain(UserRole.GROOM);
        expect(roles).not.toContain(UserRole.HORSE_OWNER);
      },
    );

    const staffReadHandlers = ['findAll', 'findOne'];

    it.each(staffReadHandlers)(
      '%s must allow STAFF roles including GROOM and CLUB_MANAGER, excluding HORSE_OWNER',
      (handlerName) => {
        const handler = (controller as any)[handlerName];
        expect(handler).toBeDefined();

        const roles = reflector.get<string[]>(ROLES_KEY, handler);
        expect(roles).toContain(UserRole.CLUB_MANAGER);
        expect(roles).toContain(UserRole.HEAD_TRAINER);
        expect(roles).toContain(UserRole.VETERINARIAN);
        expect(roles).toContain(UserRole.GROOM);
        expect(roles).not.toContain(UserRole.HORSE_OWNER);
      },
    );
  });

  describe('Handler Delegation', () => {
    it('should delegate findAll to service', async () => {
      const query = { status: 'ACTIVE' as const };
      const res = await controller.findAll(query, mockUser);
      expect(service.findAll).toHaveBeenCalledWith(query, mockUser);
      expect(res).toBeDefined();
    });

    it('should delegate findOne to service', async () => {
      const res = await controller.findOne('supply-1', mockUser);
      expect(service.findOne).toHaveBeenCalledWith('supply-1', mockUser);
      expect(res).toBeDefined();
    });

    it('should delegate create to service', async () => {
      const dto = {
        name: 'Timothy Hay Premium',
        code: 'HAY-01',
        category: SupplyCategory.FEED_HAY,
        unit: SupplyUnit.KG,
      };
      const res = await controller.create(dto, mockUser);
      expect(service.create).toHaveBeenCalledWith(dto, mockUser);
      expect(res).toBeDefined();
    });

    it('should delegate update to service', async () => {
      const dto = { name: 'Timothy Hay Gold' };
      const res = await controller.update('supply-1', dto, mockUser);
      expect(service.update).toHaveBeenCalledWith('supply-1', dto, mockUser);
      expect(res).toBeDefined();
    });

    it('should delegate setStatus to service', async () => {
      const dto = { isActive: false };
      const res = await controller.setStatus('supply-1', dto, mockUser);
      expect(service.setStatus).toHaveBeenCalledWith('supply-1', dto, mockUser);
      expect(res).toBeDefined();
    });
  });
});
