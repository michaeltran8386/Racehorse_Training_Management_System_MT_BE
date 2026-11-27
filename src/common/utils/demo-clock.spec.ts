import { demoClockMiddleware, effectiveNow, parseDemoDate } from './demo-clock';

describe('demo-clock', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('parses YYYY-MM-DD in development and returns null in production or for invalid dates', () => {
    process.env.NODE_ENV = 'development';
    const parsed = parseDemoDate('2026-12-15');
    expect(parsed).toBeInstanceOf(Date);
    expect(parsed?.toISOString().slice(0, 10)).toMatch(/^2026-12-1[45]$/);
    expect(parseDemoDate('not-a-date')).toBeNull();

    process.env.NODE_ENV = 'production';
    expect(parseDemoDate('2026-12-15')).toBeNull();
  });

  it('accepts an exact club time, rejects invalid calendar dates, and remains request scoped', () => {
    process.env.NODE_ENV = 'development';
    expect(parseDemoDate('2026-11-29T15:30')?.toISOString()).toBe('2026-11-29T08:30:00.000Z');
    for (const value of ['2026-02-30', '2026-13-01', '2026-11-29T24:00', '2026-11-29T15:60'])
      expect(parseDemoDate(value)).toBeNull();
    demoClockMiddleware(
      { headers: { 'x-demo-date': '2026-11-29T15:30' } } as any,
      {} as any,
      () => {
        expect(effectiveNow().toISOString()).toBe('2026-11-29T08:30:00.000Z');
      },
    );
    process.env.NODE_ENV = 'production';
    expect(parseDemoDate('2026-11-29T15:30')).toBeNull();
  });
  it('scopes effectiveNow() per request via demoClockMiddleware in development', () => {
    process.env.NODE_ENV = 'development';
    let capturedInside: Date | null = null;
    demoClockMiddleware({ headers: { 'x-demo-date': '2030-05-10' } } as any, {} as any, () => {
      capturedInside = effectiveNow();
    });
    expect(capturedInside).toBeInstanceOf(Date);
    expect((capturedInside as unknown as Date).getUTCFullYear()).toBe(2030);
    // Outside middleware scope, effectiveNow() falls back to real server year
    expect(effectiveNow().getUTCFullYear()).toBe(new Date().getUTCFullYear());
  });
});
