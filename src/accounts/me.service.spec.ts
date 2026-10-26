import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { MeService } from './me.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';

describe('MeService.changePassword', () => {
  let service: MeService;

  const user = {
    id: 'user-1',
    email: 'trainer@gmail.com',
    fullName: 'Trainer',
    role: Role.HEAD_TRAINER,
    status: UserStatus.ACTIVE,
    passwordHash: bcrypt.hashSync('Current@2026', 4),
  };

  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...user, ...data })),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const auth = {
    assertNotLockedOut: jest.fn().mockResolvedValue(undefined),
    recordFailedAttempt: jest.fn(),
    clearFailedAttempts: jest.fn().mockResolvedValue(undefined),
    revokeAllTokens: jest.fn().mockResolvedValue(undefined),
    issueTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: AuthService, useValue: auth },
      ],
    }).compile();
    service = module.get(MeService);
  });

  it('should count a wrong current password and report the attempts left', async () => {
    auth.recordFailedAttempt.mockResolvedValue({ attemptsLeft: 3 });

    const error = (await service
      .changePassword('user-1', { current: 'Wrong@2026', next: 'NewPass@2026' })
      .catch((e: HttpException) => e)) as HttpException;

    expect(auth.recordFailedAttempt).toHaveBeenCalledWith('trainer@gmail.com');
    expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({ code: 'WRONG_PASSWORD', data: { attemptsLeft: 3 } }),
    );
  });

  it('should lock for 15 minutes on the 5th wrong current password', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
    auth.recordFailedAttempt.mockResolvedValue({ attemptsLeft: 0, lockedUntil });

    const error = (await service
      .changePassword('user-1', { current: 'Wrong@2026', next: 'NewPass@2026' })
      .catch((e: HttpException) => e)) as HttpException;

    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'ATTEMPTS_EXCEEDED' }));
  });

  it('should refuse while the account is locked out, before checking the password', async () => {
    auth.assertNotLockedOut.mockRejectedValueOnce(new HttpException('locked', 429));

    await expect(
      service.changePassword('user-1', { current: 'Current@2026', next: 'NewPass@2026' }),
    ).rejects.toThrow(HttpException);
    expect(auth.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it('should change the password, clear the counter and sign out other devices', async () => {
    const result = await service.changePassword('user-1', {
      current: 'Current@2026',
      next: 'NewPass@2026',
    });

    expect(auth.clearFailedAttempts).toHaveBeenCalledWith('trainer@gmail.com');
    expect(auth.revokeAllTokens).toHaveBeenCalledWith('user-1');
    expect(result.accessToken).toBe('a');
  });

  describe('updateProfile', () => {
    it('should update fullName and phoneNumber and record audit log on name change', async () => {
      const updated = await service.updateProfile('user-1', {
        fullName: 'New Trainer Name',
        phone: '0901234567',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { fullName: 'New Trainer Name', phoneNumber: '0901234567' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        { id: 'user-1', name: 'Trainer' },
        'NAME_CHANGED',
        'Trainer → New Trainer Name',
      );
      expect(updated.fullName).toBe('New Trainer Name');
    });

    it('should reject invalid full name with 400 VALIDATION', async () => {
      await expect(
        service.updateProfile('user-1', {
          fullName: 'Trainer123!',
          phone: '0901234567',
        }),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: expect.objectContaining({ code: 'VALIDATION' }),
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should ignore any permission or role mutations in payload', async () => {
      const payload: any = {
        fullName: 'Valid Name',
        phone: '0901234567',
        role: Role.CLUB_MANAGER,
        permissions: { manageAccounts: true },
      };

      await service.updateProfile('user-1', payload);

      // Prisma update is strictly called with fullName and phoneNumber, ignoring role and permissions
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { fullName: 'Valid Name', phoneNumber: '0901234567' },
      });
    });
  });

  describe('updateNotification', () => {
    it('should update allowed notification setting', async () => {
      await service.updateNotification('user-1', {
        key: 'dailyDigest',
        value: true,
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          notify: expect.objectContaining({ dailyDigest: true }),
        },
      });
    });

    it('should throw 409 LOCKED when attempting to change locked notification (thresholdAlert)', async () => {
      await expect(
        service.updateNotification('user-1', {
          key: 'thresholdAlert',
          value: false,
        }),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: expect.objectContaining({ code: 'LOCKED' }),
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should throw 400 VALIDATION for unknown notification key', async () => {
      await expect(
        service.updateNotification('user-1', {
          key: 'unknownNotification' as any,
          value: true,
        }),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: expect.objectContaining({ code: 'VALIDATION' }),
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
