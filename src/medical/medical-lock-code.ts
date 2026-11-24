import { Prisma } from '@prisma/client';

export async function generateMedicalLockCode(
  tx: Prisma.TransactionClient | any,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getFullYear();
  const prefix = `MLK-${year}-`;

  let nextSeq = 1;
  if (tx?.medicalLock?.findFirst) {
    const last = await tx.medicalLock.findFirst({
      where: { lockCode: { startsWith: prefix } },
      orderBy: { lockCode: 'desc' },
      select: { lockCode: true },
    });
    if (last?.lockCode) {
      const parsed = parseInt(last.lockCode.slice(prefix.length), 10);
      if (!Number.isNaN(parsed)) {
        nextSeq = Math.max(nextSeq, parsed + 1);
      }
    }
  }

  if (tx?.counter?.upsert) {
    try {
      const counterRow = await tx.counter.upsert({
        where: { name: `medical_lock_code_${year}` },
        create: { name: `medical_lock_code_${year}`, value: nextSeq },
        update: { value: { increment: 1 } },
      });
      if (counterRow.value < nextSeq) {
        await tx.counter.update({
          where: { name: `medical_lock_code_${year}` },
          data: { value: nextSeq },
        });
      } else {
        nextSeq = counterRow.value;
      }
    } catch {
      // Counter table fallback if not available
    }
  }

  let candidate = `${prefix}${String(nextSeq).padStart(3, '0')}`;
  if (tx?.medicalLock?.findUnique) {
    while (await tx.medicalLock.findUnique({ where: { lockCode: candidate } })) {
      nextSeq++;
      candidate = `${prefix}${String(nextSeq).padStart(3, '0')}`;
    }
  }
  return candidate;
}
