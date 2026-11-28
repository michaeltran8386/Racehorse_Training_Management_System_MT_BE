import { effectiveNow } from '../common/utils/demo-clock';
import { Prisma } from '@prisma/client';
import { clubDate } from '../training/training-rules';

type RosterDelegate = {
  findMany(args: {
    where: Prisma.ShiftRosterWhereInput;
    select: { zoneId: true; groomUserId?: true };
  }): Promise<{ zoneId: string; groomUserId?: string }[]>;
};

type RosterReader = {
  shiftRoster?: RosterDelegate;
  groomAssignment?: RosterDelegate;
};

/** Ngày CLB (UTC+7) dạng cột @db.Date của ShiftRoster. */
export function rosterDay(at = effectiveNow()): Date {
  return new Date(`${clubDate(at)}T00:00:00.000Z`);
}

export function shiftInterval(
  date: Date,
  shift: { startTime: string; endTime: string; isOvernight: boolean },
) {
  const minutes = (time: string) => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  };
  const start = date.getTime() - 7 * 3600000 + minutes(shift.startTime) * 60000;
  let end = date.getTime() - 7 * 3600000 + minutes(shift.endTime) * 60000;
  if (shift.isOvernight || end <= start) end += 86400000;
  return { start, end };
}

/** Actual duty now, including the previous day's overnight roster. */
export async function onDutyGrooms(
  db: Prisma.TransactionClient,
  zoneId: string,
  at = effectiveNow(),
) {
  const today = rosterDay(at);
  const rows = await db.shiftRoster.findMany({
    where: {
      zoneId,
      date: { gte: new Date(today.getTime() - 86400000), lte: today },
      shift: { isActive: true },
      zone: { isActive: true },
      groom: { role: 'GROOM', status: 'ACTIVE' },
    },
    include: { shift: true, groom: { select: { id: true, fullName: true } } },
  });
  return rows.filter((row) => {
    const range = shiftInterval(row.date, row.shift);
    return range.start <= at.getTime() && at.getTime() < range.end;
  });
}

/**
 * #1: Groom chỉ quản lý khu chuồng mình được phân ca trong ngày (mọi ca của hôm nay).
 * Không có ca hôm nay thì không thấy ngựa nào.
 */
export async function groomZoneIds(
  prisma: RosterReader | any,
  groomUserId: string,
  at = effectiveNow(),
): Promise<string[]> {
  const delegate: RosterDelegate | undefined = prisma?.shiftRoster ?? prisma?.groomAssignment;
  if (!delegate?.findMany || typeof delegate.findMany !== 'function') {
    return [];
  }
  const rows = await delegate.findMany({
    where: { groomUserId, date: rosterDay(at) },
    select: { zoneId: true },
  });
  return [...new Set((rows || []).map((r: any) => r.zoneId))];
}

/** Điều kiện lọc ngựa đang ở một trong các khu. */
export function horsesInZones(zoneIds: string[]): Prisma.HorseWhereInput {
  return { stallAllocations: { some: { isActive: true, stall: { zoneId: { in: zoneIds } } } } };
}

/** Groom đang trực hôm nay ở khu của ngựa (người nhận thông báo về ngựa). */
export async function zoneGroomIds(
  prisma: RosterReader | any,
  zoneId: string | null | undefined,
  at = effectiveNow(),
): Promise<string[]> {
  if (!zoneId) return [];
  const delegate: RosterDelegate | undefined = prisma?.shiftRoster ?? prisma?.groomAssignment;
  if (!delegate?.findMany || typeof delegate.findMany !== 'function') {
    return [];
  }
  const rows = await delegate.findMany({
    where: { zoneId, date: rosterDay(at) },
    select: { zoneId: true, groomUserId: true },
  });
  return [...new Set((rows || []).map((r: any) => r.groomUserId as string))];
}
