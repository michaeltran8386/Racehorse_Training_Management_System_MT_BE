import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

const CLUB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEMO_DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/;
const demoClockStorage = new AsyncLocalStorage<Date>();

/**
 * Parses YYYY-MM-DD or YYYY-MM-DDTHH:mm in club time (+07:00), keeping current time-of-day when omitted
 * so same-day ordering and UTC+7 clubDate conversions remain consistent.
 * Always disabled in production.
 */
export function parseDemoDate(raw: unknown): Date | null {
  if (process.env.NODE_ENV === 'production' || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = DEMO_DATE_RE.exec(trimmed);
  if (!match) return null;
  const [year, month, day] = match[1].split('-').map(Number);
  const nowClub = new Date(Date.now() + CLUB_OFFSET_MS);
  const explicitTime = match[2] !== undefined;
  const utcMs =
    Date.UTC(
      year,
      month - 1,
      day,
      explicitTime ? Number(match[2]) : nowClub.getUTCHours(),
      explicitTime ? Number(match[3]) : nowClub.getUTCMinutes(),
      explicitTime ? 0 : nowClub.getUTCSeconds(),
      explicitTime ? 0 : nowClub.getUTCMilliseconds(),
    ) - CLUB_OFFSET_MS;
  const parsed = new Date(utcMs);
  if (
    !Number.isFinite(utcMs) ||
    new Date(utcMs + CLUB_OFFSET_MS).toISOString().slice(0, 10) !== match[1]
  )
    return null;
  return parsed;
}

export function demoClockMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV === 'production') {
    next();
    return;
  }
  const header = req.headers['x-demo-date'];
  const raw = Array.isArray(header) ? header[0] : header;
  const demoDate = parseDemoDate(raw);
  if (!demoDate) {
    next();
    return;
  }
  demoClockStorage.run(demoDate, () => next());
}

/** Returns request-scoped simulated Date in non-production when X-Demo-Date is set; otherwise real Date. */
export function effectiveNow(): Date {
  if (process.env.NODE_ENV === 'production') return new Date();
  return demoClockStorage.getStore() ?? new Date();
}

/** True only in non-production while a valid X-Demo-Date override is active for the current request. */
export function isDemoClockActive(): boolean {
  return process.env.NODE_ENV !== 'production' && demoClockStorage.getStore() !== undefined;
}
