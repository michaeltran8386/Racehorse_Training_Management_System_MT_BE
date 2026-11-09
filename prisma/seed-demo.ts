// Bộ dữ liệu DEMO BẢO VỆ (F0 + F2) — chạy: npm run db:seed:demo
// - Xóa sạch database LOCAL rồi dựng lại (prisma db push --force-reset), chỉ chạy được trên localhost.
// - Dựa trên seed.ts (đủ dữ liệu cho mọi màn hình) + các tình huống riêng cho kịch bản demo
//   (đánh dấu "DEMO:" bên dưới). Ngày giờ tính theo lúc chạy lệnh: chạy lại sáng hôm demo.
// - Mật khẩu mọi tài khoản: EquiFlow@2026.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { BOARDING_MONTHLY_RATE, calculateBoardingFee } from '../src/financial/boarding-fee';
import { planDailyTasks } from '../src/daily-tasks/daily-schedule';
import { clubDate } from '../src/training/training-rules';

const now = new Date();
const DAY = 86400000;
const clubDay = (offset: number) => clubDate(new Date(now.getTime() + offset * DAY));
const pad = (n: number, length = 2) => String(n).padStart(length, '0');
const clubDateTime = (day: number, hour: number, minute = 0) =>
  new Date(`${clubDay(day)}T${pad(hour)}:${pad(minute)}:00+07:00`);
const dateOnly = (day: number) => new Date(`${clubDay(day)}T00:00:00Z`);
const stamp = (day: number) => {
  const at = day === 0 ? now : clubDateTime(day, 7);
  return { createdAt: at, updatedAt: at };
};

const prefix = 'e091f100-';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const id = (key: string) => {
  const h = hash(key);
  return `${prefix}${h.slice(0, 4)}-4${h.slice(4, 7)}-8${h.slice(7, 10)}-${h.slice(10, 22)}`;
};
const fixture = { id: { startsWith: prefix } };
const expiredEmail = 'equiflow-expired-fixture@gmail.com';
const googleSubject = 'equiflow-lifecycle-unlinked-test-subject';
const resetHash = hash('equiflow-expired-reset-fixture');
const permissionId = 39101;

const staff = [
  ['manager', 'Trần Quang Minh', 'CLUB_MANAGER'],
  ['trainer', 'Nguyễn Văn Tuấn', 'HEAD_TRAINER'],
  ['trainer2', 'Lê Hoàng Nam', 'HEAD_TRAINER'],
  ['vet', 'BS. Phạm Minh Trí', 'VETERINARIAN'],
  ['groom', 'Lê Văn Bình', 'GROOM'],
  ['groom2', 'Hoàng Văn Phúc', 'GROOM'],
  ['groom3', 'Đỗ Thị Mai', 'GROOM'],
  ['owner', 'Phạm Gia Bảo', 'HORSE_OWNER'],
  ['owner2', 'Đặng Hoàng Yến', 'HORSE_OWNER'],
] as const;
const user = (key: string) => id(`user/${key}`);
const horse = (n: number) => id(`horse/${n}`);
const zone = (key: string) => id(`zone/${key}`);
const stall = (key: string) => id(`stall/${key}`);
const supply = (key: string) => id(`supply/${key}`);
const plan = (key: string) => id(`plan/${key}`);
const med = (key: string) => id(`medical/${key}`);

const horses = [
  ['Bạch Long Mã', 'Colt', 'Bay Dark', 495, 'ACTIVE', 'A01', 'owner', 'trainer', -90, 5],
  ['Xích Thố', 'Stallion', 'Chestnut', 510, 'INJURED', 'A02', 'owner', 'trainer', -86, 6],
  ['Hắc Báo', 'Filly', 'Black', 490, 'IN_TRAINING', 'A03', 'owner', 'trainer', -90, 4],
  ['Thần Phong', 'Gelding', 'Bay', 480, 'ACTIVE', 'A04', 'owner2', 'trainer2', -90, 5],
  ['Lão Tướng', 'Gelding', 'Grey', 520, 'RETIRED', 'B01', 'owner2', 'trainer2', -90, 18],
  ['Tuyết Ảnh', 'Mare', 'Grey', 475, 'ISOLATED', 'C01', 'owner2', 'trainer2', 0, 6],
  ['Kim Long', 'Stallion', 'Palomino', 505, 'RESTING', 'B02', 'owner', 'trainer', -72, 7],
  ['Vân Tiêu', 'Colt', 'Roan', 470, 'IN_TRAINING', 'B03', 'owner', 'trainer', -35, 3],
  ['Dạ Nguyệt', 'Mare', 'Bay', 485, 'UNDER_OBSERVATION', 'A05', 'owner2', 'trainer2', -82, 6],
  ['Lôi Chấn', 'Stallion', 'Black', 515, 'ACTIVE', 'A06', 'owner2', 'trainer2', -90, 5],
  ['Hồng Kỳ', 'Colt', 'Chestnut', 490, 'ACTIVE', 'A07', 'owner', 'trainer', -76, 4],
  ['Thanh Loan', 'Filly', 'Bay Dark', 480, 'ACTIVE', 'A08', 'owner2', 'trainer2', -74, 4],
] as const;
const trainerOf = (n: number) => user(horses[n - 1][7]);
const groomOf = (key: string) =>
  user(key.startsWith('A') ? 'groom' : key.startsWith('B') ? 'groom2' : 'groom3');
const allocation = (n: number) => ({ startDate: clubDateTime(horses[n - 1][8], 0), endDate: null });

