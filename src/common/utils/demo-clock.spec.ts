import {
  demoClockMiddleware,
  effectiveNow,
  getDemoClockState,
  parseDemoDate,
  setDemoClock,
} from './demo-clock';

describe('shared running business clock', () => {
  const env = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    jest.useFakeTimers().setSystemTime(new Date('2026-11-28T01:00:00Z'));
    setDemoClock(null);
  });
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    setDemoClock(null);
    jest.useRealTimers();
    process.env.NODE_ENV = env;
  });
  it('runs from the chosen instant across requests and rolls into the next day', () => {
    const initial = setDemoClock(new Date('2026-11-29T16:59:59Z'));
    jest.advanceTimersByTime(2000);
    expect(effectiveNow().toISOString()).toBe('2026-11-29T17:00:01.000Z');
    demoClockMiddleware({ headers: { 'x-demo-date': '2030-01-01' } } as any, {} as any, () =>
      expect(effectiveNow().toISOString()).toBe('2026-11-29T17:00:01.000Z'),
    );
    expect(getDemoClockState().revision).toBe(initial.revision);
    expect(getDemoClockState().simulated).toBe(true);
    setDemoClock(null);
    expect(+effectiveNow()).toBe(Date.now());
    expect(getDemoClockState().revision).not.toBe(initial.revision);
  });
  it('validates legacy club dates and never simulates in production', () => {
    expect(parseDemoDate('2026-11-29T15:30')?.toISOString()).toBe('2026-11-29T08:30:00.000Z');
    for (const raw of ['2026-02-30', '2026-13-01', '2026-11-29T24:00', '2026-11-29T15:60'])
      expect(parseDemoDate(raw)).toBeNull();
    expect(() => setDemoClock(new Date('invalid'))).toThrow();
    setDemoClock(new Date('2030-01-01T00:00:00Z'));
    process.env.NODE_ENV = 'production';
    expect(+effectiveNow()).toBe(Date.now());
    expect(parseDemoDate('2030-01-01')).toBeNull();
    expect(() => setDemoClock(null)).toThrow('disabled');
  });
});
