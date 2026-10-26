import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { MedicalController } from './medical.controller';
import { HealthOverviewService } from './health-overview.service';
import { InjuriesService } from './injuries.service';
import { MedicalLocksService } from './medical-locks.service';
import { MedicalRecordsService } from './medical-records.service';
import { PreventiveCareService } from './preventive-care.service';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { PERMISSION_KEY } from '../common/decorators/require-permission.decorator';
import { UserRole } from '../common/enums/role.enum';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

describe('MedicalController', () => {
  let controller: MedicalController;
  let reflector: Reflector;

  let overviewService: jest.Mocked<Partial<HealthOverviewService>>;
  let injuriesService: jest.Mocked<Partial<InjuriesService>>;
  let locksService: jest.Mocked<Partial<MedicalLocksService>>;
  let recordsService: jest.Mocked<Partial<MedicalRecordsService>>;
  let preventiveService: jest.Mocked<Partial<PreventiveCareService>>;

  const mockVetUser: CurrentUserPayload = {
    userId: 'vet-uuid-001',
    email: 'vet@equiflow.com',
    role: 'VETERINARIAN',
    fullName: 'Dr. Chau Le',
    permissions: {
      viewHorses: true,
      editHorses: false,
      deleteHorses: false,
      createPlan: false,
      assignSchedule: false,
      recordMetrics: false,
      ackAlerts: true,
      viewMedical: true,
      placeLock: true,
      liftLock: true,
      manageAccounts: false,
      viewAudit: false,
    },
  };

  beforeEach(async () => {
    reflector = new Reflector();

    overviewService = {
      getHealthBoard: jest.fn().mockResolvedValue({ status: 'OK' } as any),
      getHorseMedicalProfile: jest.fn().mockResolvedValue({ id: 'h-1' } as any),
      getHorseObservations: jest.fn().mockResolvedValue([] as any),
    };

    injuriesService = {
      getHorseInjuries: jest.fn().mockResolvedValue([] as any),
      createInjury: jest.fn().mockResolvedValue({ id: 'inj-1' } as any),
      getInjuryDetail: jest.fn().mockResolvedValue({ id: 'inj-1' } as any),
      updateInjury: jest.fn().mockResolvedValue({ id: 'inj-1' } as any),
      deleteInjury: jest.fn().mockResolvedValue({ success: true } as any),
      updateRecoveryProgress: jest.fn().mockResolvedValue({ id: 'inj-1' } as any),
    };

    locksService = {
      getMedicalLocks: jest.fn().mockResolvedValue([] as any),
      getMedicalLockDetail: jest.fn().mockResolvedValue({ id: 'lock-1' } as any),
      createMedicalLock: jest.fn().mockResolvedValue({ id: 'lock-1' } as any),
      releaseMedicalLock: jest.fn().mockResolvedValue({ id: 'lock-1' } as any),
      extendMedicalLock: jest.fn().mockResolvedValue({ id: 'lock-1' } as any),
    };

    recordsService = {
      getMedicalRecords: jest.fn().mockResolvedValue({ data: [], total: 0 } as any),
      createMedicalRecord: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      getMedicalRecordDetail: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      updateMedicalRecord: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      finalizeMedicalRecord: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      deleteMedicalRecord: jest.fn().mockResolvedValue({ success: true } as any),
      closeMedicalRecord: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      reopenMedicalRecord: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      addTreatmentPhase: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      updateTreatmentPhase: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      addPrescription: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      updatePrescription: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      stopPrescription: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
      addFollowUp: jest.fn().mockResolvedValue({ id: 'rec-1' } as any),
    };

    preventiveService = {
      getPreventiveCatalogs: jest.fn().mockResolvedValue([] as any),
      createPreventiveCatalog: jest.fn().mockResolvedValue({ id: 'cat-1' } as any),
      updatePreventiveCatalog: jest.fn().mockResolvedValue({ id: 'cat-1' } as any),
      togglePreventiveCatalogStatus: jest.fn().mockResolvedValue({ id: 'cat-1' } as any),
      getPreventiveSchedules: jest.fn().mockResolvedValue([] as any),
      recordPreventiveCare: jest.fn().mockResolvedValue({ count: 1 } as any),
      setupHorsePreventive: jest.fn().mockResolvedValue({ count: 1 } as any),
      createPreventiveSchedule: jest.fn().mockResolvedValue({ id: 'sched-1' } as any),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicalController],
      providers: [
        { provide: HealthOverviewService, useValue: overviewService },
        { provide: InjuriesService, useValue: injuriesService },
        { provide: MedicalLocksService, useValue: locksService },
        { provide: MedicalRecordsService, useValue: recordsService },
        { provide: PreventiveCareService, useValue: preventiveService },
      ],
    }).compile();

    controller = module.get<MedicalController>(MedicalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Role & Permission Boundary Metadata', () => {
    const writeHandlers = [
      'createInjury',
      'updateInjury',
      'deleteInjury',
      'updateRecoveryProgress',
      'createRecord',
      'updateRecord',
      'finalize',
      'deleteRecord',
      'closeRecord',
      'reopenRecord',
      'addTreatmentPhase',
      'updateTreatmentPhase',
      'addPrescription',
      'updatePrescription',
      'stopPrescription',
      'addFollowUp',
      'createPreventiveCatalog',
      'updatePreventiveCatalog',
      'togglePreventiveCatalogStatus',
      'recordPreventiveCare',
      'setupHorsePreventive',
      'createPreventiveSchedule',
    ];

    it.each(writeHandlers)(
      '%s must be strictly guarded with @Roles(UserRole.VETERINARIAN) and NOT @RequirePermission(viewMedical)',
      (handlerName) => {
        const handler = (controller as any)[handlerName];
        expect(handler).toBeDefined();

        const roles = reflector.get<string[]>(ROLES_KEY, handler);
        expect(roles).toEqual([UserRole.VETERINARIAN]);

        const permission = reflector.get<string>(PERMISSION_KEY, handler);
        expect(permission).not.toBe('viewMedical');
      },
    );

    it('lock mutation endpoints must require UserRole.VETERINARIAN plus appropriate lock permission', () => {
      expect(reflector.get(ROLES_KEY, controller.createLock)).toEqual([UserRole.VETERINARIAN]);
      expect(reflector.get(PERMISSION_KEY, controller.createLock)).toBe('placeLock');

      expect(reflector.get(ROLES_KEY, controller.releaseLock)).toEqual([UserRole.VETERINARIAN]);
      expect(reflector.get(PERMISSION_KEY, controller.releaseLock)).toBe('liftLock');

      expect(reflector.get(ROLES_KEY, controller.extendLock)).toEqual([UserRole.VETERINARIAN]);
      expect(reflector.get(PERMISSION_KEY, controller.extendLock)).toBe('placeLock');
    });

    const readHandlers = [
      'getHealthBoard',
      'getHorseMedicalProfile',
      'getHorseObservations',
      'getHorseInjuries',
      'getInjuryDetail',
      'getLocks',
      'getLockDetail',
      'getRecords',
      'getRecordDetail',
      'getPreventiveCatalogs',
      'getPreventiveSchedules',
    ];

    it.each(readHandlers)(
      '%s must require @RequirePermission(viewMedical) allowing scoped role viewing',
      (handlerName) => {
        const handler = (controller as any)[handlerName];
        expect(handler).toBeDefined();

        const permission = reflector.get<string>(PERMISSION_KEY, handler);
        expect(permission).toBe('viewMedical');
      },
    );
  });

  describe('Medical Overview & Health Board', () => {
    it('getHealthBoard delegates to overview service', async () => {
      const query = { search: 'Thunderbolt' } as any;
      await controller.getHealthBoard(query, mockVetUser);
      expect(overviewService.getHealthBoard).toHaveBeenCalledWith(query, mockVetUser);
    });

    it('getHorseMedicalProfile delegates to overview service', async () => {
      await controller.getHorseMedicalProfile('horse-1', mockVetUser);
      expect(overviewService.getHorseMedicalProfile).toHaveBeenCalledWith('horse-1', mockVetUser);
    });

    it('getHorseObservations delegates to overview service', async () => {
      await controller.getHorseObservations('horse-1', mockVetUser, 'HIGH');
      expect(overviewService.getHorseObservations).toHaveBeenCalledWith(
        'horse-1',
        mockVetUser,
        'HIGH',
      );
    });
  });

  describe('2D Injuries & Recovery', () => {
    it('getHorseInjuries delegates to injuries service', async () => {
      const q = {} as any;
      await controller.getHorseInjuries('h-1', mockVetUser, q);
      expect(injuriesService.getHorseInjuries).toHaveBeenCalledWith('h-1', mockVetUser, q);
    });

    it('createInjury delegates to injuries service', async () => {
      const dto = { horseId: 'h-1' } as any;
      await controller.createInjury(mockVetUser, dto);
      expect(injuriesService.createInjury).toHaveBeenCalledWith(mockVetUser, dto);
    });

    it('getInjuryDetail delegates to injuries service', async () => {
      await controller.getInjuryDetail('inj-1', mockVetUser);
      expect(injuriesService.getInjuryDetail).toHaveBeenCalledWith('inj-1', mockVetUser);
    });

    it('updateInjury delegates to injuries service', async () => {
      const dto = { notes: 'Healing well' } as any;
      await controller.updateInjury('inj-1', mockVetUser, dto);
      expect(injuriesService.updateInjury).toHaveBeenCalledWith('inj-1', mockVetUser, dto);
    });

    it('deleteInjury delegates to injuries service', async () => {
      await controller.deleteInjury('inj-1', mockVetUser);
      expect(injuriesService.deleteInjury).toHaveBeenCalledWith('inj-1', mockVetUser);
    });

    it('updateRecoveryProgress delegates to injuries service', async () => {
      const dto = { stage: 'RECOVERING' } as any;
      await controller.updateRecoveryProgress('inj-1', mockVetUser, dto);
      expect(injuriesService.updateRecoveryProgress).toHaveBeenCalledWith(
        'inj-1',
        mockVetUser,
        dto,
      );
    });
  });

  describe('Medical Locks', () => {
    it('getLocks delegates to locks service', async () => {
      const q = {} as any;
      await controller.getLocks(mockVetUser, q);
      expect(locksService.getMedicalLocks).toHaveBeenCalledWith(mockVetUser, q);
    });

    it('getLockDetail delegates to locks service', async () => {
      await controller.getLockDetail('lock-1', mockVetUser);
      expect(locksService.getMedicalLockDetail).toHaveBeenCalledWith('lock-1', mockVetUser);
    });

    it('createLock delegates to locks service', async () => {
      const dto = { horseId: 'h-1', lockReason: 'Lameness suspected' } as any;
      await controller.createLock(mockVetUser, dto);
      expect(locksService.createMedicalLock).toHaveBeenCalledWith(mockVetUser, dto);
    });

    it('releaseLock delegates to locks service', async () => {
      const dto = { releaseNotes: 'Fully cleared' } as any;
      await controller.releaseLock('lock-1', mockVetUser, dto);
      expect(locksService.releaseMedicalLock).toHaveBeenCalledWith('lock-1', mockVetUser, dto);
    });

    it('extendLock delegates to locks service', async () => {
      const dto = { extendedReviewDate: '2026-11-01', extensionReason: 'Need more rest' } as any;
      await controller.extendLock('lock-1', mockVetUser, dto);
      expect(locksService.extendMedicalLock).toHaveBeenCalledWith('lock-1', mockVetUser, dto);
    });
  });

  describe('Medical Records', () => {
    it('getRecords delegates to records service', async () => {
      const q = {} as any;
      await controller.getRecords(mockVetUser, q);
      expect(recordsService.getMedicalRecords).toHaveBeenCalledWith(mockVetUser, q);
    });

    it('createRecord delegates to records service', async () => {
      const dto = { horseId: 'h-1' } as any;
      await controller.createRecord(mockVetUser, dto);
      expect(recordsService.createMedicalRecord).toHaveBeenCalledWith(mockVetUser, dto);
    });

    it('getRecordDetail delegates to records service', async () => {
      await controller.getRecordDetail('rec-1', mockVetUser);
      expect(recordsService.getMedicalRecordDetail).toHaveBeenCalledWith('rec-1', mockVetUser);
    });

    it('updateRecord delegates to records service', async () => {
      const dto = { diagnosis: 'Updated diagnosis' } as any;
      await controller.updateRecord('rec-1', mockVetUser, dto);
      expect(recordsService.updateMedicalRecord).toHaveBeenCalledWith('rec-1', mockVetUser, dto);
    });

    it('finalize delegates to records service', async () => {
      const dto = { clinicalDiagnosis: 'Finalized' } as any;
      await controller.finalize('rec-1', mockVetUser, dto);
      expect(recordsService.finalizeMedicalRecord).toHaveBeenCalledWith('rec-1', mockVetUser, dto);
    });

    it('deleteRecord delegates to records service', async () => {
      await controller.deleteRecord('rec-1', mockVetUser);
      expect(recordsService.deleteMedicalRecord).toHaveBeenCalledWith('rec-1', mockVetUser);
    });

    it('closeRecord delegates to records service', async () => {
      const dto = { conclusion: 'Healed' } as any;
      await controller.closeRecord('rec-1', mockVetUser, dto);
      expect(recordsService.closeMedicalRecord).toHaveBeenCalledWith('rec-1', mockVetUser, dto);
    });

    it('reopenRecord delegates to records service', async () => {
      const dto = { reopenReason: 'Recurrence' } as any;
      await controller.reopenRecord('rec-1', mockVetUser, dto);
      expect(recordsService.reopenMedicalRecord).toHaveBeenCalledWith('rec-1', mockVetUser, dto);
    });

    it('addTreatmentPhase delegates to records service', async () => {
      const dto = { phaseName: 'Phase 1' } as any;
      await controller.addTreatmentPhase('rec-1', mockVetUser, dto);
      expect(recordsService.addTreatmentPhase).toHaveBeenCalledWith('rec-1', mockVetUser, dto);
    });

    it('updateTreatmentPhase delegates to records service', async () => {
      const dto = { phaseName: 'Phase 1 updated' } as any;
      await controller.updateTreatmentPhase('rec-1', 'p-1', mockVetUser, dto);
      expect(recordsService.updateTreatmentPhase).toHaveBeenCalledWith(
        'rec-1',
        'p-1',
        mockVetUser,
        dto,
      );
    });

    it('addPrescription delegates to records service', async () => {
      const dto = { medicationName: 'Antibiotic' } as any;
      await controller.addPrescription('rec-1', mockVetUser, dto);
      expect(recordsService.addPrescription).toHaveBeenCalledWith('rec-1', mockVetUser, dto);
    });

    it('updatePrescription delegates to records service', async () => {
      const dto = { dosage: '10' } as any;
      await controller.updatePrescription('rec-1', 'rx-1', mockVetUser, dto);
      expect(recordsService.updatePrescription).toHaveBeenCalledWith(
        'rec-1',
        'rx-1',
        mockVetUser,
        dto,
      );
    });

    it('stopPrescription delegates to records service', async () => {
      const dto = { stopReason: 'Adverse reaction' } as any;
      await controller.stopPrescription('rec-1', 'rx-1', mockVetUser, dto);
      expect(recordsService.stopPrescription).toHaveBeenCalledWith(
        'rec-1',
        'rx-1',
        mockVetUser,
        dto,
      );
    });

    it('addFollowUp delegates to records service', async () => {
      const dto = { notes: 'Followup visit' } as any;
      await controller.addFollowUp('rec-1', mockVetUser, dto);
      expect(recordsService.addFollowUp).toHaveBeenCalledWith('rec-1', mockVetUser, dto);
    });
  });

  describe('Preventive Care', () => {
    it('getPreventiveCatalogs delegates to preventive service', async () => {
      await controller.getPreventiveCatalogs();
      expect(preventiveService.getPreventiveCatalogs).toHaveBeenCalled();
    });

    it('createPreventiveCatalog delegates to preventive service', async () => {
      const dto = { name: 'Equine Flu' } as any;
      await controller.createPreventiveCatalog(mockVetUser, dto);
      expect(preventiveService.createPreventiveCatalog).toHaveBeenCalledWith(mockVetUser, dto);
    });

    it('updatePreventiveCatalog delegates to preventive service', async () => {
      const dto = { name: 'Equine Flu v2' } as any;
      await controller.updatePreventiveCatalog('cat-1', mockVetUser, dto);
      expect(preventiveService.updatePreventiveCatalog).toHaveBeenCalledWith(
        'cat-1',
        mockVetUser,
        dto,
      );
    });

    it('togglePreventiveCatalogStatus delegates to preventive service', async () => {
      await controller.togglePreventiveCatalogStatus('cat-1', mockVetUser);
      expect(preventiveService.togglePreventiveCatalogStatus).toHaveBeenCalledWith(
        'cat-1',
        mockVetUser,
      );
    });

    it('getPreventiveSchedules delegates to preventive service', async () => {
      const q = {} as any;
      await controller.getPreventiveSchedules(mockVetUser, q);
      expect(preventiveService.getPreventiveSchedules).toHaveBeenCalledWith(mockVetUser, q);
    });

    it('recordPreventiveCare delegates to preventive service', async () => {
      const dto = { records: [] } as any;
      await controller.recordPreventiveCare(mockVetUser, dto);
      expect(preventiveService.recordPreventiveCare).toHaveBeenCalledWith(mockVetUser, dto);
    });

    it('setupHorsePreventive delegates to preventive service', async () => {
      const dto = { horseId: 'h-1', careTypeIds: [] } as any;
      await controller.setupHorsePreventive(mockVetUser, dto);
      expect(preventiveService.setupHorsePreventive).toHaveBeenCalledWith(mockVetUser, dto);
    });

    it('createPreventiveSchedule delegates to preventive service', async () => {
      const dto = { horseId: 'h-1', careTypeId: 'ct-1' } as any;
      await controller.createPreventiveSchedule(mockVetUser, dto);
      expect(preventiveService.createPreventiveSchedule).toHaveBeenCalledWith(mockVetUser, dto);
    });
  });
});