function demoDatabase(): string {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const configured = process.env.DATABASE_URL;
  if (process.env.NODE_ENV === 'production' || !configured) {
    throw new Error('Demo seed requires a local PostgreSQL database.');
  }
  // DEMO: chỉ cho chạy trên PostgreSQL của chính máy này (không bao giờ Supabase / server chung).
  for (const value of [configured, process.env.DIRECT_URL ?? configured]) {
    const url = new URL(value);
    if (
      !['postgresql:', 'postgres:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.searchParams.has('host')
    ) {
      throw new Error('Demo seed only runs against a PostgreSQL database on localhost.');
    }
  }
  return configured;
}

async function clearFixtures(tx: Prisma.TransactionClient) {
  await tx.simulatorSession.deleteMany({});
  await tx.dailyCareTask.deleteMany({});
  await tx.shiftRoster.deleteMany({});
  await tx.dailyGroomingLog.deleteMany({});
  await tx.tournamentResult.deleteMany({});
  await tx.tournamentRegistration.deleteMany({});
  await tx.tournament.deleteMany({});
  await tx.financialInvoice.deleteMany({});
  await tx.workoutSession.deleteMany({});
  await tx.trainingPlan.deleteMany({});
  await tx.medicalLock.deleteMany({});
  await tx.injuryLog.deleteMany({});
  await tx.medicalRecord.deleteMany({});
  await tx.preventiveSchedule.deleteMany({});
  await tx.nutritionPlan.deleteMany({});
  await tx.incidentReport.deleteMany({});
  await tx.restockRequest.deleteMany({});
  await tx.stockBalance.deleteMany({});
  await tx.aIInsight.deleteMany({});
  await tx.permissionRequest.deleteMany({});
  await tx.notification.deleteMany({});
  await tx.auditLog.deleteMany({});
  await tx.refreshToken.deleteMany({});
  await tx.googleIdentity.deleteMany({});
  await tx.otpCode.deleteMany({});
  await tx.loginAttempt.deleteMany({});
  await tx.resetToken.deleteMany({});
  await tx.stallAllocation.deleteMany({});
  await tx.horse.deleteMany({});
  await tx.stall.deleteMany({});
  await tx.stallZone.deleteMany({});
  await tx.horseCatalogItem.deleteMany({});
  await tx.supplyCatalog.deleteMany({});
  await tx.preventiveTypeCatalog.deleteMany({});
  await tx.shiftCatalog.deleteMany({});
  await tx.user.deleteMany({});
}

async function seedClub(tx: Prisma.TransactionClient, passwordHash: string) {
  const users: Prisma.UserCreateManyInput[] = [
    ...staff.map(([key, fullName, role], i) => ({
      id: user(key),
      email: `${key}@gmail.com`,
      fullName,
      role,
      status: 'ACTIVE' as const,
      passwordHash,
      phoneNumber: `+849012345${pad(60 + i)}`,
      ...stamp(-90),
    })),
    {
      id: user('expired'),
      email: expiredEmail,
      fullName: 'Tài khoản thử nghiệm đã khóa',
      role: 'HORSE_OWNER',
      status: 'LOCKED',
      lockedAt: clubDateTime(-2, 9),
      ...stamp(-90),
    },
  ];
  // Keep seeded account IDs in place so unrelated sessions and audit references survive.
  for (const { id: userId, ...data } of users) {
    if (!userId) throw new Error('Seed account must have a stable ID.');
    await tx.user.upsert({ where: { id: userId }, create: { id: userId, ...data }, update: data });
  }
  const zones = [
    { code: 'A', name: 'Barn 1 · Đua', rows: 2, cols: 4, sortOrder: 1 },
    { code: 'B', name: 'Barn 2 · Huấn luyện & nghỉ', rows: 2, cols: 4, sortOrder: 2 },
    { code: 'C', name: 'Cách ly', rows: 1, cols: 4, sortOrder: 3 },
    { code: 'H', name: 'Khu Lưu giữ (Nợ phí)', rows: 1, cols: 4, sortOrder: 4 },
  ];
  await tx.stallZone.createMany({
    data: zones.map((z) => ({ id: zone(z.code), ...z, ...stamp(-90) })),
  });
  const occupied = new Set<string>(horses.map((h) => h[5]));
  await tx.stall.createMany({
    data: zones.flatMap((z) =>
      Array.from({ length: z.rows * z.cols }, (_, i) => {
        const key = z.code + pad(i + 1);
        return {
          id: stall(key),
          code: `STALL-${key}`,
          zone: z.name,
          zoneId: zone(z.code),
          row: Math.floor(i / z.cols) + 1,
          col: (i % z.cols) + 1,
          status: occupied.has(key)
            ? ('OCCUPIED' as const)
            : key === 'B04'
              ? ('MAINTENANCE' as const)
              : ('AVAILABLE' as const),
          notes: key === 'B04' ? 'Tạm ngừng sử dụng để sửa chốt cửa.' : null,
          ...stamp(-90),
        };
      }),
    ),
  });
  await tx.horseCatalogItem.createMany({
    data: [
      {
        id: id('breed/thoroughbred'),
        type: 'BREED',
        code: 'THOROUGHBRED',
        name: 'Thoroughbred',
        ...stamp(-90),
      },
      ...[...new Set(horses.map((h) => h[2]))].map((name, i) => ({
        id: id(`color/${name}`),
        type: 'COLOR' as const,
        code: name.toUpperCase().replaceAll(' ', '_'),
        name,
        sortOrder: i + 1,
        ...stamp(-90),
      })),
    ],
  });
  await tx.horse.createMany({
    data: horses.map(([name, gender, color, weightKg, status, , owner, , arrival, years], i) => ({
      id: horse(i + 1),
      horseCode: `HR-${pad(i + 1, 6)}`,
      name,
      gender,
      color,
      weightKg,
      microchip: `985141002341${pad(i + 1, 3)}`,
      microchipRfid: `985141002341${pad(i + 1, 3)}`,
      breed: 'Thoroughbred',
      dob: dateOnly(-years * 365 - i * 11),
      status,
      isMedicalLocked: i === 1,
      ownerId: user(owner),
      retireReason: status === 'RETIRED' ? 'RETIRED' : null,
      deleteReason: status === 'RETIRED' ? 'Giải nghệ vì tuổi tác; vẫn lưu trú tại CLB.' : null,
      createdAt: clubDateTime(arrival, 0),
      updatedAt: now,
    })),
  });
  await tx.stallAllocation.createMany({
    data: horses.map((h, i) => ({
      id: id(`allocation/${i + 1}`),
      horseId: horse(i + 1),
      stallId: stall(h[5]),
      assignedGroomUserId: groomOf(h[5]),
      ...allocation(i + 1),
      createdAt: allocation(i + 1).startDate,
      updatedAt: now,
    })),
  });
}

const activeHorses = [1, 2, 3, 4, 7, 8, 9, 10, 11, 12];
const history = [
  {
    key: 'bach-base',
    n: 1,
    name: 'Bạch Long Mã · Nền tảng',
    from: -60,
    to: -42,
    type: 'BASE',
    skip: [-45],
  },
  {
    key: 'bach-speed',
    n: 1,
    name: 'Bạch Long Mã · Tốc độ',
    from: -41,
    to: -20,
    type: 'SPEED',
    skip: [-31, -30, -20],
  },
  {
    key: 'legend',
    n: 5,
    name: 'Lão Tướng · Mùa giải cuối',
    from: -60,
    to: -2,
    type: 'SPEED',
    skip: [-54, -46, -36, -26, -20],
  },
  {
    key: 'sprint',
    n: 10,
    name: 'Lôi Chấn · Bứt tốc',
    from: -60,
    to: -22,
    type: 'SPEED',
    skip: [-45],
  },
] as const;
const activeKey = (n: number) => `active/${n}`;
const phase = (key: string) => id(`phase/${key}`);
const workout = (key: string) => id(`workout/${key}`);

async function seedTraining(tx: Prisma.TransactionClient) {
  const active = activeHorses.map((n) => ({
    key: activeKey(n),
    n,
    name: `${horses[n - 1][0]} · ${n === 9 ? 'Phục hồi' : n === 8 ? 'Nền tảng' : n === 7 ? 'Duy trì thể lực' : 'Chuẩn bị thi đấu'}`,
    from: n === 8 ? -24 : n === 11 ? -18 : -12,
    to: n === 2 ? 12 : 28,
    type: [2, 7, 9].includes(n) ? 'RECOVERY' : n === 8 ? 'BASE' : 'PRE_RACE',
  }));
  const definitions = [...history, ...active];
  await tx.trainingPlan.createMany({
    data: definitions.map(({ key, n, name, from, to, type }, i) => {
      const complete = i < history.length;
      const surface = n === 3 || n === 8 ? 'DIRT' : 'TURF';
      return {
        id: plan(key),
        planCode: `GA-${pad(i + 1, 6)}`,
        horseId: horse(n),
        trainerUserId: trainerOf(n),
        phaseName: name,
        objective: complete
          ? 'Ổn định phong độ trong mùa giải.'
          : 'Duy trì tiến độ và theo dõi hồi phục sau tập.',
        phases: [
          {
            id: phase(key),
            name:
              type === 'RECOVERY'
                ? 'Phục hồi'
                : type === 'BASE'
                  ? 'Nền tảng'
                  : type === 'SPEED'
                    ? 'Tốc độ'
                    : 'Chuẩn bị thi đấu',
            type,
            startDate: clubDay(from),
            endDate: clubDay(to),
            sessionsPerWeek: 6,
            maxWeeklyDistance: 10000,
            // DEMO: giai đoạn Hồi phục không đặt tốc độ mục tiêu (ô này chỉ nhận 10–70 km/h,
            // để 8 như seed.ts thì mở "Sửa giáo án" sẽ báo lỗi).
            ...(type === 'RECOVERY' ? {} : { targetSpeedKmh: 62 }),
            surface,
          },
        ],
        startDate: clubDateTime(from, 0),
        endDate: clubDateTime(to, 23, 59),
        trackSurface: surface,
        targetDistance: type === 'RECOVERY' ? 600 : 1600,
        targetSpeed: type === 'RECOVERY' ? 8 : 62,
        status: complete ? ('COMPLETED' as const) : ('ACTIVE' as const),
        completionSummary: complete
          ? 'Hoàn thành đầy đủ các buổi tập; chỉ số hồi phục ổn định.'
          : null,
        createdAt: clubDateTime(from - 1, 9),
        updatedAt: complete ? clubDateTime(to + 1, 9) : n === 1 ? now : clubDateTime(from, 10),
      };
    }),
  });

  const scheduled = (
    key: string,
    planKey: string,
    n: number,
    day: number,
    hour: number,
    minute: number,
    workoutType: string,
    trackSurface: string,
    distanceMeters: number,
    extra: Partial<Prisma.WorkoutSessionCreateManyInput> = {},
  ): Prisma.WorkoutSessionCreateManyInput => ({
    id: workout(key),
    trainingPlanId: plan(planKey),
    phaseId: phase(planKey),
    horseId: horse(n),
    assignedStaffUserId: groomOf(horses[n - 1][5]),
    scheduledDate: clubDateTime(day, hour, minute),
    distanceMeters,
    repetitions: 1,
    workoutType,
    trackSurface,
    intensity: ['TRIAL', 'BREEZE'].includes(workoutType)
      ? 'HEAVY'
      : ['WALK', 'SWIM'].includes(workoutType)
        ? 'LIGHT'
        : 'MEDIUM',
    status: 'SCHEDULED',
    ...stamp(Math.min(day - 1, -1)),
    ...extra,
  });
  const result = (
    n: number,
    day: number,
    distance: number,
    surface: string,
    speed: number,
    hr: number,
  ) => ({
    status: 'COMPLETED' as const,
    actualDistanceMeters: distance,
    actualSurface: surface,
    trackCondition: 'DRY',
    averageSpeedKmh: speed,
    topSpeedKmh: Math.min(64, speed + 2),
    heartRatePeak: hr,
    heartRateRecovery: 58 + Math.abs(day % 9),
    actualTimeSeconds: Math.round(((distance * 3.6) / speed) * 10) / 10,
    completionLevel: 'ACHIEVED',
    performanceScore: 7 + Math.abs(day % 4),
    recoveryTimeMinutes: 9 + Math.abs(day % 4),
    trainerNotes: 'Giữ nhịp đều, đáp ứng mục tiêu tốc độ và hồi phục tốt sau buổi tập.',
    resultRecordedById: trainerOf(n),
  });
  const completed: Prisma.WorkoutSessionCreateManyInput[] = history.flatMap(
    ({ key, n, from, to, skip }) =>
      Array.from({ length: to - from + 1 }, (_, i) => from + i)
        .filter((d) => !(skip as readonly number[]).includes(d))
        .map((d) => {
          const distance = 1200 + Math.abs(d % 4) * 100;
          const speed = n === 1 ? 58 + Math.abs(d % 5) : 46 + Math.abs(d % 15);
          const hr = n === 1 ? 140 + Math.abs(d % 26) : 132 + Math.abs(d % 38);
          return scheduled(
            `history/${key}/${d}`,
            key,
            n,
            d,
            7,
            15,
            key === 'bach-base' ? 'CANTER' : 'BREEZE',
            'TURF',
            distance,
            {
              ...result(n, d, distance, 'TURF', speed, hr),
              resultRecordedAt: clubDateTime(d, 8),
              updatedAt: clubDateTime(d, 8),
            },
          );
        }),
  );
  for (let i = 0; i < 15; i++) {
    const d = -22 + i,
      distance = 800 + i * 20;
    completed.push(
      scheduled(
        `young/${i}`,
        activeKey(8),
        8,
        d,
        8,
        40,
        i % 2 ? 'CANTER' : 'TROT',
        'DIRT',
        distance,
        {
          ...result(8, d, distance, 'DIRT', 24 + i, 111 + i),
          resultRecordedAt: clubDateTime(d, 9),
          updatedAt: clubDateTime(d, 9),
        },
      ),
    );
  }
  for (const d of [-16, -12, -8]) {
    completed.push(
      scheduled(`trial-history/${d}`, activeKey(11), 11, d, 10, 15, 'TRIAL', 'TURF', 1000, {
        ...result(11, d, 1000, 'TURF', 57, 151),
        targetSpeedKmh: 60,
        jockeyName: 'Nguyễn Văn An',
        resultRecordedAt: clubDateTime(d, 11),
        updatedAt: clubDateTime(d, 11),
      }),
    );
  }

  const today = [
    scheduled('today/bach', activeKey(1), 1, 0, 8, 0, 'TRIAL', 'TURF', 1400, {
      targetSpeedKmh: 62,
      jockeyName: 'Nguyễn Văn An',
    }),
    scheduled('today/phong', activeKey(4), 4, 0, 8, 15, 'TRIAL', 'TURF', 1400, {
      targetSpeedKmh: 60,
      jockeyName: 'Trần Đình Trọng',
      assignedStaffUserId: user('groom2'),
    }),
    scheduled('today/bao', activeKey(3), 3, 0, 9, 30, 'CANTER', 'DIRT', 1600, {
      targetSpeedKmh: 42,
    }),
    scheduled('today/nguyet', activeKey(9), 9, 0, 14, 0, 'SWIM', 'NONE', 300, {
      targetDurationSeconds: 1200,
      medicalOverride: true,
      assignedStaffUserId: user('groom3'),
    }),
    scheduled('today/kim', activeKey(7), 7, 0, 16, 30, 'WALK', 'TURF', 500),
    scheduled('locked/xich', activeKey(2), 2, 2, 7, 30, 'BREEZE', 'TURF', 1200, {
      status: 'BLOCKED',
      statusReason: 'Khóa y tế KH-000001: viêm gân cấp tính chân trước bên phải.',
      targetSpeedKmh: 55,
    }),
  ];
  const rotation = [1, 3, 4, 8, 9, 10, 11, 12];
  const future = Array.from({ length: 14 }, (_, i) => {
    const d = i + 1,
      n = rotation[i % rotation.length];
    const type = n === 9 ? 'SWIM' : n === 10 ? 'BREEZE' : n === 8 ? 'TROT' : 'CANTER';
    return [
      scheduled(
        `future/${d}/main`,
        activeKey(n),
        n,
        d,
        6,
        30,
        type,
        n === 9 ? 'NONE' : n === 3 || n === 8 ? 'DIRT' : 'TURF',
        n === 9 ? 300 : 1200,
        n === 9
          ? { targetDurationSeconds: 1200, medicalOverride: true }
          : n === 10
            ? { targetSpeedKmh: 62 }
            : {},
      ),
      scheduled(`future/${d}/walk`, activeKey(7), 7, d, 16, 30, 'WALK', 'TURF', 500),
    ];
  }).flat();
  // DEMO (kịch bản Xếp lịch buổi tập): các buổi dựng sẵn để demo từng ngoại lệ.
  // Happy case dùng khung trống: Bạch Long Mã · ngày mốt · 09:00 · groom Lê Văn Bình.
  const demo = [
    // E10: Hồng Kỳ đã có lượt Chạy thử trên sân Cỏ lúc 10:00 ngày mốt
    //      -> xếp Chạy thử cho ngựa khác trên sân Cỏ lúc 10:10 bị chặn (khung 15 phút).
    scheduled('demo/trial-slot', activeKey(11), 11, 2, 10, 0, 'TRIAL', 'TURF', 1000, {
      targetSpeedKmh: 60,
      jockeyName: 'Nguyễn Văn An',
      assignedStaffUserId: user('groom3'),
    }),
    // E11: Vân Tiêu đã đủ 3 buổi trong ngày kia (3 ngày nữa) -> thêm buổi thứ 4 bị chặn.
    scheduled('demo/day-full-1', activeKey(8), 8, 3, 6, 0, 'WALK', 'DIRT', 800),
    scheduled('demo/day-full-2', activeKey(8), 8, 3, 10, 0, 'TROT', 'DIRT', 1000),
    scheduled('demo/day-full-3', activeKey(8), 8, 3, 15, 0, 'WALK', 'DIRT', 800),
  ];
  await tx.workoutSession.createMany({ data: [...completed, ...today, ...future, ...demo] });
  await tx.counter.upsert({
    where: { name: 'horse_code' },
    create: { name: 'horse_code', value: horses.length },
    update: {},
  });
  await tx.counter.upsert({
    where: { name: 'training_plan' },
    create: { name: 'training_plan', value: definitions.length },
    update: {},
  });
}

const injuryReason = 'Viêm gân cấp tính chân trước bên phải';
const preventive = (key: string) => id(`preventive/${key}`);
async function seedMedical(tx: Prisma.TransactionClient) {
  const vet = user('vet');
  const cases = [
    {
      key: 'xich',
      n: 2,
      day: -2,
      status: 'OPEN',
      diagnosis: injuryReason,
      symptoms: 'Sưng nóng gân gấp và khập khiễng khi bước.',
      protocol: 'Nghỉ tuyệt đối, chườm lạnh, tái khám siêu âm sau 7 ngày.',
      follow: 7,
      closed: null,
      severity: 'SEVERE',
    },
    {
      key: 'bach',
      n: 1,
      day: -31,
      status: 'CLOSED',
      diagnosis: 'Căng cơ nhẹ sau tập.',
      symptoms: 'Đau cơ nhẹ, không sưng.',
      protocol: 'Nghỉ một ngày, khám lại trước khi trở về lịch tập.',
      follow: null,
      closed: -30,
      severity: 'MILD',
    },
    {
      key: 'nguyet',
      n: 9,
      day: -25,
      status: 'CLOSED',
      diagnosis: 'Bong gân nhẹ đã bình phục.',
      symptoms: 'Sưng nhẹ cổ chân trái.',
      protocol: 'Chườm lạnh, sau khi bình phục tập bơi nhẹ có giám sát.',
      follow: 9,
      closed: -6,
      severity: 'MODERATE',
    },
    {
      key: 'tuyet',
      n: 6,
      day: 0,
      status: 'OPEN',
      diagnosis: 'Kiểm tra nhập đàn, chưa ghi nhận dấu hiệu lây nhiễm.',
      symptoms: 'Thể trạng ổn định khi nhập chuồng cách ly.',
      protocol: 'Cách ly đủ 14 ngày, ghi nhiệt độ hằng ngày và khám lại trước khi nhập đàn.',
      follow: 14,
      closed: null,
      severity: 'MILD',
    },
  ] as const;
  await tx.medicalRecord.createMany({
    data: cases.map((c, i) => ({
      id: med(c.key),
      recordNumber: `BA-${clubDay(c.day).slice(2, 7).replace('-', '')}-${pad(i + 1, 3)}`,
      horseId: horse(c.n),
      veterinarianUserId: vet,
      status: c.status,
      examinationDate: c.day === 0 ? now : clubDateTime(c.day, 9),
      examinationType: c.key === 'tuyet' ? 'Routine Clinical' : 'Injury Examination',
      symptoms: c.symptoms,
      clinicalDiagnosis: c.diagnosis,
      treatmentProtocol: c.protocol,
      severity: c.severity,
      temperature: 37.8,
      restingHeartRate: c.n === 2 ? 48 : 36,
      respiratoryRate: 14,
      weightKg: horses[c.n - 1][3],
      requiresFollowUp: c.follow !== null,
      followUpDate: c.follow === null ? null : clubDateTime(c.follow, 9),
      closedAt: c.closed === null ? null : clubDateTime(c.closed, 9),
      treatmentResult:
        c.closed === null ? null : 'Đã bình phục, tiếp tục theo dõi trong buổi tập nhẹ.',
      ...stamp(c.day),
      updatedAt: c.closed === null ? now : clubDateTime(c.closed, 9),
    })),
  });
  await tx.injuryLog.createMany({
    data: [
      {
        id: id('injury/xich'),
        horseId: horse(2),
        medicalRecordId: med('xich'),
        coordinateX: 0.72,
        coordinateY: 0.76,
        viewSide: 'RIGHT',
        bodySide: 'RIGHT',
        anatomicalZone: 'Cẳng trước phải',
        layer: 'MUSCLE',
        injuryType: injuryReason,
        severity: 'SEVERE',
        stage: 'ACUTE',
        status: 'ACTIVE',
        discoveryDate: clubDateTime(-2, 8),
        ...stamp(-2),
      },
      {
        id: id('injury/nguyet'),
        horseId: horse(9),
        medicalRecordId: med('nguyet'),
        coordinateX: 0.65,
        coordinateY: 0.81,
        viewSide: 'LEFT',
        bodySide: 'LEFT',
        anatomicalZone: 'Cổ chân trước trái',
        injuryType: 'Bong gân nhẹ',
        severity: 'MODERATE',
        stage: 'HEALED',
        status: 'RESOLVED',
        discoveryDate: clubDateTime(-25, 8),
        recoveryHistory: [
          {
            id: id('recovery/nguyet'),
            stage: 'HEALED',
            severity: 'MILD',
            evaluationDate: clubDateTime(-6, 9).toISOString(),
            notes: 'Không còn đau khi vận động nhẹ.',
            updatedByName: 'BS. Phạm Minh Trí',
          },
        ],
        ...stamp(-25),
        updatedAt: clubDateTime(-6, 9),
      },
    ],
  });
  await tx.medicalLock.createMany({
    data: [
      {
        id: id('lock/xich'),
        lockCode: 'KH-000001',
        horseId: horse(2),
        medicalRecordId: med('xich'),
        veterinarianUserId: vet,
        lockedAt: clubDateTime(-2, 9),
        expectedRestDays: 9,
        recheckDate: clubDateTime(7, 9),
        lockReason: injuryReason,
        unlockConditions: 'Siêu âm xác nhận gân không còn viêm và hết khập khiễng.',
        isLocked: true,
        ...stamp(-2),
      },
      {
        id: id('lock/bach'),
        lockCode: 'KH-000002',
        horseId: horse(1),
        medicalRecordId: med('bach'),
        veterinarianUserId: vet,
        lockedAt: clubDateTime(-31, 9),
        expectedRestDays: 1,
        recheckDate: clubDateTime(-30, 9),
        lockReason: 'Căng cơ nhẹ sau buổi tập.',
        isLocked: false,
        unlockedAt: clubDateTime(-30, 9),
        unlockVetUserId: vet,
        unlockReason: 'Hồi phục hoàn toàn sau điều trị',
        ...stamp(-31),
        updatedAt: clubDateTime(-30, 9),
      },
    ],
  });
  const vaccines = [
    ['TETANUS', 'Uốn ván'],
    ['INFLUENZA', 'Cúm ngựa'],
    ['RABIES', 'Bệnh dại'],
  ] as const;
  await tx.preventiveTypeCatalog.createMany({
    data: [
      ...vaccines.map(([code, name]) => ({
        id: preventive(code),
        code: `VAC_${code}`,
        name: `Tiêm phòng ${name}`,
        intervalDays: 365,
        ...stamp(-90),
      })),
      {
        id: preventive('DEWORM'),
        code: 'DEWORM',
        name: 'Tẩy giun định kỳ',
        category: 'DEWORMING',
        intervalDays: 90,
        ...stamp(-90),
      },
      {
        id: preventive('DENTAL'),
        code: 'DENTAL',
        name: 'Kiểm tra răng',
        category: 'DENTAL',
        intervalDays: 180,
        ...stamp(-90),
      },
    ],
  });
  await tx.preventiveSchedule.createMany({
    data: [
      ...horses.flatMap((_, i) =>
        vaccines.map(([code, product], j) => {
          const d = -76 + i * 2 + j;
          const date = clubDateTime(d, 9);
          return {
            id: id(`vaccine/${i + 1}/${code}`),
            horseId: horse(i + 1),
            typeCatalogId: preventive(code),
            veterinarianUserId: i === 5 ? null : vet,
            dueDate: date,
            completedDate: date,
            lastCompletedDate: date,
            status: 'COMPLETED' as const,
            productAdministered: product,
            batchNumber: `DEMO-${code}-${i + 1}`,
            performedByMode: i === 5 || i === 7 ? 'EXTERNAL' : 'SELF',
            performedByName: i === 5 || i === 7 ? 'Thú y cơ sở bàn giao' : 'BS. Phạm Minh Trí',
            ...stamp(d),
          };
        }),
      ),
      ...(
        [
          [3, 'DEWORM', 'DEWORMING', -5, 'OVERDUE'],
          [6, 'DEWORM', 'DEWORMING', 3, 'PENDING'],
          [9, 'DENTAL', 'DENTAL', 6, 'PENDING'],
          [12, 'DEWORM', 'DEWORMING', 10, 'PENDING'],
          [12, 'INFLUENZA', 'VACCINATION', 12, 'PENDING'],
        ] as const
      ).map(([n, key, scheduleType, day, status]) => ({
        id: id(`preventive-due/${n}/${key}`),
        horseId: horse(n),
        typeCatalogId: preventive(key),
        veterinarianUserId: vet,
        scheduleType,
        dueDate: clubDateTime(day, 9),
        status,
        ...stamp(-15),
      })),
    ],
  });
}

const shift = (key: string) => id(`shift/${key}`);
const food = [
  ['TIMOTHY', 'Cỏ khô Timothy', 'FEED_HAY', 'KG', 20000],
  ['OATS', 'Cám yến mạch', 'FEED_GRAIN', 'KG', 24000],
  ['ELECTROLYTE', 'Điện giải cho ngựa', 'SUPPLEMENT_ELECTROLYTE', 'PACKET', 45000],
  ['ANTI_INFLAM', 'Thuốc chống viêm thú y', 'MEDICINE', 'VIAL', 180000],
  ['BANDAGE', 'Băng cuốn đàn hồi', 'TOOL_EQUIPMENT', 'PIECE', 35000],
  ['DISINFECTANT', 'Dung dịch vệ sinh chuồng', 'CLEANING_SUPPLY', 'LITER', 65000],
] as const;
const nutrition = (horseId: string) => id(`nutrition/${horseId}`);

function mealsFor(resting: boolean) {
  return (
    [
      ['MORNING', '05:30', 3, resting ? 0.4 : 0.9],
      ['NOON', '11:30', 2.5, 0],
      ['EVENING', '18:00', 3, resting ? 0.4 : 1],
    ] as const
  ).map(([mealType, time, hay, grain]) => ({
    mealType,
    time,
    items: [
      {
        supplyId: supply('TIMOTHY'),
        supplyName: 'Cỏ khô Timothy',
        supplyCode: 'TIMOTHY',
        amount: hay,
        unit: 'KG',
      },
      ...(grain > 0
        ? [
            {
              supplyId: supply('OATS'),
              supplyName: 'Cám yến mạch',
              supplyCode: 'OATS',
              amount: grain,
              unit: 'KG',
            },
          ]
        : []),
    ],
  }));
}
async function seedStableCare(tx: Prisma.TransactionClient) {
  const manager = user('manager'),
    vet = user('vet');
  await tx.supplyCatalog.createMany({
    data: food.map(([code, name, category, unit, unitPrice]) => ({
      id: supply(code),
      code,
      name,
      category,
      unit,
      unitPrice,
      withdrawalDays: code === 'ANTI_INFLAM' ? 7 : null,
      ...stamp(-90),
    })),
  });
  await tx.stockBalance.createMany({
    data: ['A', 'B', 'C'].flatMap((key) =>
      food.map(([code], i) => ({
        id: id(`stock/${key}/${code}`),
        zoneId: zone(key),
        supplyId: supply(code),
        quantity:
          key === 'A' && code === 'TIMOTHY'
            ? 18
            : key === 'B' && code === 'ELECTROLYTE'
              ? 4
              : 55 + i * 9,
        minThreshold: code === 'TIMOTHY' ? 30 : 10,
        capacity: code === 'TIMOTHY' ? 300 : 180,
        lastAdjustedById: manager,
        lastInventoryDate: clubDateTime(-1, 16),
        ...stamp(-40),
      })),
    ),
  });
  await tx.restockRequest.createMany({
    data: [
      {
        id: id('restock/delivered'),
        requestNumber: `REQ-${clubDay(-32).replaceAll('-', '')}-0001`,
        zoneId: zone('A'),
        supplyId: supply('OATS'),
        requestedQuantity: 60,
        approvedQuantity: 60,
        status: 'DELIVERED',
        requestedById: user('groom'),
        reviewedById: manager,
        reviewedAt: clubDateTime(-31, 9),
        deliveredById: manager,
        deliveredAt: clubDateTime(-30, 11),
        urgencyReason: 'Bổ sung ngũ cốc cho đợt tập mùa thu.',
        ...stamp(-32),
        updatedAt: clubDateTime(-30, 11),
      },
      {
        id: id('restock/pending'),
        requestNumber: `REQ-${clubDay(-1).replaceAll('-', '')}-0001`,
        zoneId: zone('A'),
        supplyId: supply('TIMOTHY'),
        requestedQuantity: 100,
        status: 'PENDING',
        requestedById: user('groom'),
        urgencyReason: 'Tồn cỏ dưới ngưỡng, cần bổ sung cho đàn ngựa đua.',
        ...stamp(-1),
      },
      {
        id: id('restock/approved'),
        requestNumber: `REQ-${clubDay(-3).replaceAll('-', '')}-0001`,
        zoneId: zone('B'),
        supplyId: supply('ELECTROLYTE'),
        requestedQuantity: 30,
        approvedQuantity: 24,
        status: 'APPROVED',
        requestedById: user('groom2'),
        reviewedById: manager,
        reviewedAt: clubDateTime(-2, 9),
        urgencyReason: 'Đã duyệt, chờ nhà cung cấp giao.',
        ...stamp(-3),
        updatedAt: clubDateTime(-2, 9),
      },
    ],
  });
  const shifts = [
    {
      code: 'MORNING',
      name: 'Ca sáng',
      startTime: '05:00',
      endTime: '13:00',
      isOvernight: false,
      sortOrder: 1,
    },
    {
      code: 'AFTERNOON',
      name: 'Ca chiều',
      startTime: '13:00',
      endTime: '21:00',
      isOvernight: false,
      sortOrder: 2,
    },
    {
      code: 'NIGHT',
      name: 'Ca đêm',
      startTime: '21:00',
      endTime: '05:00',
      isOvernight: true,
      sortOrder: 3,
    },
  ];
  await tx.shiftCatalog.createMany({
    data: shifts.map((s) => ({ id: shift(s.code), ...s, ...stamp(-90) })),
  });
  const roster = ['A', 'B', 'C'].map((key) => ({
    zoneId: zone(key),
    groomUserId: groomOf(key),
    shiftId: shift('MORNING'),
    startTime: shifts[0].startTime,
    endTime: shifts[0].endTime,
    isOvernight: false,
  }));
  await tx.shiftRoster.createMany({
    data: Array.from({ length: 7 }, (_, i) => i - 3).flatMap((day) =>
      roster.map(({ zoneId, groomUserId, shiftId }, i) => ({
        id: id(`roster/${day}/${i}`),
        date: dateOnly(day),
        zoneId,
        groomUserId,
        shiftId,
        createdById: manager,
        notes: 'Kiểm tra máng nước, khẩu phần và sức khỏe đầu ca.',
        ...stamp(-4),
      })),
    ),
  });
  const care = horses.map((h, i) => ({
    id: horse(i + 1),
    zoneId: zone(h[5][0]),
    stallId: stall(h[5]),
    stallCode: `STALL-${h[5]}`,
    allocationGroomId: groomOf(h[5]),
    isLocked: i === 1,
    mealsJson: mealsFor(i === 6 || i === 4),
  }));
  await tx.nutritionPlan.createMany({
    data: care.map((h, i) => {
      const weight = horses[i][3],
        dailyFeedWeightKg = h.mealsJson
          .flatMap((m) => m.items)
          .reduce((sum, item) => sum + item.amount, 0);
      const start = Math.max(-12, horses[i][8]);
      const status = i === 0 || i === 6 ? ('PENDING_APPROVAL' as const) : i === 4 ? ('REJECTED' as const) : ('APPROVED' as const);
      const isApproved = status === 'APPROVED';
      return {
        id: nutrition(h.id),
        planCode: `DD-${pad(i + 1, 6)}`,
        horseId: h.id,
        status,
        horseWeightSnapshot: weight,
        dailyFeedWeightKg,
        targetWeightRatioPct: Number(((dailyFeedWeightKg / weight) * 100).toFixed(2)),
        mealsJson: h.mealsJson,
        validFrom: clubDateTime(start, 0),
        validTo: isApproved ? clubDateTime(28, 18) : null,
        createdById: trainerOf(i + 1),
        approvedById: isApproved ? vet : null,
        approvedAt: isApproved ? clubDateTime(start, 0) : null,
        rejectionReason: status === 'REJECTED' ? 'Tỷ lệ cỏ thô chưa đáp ứng nhu cầu tiêu hóa. Cần tăng lượng cỏ khô Timothy và giảm cám đậm đặc.' : null,
        vetNotes: status === 'REJECTED' ? 'Ngựa có tiền sử tiêu hóa nhạy cảm. HLV vui lòng điều chỉnh lại theo khuyến cáo.' : null,
        specialInstructions: h.isLocked
          ? 'Theo dõi lượng nước uống; không cho tập nặng.'
          : 'Chia khẩu phần theo bữa; cung cấp nước sạch liên tục.',
        ...stamp(start),
        createdAt: clubDateTime(start, 0),
      };
    }),
  });

  const tasks: Prisma.DailyCareTaskCreateManyInput[] = [-1, 0, 1].flatMap((day) =>
    planDailyTasks(
      care.filter((_, i) => horses[i][8] <= day),
      roster,
    ).map((task, i) => {
      const due = new Date(`${clubDay(day)}T${task.scheduledTime}:00+07:00`);
      const done = day < 0 || (day === 0 && due <= now && i % 3 !== 0);
      return {
        id: id(`care/${day}/${task.horseId}/${task.title}`),
        taskCode: `TSK-${clubDay(day).replaceAll('-', '')}-${pad(i + 1, 3)}`,
        date: dateOnly(day),
        horseId: task.horseId,
        stallZoneId: task.zoneId,
        stallId: task.stallId,
        taskType: task.taskType,
        title: task.title,
        description: task.description,
        mealType: task.mealType,
        scheduledTime: task.scheduledTime,
        shiftId: task.shiftId,
        nutritionPlanId: nutrition(task.horseId),
        assignedGroomUserId: task.assignedGroomUserId,
        isMedicalLocked: task.horseId === horse(2),
        medicalLockNotes: task.horseId === horse(2) ? injuryReason : null,
        itemsSnapshotJson: task.itemsSnapshotJson as Prisma.InputJsonValue | undefined,
        isCompleted: done,
        completedAt: done ? due : null,
        completedById: done ? task.assignedGroomUserId : null,
        createdAt: clubDateTime(Math.min(day, 0), 0),
        updatedAt: done ? due : now,
      };
    }),
  );
  tasks.push({
    id: id('care/midnight-check'),
    taskCode: `TSK-${clubDay(0).replaceAll('-', '')}-NIGHT`,
    date: dateOnly(0),
    horseId: horse(6),
    stallZoneId: zone('C'),
    stallId: stall('C01'),
    taskType: 'OTHER',
    title: 'Kiểm tra máng nước chuồng cách ly đầu ngày',
    scheduledTime: '00:00',
    assignedGroomUserId: user('groom3'),
    isCompleted: true,
    completedAt: now,
    completedById: user('groom3'),
    createdAt: clubDateTime(0, 0),
    updatedAt: now,
  });
  await tx.dailyCareTask.createMany({ data: tasks });
  await tx.dailyGroomingLog.createMany({
    data: [-7, -3, -1, 0].flatMap((day) =>
      [1, 2, 3, 7, 9].map((n) => ({
        id: id(`groom-log/${day}/${n}`),
        horseId: horse(n),
        groomUserId: groomOf(horses[n - 1][5]),
        shiftDate: day === 0 ? now : clubDateTime(day, 9),
        feedCompleted: day < 0 || now >= clubDateTime(0, 6),
        cleaningCompleted: day < 0 || now >= clubDateTime(0, 8),
        groomingCompleted: day < 0,
        iceBootCompleted: n === 2 && day >= -2,
        healthObservations:
          n === 2 && day >= -2
            ? 'Đang theo dõi sưng gân và chườm lạnh.'
            : 'Ăn hết khẩu phần; tinh thần và bước đi ổn định.',
        ...stamp(day),
      })),
    ),
  });
  await tx.incidentReport.createMany({
    data: [
      {
        id: id('incident/scratch'),
        incidentNumber: `INC-${clubDay(-7).replaceAll('-', '')}-0001`,
        horseId: horse(9),
        stallZoneId: zone('A'),
        reportedById: user('groom'),
        severity: 'MILD',
        symptomsJson: ['OTHER'],
        description: 'Ngựa cọ xước nhẹ thành chuồng',
        status: 'RESOLVED',
        reviewedById: vet,
        reviewedAt: clubDateTime(-6, 8),
        vetNotes: 'Vết trầy đã sạch và khô, không ảnh hưởng vận động.',
        ...stamp(-7),
        updatedAt: clubDateTime(-6, 8),
      },
      {
        id: id('incident/latch'),
        incidentNumber: `INC-${clubDay(0).replaceAll('-', '')}-0001`,
        horseId: horse(7),
        stallZoneId: zone('B'),
        reportedById: user('groom2'),
        severity: 'MILD',
        symptomsJson: ['OTHER'],
        description: 'Cửa chuồng STALL-B04 bị kẹt chốt',
        status: 'REPORTED',
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
}

const tournament = (key: string) => id(`tournament/${key}`);
const invoice = (key: string) => id(`invoice/${key}`);
const previousMonth = (day: number) => {
  const first = new Date(`${clubDay(day).slice(0, 7)}-01T00:00:00Z`);
  first.setUTCDate(0);
  return first.toISOString().slice(0, 7);
};

async function seedRacingAndInvoices(tx: Prisma.TransactionClient) {
  const events = [
    {
      key: 'autumn',
      name: 'Giải Vô Địch Mùa Thu EquiFlow',
      day: -45,
      distance: 1600,
      status: 'COMPLETED',
      places: [
        [1, 1, 50000000],
        [4, 2, 25000000],
        [10, 3, 10000000],
      ],
    },
    {
      key: 'open',
      name: 'Cúp Đua Nước Rút Mở Rộng',
      day: -20,
      distance: 1200,
      status: 'COMPLETED',
      places: [
        [5, 1, 20000000],
        [1, 2, 10000000],
      ],
    },
    {
      key: 'veteran-classic',
      name: 'Cúp Cự Ly Kinh Điển',
      day: -54,
      distance: 1800,
      status: 'COMPLETED',
      places: [
        [5, 1, 22000000],
        [4, 2, 11000000],
      ],
    },
    {
      key: 'veteran-derby',
      name: 'Derby Danh Dự',
      day: -46,
      distance: 1700,
      status: 'COMPLETED',
      places: [
        [5, 1, 24000000],
        [11, 2, 12000000],
      ],
    },
    {
      key: 'veteran-turf',
      name: 'Cúp Đường Cỏ',
      day: -36,
      distance: 1600,
      status: 'COMPLETED',
      places: [
        [12, 1, 22000000],
        [5, 2, 11000000],
      ],
    },
    {
      key: 'veteran-sprint',
      name: 'Cúp Tốc Độ CLB',
      day: -26,
      distance: 1200,
      status: 'COMPLETED',
      places: [
        [4, 1, 20000000],
        [5, 2, 10000000],
      ],
    },
    {
      key: 'winter',
      name: 'Cúp Mùa Đông Hoàng Gia',
      day: 20,
      distance: 1600,
      status: 'OPEN_REGISTRATION',
      places: [
        [1, 0, 0],
        [4, 0, 0],
        [10, 0, 0],
      ],
    },
    {
      key: 'spring',
      name: 'Cúp Tân Niên CLB',
      day: 60,
      distance: 1400,
      status: 'UPCOMING',
      places: [],
    },
  ] as const;
  await tx.tournament.createMany({
    data: events.map((e) => ({
      id: tournament(e.key),
      name: `${e.name} ${clubDay(e.day).slice(0, 4)}`,
      raceDate: clubDateTime(e.day, 15),
      location: 'Trường đua Thiên Mã',
      distanceMeters: e.distance,
      trackType: 'TURF',
      status: e.status,
      prizePool:
        e.day < 0
          ? (e.places as ReadonlyArray<readonly [number, number, number]>).reduce(
              (sum, p) => sum + p[2],
              0,
            )
          : 90000000,
      registrationDeadline: clubDateTime(e.day - 5, 17),
      ...stamp(Math.min(e.day - 25, -1)),
    })),
  });
  const registration = (key: string, n: number) => id(`entry/${key}/${n}`);
  await tx.tournamentRegistration.createMany({
    data: events.flatMap((e) =>
      (e.places as ReadonlyArray<readonly [number, number, number]>).map(([n]) => {
        const day = e.day < 0 ? e.day - 12 : -3;
        return {
          id: registration(e.key, n),
          tournamentId: tournament(e.key),
          horseId: horse(n),
          registeredByTrainerId: trainerOf(n),
          status: 'CONFIRMED' as const,
          registrationDate: clubDateTime(day, 9),
          ...stamp(day),
        };
      }),
    ),
  });
  await tx.tournamentResult.createMany({
    data: events.flatMap((e) =>
      (e.places as ReadonlyArray<readonly [number, number, number]>)
        .filter((p) => p[1] > 0)
        .map(([n, finalRank, prizeMoneyWon]) => {
          const avgSpeedKmh = 61.5 - finalRank * 1.8;
          return {
            id: id(`result/${e.key}/${n}`),
            registrationId: registration(e.key, n),
            finalRank,
            avgSpeedKmh,
            finishTimeSeconds: Number(((e.distance * 3.6) / avgSpeedKmh).toFixed(2)),
            prizeMoneyWon,
            officialNotes: `${['Huy chương vàng', 'Huy chương bạc', 'Huy chương đồng'][finalRank - 1]} · Kết quả chính thức.`,
            createdAt: clubDateTime(e.day, 16),
            updatedAt: clubDateTime(e.day, 16),
          };
        }),
    ),
  });

  const bills = [
    { key: 'paid', n: 1, issue: -20, status: 'PAID', trainingFee: 6000000, medicalFee: 2500000 },
    { key: 'overdue', n: 3, issue: -10, status: 'OVERDUE', trainingFee: 0, medicalFee: 0 },
    { key: 'sent', n: 4, issue: -2, status: 'SENT', trainingFee: 1800000, medicalFee: 400000 },
    { key: 'draft', n: 10, issue: 0, status: 'DRAFT', trainingFee: 4000000, medicalFee: 0 },
  ] as const;
  await tx.financialInvoice.createMany({
    data: bills.map(({ key, n, issue, status, trainingFee, medicalFee }) => {
      const billingPeriod = previousMonth(issue);
      const { boardingDays, boardingFee } = calculateBoardingFee(billingPeriod, [allocation(n)]);
      const issued = status !== 'DRAFT';
      return {
        id: invoice(key),
        horseId: horse(n),
        ownerId: user(horses[n - 1][6]),
        billingPeriod,
        boardingDays,
        boardingMonthlyRate: BOARDING_MONTHLY_RATE,
        boardingFee,
        trainingFee,
        medicalFee,
        netAmount: boardingFee.plus(trainingFee).plus(medicalFee),
        status,
        dueAt: issued ? clubDateTime(issue + 7, 8) : null,
        createdAt: issued ? clubDateTime(issue, 8) : now,
        updatedAt:
          status === 'PAID'
            ? clubDateTime(-16, 10)
            : status === 'OVERDUE'
              ? clubDateTime(-3, 9)
              : issued
                ? clubDateTime(issue, 8)
                : now,
      };
    }),
  });
}

async function seedActivityAndSupport(tx: Prisma.TransactionClient) {
  // Nonfunctional auth history: expired/revoked fixtures linked to a locked account only.
  await tx.googleIdentity.create({ data: { subject: googleSubject, userId: user('expired') } });
  await tx.otpCode.create({
    data: {
      id: permissionId,
      email: expiredEmail,
      purpose: 'RESET',
      codeHash: hash('expired-seed-otp'),
      sentAt: clubDateTime(-2, 8),
      expiresAt: clubDateTime(-2, 8, 5),
      resendAt: clubDateTime(-2, 8, 1),
      attempts: 2,
    },
  });
  await tx.loginAttempt.create({
    data: {
      email: expiredEmail,
      fails: 5,
      windowStart: clubDateTime(-2, 8),
      lockedUntil: clubDateTime(-2, 8, 30),
    },
  });
  await tx.resetToken.create({
    data: { tokenHash: resetHash, email: expiredEmail, expiresAt: clubDateTime(-2, 9) },
  });
  await tx.refreshToken.create({
    data: {
      id: id('revoked-refresh'),
      tokenHash: hash('equiflow-expired-refresh-fixture'),
      userId: user('expired'),
      revoked: true,
      rotatedAt: clubDateTime(-2, 8),
      expiresAt: clubDateTime(-1, 8),
      createdAt: clubDateTime(-3, 8),
    },
  });
  await tx.permissionRequest.create({
    data: {
      id: permissionId,
      userId: user('groom'),
      at: clubDateTime(-1, 9),
      screen: 'Audit Log',
      reference: `403-${clubDay(-1).slice(2, 7).replace('-', '')}-0001`,
      status: 'OPEN',
    },
  });

  const notices = [
    [
      'trainer',
      'TRAINING',
      'WORKOUT_SCHEDULED',
      'Buổi chạy thử sáng nay',
      'Bạch Long Mã tập sân cỏ lúc 08:00.',
      '/training/calendar',
      0,
    ],
    [
      'trainer2',
      'LOCK',
      'MEDICAL_LOCK_CREATED',
      'Khóa y tế đang áp dụng',
      'Xích Thố không được tập nặng hoặc tham gia giải.',
      '/locks',
      -2,
    ],
    [
      'vet',
      'MEDICAL',
      'PREVENTIVE_OVERDUE',
      'Đã quá hạn tẩy giun',
      'Hắc Báo cần tẩy giun và ghi kết quả chăm sóc.',
      '/medical/preventive',
      -1,
    ],
    [
      'groom',
      'SYSTEM',
      'LOW_STOCK',
      'Cỏ Timothy dưới ngưỡng',
      'Barn 1 còn 18 kg, dưới mức tối thiểu 30 kg.',
      '/supplies/inventory',
      -1,
    ],
    [
      'manager',
      'SYSTEM',
      'INCIDENT_REPORTED',
      'Có sự cố chuồng trại mới',
      'Cửa chuồng STALL-B04 bị kẹt chốt.',
      '/incidents',
      0,
    ],
    [
      'owner',
      'ACCOUNT',
      'INVOICE_SENT',
      'Hóa đơn lưu chuồng cần thanh toán',
      'Hắc Báo còn công nợ lưu chuồng.',
      `/owner/financial-reports?highlight=${invoice('overdue')}`,
      -10,
    ],
  ] as const;
  await tx.notification.createMany({
    data: notices.map(([recipient, category, type, title, message, link, day]) => ({
      id: id(`notification/${recipient}/${type}`),
      userId: user(recipient),
      category,
      type,
      title,
      message,
      link,
      dedupeKey: `seed-lifecycle:${recipient}:${type}`,
      createdAt: day === 0 ? now : clubDateTime(day, 8),
    })),
  });
  const events = [
    [
      'vet',
      'MEDICAL_LOCK_CREATED',
      'MedicalLock',
      id('lock/xich'),
      -2,
      9,
      { horseCode: 'HR-000002', reason: injuryReason },
    ],
    [
      'vet',
      'MEDICAL_LOCK_RELEASED',
      'MedicalLock',
      id('lock/bach'),
      -30,
      9,
      { horseCode: 'HR-000001' },
    ],
    [
      'manager',
      'INVOICE_STATUS_CHANGED',
      'FinancialInvoice',
      invoice('overdue'),
      -10,
      8,
      { status: 'SENT' },
    ],
    [
      'manager',
      'INVOICE_STATUS_CHANGED',
      'FinancialInvoice',
      invoice('sent'),
      -2,
      8,
      { status: 'SENT' },
    ],
    [
      'owner',
      'INVOICE_PAID',
      'FinancialInvoice',
      invoice('paid'),
      -16,
      10,
      { status: 'PAID', method: 'BANK_TRANSFER' },
    ],
    [
      'trainer',
      'WORKOUT_COMPLETED',
      'WorkoutSession',
      workout('history/bach-base/-60'),
      -60,
      8,
      { averageSpeedKmh: 58, heartRatePeak: 148 },
    ],
    [
      'groom2',
      'INCIDENT_REPORTED',
      'IncidentReport',
      id('incident/latch'),
      0,
      0,
      { status: 'REPORTED' },
    ],
  ] as const;
  await tx.auditLog.createMany({
    data: events.map(([actor, action, entityName, entityId, day, hour, details], i) => ({
      id: id(`audit/${i}`),
      userId: user(actor),
      action,
      entityName,
      entityId,
      newValuesJson: JSON.stringify(details),
      timestamp: day === 0 ? now : clubDateTime(day, hour),
    })),
  });
  await tx.aIInsight.createMany({
    data: (
      [
        [
          1,
          'WORKOUT_RECOMMENDATION',
          5.8,
          0.15,
          'GENERATED',
          'Duy trì tốc độ mục tiêu 62 km/h và theo dõi nhịp tim hồi phục.',
        ],
        [
          2,
          'INJURY_RISK_WARNING',
          0,
          0.85,
          'ACKNOWLEDGED',
          'Tạm dừng bài tập nặng cho đến khi bác sĩ thú y gỡ khóa.',
        ],
        [
          9,
          'RECOVERY_ADVICE',
          2.1,
          0.28,
          'APPLIED',
          'Bơi phục hồi 20 phút, đánh giá bước đi sau tập.',
        ],
      ] as const
    ).map(([n, insightType, trainingLoadIndex, riskScore, status, suggestion]) => ({
      id: id(`insight/${n}`),
      horseId: horse(n),
      insightType,
      trainingLoadIndex,
      riskScore,
      status,
      recommendationsJson: JSON.stringify([suggestion]),
      ...stamp(-1),
    })),
  });
  await tx.simulatorSession.create({
    data: {
      id: id('sim/workout/bach'),
      type: 'WORKOUT',
      status: 'COMPLETED',
      horseIds: [horse(1)],
      actorUserId: user('trainer'),
      workoutSessionId: workout('history/bach-base/-60'),
      startedAt: clubDateTime(-60, 7, 15),
      finishedAt: clubDateTime(-60, 7, 17),
      result: {
        horseId: horse(1),
        distanceMeters: 1200,
        averageSpeedKmh: 58,
        heartRatePeak: 148,
        finished: true,
      },
      createdAt: clubDateTime(-60, 7, 15),
      updatedAt: clubDateTime(-60, 7, 17),
    },
  });
}

async function main() {
  const datasourceUrl = demoDatabase(); // kiểm "chỉ localhost" TRƯỚC khi xóa bất cứ thứ gì
  // DEMO: xóa sạch rồi dựng lại bảng theo schema.prisma để bộ dữ liệu demo luôn sạch.
  execSync('npx prisma db push --force-reset --skip-generate', { stdio: 'inherit' });
  const prisma = new PrismaClient({ datasourceUrl });
  try {
    const password = await bcrypt.hash('EquiFlow@2026', 10);
    await prisma.$transaction(
      async (tx) => {
        await clearFixtures(tx);
        await seedClub(tx, password);
        await seedTraining(tx);
        await seedMedical(tx);
        await seedStableCare(tx);
        await seedRacingAndInvoices(tx);
        await seedActivityAndSupport(tx);
      },
      { isolationLevel: 'Serializable', timeout: 60000 },
    );
    console.log(`EquiFlow demo data ready for ${clubDay(0)} (UTC+7). Password: EquiFlow@2026`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    console.error(
      'Seed keys collide with existing records. Run "npm run db:seed:demo" (it resets the local database first); no changes were committed.',
    );
  } else {
    console.error(error instanceof Error ? error.message : 'Demo seed failed.');
  }
  process.exitCode = 1;
});
