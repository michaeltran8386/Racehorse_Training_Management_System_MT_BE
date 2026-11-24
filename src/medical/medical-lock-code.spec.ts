import { generateMedicalLockCode } from './medical-lock-code';

describe('generateMedicalLockCode', () => {
  it('generates MLK-YYYY-001 when no existing lock exists', async () => {
    const tx = {
      medicalLock: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const now = new Date('2026-11-24T12:00:00Z');
    const code = await generateMedicalLockCode(tx, now);
    expect(code).toBe('MLK-2026-001');
    expect(tx.medicalLock.findFirst).toHaveBeenCalledWith({
      where: { lockCode: { startsWith: 'MLK-2026-' } },
      orderBy: { lockCode: 'desc' },
      select: { lockCode: true },
    });
  });

  it('increments sequence based on last existing lockCode', async () => {
    const tx = {
      medicalLock: {
        findFirst: jest.fn().mockResolvedValue({ lockCode: 'MLK-2026-042' }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const now = new Date('2026-05-10T12:00:00Z');
    const code = await generateMedicalLockCode(tx, now);
    expect(code).toBe('MLK-2026-043');
  });

  it('handles counter upsert when counter table is present', async () => {
    const tx = {
      medicalLock: {
        findFirst: jest.fn().mockResolvedValue({ lockCode: 'MLK-2026-005' }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      counter: {
        upsert: jest.fn().mockResolvedValue({ name: 'medical_lock_code_2026', value: 6 }),
        update: jest.fn(),
      },
    };
    const now = new Date('2026-01-01T00:00:00Z');
    const code = await generateMedicalLockCode(tx, now);
    expect(code).toBe('MLK-2026-006');
  });

  it('resolves collision if candidate already exists in findUnique', async () => {
    const tx = {
      medicalLock: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'existing-1' })
          .mockResolvedValueOnce(null),
      },
    };
    const now = new Date('2026-11-24T12:00:00Z');
    const code = await generateMedicalLockCode(tx, now);
    expect(code).toBe('MLK-2026-002');
  });
});
