import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { apiError } from '../common/exceptions/api-error';

export const BOARDING_MONTHLY_RATE = 6000000;
const DAY_MS = 86400000;
const CLUB_OFFSET_MS = 7 * 3600000;

export function boardingMonth(billingPeriod: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingPeriod) || billingPeriod.startsWith('0000')) {
    throw apiError(
      HttpStatus.BAD_REQUEST,
      'INVALID_BILLING_PERIOD',
      'Use a valid billing month in YYYY-MM format.',
    );
  }
  const calendar = new Date(`${billingPeriod}-01T00:00:00Z`);
  const firstDay = calendar.getTime() / DAY_MS;
  calendar.setUTCMonth(calendar.getUTCMonth() + 1);
  const lastDay = calendar.getTime() / DAY_MS;
  return {
    firstDay,
    lastDay,
    start: new Date(firstDay * DAY_MS - CLUB_OFFSET_MS),
    end: new Date(lastDay * DAY_MS - CLUB_OFFSET_MS),
  };
}

/** Count club-calendar days, including arrival and excluding departure (minimum one day). */
export function calculateBoardingFee(
  billingPeriod: string,
  allocations: { startDate: Date; endDate: Date | null }[],
): { boardingDays: number; boardingFee: Prisma.Decimal } {
  const { firstDay, lastDay } = boardingMonth(billingPeriod);
  const occupied = new Set<number>();
  for (const { startDate, endDate } of allocations) {
    if (
      !Number.isFinite(startDate.getTime()) ||
      (endDate && (!Number.isFinite(endDate.getTime()) || endDate < startDate))
    ) {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'INVALID_STAY_INTERVAL',
        'The stall stay dates are invalid.',
      );
    }
    const arrival = Math.floor((startDate.getTime() + CLUB_OFFSET_MS) / DAY_MS);
    const departure = endDate
      ? Math.max(arrival + 1, Math.floor((endDate.getTime() + CLUB_OFFSET_MS) / DAY_MS))
      : lastDay;
    for (let day = Math.max(arrival, firstDay); day < Math.min(departure, lastDay); day++) {
      occupied.add(day);
    }
  }
  return {
    boardingDays: occupied.size,
    boardingFee: new Prisma.Decimal(BOARDING_MONTHLY_RATE)
      .mul(occupied.size)
      .div(lastDay - firstDay)
      .toDecimalPlaces(0),
  };
}
