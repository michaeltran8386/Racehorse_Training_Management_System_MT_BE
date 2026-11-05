import { FinancialScheduler } from './financial.scheduler';
import { FinancialService } from './financial.service';

describe('FinancialScheduler', () => {
  it('generates the previous club-calendar month at a year boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-31T17:10:00Z'));
    try {
      const generateMonthlyDrafts = jest.fn().mockResolvedValue({ createdCount: 1 });
      const scheduler = new FinancialScheduler({
        generateMonthlyDrafts,
      } as unknown as FinancialService);
      await scheduler.generatePreviousMonth();
      expect(generateMonthlyDrafts).toHaveBeenCalledWith('2026-12', {
        id: null,
        name: 'Financial scheduler',
        role: 'SYSTEM',
      });
    } finally {
      jest.useRealTimers();
    }
  });
  it('runs the overdue sweep without depending on a user opening a report', async () => {
    const sweepOverdue = jest.fn().mockResolvedValue(2);
    await new FinancialScheduler({ sweepOverdue } as unknown as FinancialService).sweep();
    expect(sweepOverdue).toHaveBeenCalledTimes(1);
  });
});
