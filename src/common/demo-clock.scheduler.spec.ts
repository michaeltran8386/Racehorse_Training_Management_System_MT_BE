import { TrainingScheduler } from '../training/training.scheduler';
import { FinancialScheduler } from '../financial/financial.scheduler';
import { DemoClockScheduler } from './demo-clock.scheduler';
import { setDemoClock } from './utils/demo-clock';
import { DemoClockController, SetDemoClockDto } from './demo-clock.controller';
import { validate } from 'class-validator';

describe('TimeControl jobs and API', () => {
  const env = process.env.NODE_ENV;
  let jobs: any[];
  let scheduler: DemoClockScheduler;
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    jest.useFakeTimers().setSystemTime(new Date('2026-11-28T00:00:00Z'));
    setDemoClock(null);
    jobs = [
      { nightlySweep: jest.fn() },
      { sweep: jest.fn(), generatePreviousMonth: jest.fn() },
      { handleNightlyTaskGeneration: jest.fn() },
      { remind: jest.fn() },
      { checkAndSendReminders: jest.fn() },
      { followUpReminders: jest.fn(), dailyReminders: jest.fn() },
    ];
    scheduler = new DemoClockScheduler(...(jobs as [any, any, any, any, any, any]));
  });
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    setDemoClock(null);
    jest.useRealTimers();
    process.env.NODE_ENV = env;
  });
  it('runs sweeps once per minute and daily/monthly jobs at virtual boundaries', async () => {
    await scheduler.tick();
    expect(jobs[0].nightlySweep).not.toHaveBeenCalled();
    setDemoClock(new Date('2026-11-30T16:59:58Z'));
    await scheduler.tick();
    await scheduler.tick();
    expect(jobs[0].nightlySweep).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(11 * 60000);
    await scheduler.tick();
    expect(jobs[0].nightlySweep).toHaveBeenCalledTimes(2);
    expect(jobs[2].handleNightlyTaskGeneration).toHaveBeenCalledTimes(2);
    expect(jobs[1].generatePreviousMonth).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(60000);
    await scheduler.tick();
    expect(jobs[0].nightlySweep).toHaveBeenCalledTimes(3);
    expect(jobs[2].handleNightlyTaskGeneration).toHaveBeenCalledTimes(2);
    expect(jobs[1].generatePreviousMonth).toHaveBeenCalledTimes(2);
  });
  it('honors care and reminder times after midnight and blocks reentry', async () => {
    setDemoClock(new Date('2026-12-01T00:01:00+07:00'));
    scheduler.isBusy = true;
    await scheduler.tick();
    expect(jobs[0].nightlySweep).not.toHaveBeenCalled();
    scheduler.isBusy = false;
    await scheduler.tick();
    expect(jobs[2].handleNightlyTaskGeneration).not.toHaveBeenCalled();
    expect(jobs[1].generatePreviousMonth).not.toHaveBeenCalled();
    jest.advanceTimersByTime(4 * 60000);
    await scheduler.tick();
    expect(jobs[2].handleNightlyTaskGeneration).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5 * 60000);
    await scheduler.tick();
    expect(jobs[1].generatePreviousMonth).toHaveBeenCalledTimes(1);
    expect(jobs[5].dailyReminders).not.toHaveBeenCalled();
    jest.advanceTimersByTime(350 * 60000);
    await scheduler.tick();
    expect(jobs[5].dailyReminders).toHaveBeenCalledTimes(1);
    expect(jobs[3].remind).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60 * 60000);
    await scheduler.tick();
    expect(jobs[3].remind).toHaveBeenCalledTimes(1);
  });
  it('pauses wall-clock cron callbacks while TimeControl owns business jobs', async () => {
    const common = { sweepOverdue: jest.fn() };
    const financial = { sweepOverdue: jest.fn(), generateMonthlyDrafts: jest.fn() };
    const trainingCron = new TrainingScheduler(common as any);
    const financialCron = new FinancialScheduler(financial as any);
    setDemoClock(new Date('2030-01-01T15:30:00+07:00'));
    await trainingCron.nightlySweep();
    await financialCron.generatePreviousMonth();
    expect(common.sweepOverdue).not.toHaveBeenCalled();
    expect(financial.generateMonthlyDrafts).not.toHaveBeenCalled();
    await trainingCron.nightlySweep(true);
    await financialCron.generatePreviousMonth(true);
    expect(common.sweepOverdue).toHaveBeenCalledTimes(1);
    expect(financial.generateMonthlyDrafts).toHaveBeenCalledWith(
      '2029-12',
      expect.objectContaining({ role: 'SYSTEM' }),
    );
  });
  it('rejects production writes, concurrent changes, and invalid input; supports real-time reset', async () => {
    const controller = new DemoClockController(scheduler);
    const bad = Object.assign(new SetDemoClockDto(), { at: '2026-02-30T12:00:00+07:00' });
    expect((await validate(bad)).length).toBeGreaterThan(0);
    expect((await validate(new SetDemoClockDto())).length).toBeGreaterThan(0);
    expect((await validate(Object.assign(new SetDemoClockDto(), { at: null }))).length).toBe(0);
    scheduler.isBusy = true;
    await expect(controller.set({ at: null })).rejects.toThrow();
    scheduler.isBusy = false;
    const shifted = await controller.set({ at: '2030-01-01T15:30:00+07:00' });
    expect(shifted.serverNow).toBe('2030-01-01T08:30:00.000Z');
    const real = await controller.set({ at: null });
    expect(real.simulated).toBe(false);
    process.env.NODE_ENV = 'production';
    await expect(controller.set({ at: null })).rejects.toThrow();
  });
});
