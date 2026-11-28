import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TrainingScheduler } from '../training/training.scheduler';
import { FinancialScheduler } from '../financial/financial.scheduler';
import { DailyTasksScheduler } from '../daily-tasks/daily-tasks.scheduler';
import { BusinessMailScheduler } from '../business-mail/business-mail.scheduler';
import { IncidentsScheduler } from '../incidents/incidents.scheduler';
import { PreventiveScheduler } from '../medical/preventive.scheduler';
import { effectiveNow, getDemoClockState, isDemoClockActive } from './utils/demo-clock';

@Injectable()
export class DemoClockScheduler {
  private readonly logger = new Logger(DemoClockScheduler.name);
  isBusy = false;
  private lastMinute = '';
  private lastCareDay = '';
  private lastMedicalDay = '';
  private lastMailDay = '';
  private lastMonth = '';
  constructor(
    private readonly training: TrainingScheduler,
    private readonly financial: FinancialScheduler,
    private readonly care: DailyTasksScheduler,
    private readonly mail: BusinessMailScheduler,
    private readonly incidents: IncidentsScheduler,
    private readonly preventive: PreventiveScheduler,
  ) {}

  @Interval('demo-clock-business-tick', 1000)
  async tick() {
    if (!isDemoClockActive() || this.isBusy) return;
    const state = getDemoClockState();
    const local = new Date(+effectiveNow() + 7 * 3600000).toISOString();
    const minute = `${state.revision}:${local.slice(0, 16)}`;
    if (minute === this.lastMinute) return;
    this.isBusy = true;
    try {
      const day = `${state.revision}:${local.slice(0, 10)}`;
      const month = `${state.revision}:${local.slice(0, 7)}`;
      const minuteOfDay = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
      const careDue = minuteOfDay >= 5 && day !== this.lastCareDay;
      const medicalDue = minuteOfDay >= 360 && day !== this.lastMedicalDay;
      const mailDue = minuteOfDay >= 420 && day !== this.lastMailDay;
      const monthDue =
        (local.slice(8, 10) !== '01' || minuteOfDay >= 10) && month !== this.lastMonth;
      const work: Array<() => Promise<unknown>> = [
        () => this.training.nightlySweep(true),
        () => this.financial.sweep(true),
        () => this.incidents.checkAndSendReminders(undefined, true),
      ];
      if (careDue) work.push(() => this.care.handleNightlyTaskGeneration(true));
      if (medicalDue)
        work.push(
          () => this.preventive.dailyReminders(undefined, true),
          () => this.preventive.followUpReminders(undefined, true),
        );
      if (mailDue) work.push(() => this.mail.remind(true));
      if (monthDue) work.push(() => this.financial.generatePreviousMonth(true));
      for (const run of work) {
        try {
          await run();
        } catch (error) {
          this.logger.warn(`TimeControl job failed: ${(error as Error).message}`);
        }
      }
      this.lastMinute = minute;
      if (careDue) this.lastCareDay = day;
      if (medicalDue) this.lastMedicalDay = day;
      if (mailDue) this.lastMailDay = day;
      if (monthDue) this.lastMonth = month;
    } finally {
      this.isBusy = false;
    }
  }
}
