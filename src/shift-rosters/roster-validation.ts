import { effectiveNow } from '../common/utils/demo-clock';
import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';
import { shiftInterval } from './groom-zones';

export async function assertRosterSlot(
  tx: Prisma.TransactionClient,
  date: Date,
  shiftId: string,
  zoneId: string,
  groomIds: string[],
  excludeIds: string[] = [],
) {
  const shift = await tx.shiftCatalog.findUnique({ where: { id: shiftId } });
  const zone = await tx.stallZone.findUnique({ where: { id: zoneId } });
  if (!shift?.isActive || !zone?.isActive)
    throw apiError(
      HttpStatus.CONFLICT,
      'ROSTER_TARGET_INACTIVE',
      'Ca trực hoặc khu chuồng đã ngừng hoạt động.',
    );
  const interval = shiftInterval(date, shift);
  if (interval.end <= effectiveNow().getTime())
    throw apiError(
      HttpStatus.CONFLICT,
      'ROSTER_SHIFT_ENDED',
      'Không sửa hoặc sao chép vào ca trực đã kết thúc.',
    );
  const valid = await tx.user.count({
    where: { id: { in: groomIds }, role: 'GROOM', status: 'ACTIVE' },
  });
  if (valid !== groomIds.length)
    throw apiError(
      HttpStatus.CONFLICT,
      'INVALID_GROOMS_SELECTED',
      'Nhân viên được chọn không còn hoạt động.',
    );
  const adjacent = await tx.shiftRoster.findMany({
    where: {
      groomUserId: { in: groomIds },
      date: { gte: new Date(date.getTime() - 86400000), lte: new Date(date.getTime() + 86400000) },
      id: { notIn: excludeIds },
    },
    include: { shift: true },
  });
  for (const row of adjacent) {
    if (row.date.getTime() === date.getTime() && row.shiftId === shiftId && row.zoneId === zoneId)
      continue;
    const other = shiftInterval(row.date, row.shift);
    if (interval.start < other.end && other.start < interval.end)
      throw apiError(
        HttpStatus.CONFLICT,
        'GROOM_SHIFT_OVERLAP',
        'Groom đã có ca trực chồng giờ (bao gồm ca qua đêm).',
      );
  }
}
