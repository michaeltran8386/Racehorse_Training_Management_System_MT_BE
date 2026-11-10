import { DailyTaskType } from '@prisma/client';

// Lập lịch công việc chăm sóc trong ngày (thuần, không chạm DB) — dùng chung cho DailyTasksService và prisma/seed.ts.
// Mỗi việc được gán cho Groom trực ca chứa giờ gốc của việc đó, và các việc của cùng một Groom trong một ca
// được xếp nối tiếp nhau (không chồng giờ).

export interface ScheduleCareInstruction {
  activity: string;
  frequencyPerDay: number; // 1, 2, or 3
  notes?: string;
  phaseName?: string;
}

export interface ScheduleHorse {
  id: string;
  zoneId?: string;
  stallId?: string;
  stallCode?: string;
  allocationGroomId?: string;
  isLocked: boolean;
  allowedActivityLevel?: string;
  mealsJson?: unknown;
  medications?: Array<{
    name: string;
    dosage: string | number;
    unit?: string;
    route?: string;
    notes?: string;
    supplyId?: string;
    frequencyPerDay?: number;
  }>;
  careInstructions?: ScheduleCareInstruction[];
}

export interface ScheduleRoster {
  zoneId: string;
  groomUserId: string;
  shiftId: string;
  startTime: string; // "05:00"
  endTime: string; // "13:00"
  isOvernight: boolean;
}

export interface PlannedTask {
  horseId: string;
  zoneId?: string;
  stallId?: string;
  taskType: DailyTaskType;
  title: string;
  description: string;
  mealType: string | null;
  scheduledTime: string;
  shiftId?: string;
  assignedGroomUserId?: string;
  itemsSnapshotJson?: unknown;
}

