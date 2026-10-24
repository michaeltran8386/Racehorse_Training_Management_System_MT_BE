import { Role } from '@prisma/client';
import { defaultPermissions, isNotifyLocked, normalizePermissions } from './permissions';
import { permissionsOf, toPublicUser } from './public-user';

describe('permissions', () => {
  it('should give each role its default permissions', () => {
    expect(defaultPermissions(Role.CLUB_MANAGER).manageAccounts).toBe(true);
    expect(defaultPermissions(Role.CLUB_MANAGER).ackAlerts).toBe(false);
    expect(defaultPermissions(Role.CLUB_MANAGER).editHorses).toBe(true);
    expect(defaultPermissions(Role.CLUB_MANAGER).deleteHorses).toBe(true);
    expect(defaultPermissions(Role.HEAD_TRAINER).editHorses).toBe(false);
    expect(defaultPermissions(Role.HEAD_TRAINER).deleteHorses).toBe(false);
    expect(defaultPermissions(Role.VETERINARIAN).placeLock).toBe(true);
    expect(defaultPermissions(Role.VETERINARIAN).ackAlerts).toBe(true);
    expect(defaultPermissions(Role.GROOM)).toEqual(
      expect.objectContaining({ viewHorses: true, editHorses: false, manageAccounts: false }),
    );
  });

  it('should force locked switches regardless of what the client sends', () => {
    const result = normalizePermissions(Role.HEAD_TRAINER, {
      viewHorses: false, // core => luôn bật
      manageAccounts: true, // chỉ Club Manager
      placeLock: true, // chỉ Veterinarian
      createPlan: true, // đổi tự do
      unknownKey: true,
    });
    expect(result.viewHorses).toBe(true);
    expect(result.manageAccounts).toBe(false);
    expect(result.placeLock).toBe(false);
    expect(result.createPlan).toBe(true);
    expect(result).not.toHaveProperty('unknownKey');
  });

  it('should keep manageAccounts always on for a Club Manager', () => {
    expect(normalizePermissions(Role.CLUB_MANAGER, { manageAccounts: false }).manageAccounts).toBe(
      true,
    );
  });

  it('Head Trainer default has no horse edit/delete authority and only Club Manager manages accounts', () => {
    const ht = defaultPermissions(Role.HEAD_TRAINER);
    expect(ht.editHorses).toBe(false);
    expect(ht.deleteHorses).toBe(false);
    expect(ht.manageAccounts).toBe(false);

    expect(defaultPermissions(Role.CLUB_MANAGER).manageAccounts).toBe(true);
    expect(defaultPermissions(Role.VETERINARIAN).manageAccounts).toBe(false);
    expect(defaultPermissions(Role.GROOM).manageAccounts).toBe(false);
    expect(defaultPermissions(Role.HORSE_OWNER).manageAccounts).toBe(false);
  });

  it('TASK-002: only Club Manager can retain or receive editHorses; all non-CM roles normalize editHorses to false', () => {
    // 1. Default permissions check
    expect(defaultPermissions(Role.CLUB_MANAGER).editHorses).toBe(true);
    expect(defaultPermissions(Role.HEAD_TRAINER).editHorses).toBe(false);
    expect(defaultPermissions(Role.VETERINARIAN).editHorses).toBe(false);
    expect(defaultPermissions(Role.GROOM).editHorses).toBe(false);
    expect(defaultPermissions(Role.HORSE_OWNER).editHorses).toBe(false);

    // 2. Normalization check: client/stored attempting to set editHorses: true for non-CM roles MUST be forced to false
    expect(normalizePermissions(Role.HEAD_TRAINER, { editHorses: true }).editHorses).toBe(false);
    expect(normalizePermissions(Role.VETERINARIAN, { editHorses: true }).editHorses).toBe(false);
    expect(normalizePermissions(Role.GROOM, { editHorses: true }).editHorses).toBe(false);
    expect(normalizePermissions(Role.HORSE_OWNER, { editHorses: true }).editHorses).toBe(false);

    // 3. Normalization check: Club Manager can retain editHorses
    expect(normalizePermissions(Role.CLUB_MANAGER, { editHorses: true }).editHorses).toBe(true);
    expect(normalizePermissions(Role.CLUB_MANAGER, {}).editHorses).toBe(true);
  });

  it('only a Veterinarian acknowledges and is notified of abnormal-sign alerts (Q-0.04)', () => {
    expect(defaultPermissions(Role.VETERINARIAN).ackAlerts).toBe(true);
    expect(defaultPermissions(Role.HEAD_TRAINER).ackAlerts).toBe(false);
    expect(normalizePermissions(Role.CLUB_MANAGER, { ackAlerts: true }).ackAlerts).toBe(false);
  });

  it('a permission missing from the stored map falls back to the role default', () => {
    expect(normalizePermissions(Role.VETERINARIAN, { placeLock: true }).ackAlerts).toBe(true);
    expect(normalizePermissions(Role.VETERINARIAN, { ackAlerts: false }).ackAlerts).toBe(false);
  });

  it('should lock only the threshold alert notification', () => {
    expect(isNotifyLocked(Role.HEAD_TRAINER, 'thresholdAlert')).toBe(true);
    expect(isNotifyLocked(Role.HEAD_TRAINER, 'dailyDigest')).toBe(false);
  });

  it('should fall back to role defaults when the stored permissions are null', () => {
    expect(permissionsOf({ role: Role.VETERINARIAN, permissions: null }).liftLock).toBe(true);
  });

  it('should never expose the password hash in the public user', () => {
    const publicUser = toPublicUser({
      id: 'u1',
      email: 'a@gmail.com',
      passwordHash: 'secret-hash',
      passwordChangedAt: null,
      fullName: 'A',
      phoneNumber: null,
      role: Role.GROOM,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastActive: null,
      requestedAt: null,
      requestCode: null,
      lockedAt: null,
      invitedBy: null,
      statusReason: null,
      statusChangedAt: null,
      statusChangedBy: null,
      permissions: null,
      permissionsChangedAt: null,
      permissionsChangedBy: null,
      notify: null,
    });
    expect(publicUser).not.toHaveProperty('passwordHash');
    expect(publicUser).not.toHaveProperty('verificationCode');
    expect(publicUser.phone).toBe('');
  });
});
