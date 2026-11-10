import { planDailyTasks, shiftCovers, toMinutes } from './daily-schedule';

const rosters = [
  {
    zoneId: 'A',
    groomUserId: 'g1',
    shiftId: 'M',
    startTime: '05:00',
    endTime: '13:00',
    isOvernight: false,
  },
  {
    zoneId: 'B',
    groomUserId: 'g1',
    shiftId: 'M',
    startTime: '05:00',
    endTime: '13:00',
    isOvernight: false,
  },
  {
    zoneId: 'A',
    groomUserId: 'g2',
    shiftId: 'P',
    startTime: '13:00',
    endTime: '21:00',
    isOvernight: false,
  },
];

describe('planDailyTasks', () => {
  const horses = Array.from({ length: 6 }, (_, i) => ({
    id: `h${i}`,
    zoneId: i < 4 ? 'A' : 'B',
    stallCode: `S${i}`,
    isLocked: i === 0,
    careInstructions:
      i === 0 ? [{ activity: 'Ngâm chân nước đá', frequencyPerDay: 2 }] : undefined,
  }));
  const tasks = planDailyTasks(horses, rosters);

  it('never gives one groom two tasks at the same minute', () => {
    const seen = new Set<string>();
    // Việc ở khu không có ai trực (khu B buổi chiều) chưa giao cho Groom nào – không tính là trùng giờ của một Groom.
    const assigned = tasks.filter((t) => t.assignedGroomUserId);
    expect(assigned.length).toBeGreaterThan(0);
    for (const t of assigned) {
      const key = `${t.assignedGroomUserId}|${t.scheduledTime}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('assigns each task to the groom whose shift covers it', () => {
    const afternoon = tasks.filter(
      (t) => t.zoneId === 'A' && toMinutes(t.scheduledTime) >= 13 * 60 && t.mealType !== 'EVENING',
    );
    expect(afternoon.length).toBeGreaterThan(0);
    expect(afternoon.every((t) => t.assignedGroomUserId === 'g2' && t.shiftId === 'P')).toBe(true);
  });

  it('gives a locked horse ice-boot rest from careInstructions and skips walking', () => {
    const types = tasks.filter((t) => t.horseId === 'h0').map((t) => t.taskType);
    expect(types).toContain('ICE_BOOT_REST');
    expect(types).toContain('GROOMING');
    expect(types).not.toContain('WALKING');
  });
});

describe('shiftCovers', () => {
  it('handles overnight shifts', () => {
    const night = { startTime: '21:00', endTime: '05:00', isOvernight: true };
    expect(shiftCovers(night, toMinutes('23:30'))).toBe(true);
    expect(shiftCovers(night, toMinutes('04:59'))).toBe(true);
    expect(shiftCovers(night, toMinutes('12:00'))).toBe(false);
  });
});
