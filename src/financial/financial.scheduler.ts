import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FinancialService } from './financial.service';

@Injectable()
export class FinancialScheduler {
  private readonly logger = new Logger(FinancialScheduler.name);
  constructor(private readonly financial: FinancialService) {}

  @Cron('10 0 1 * *', { name: 'monthly-boarding-invoices', timeZone: 'Asia/Ho_Chi_Minh' })
  async generatePreviousMonth(): Promise<void> {
    const club = new Date(Date.now() + 7 * 3600000);
    club.setUTCDate(1);
    club.setUTCMonth(club.getUTCMonth() - 1);
    try {
      await this.financial.generateMonthlyDrafts(club.toISOString().slice(0, 7), {
        id: null,
        name: 'Financial scheduler',
        role: 'SYSTEM',
      });
    } catch (err) {
      this.logger.error(`Monthly invoice generation failed: ${(err as Error).message}`);
    }
  }

  @Cron('0 * * * * *', { name: 'invoice-overdue-sweep', timeZone: 'Asia/Ho_Chi_Minh' })
  async sweep(): Promise<void> {
    try {
      await this.financial.sweepOverdue();
    } catch (err) {
      this.logger.error(`Invoice overdue sweep failed: ${(err as Error).message}`);
    }
  }
}