interface Template {
  taskType: DailyTaskType;
  title: string;
  description: string;
  mealType: string | null;
  baseTime: string;
  minutes: number;
  itemsSnapshotJson?: unknown;
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

export const toHhmm = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const shiftCovers = (
  r: Pick<ScheduleRoster, 'startTime' | 'endTime' | 'isOvernight'>,
  minutes: number,
) => {
  const start = toMinutes(r.startTime);
  const end = toMinutes(r.endTime);
  return r.isOvernight || end <= start
    ? minutes >= start || minutes < end
    : minutes >= start && minutes < end;
};

const MEAL_LABEL: Record<string, string> = { MORNING: 'Sáng', NOON: 'Trưa', EVENING: 'Tối' };

// Khẩu phần lưu dạng { time, mealType? | type: 'Sáng' | 'Trưa' | 'Chiều' | 'Tối', items? | hayKg/grainKg/notes }.
function mealTypeOf(meal: any): string {
  if (meal?.mealType && MEAL_LABEL[meal.mealType]) return meal.mealType;
  const label = String(meal?.type ?? '').toLowerCase();
  if (label.includes('sáng')) return 'MORNING';
  if (label.includes('trưa')) return 'NOON';
  if (label.includes('chiều') || label.includes('tối')) return 'EVENING';
  const at = meal?.time ? toMinutes(meal.time) : 360;
  return at < 600 ? 'MORNING' : at < 900 ? 'NOON' : 'EVENING';
}

function mealDescription(meal: any): string {
  const items = Array.isArray(meal?.items) ? meal.items : [];
  if (items.length > 0) {
    const text = items
      .map((it: any) => `${it.supplyName || it.supplyCode}: ${it.amount}${it.unit}`)
      .join(' + ');
    return `Thực đơn đã duyệt: ${text}`;
  }
  const parts = [
    meal?.hayKg ? `${meal.hayKg}kg cỏ khô` : null,
    meal?.grainKg ? `${meal.grainKg}kg ngũ cốc` : null,
    meal?.notes || null,
  ].filter(Boolean);
  return parts.length > 0
    ? `Thực đơn đã duyệt: ${parts.join(' + ')}`
    : 'Cho ăn theo khẩu phần chuẩn.';
}

const MEAL_BASE: Record<string, string> = { MORNING: '05:30', NOON: '11:30', EVENING: '18:00' };

function templatesFor(horse: ScheduleHorse): Template[] {
  const list: Template[] = [];
  const meals = Array.isArray(horse.mealsJson) ? (horse.mealsJson as any[]) : [];
  const seen = new Set<string>();
  for (const meal of meals) {
    const mealType = mealTypeOf(meal);
    if (seen.has(mealType)) continue;
    seen.add(mealType);
    list.push({
      taskType: DailyTaskType.FEEDING,
      title: `Cho ăn bữa ${MEAL_LABEL[mealType]}`,
      description: mealDescription(meal),
      mealType,
      baseTime: MEAL_BASE[mealType],
      minutes: 5,
      itemsSnapshotJson: Array.isArray(meal?.items) ? meal.items : undefined,
    });
  }
  const fallbackMeals: Array<[string, string]> = [
    ['MORNING', '3.0kg cỏ khô Timothy + 1.0kg cám yến mạch + nước sạch.'],
    ['NOON', '2.0kg cỏ khô + nước hòa tan chất điện giải.'],
    ['EVENING', '3.5kg cỏ khô + 1.2kg ngũ cốc hỗn hợp.'],
  ];
  for (const [mealType, description] of fallbackMeals) {
    if (seen.has(mealType)) continue;
    list.push({
      taskType: DailyTaskType.FEEDING,
      title: `Cho ăn bữa ${MEAL_LABEL[mealType]}`,
      description,
      mealType,
      baseTime: MEAL_BASE[mealType],
      minutes: 5,
    });
  }

  list.push({
    taskType: DailyTaskType.CLEANING,
    title: 'Vệ sinh ô chuồng & dọn phân buổi sáng',
    description:
      'Dọn sạch phân, thay rơm lót chuồng mới, khử trùng đáy chuồng và kiểm tra máng nước tự động.',
    mealType: null,
    baseTime: '07:00',
    minutes: 10,
  });

  // Chăm sóc y tế từ Phác đồ điều trị của Vet (Chỉ dẫn chăm sóc hàng ngày)
  // Bỏ hoàn toàn việc hardcode ngâm nước đá khi bị lock! Chấp nhận để trống nếu không có chỉ định từ Vet.
  if (horse.careInstructions && horse.careInstructions.length > 0) {
    for (const inst of horse.careInstructions) {
      const freq = Math.min(3, Math.max(1, Number(inst.frequencyPerDay) || 1));
      const times =
        freq === 1 ? ['09:30'] : freq === 2 ? ['09:30', '15:00'] : ['09:30', '13:30', '17:00'];

      times.forEach((time, idx) => {
        const suffix = times.length > 1 ? ` (Lần ${idx + 1})` : '';
        const isIceCold = /đá|lạnh|ice|boot|chườm|ngâm/i.test(inst.activity);
        list.push({
          taskType: isIceCold ? DailyTaskType.ICE_BOOT_REST : DailyTaskType.ICE_BOOT_REST,
          title: `${inst.activity}${suffix}`,
          description: `Chỉ dẫn chăm sóc theo phác đồ y tế${inst.phaseName ? ` [${inst.phaseName}]` : ''}: ${inst.activity}.${inst.notes ? ` Ghi chú: ${inst.notes}` : ''}`,
          mealType: null,
          baseTime: time,
          minutes: 15,
        });
      });
    }
  }

  // Tắm rửa, chải lông móng luôn có cho ngựa hàng ngày
  list.push({
    taskType: DailyTaskType.GROOMING,
    title: 'Tắm rửa, chải lông móng & kiểm tra thể trạng',
    description:
      'Tắm mát, chải mượt bờm lông, cạo sạch sỏi bùn trong lòng móng và lau khô chân ngựa.',
    mealType: null,
    baseTime: '13:30',
    minutes: 15,
  });

  // Dắt đi dạo nhẹ nhàng - chỉ khi ngựa không bị chỉ định nghỉ ngơi nghiêm ngặt tại ô chuồng
  const isStrictStallRest =
    horse.isLocked || /stall rest|nghỉ tại ô|strict/i.test(horse.allowedActivityLevel || '');

  if (!isStrictStallRest) {
    list.push({
      taskType: DailyTaskType.WALKING,
      title: 'Dắt đi dạo nhẹ nhàng & thả lỏng cơ bắp',
      description: 'Dắt ngựa đi bộ thả lỏng 15 phút trong sân bóng mát.',
      mealType: null,
      baseTime: '15:30',
      minutes: 15,
    });
  }

  if (horse.medications && horse.medications.length > 0) {
    for (const med of horse.medications) {
      const rawFreq = Number(med.frequencyPerDay) || 1;
      const freq = Math.min(3, Math.max(1, rawFreq)); // Tối đa 3 lần/ngày theo yêu cầu
      const times =
        freq === 1 ? ['08:00'] : freq === 2 ? ['08:00', '18:00'] : ['08:00', '13:00', '19:00'];

      times.forEach((time, idx) => {
        const suffix = times.length > 1 ? ` (Lần ${idx + 1})` : '';
        const parsedDosage =
          typeof med.dosage === 'number' ? med.dosage : parseFloat(String(med.dosage)) || 1;
        list.push({
          taskType: DailyTaskType.MEDICATION,
          title: `Cho uống thuốc: ${med.name}${suffix}`,
          description: `Liều lượng: ${med.dosage} ${med.unit || ''}. Đường dùng: ${med.route || 'Uống'}.${med.notes ? ` Ghi chú: ${med.notes}` : ''}`,
          mealType: null,
          baseTime: time,
          minutes: 10,
          itemsSnapshotJson: [
            {
              supplyId: med.supplyId,
              supplyName: med.name,
              amount: parsedDosage,
              unit: med.unit,
              isMedicine: true,
            },
          ],
        });
      });
    }
  }

  return list;
}

export function planDailyTasks(horses: ScheduleHorse[], rosters: ScheduleRoster[]): PlannedTask[] {
  const rows = horses
    .flatMap((horse) => templatesFor(horse).map((t) => ({ horse, t, base: toMinutes(t.baseTime) })))
    .sort(
      (a, b) =>
        a.base - b.base ||
        (a.horse.stallCode ?? '~').localeCompare(b.horse.stallCode ?? '~') ||
        a.horse.id.localeCompare(b.horse.id),
    );

  const cursor = new Map<string, number>();
  return rows.map(({ horse, t, base }) => {
    const roster = rosters.find((r) => r.zoneId === horse.zoneId && shiftCovers(r, base));
    const groom = roster?.groomUserId ?? horse.allocationGroomId;
    const lane = groom ? `${groom}|${roster?.shiftId ?? 'none'}` : `horse|${horse.id}`;
    const start = Math.max(base, cursor.get(lane) ?? 0);
    cursor.set(lane, start + t.minutes);
    return {
      horseId: horse.id,
      zoneId: horse.zoneId,
      stallId: horse.stallId,
      taskType: t.taskType,
      title: t.title,
      description: t.description,
      mealType: t.mealType,
      scheduledTime: toHhmm(start),
      shiftId: roster?.shiftId,
      assignedGroomUserId: groom,
      itemsSnapshotJson: t.itemsSnapshotJson,
    };
  });
}
