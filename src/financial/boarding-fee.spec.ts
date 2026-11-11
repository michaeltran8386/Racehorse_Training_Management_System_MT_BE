import { calculateBoardingFee, calculateBoardingFeeForOwner } from './boarding-fee';

const stay = (start: string, end: string | null) => ({
  startDate: new Date(start),
  endDate: end ? new Date(end) : null,
});

describe('calculateBoardingFee', () => {
  it.each(['2026-11', '2026-12', '2026-02', '2028-02'])(
    'charges exactly six million for a full %s including open stays',
    (period) => {
      const result = calculateBoardingFee(period, [stay('2020-01-01T00:00:00+07:00', null)]);
      expect(result.boardingFee.toNumber()).toBe(6000000);
    },
  );
  it.each([
    ['2026-11', 2000000],
    ['2026-12', 1935484],
  ])('prorates ten days in %s and rounds once', (period, amount) => {
    const result = calculateBoardingFee(period, [
      stay(`${period}-01T09:00:00+07:00`, `${period}-11T09:00:00+07:00`),
    ]);
    expect(result.boardingDays).toBe(10);
    expect(result.boardingFee.toNumber()).toBe(amount);
  });
  it('merges transfers, overlapping stays and same-day visits without double charging', () => {
    const result = calculateBoardingFee('2026-11', [
      stay('2026-11-01T09:00:00+07:00', '2026-11-05T09:00:00+07:00'),
      stay('2026-11-05T09:00:00+07:00', '2026-11-11T09:00:00+07:00'),
      stay('2026-11-05T10:00:00+07:00', '2026-11-05T12:00:00+07:00'),
    ]);
    expect(result.boardingDays).toBe(10);
    expect(result.boardingFee.toNumber()).toBe(2000000);
  });
  it('clips at club midnight and charges the arrival day but not the departure day', () => {
    const allocations = [stay('2026-10-31T17:00:00Z', '2026-12-01T17:00:00Z')];
    expect(calculateBoardingFee('2026-11', allocations).boardingDays).toBe(30);
    expect(calculateBoardingFee('2026-12', allocations).boardingDays).toBe(1);
    expect(calculateBoardingFee('2026-10', allocations).boardingDays).toBe(0);
  });
  it('charges one day for arrival and departure on the same club date', () => {
    expect(
      calculateBoardingFee('2026-11', [
        stay('2026-11-03T08:00:00+07:00', '2026-11-03T09:00:00+07:00'),
      ]).boardingDays,
    ).toBe(1);
    expect(calculateBoardingFee('2026-11', []).boardingFee.toNumber()).toBe(0);
  });
  it.each(['2026-00', '2026-13', '0000-01', '2026-1', 'bad'])(
    'rejects invalid period %s',
    (period) => expect(() => calculateBoardingFee(period, [])).toThrow(),
  );
  it('rejects reversed or invalid stay dates', () => {
    expect(() => calculateBoardingFee('2026-11', [stay('2026-11-04', '2026-11-03')])).toThrow();
    expect(() => calculateBoardingFee('2026-11', [stay('invalid', null)])).toThrow();
  });

  it('prorates boarding fees when a horse transfers ownership mid-month', () => {
    const allocations = [
      {
        startDate: new Date('2026-11-01T00:00:00+07:00'),
        endDate: new Date('2026-11-16T00:00:00+07:00'),
        ownerId: 'owner-A',
      },
      {
        startDate: new Date('2026-11-16T00:00:00+07:00'),
        endDate: new Date('2026-12-01T00:00:00+07:00'),
        ownerId: 'owner-B',
      },
    ];
    const feeA = calculateBoardingFeeForOwner('2026-11', allocations, 'owner-A');
    const feeB = calculateBoardingFeeForOwner('2026-11', allocations, 'owner-B');

    expect(feeA.boardingDays).toBe(15);
    expect(feeB.boardingDays).toBe(15);
    expect(feeA.boardingFee.toNumber()).toBe(3000000);
    expect(feeB.boardingFee.toNumber()).toBe(3000000);
    expect(feeA.boardingFee.plus(feeB.boardingFee).toNumber()).toBe(6000000);
  });
});
