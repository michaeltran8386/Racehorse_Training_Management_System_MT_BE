import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const CLUB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEMO_DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/;
// shortcut: clock state is local to one backend process; use shared storage before running multiple replicas.
let offsetMs = 0;
let simulated = false;
let revision = randomUUID();

export function isDemoClockActive(): boolean {
  return process.env.NODE_ENV !== 'production' && simulated;
}

/** The business clock runs at normal speed; authentication and session lifetimes use the real clock. */
export function effectiveNow(): Date {
  return new Date(Date.now() + (isDemoClockActive() ? offsetMs : 0));
}

export function getDemoClockState() {
  const real = Date.now();
  return {
    serverNow: new Date(real + (isDemoClockActive() ? offsetMs : 0)).toISOString(),
    realNow: new Date(real).toISOString(),
    simulated: isDemoClockActive(),
    revision,
  };
}

export function setDemoClock(at: Date | null) {
  if (process.env.NODE_ENV === 'production')
    throw new Error('TimeControl is disabled in production');
  if (at && !Number.isFinite(+at)) throw new RangeError('Invalid TimeControl timestamp');
  offsetMs = at ? +at - Date.now() : 0;
  simulated = at !== null;
  revision = randomUUID();
  return getDemoClockState();
}

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

// Retained for existing bootstrap callers; request headers cannot change the shared clock.
export function demoClockMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
