import {
  BodySide,
  DailyTaskType,
  HorseCatalogType,
  HorseStatus,
  IncidentStatus,
  InjuryStatus,
  InvoiceStatus,
  MedicalRecordStatus,
  NotificationCategory,
  NutritionPlanStatus,
  OtpPurpose,
  PermissionRequestStatus,
  PlanStatus,
  PreventiveStatus,
  PreventiveType,
  Prisma,
  PrismaClient,
  RegistrationStatus,
  RestockStatus,
  RetireReason,
  Role,
  SeverityLevel,
  ShiftType,
  SimulatorSessionStatus,
  SimulatorSessionType,
  StallStatus,
  SupplyCategory,
  SupplyUnit,
  TournamentStatus,
  TrackSurface,
  UserStatus,
  WorkoutStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { yymm } from '../src/common/utils/input';
import { planDailyTasks, ScheduleHorse } from '../src/daily-tasks/daily-schedule';
import { BOARDING_MONTHLY_RATE, calculateBoardingFee } from '../src/financial/boarding-fee';
import { clubDate } from '../src/training/training-rules';

type Tx = Prisma.TransactionClient;

const RESET_FLAG = process.argv.includes('--reset');

function resolveDatabaseUrl(): string {
  if (!process.env.DIRECT_URL && !process.env.DATABASE_URL && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  // Prefer DIRECT_URL (Session pooler 5432 on Supabase/Render) for interactive seed transactions.
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DIRECT_URL or DATABASE_URL must be configured. Check .env or environment.');
  }
  return url;
}

/** Deterministic RFC-4122 UUID derived from a readable seed tag. */
function id(tag: string): string {
  const h = createHash('sha256').update(`equiflow-canonical:${tag}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

const now = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;
const days = (offsetDays: number, hour = 0, minute = 0): Date => {
  const base = clubDate(new Date(now.getTime() + offsetDays * DAY_MS));
  const localHour = String(hour).padStart(2, '0');
  const localMin = String(minute).padStart(2, '0');
  return new Date(`${base}T${localHour}:${localMin}:00+07:00`);
};
const dateStrOffset = (offsetDays: number) =>
  clubDate(new Date(now.getTime() + offsetDays * DAY_MS));
const monthOf = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const pastIso = (offsetDays: number) => dateStrOffset(offsetDays);

const horseIds = Array.from({ length: 19 }, (_, idx) => id(`horse:${idx + 1}`));
const stallIds = {
  A: Array.from({ length: 12 }, (_, i) => id(`stall:A${String(i + 1).padStart(2, '0')}`)),
  B: Array.from({ length: 12 }, (_, i) => id(`stall:B${String(i + 1).padStart(2, '0')}`)),
  C: Array.from({ length: 4 }, (_, i) => id(`stall:C${String(i + 1).padStart(2, '0')}`)),
  H: Array.from({ length: 4 }, (_, i) => id(`stall:H${String(i + 1).padStart(2, '0')}`)),
};
const zoneIds = {
  A: id('zone:A'),
  B: id('zone:B'),
  C: id('zone:C'),
  H: id('zone:H'),
};

const userIds = {
  manager: id('user:manager'),
  manager2: id('user:manager2'),
  trainer: id('user:trainer'),
  trainer2: id('user:trainer2'),
  trainer3: id('user:trainer3'),
  trainer4: id('user:trainer4'),
  vet: id('user:vet'),
  vet2: id('user:vet2'),
  vet3: id('user:vet3'),
  vet4: id('user:vet4'),
  grooms: Array.from({ length: 10 }, (_, i) => id(`user:groom${i === 0 ? '' : i + 1}`)),
  owners: Array.from({ length: 6 }, (_, i) => id(`user:owner${i === 0 ? '' : i + 1}`)),
  pendingEmail: id('user:pending-email'),
  pendingApproval: id('user:pending-approval'),
  invited: id('user:invited-vet'),
  inactive: id('user:inactive-groom'),
  rejected: id('user:rejected-trainer'),
  locked: id('user:locked-owner'),
};

const shiftIds = {
  MORNING: id('shift:MORNING'),
  AFTERNOON: id('shift:AFTERNOON'),
  NIGHT: id('shift:NIGHT'),
};

const supplyIds = {
  timothyHay: id('supply:timothy-hay'),
  oatGrain: id('supply:oat-grain'),
  electrolyte: id('supply:electrolyte'),
  antiInflam: id('supply:anti-inflam'),
};

const preventiveTypeIds = {
  VACCINATION: id('prev-type:VACCINATION'),
  DEWORMING: id('prev-type:DEWORMING'),
  FARRIER_HOOF_CARE: id('prev-type:FARRIER_HOOF_CARE'),
  DENTAL: id('prev-type:DENTAL'),
};

async function clearFixtures(tx: Tx) {
  await tx.auditLog.deleteMany();
  await tx.notification.deleteMany();
  await tx.financialInvoice.deleteMany();
  await tx.tournamentResult.deleteMany();
  await tx.tournamentRegistration.deleteMany();
  await tx.tournament.deleteMany();
  await tx.simulatorSession.deleteMany();
  await tx.workoutSession.deleteMany();
  await tx.trainingPlan.deleteMany();
  await tx.incidentReport.deleteMany();
  await tx.dailyCareTask.deleteMany();
  await tx.dailyGroomingLog.deleteMany();
  await tx.shiftRoster.deleteMany();
  await tx.restockRequest.deleteMany();
  await tx.stockBalance.deleteMany();
  await tx.nutritionPlan.deleteMany();
  await tx.supplyCatalog.deleteMany();
  await tx.shiftCatalog.deleteMany();
  await tx.medicalLock.deleteMany();
  await tx.injuryLog.deleteMany();
  await tx.medicalRecord.deleteMany();
  await tx.preventiveSchedule.deleteMany();
  await tx.preventiveTypeCatalog.deleteMany();
  await tx.stallAllocation.deleteMany();
  await tx.stall.deleteMany();
  await tx.stallZone.deleteMany();
  await tx.horse.deleteMany();
  await tx.horseCatalogItem.deleteMany();
  await tx.permissionRequest.deleteMany();
  await tx.refreshToken.deleteMany();
  await tx.resetToken.deleteMany();
  await tx.loginAttempt.deleteMany();
  await tx.otpCode.deleteMany();
  await tx.googleIdentity.deleteMany();
  await tx.counter.deleteMany();
  await tx.user.deleteMany();
}

interface HorseSpec {
  id: string;
  horseCode: string;
  name: string;
  microchip: string;
  breed: string;
  dob: Date;
  gender: 'Stallion' | 'Mare' | 'Gelding';
  color: string;
  weightKg: number;
  status: HorseStatus;
  ownerId: string;
  stallId: string | null;
  groomId?: string;
  isMedicalLocked?: boolean;
  isDebtImpounded?: boolean;
  debtImpoundReason?: string;
  retireReason?: RetireReason;
}

const HORSES: HorseSpec[] = [
  {
    id: horseIds[0],
    horseCode: 'HR-000001',
    name: 'Bạch Long Mã',
    microchip: '985000000000001',
    breed: 'Thoroughbred',
    dob: new Date('2021-03-14T00:00:00Z'),
    gender: 'Stallion',
    color: 'Bay',
    weightKg: 495,
    status: HorseStatus.ACTIVE,
    ownerId: userIds.owners[0],
    stallId: stallIds.A[0],
    groomId: userIds.grooms[0],
  },
  {
    id: horseIds[1],
    horseCode: 'HR-000002',
    name: 'Xích Thố',
    microchip: '985000000000002',
    breed: 'Thoroughbred',
    dob: new Date('2021-05-20T00:00:00Z'),
    gender: 'Stallion',
    color: 'Chestnut',
    weightKg: 502,
    status: HorseStatus.UNDER_OBSERVATION,
    ownerId: userIds.owners[0],
    stallId: stallIds.A[1],
    groomId: userIds.grooms[3],
    isMedicalLocked: true,
  },
  {
    id: horseIds[2],
    horseCode: 'HR-000003',
    name: 'Kim Long',
    microchip: '985000000000003',
    breed: 'Warmblood',
    dob: new Date('2022-02-10T00:00:00Z'),
    gender: 'Stallion',
    color: 'Palomino',
    weightKg: 510,
    status: HorseStatus.IN_TRAINING,
    ownerId: userIds.owners[0],
    stallId: stallIds.A[2],
    groomId: userIds.grooms[0],
  },
  {
    id: horseIds[3],
    horseCode: 'HR-000004',
    name: 'Vân Tiêu',
    microchip: '985000000000004',
    breed: 'Arabian Cross',
    dob: new Date('2022-07-08T00:00:00Z'),
    gender: 'Mare',
    color: 'Grey',
    weightKg: 448,
    status: HorseStatus.ACTIVE,
    ownerId: userIds.owners[0],
    stallId: stallIds.A[3],
    groomId: userIds.grooms[3],
  },
  {
    id: horseIds[4],
    horseCode: 'HR-000005',
    name: 'Thần Phong',
    microchip: '985000000000005',
    breed: 'Arabian',
    dob: new Date('2021-11-01T00:00:00Z'),
    gender: 'Stallion',
    color: 'Bay Dark',
    weightKg: 460,
    status: HorseStatus.ACTIVE,
    ownerId: userIds.owners[1],
    stallId: stallIds.A[4],
    groomId: userIds.grooms[4],
  },
  {
    id: horseIds[5],
    horseCode: 'HR-000006',
    name: 'Hắc Báo',
    microchip: '985000000000006',
    breed: 'Standardbred',
    dob: new Date('2020-09-18T00:00:00Z'),
    gender: 'Gelding',
    color: 'Black',
    weightKg: 490,
    status: HorseStatus.ACTIVE,
    ownerId: userIds.owners[2],
    stallId: stallIds.A[5],
    groomId: userIds.grooms[0],
  },
  {
    id: horseIds[6],
    horseCode: 'HR-000007',
    name: 'Hồng Kỳ',
    microchip: '985000000000007',
    breed: 'Quarter Horse',
    dob: new Date('2021-08-22T00:00:00Z'),
    gender: 'Mare',
    color: 'Chestnut',
    weightKg: 478,
    status: HorseStatus.IN_TRAINING,
    ownerId: userIds.owners[2],
    stallId: stallIds.A[6],
    groomId: userIds.grooms[4],
  },
  {
    id: horseIds[7],
    horseCode: 'HR-000008',
    name: 'Phi Vũ',
    microchip: '985000000000008',
    breed: 'Appaloosa',
    dob: new Date('2022-04-19T00:00:00Z'),
    gender: 'Mare',
    color: 'Roan',
    weightKg: 456,
    status: HorseStatus.IN_TRAINING,
    ownerId: userIds.owners[1],
    stallId: stallIds.B[0],
    groomId: userIds.grooms[1],
  },
  {
    id: horseIds[8],
    horseCode: 'HR-000009',
    name: 'Tử Điện',
    microchip: '985000000000009',
    breed: 'Paint',
    dob: new Date('2022-09-05T00:00:00Z'),
    gender: 'Stallion',
    color: 'Bay',
    weightKg: 486,
    status: HorseStatus.IN_TRAINING,
    ownerId: userIds.owners[4],
    stallId: stallIds.B[1],
    groomId: userIds.grooms[5],
  },
  {
    id: horseIds[9],
    horseCode: 'HR-000010',
    name: 'Thanh Loan',
    microchip: '985000000000010',
    breed: 'Arabian Cross',
    dob: new Date('2021-06-30T00:00:00Z'),
    gender: 'Mare',
    color: 'Gray Roaming',
    weightKg: 452,
    status: HorseStatus.ACTIVE,
    ownerId: userIds.owners[3],
    stallId: stallIds.B[2],
    groomId: userIds.grooms[1],
  },
  {
    id: horseIds[10],
    horseCode: 'HR-000011',
    name: 'Ngàn Hoa',
    microchip: '985000000000011',
    breed: 'Paint',
    dob: new Date('2023-01-17T00:00:00Z'),
    gender: 'Mare',
    color: 'Palomino',
    weightKg: 440,
    status: HorseStatus.IN_TRAINING,
    ownerId: userIds.owners[3],
    stallId: stallIds.B[3],
    groomId: userIds.grooms[5],
  },
  {
    id: horseIds[11],
    horseCode: 'HR-000012',
    name: 'Thiên Mã',
    microchip: '985000000000012',
    breed: 'Warmblood',
    dob: new Date('2020-12-12T00:00:00Z'),
    gender: 'Gelding',
    color: 'Bay Dark',
    weightKg: 518,
    status: HorseStatus.ACTIVE,
    ownerId: userIds.owners[4],
    stallId: stallIds.B[4],
    groomId: userIds.grooms[6],
  },
  {
    id: horseIds[12],
    horseCode: 'HR-000013',
    name: 'Hỏa Phụng',
    microchip: '985000000000013',
    breed: 'Thoroughbred',
    dob: new Date('2022-05-11T00:00:00Z'),
    gender: 'Mare',
    color: 'Chestnut',
    weightKg: 465,
    status: HorseStatus.UNDER_OBSERVATION,
    ownerId: userIds.owners[5],
    stallId: stallIds.B[5],
    groomId: userIds.grooms[6],
  },
  {
    id: horseIds[13],
    horseCode: 'HR-000014',
    name: 'Phong Lôi',
    microchip: '985000000000014',
    breed: 'Quarter Horse',
    dob: new Date('2021-01-25T00:00:00Z'),
    gender: 'Gelding',
    color: 'Black',
    weightKg: 498,
    status: HorseStatus.RESTING,
    ownerId: userIds.owners[5],
    stallId: stallIds.B[6],
    groomId: userIds.grooms[9],
  },
  {
    id: horseIds[14],
    horseCode: 'HR-000015',
    name: 'Tuyết Ảnh',
    microchip: '985000000000015',
    breed: 'Arabian',
    dob: new Date('2021-10-03T00:00:00Z'),
    gender: 'Mare',
    color: 'Grey',
    weightKg: 445,
    status: HorseStatus.ISOLATED,
    ownerId: userIds.owners[1],
    stallId: stallIds.C[0],
    groomId: userIds.grooms[2],
    isMedicalLocked: true,
  },
  {
    id: horseIds[15],
    horseCode: 'HR-000016',
    name: 'Lôi Chấn',
    microchip: '985000000000016',
    breed: 'Standardbred',
    dob: new Date('2020-08-14T00:00:00Z'),
    gender: 'Stallion',
    color: 'Roan',
    weightKg: 505,
    status: HorseStatus.INJURED,
    ownerId: userIds.owners[1],
    stallId: stallIds.C[1],
    groomId: userIds.grooms[7],
    isMedicalLocked: true,
  },
  {
    id: horseIds[16],
    horseCode: 'HR-000017',
    name: 'Dạ Nguyệt',
    microchip: '985000000000017',
    breed: 'Appaloosa',
    dob: new Date('2021-04-09T00:00:00Z'),
    gender: 'Mare',
    color: 'Black',
    weightKg: 458,
    status: HorseStatus.RESTING,
    ownerId: userIds.owners[3],
    stallId: stallIds.H[0],
    groomId: userIds.grooms[8],
    isDebtImpounded: true,
    debtImpoundReason: 'Quá hạn thanh toán chi phí lưu chuồng & điều trị T8-T10/2026',
  },
  {
    id: horseIds[17],
    horseCode: 'HR-000018',
    name: 'Lão Tướng',
    microchip: '985000000000018',
    breed: 'Thoroughbred',
    dob: new Date('2016-05-02T00:00:00Z'),
    gender: 'Gelding',
    color: 'Bay Dark',
    weightKg: 492,
    status: HorseStatus.RETIRED,
    ownerId: userIds.owners[1],
    stallId: null,
    retireReason: RetireReason.RETIRED,
  },
  {
    id: horseIds[18],
    horseCode: 'HR-000019',
    name: 'Huyền Vũ',
    microchip: '985000000000019',
    breed: 'Warmblood',
    dob: new Date('2017-03-19T00:00:00Z'),
    gender: 'Stallion',
    color: 'Black',
    weightKg: 515,
    status: HorseStatus.RETIRED,
    ownerId: userIds.owners[2],
    stallId: null,
    retireReason: RetireReason.TRANSFERRED,
  },
];

async function seedClub(tx: Tx, passwordHash: string) {
  const createdBase = days(-150);

  const users: Prisma.UserCreateManyInput[] = [
    // 2 Managers
    {
      id: userIds.manager,
      email: 'manager@gmail.com',
      passwordHash,
      fullName: 'Trần Quang Minh',
      phoneNumber: '0901000001',
      role: Role.CLUB_MANAGER,
      status: UserStatus.ACTIVE,
      createdAt: createdBase,
      lastActive: days(-1, 9),
    },
    {
      id: userIds.manager2,
      email: 'manager2@gmail.com',
      passwordHash,
      fullName: 'Nguyễn Hải Đăng',
      phoneNumber: '0901000002',
      role: Role.CLUB_MANAGER,
      status: UserStatus.ACTIVE,
      createdAt: createdBase,
      lastActive: days(-2, 16),
    },
    // 4 Head Trainers
    {
      id: userIds.trainer,
      email: 'trainer@gmail.com',
      passwordHash,
      fullName: 'Nguyễn Văn Tuấn',
      phoneNumber: '0902000001',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
      createdAt: createdBase,
      lastActive: days(0, 7),
    },
    {
      id: userIds.trainer2,
      email: 'trainer2@gmail.com',
      passwordHash,
      fullName: 'Lê Hoàng Nam',
      phoneNumber: '0902000002',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
      createdAt: createdBase,
      lastActive: days(0, 8),
    },
    {
      id: userIds.trainer3,
      email: 'trainer3@gmail.com',
      passwordHash,
      fullName: 'Phạm Quốc Trung',
      phoneNumber: '0902000003',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
      createdAt: days(-120),
      lastActive: days(-1, 17),
    },
    {
      id: userIds.trainer4,
      email: 'trainer4@gmail.com',
      passwordHash,
      fullName: 'Vũ Thành Long',
      phoneNumber: '0902000004',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
      createdAt: days(-90),
      lastActive: days(-1, 15),
    },
    // 4 Veterinarians (> 2)
    {
      id: userIds.vet,
      email: 'vet@gmail.com',
      passwordHash,
      fullName: 'BS. Phạm Minh Trí',
      phoneNumber: '0903000001',
      role: Role.VETERINARIAN,
      status: UserStatus.ACTIVE,
      createdAt: createdBase,
      lastActive: days(0, 9),
    },
    {
      id: userIds.vet2,
      email: 'vet2@gmail.com',
      passwordHash,
      fullName: 'BS. Nguyễn Thảo Vy',
      phoneNumber: '0903000002',
      role: Role.VETERINARIAN,
      status: UserStatus.ACTIVE,
      createdAt: createdBase,
      lastActive: days(-1, 11),
    },
    {
      id: userIds.vet3,
      email: 'vet3@gmail.com',
      passwordHash,
      fullName: 'BS. Trần Đình Khôi',
      phoneNumber: '0903000003',
      role: Role.VETERINARIAN,
      status: UserStatus.ACTIVE,
      createdAt: days(-110),
      lastActive: days(0, 8),
    },
    {
      id: userIds.vet4,
      email: 'vet4@gmail.com',
      passwordHash,
      fullName: 'BS. Lê Phương Anh',
      phoneNumber: '0903000004',
      role: Role.VETERINARIAN,
      status: UserStatus.ACTIVE,
      createdAt: days(-95),
      lastActive: days(-1, 14),
    },
    // 10 Active Grooms
    ...[
      'Lê Văn Bình',
      'Hoàng Văn Phúc',
      'Đỗ Thị Mai',
      'Nguyễn Hữu Tài',
      'Trần Minh Khoa',
      'Võ Ngọc Hân',
      'Bùi Quang Huy',
      'Lý Thanh Tâm',
      'Đinh Công Thành',
      'Phan Thị Thu Hà',
    ].map((fullName, idx) => ({
      id: userIds.grooms[idx],
      email: `groom${idx === 0 ? '' : idx + 1}@gmail.com`,
      passwordHash,
      fullName,
      phoneNumber: `09040000${String(idx + 1).padStart(2, '0')}`,
      role: Role.GROOM,
      status: UserStatus.ACTIVE,
      createdAt: createdBase,
      lastActive: days(0, 6 + (idx % 4)),
    })),
    // 6 Horse Owners
    ...[
      { fullName: 'Phạm Gia Bảo', debt: false },
      { fullName: 'Đặng Hoàng Yến', debt: false },
      { fullName: 'Vũ Quốc Hưng', debt: false },
      {
        fullName: 'Trịnh Bích Ngọc',
        debt: true,
        debtReason: 'Có hóa đơn quá hạn liên tục từ T8–T10/2026',
      },
      { fullName: 'Lương Minh Đức', debt: false },
      { fullName: 'Tống Khánh Linh', debt: false },
    ].map((o, idx) => ({
      id: userIds.owners[idx],
      email: `owner${idx === 0 ? '' : idx + 1}@gmail.com`,
      passwordHash,
      fullName: o.fullName,
      phoneNumber: `09050000${String(idx + 1).padStart(2, '0')}`,
      role: Role.HORSE_OWNER,
      status: UserStatus.ACTIVE,
      createdAt: createdBase,
      lastActive: days(-idx, 10),
      isBadDebtFlagged: o.debt,
      badDebtFlaggedAt: o.debt ? days(-20) : null,
      badDebtReason: o.debtReason ?? null,
    })),
    // Lifecycle coverage across all remaining 6 UserStatus values
    {
      id: userIds.pendingEmail,
      email: 'applicant.email@gmail.com',
      passwordHash,
      fullName: 'Ngô Minh Châu',
      phoneNumber: '0906000001',
      role: Role.HORSE_OWNER,
      status: UserStatus.PENDING_EMAIL,
      requestedAt: days(-2),
      requestCode: `REQ-${yymm()}-001`,
      createdAt: days(-2),
    },
    {
      id: userIds.pendingApproval,
      email: 'applicant.approval@gmail.com',
      passwordHash,
      fullName: 'Trương Quốc Khánh',
      phoneNumber: '0906000002',
      role: Role.GROOM,
      status: UserStatus.PENDING_APPROVAL,
      requestedAt: days(-1),
      requestCode: `REQ-${yymm()}-002`,
      createdAt: days(-1),
    },
    {
      id: userIds.invited,
      email: 'invited.vet@gmail.com',
      fullName: 'BS. Đặng Hải Lâm',
      phoneNumber: '0906000003',
      role: Role.VETERINARIAN,
      status: UserStatus.INVITED,
      invitedBy: userIds.manager,
      requestCode: `REQ-${yymm()}-003`,
      createdAt: days(-3),
    },
    {
      id: userIds.inactive,
      email: 'inactive.groom@gmail.com',
      passwordHash,
      fullName: 'Huỳnh Tấn Phát',
      phoneNumber: '0906000004',
      role: Role.GROOM,
      status: UserStatus.INACTIVE,
      statusReason: 'Nghỉ phép dài hạn theo đơn cá nhân',
      statusChangedAt: days(-30),
      statusChangedBy: userIds.manager,
      createdAt: createdBase,
    },
    {
      id: userIds.rejected,
      email: 'rejected.trainer@gmail.com',
      passwordHash,
      fullName: 'Dương Quang Vinh',
      phoneNumber: '0906000005',
      role: Role.HEAD_TRAINER,
      status: UserStatus.REJECTED,
      requestedAt: days(-14),
      requestCode: `REQ-${yymm()}-004`,
      statusReason: 'Hồ sơ chưa bổ sung chứng chỉ huấn luyện cấp quốc gia',
      statusChangedAt: days(-12),
      statusChangedBy: userIds.manager,
      createdAt: days(-14),
    },
    {
      id: userIds.locked,
      email: 'equiflow-expired-fixture@gmail.com',
      passwordHash,
      fullName: 'Tài khoản bị khóa kiểm thử',
      phoneNumber: '0906000006',
      role: Role.HORSE_OWNER,
      status: UserStatus.LOCKED,
      lockedAt: days(-5),
      statusReason: 'Đăng nhập sai mật khẩu quá 5 lần liên tiếp',
      statusChangedAt: days(-5),
      statusChangedBy: userIds.manager,
      createdAt: days(-60),
    },
  ];
  await tx.user.createMany({ data: users, skipDuplicates: true });

  // Reconcile IDs if the database already contains rows from an earlier seed or live users
  const dbUsers = await tx.user.findMany({
    where: { email: { in: users.map((u) => u.email) } },
    select: { id: true, email: true },
  });
  const byEmail = new Map(dbUsers.map((u) => [u.email, u.id]));
  const remapped = new Map<string, string>();
  for (const u of users) {
    const actualId = byEmail.get(u.email);
    if (actualId && u.id && actualId !== u.id) {
      remapped.set(u.id, actualId);
    }
  }
  if (remapped.size > 0) {
    const r = (cid: string) => remapped.get(cid) ?? cid;
    userIds.manager = r(userIds.manager);
    userIds.manager2 = r(userIds.manager2);
    userIds.trainer = r(userIds.trainer);
    userIds.trainer2 = r(userIds.trainer2);
    userIds.trainer3 = r(userIds.trainer3);
    userIds.trainer4 = r(userIds.trainer4);
    userIds.vet = r(userIds.vet);
    userIds.vet2 = r(userIds.vet2);
    userIds.vet3 = r(userIds.vet3);
    userIds.vet4 = r(userIds.vet4);
    userIds.grooms = userIds.grooms.map(r);
    userIds.owners = userIds.owners.map(r);
    for (const h of HORSES) {
      h.ownerId = r(h.ownerId);
      if (h.groomId) h.groomId = r(h.groomId);
    }
  }

  await tx.googleIdentity.createMany({
    data: [
      { subject: 'google-sub-owner-1001', userId: userIds.owners[0] },
      { subject: 'google-sub-trainer-2002', userId: userIds.trainer2 },
    ],
    skipDuplicates: true,
  });

  await tx.otpCode.createMany({
    data: [
      {
        email: 'applicant.email@gmail.com',
        purpose: OtpPurpose.SIGNUP,
        codeHash: sha256Hex('654321'),
        sentAt: days(-2),
        expiresAt: days(1),
        resendAt: days(-2, 1),
        attempts: 1,
      },
      {
        email: 'owner2@gmail.com',
        purpose: OtpPurpose.RESET,
        codeHash: sha256Hex('246810'),
        sentAt: days(-3),
        expiresAt: days(-2),
        resendAt: days(-3, 1),
        attempts: 0,
      },
      {
        email: 'invited.vet@gmail.com',
        purpose: OtpPurpose.INVITE,
        codeHash: sha256Hex('112233'),
        sentAt: days(-3),
        expiresAt: days(4),
        resendAt: days(-3, 1),
        attempts: 0,
      },
    ],
    skipDuplicates: true,
  });

  await tx.loginAttempt.createMany({
    data: [
      {
        email: 'equiflow-expired-fixture@gmail.com',
        fails: 5,
        lockedUntil: days(1),
        windowStart: days(-5),
      },
      {
        email: 'owner@gmail.com',
        fails: 0,
        lockedUntil: null,
        windowStart: days(-1),
      },
    ],
    skipDuplicates: true,
  });

  await tx.resetToken.createMany({
    data: [
      {
        tokenHash: sha256Hex('canonical-reset-active-token'),
        email: 'owner2@gmail.com',
        expiresAt: days(2),
      },
      {
        tokenHash: sha256Hex('canonical-reset-expired-token'),
        email: 'equiflow-expired-fixture@gmail.com',
        expiresAt: days(-4),
      },
    ],
    skipDuplicates: true,
  });

  await tx.refreshToken.createMany({
    data: [
      {
        id: id('refresh:owner1'),
        tokenHash: sha256Hex('canonical-refresh-owner1'),
        userId: userIds.owners[0],
        revoked: false,
        expiresAt: days(7),
        createdAt: days(-1),
      },
      {
        id: id('refresh:trainer1-revoked'),
        tokenHash: sha256Hex('canonical-refresh-trainer1-revoked'),
        userId: userIds.trainer,
        revoked: true,
        rotatedAt: days(-2),
        expiresAt: days(5),
        createdAt: days(-8),
      },
    ],
    skipDuplicates: true,
  });

  const permRequests = [
    {
      at: days(-1),
      userId: userIds.grooms[0],
      screen: 'financial-invoices',
      reference: `403-${yymm()}-0001`,
      status: PermissionRequestStatus.OPEN,
    },
    {
      at: days(-6),
      userId: userIds.trainer3,
      screen: 'medical-lock-override',
      reference: `403-${yymm()}-0002`,
      status: PermissionRequestStatus.GRANTED,
      resolvedAt: days(-5),
      resolvedBy: userIds.manager,
    },
    {
      at: days(-12),
      userId: userIds.grooms[4],
      screen: 'user-management',
      reference: `403-${yymm()}-0003`,
      status: PermissionRequestStatus.DISMISSED,
      resolvedAt: days(-11),
      resolvedBy: userIds.manager2,
    },
  ];
  for (const req of permRequests) {
    const exists = await tx.permissionRequest.findFirst({ where: { reference: req.reference } });
    if (!exists) {
      await tx.permissionRequest.create({ data: req });
    }
  }

  // Horse Catalog: 8 active breeds (+ 1 inactive breed) + 8 colors
  const breeds: Array<[string, string, boolean]> = [
    ['THOROUGHBRED', 'Thoroughbred', true],
    ['ARABIAN', 'Arabian', true],
    ['ARABIAN_CROSS', 'Arabian Cross', true],
    ['QUARTER_HORSE', 'Quarter Horse', true],
    ['WARMBLOOD', 'Warmblood', true],
    ['STANDARDBRED', 'Standardbred', true],
    ['APPALOOSA', 'Appaloosa', true],
    ['PAINT', 'Paint', true],
    ['MORGAN', 'Morgan', false],
  ];
  const colors: Array<[string, string]> = [
    ['BAY', 'Bay'],
    ['BAY_DARK', 'Bay Dark'],
    ['CHESTNUT', 'Chestnut'],
    ['BLACK', 'Black'],
    ['GREY', 'Grey'],
    ['GRAY_ROAMING', 'Gray Roaming'],
    ['ROAN', 'Roan'],
    ['PALOMINO', 'Palomino'],
  ];
  await tx.horseCatalogItem.createMany({
    data: [
      ...breeds.map(([code, name, isActive], idx) => ({
        id: id(`catalog:BREED:${code}`),
        type: HorseCatalogType.BREED,
        code,
        name,
        description: `Giống ngựa ${name}`,
        sortOrder: idx + 1,
        isActive,
      })),
      ...colors.map(([code, name], idx) => ({
        id: id(`catalog:COLOR:${code}`),
        type: HorseCatalogType.COLOR,
        code,
        name,
        description: `Màu lông ${name}`,
        sortOrder: idx + 1,
        isActive: true,
      })),
    ],
    skipDuplicates: true,
  });

  // 4 StallZones (rows 1..4, cols 1..4) -> 32 Stalls
  await tx.stallZone.createMany({
    data: [
      {
        id: zoneIds.A,
        code: 'A',
        name: 'Khu Chuồng A - Đua Chính',
        rows: 3,
        cols: 4,
        description: 'Khu chuồng tiêu chuẩn thi đấu dành cho chiến mã chủ lực',
        sortOrder: 1,
        isActive: true,
      },
      {
        id: zoneIds.B,
        code: 'B',
        name: 'Khu Chuồng B - Huấn Luyện',
        rows: 3,
        cols: 4,
        description: 'Khu chuồng huấn luyện thể lực, phục hồi và ngựa trẻ',
        sortOrder: 2,
        isActive: true,
      },
      {
        id: zoneIds.C,
        code: 'C',
        name: 'Khu Cách Ly Y Tế',
        rows: 2,
        cols: 2,
        description: 'Khu điều trị y tế chuyên sâu & cách ly kiểm dịch',
        sortOrder: 3,
        isActive: true,
      },
      {
        id: zoneIds.H,
        code: 'H',
        name: 'Khu Lưu Giữ Nợ Phí',
        rows: 2,
        cols: 2,
        description: 'Khu lưu giữ tạm thời ngựa có hóa đơn quá hạn nhiều kỳ',
        sortOrder: 4,
        isActive: true,
      },
    ],
    skipDuplicates: true,
  });

  const occupiedStallSet = new Set(HORSES.map((h) => h.stallId).filter(Boolean) as string[]);
  const makeZoneStalls = (
    zoneCode: 'A' | 'B' | 'C' | 'H',
    zoneId: string,
    rows: number,
    cols: number,
  ): Prisma.StallCreateManyInput[] => {
    const out: Prisma.StallCreateManyInput[] = [];
    for (let idx = 0; idx < rows * cols; idx++) {
      const sid = stallIds[zoneCode][idx];
      const code = `STALL-${zoneCode}${String(idx + 1).padStart(2, '0')}`;
      let status: StallStatus = StallStatus.AVAILABLE;
      let notes: string | null = null;
      if (occupiedStallSet.has(sid)) {
        status = StallStatus.OCCUPIED;
      } else if (code === 'STALL-A11' || code === 'STALL-B11') {
        status = StallStatus.MAINTENANCE;
        notes = 'Đang bảo trì sàn cao su chống trượt và van nước tự động';
      } else if (code === 'STALL-A12') {
        status = StallStatus.INACTIVE;
        notes = 'Ô dự phòng đang nâng cấp hệ thống thông gió';
      }
      out.push({
        id: sid,
        code,
        zone: zoneCode,
        zoneId,
        row: Math.floor(idx / cols) + 1,
        col: (idx % cols) + 1,
        status,
        notes,
      });
    }
    return out;
  };

  await tx.stall.createMany({
    data: [
      ...makeZoneStalls('A', zoneIds.A, 3, 4),
      ...makeZoneStalls('B', zoneIds.B, 3, 4),
      ...makeZoneStalls('C', zoneIds.C, 2, 2),
      ...makeZoneStalls('H', zoneIds.H, 2, 2),
    ],
    skipDuplicates: true,
  });

  // 19 Horses
  await tx.horse.createMany({
    data: HORSES.map((h) => ({
      id: h.id,
      horseCode: h.horseCode,
      name: h.name,
      microchip: h.microchip,
      microchipRfid: `RFID-${h.microchip}`,
      breed: h.breed,
      dob: h.dob,
      gender: h.gender,
      color: h.color,
      weightKg: h.weightKg,
      status: h.status,
      ownerId: h.ownerId,
      isMedicalLocked: Boolean(h.isMedicalLocked),
      isDebtImpounded: Boolean(h.isDebtImpounded),
      debtImpoundedAt: h.isDebtImpounded ? days(-20) : null,
      debtImpoundReason: h.debtImpoundReason ?? null,
      retireReason: h.retireReason ?? null,
      createdAt: createdBase,
    })),
    skipDuplicates: true,
  });

  // Stall Allocations (17 active + 3 historical/released for BR-STL-07 & relocation trace)
  const stayStart = new Date('2026-06-01T00:00:00+07:00');
  const allocations: Prisma.StallAllocationCreateManyInput[] = [
    ...HORSES.filter((h) => h.stallId !== null).map((h) => ({
      id: id(`alloc:active:${h.id}`),
      stallId: h.stallId!,
      horseId: h.id,
      assignedGroomUserId: h.groomId ?? userIds.grooms[0],
      startDate: h.id === horseIds[16] ? days(-20) : stayStart,
      endDate: null,
      isActive: true,
    })),
    // Dạ Nguyệt lived at B10 until impounded to H01
    {
      id: id(`alloc:hist:${horseIds[16]}`),
      stallId: stallIds.B[9],
      horseId: horseIds[16],
      assignedGroomUserId: userIds.grooms[1],
      startDate: stayStart,
      endDate: days(-20),
      isActive: false,
    },
    // RETIRED horses released stalls per BR-STL-07
    {
      id: id(`alloc:retired:${horseIds[17]}`),
      stallId: stallIds.B[7],
      horseId: horseIds[17],
      assignedGroomUserId: userIds.grooms[1],
      startDate: stayStart,
      endDate: days(-18),
      isActive: false,
    },
    {
      id: id(`alloc:retired:${horseIds[18]}`),
      stallId: stallIds.B[8],
      horseId: horseIds[18],
      assignedGroomUserId: userIds.grooms[5],
      startDate: stayStart,
      endDate: days(-32),
      isActive: false,
    },
  ];
  await tx.stallAllocation.createMany({ data: allocations, skipDuplicates: true });
}

async function seedTraining(tx: Tx) {
  const planSpecs: Array<{
    key: string;
    code: string;
    horseId: string;
    trainerId: string;
    phaseName: string;
    objective: string;
    surface: TrackSurface;
    status: PlanStatus;
    targetSpeed: number;
    targetDistance: number;
    startOffset: number;
    endOffset: number;
    cancelReason?: string;
    completionSummary?: string;
  }> = [
    {
      key: 'tp-h1-active',
      code: 'GA-000001',
      horseId: horseIds[0],
      trainerId: userIds.trainer,
      phaseName: 'Nước rút & Bứt tốc Cúp Mùa Đông',
      objective: 'Tối ưu pha nước rút 400m cuối cho Cúp Mùa Đông',
      surface: TrackSurface.TURF,
      status: PlanStatus.ACTIVE,
      targetSpeed: 64,
      targetDistance: 1600,
      startOffset: -40,
      endOffset: 30,
    },
    {
      key: 'tp-h1-completed',
      code: 'GA-000002',
      horseId: horseIds[0],
      trainerId: userIds.trainer,
      phaseName: 'Nền tảng Mùa Hè – Thu 2026',
      objective: 'Xây dựng sức bền tim mạch & duy trì ACWR vùng an toàn',
      surface: TrackSurface.TURF,
      status: PlanStatus.COMPLETED,
      targetSpeed: 58,
      targetDistance: 2000,
      startOffset: -135,
      endOffset: -42,
      completionSummary: 'Đạt chuẩn vô địch Cúp Mùa Thu, nhịp tim hồi phục đạt 44 bpm.',
    },
    {
      key: 'tp-h2-active',
      code: 'GA-000003',
      horseId: horseIds[1],
      trainerId: userIds.trainer,
      phaseName: 'Tập nhẹ dưới Khóa Y Tế',
      objective: 'Giữ nhịp vận động nhẹ tránh teo cơ trong lúc theo dõi gân khoeo',
      surface: TrackSurface.DIRT,
      status: PlanStatus.ACTIVE,
      targetSpeed: 18,
      targetDistance: 800,
      startOffset: -20,
      endOffset: 20,
    },
    {
      key: 'tp-h3-active',
      code: 'GA-000004',
      horseId: horseIds[2],
      trainerId: userIds.trainer,
      phaseName: 'Nâng tải Sân Cỏ 1800m',
      objective: 'Chuẩn bị bước vào giải hạng A cự ly trung bình',
      surface: TrackSurface.TURF,
      status: PlanStatus.ACTIVE,
      targetSpeed: 60,
      targetDistance: 1800,
      startOffset: -35,
      endOffset: 25,
    },
    {
      key: 'tp-h4-active',
      code: 'GA-000005',
      horseId: horseIds[3],
      trainerId: userIds.trainer2,
      phaseName: 'Ổn định nhịp bước Sân Tổng Hợp',
      objective: 'Cân bằng sức bền & kỹ năng đổi chân trong khúc cua',
      surface: TrackSurface.SYNTHETIC,
      status: PlanStatus.ACTIVE,
      targetSpeed: 57,
      targetDistance: 1400,
      startOffset: -30,
      endOffset: 30,
    },
    {
      key: 'tp-h5-active',
      code: 'GA-000006',
      horseId: horseIds[4],
      trainerId: userIds.trainer2,
      phaseName: 'Tốc độ Cự ly Trung bình 1600m',
      objective: 'Hoàn thiện xuất phát hộp & tăng tốc giữa đường đua',
      surface: TrackSurface.DIRT,
      status: PlanStatus.ACTIVE,
      targetSpeed: 62,
      targetDistance: 1600,
      startOffset: -35,
      endOffset: 25,
    },
    {
      key: 'tp-h6-active',
      code: 'GA-000007',
      horseId: horseIds[5],
      trainerId: userIds.trainer2,
      phaseName: 'Bền bỉ Đường trường 2200m',
      objective: 'Chuẩn bị thể lực cho Cúp Quốc Gia Mùa Đông',
      surface: TrackSurface.DIRT,
      status: PlanStatus.ACTIVE,
      targetSpeed: 59,
      targetDistance: 2200,
      startOffset: -30,
      endOffset: 30,
    },
    {
      key: 'tp-h7-active',
      code: 'GA-000008',
      horseId: horseIds[6],
      trainerId: userIds.trainer3,
      phaseName: 'Tăng tốc Khởi động 1200m',
      objective: 'Nâng tốc độ tối đa trên 300m đầu tiên',
      surface: TrackSurface.SYNTHETIC,
      status: PlanStatus.ACTIVE,
      targetSpeed: 63,
      targetDistance: 1200,
      startOffset: -28,
      endOffset: 28,
    },
    {
      key: 'tp-h8-draft',
      code: 'GA-000009',
      horseId: horseIds[7],
      trainerId: userIds.trainer3,
      phaseName: 'Dự thảo Giáo án Chạy Thử Mùa Đông',
      objective: 'Chờ HLV trưởng chốt lịch sau kiểm tra thể lực tuần tới',
      surface: TrackSurface.TURF,
      status: PlanStatus.DRAFT,
      targetSpeed: 56,
      targetDistance: 1500,
      startOffset: 3,
      endOffset: 45,
    },
    {
      key: 'tp-h9-active',
      code: 'GA-000010',
      horseId: horseIds[8],
      trainerId: userIds.trainer3,
      phaseName: 'Huấn luyện Chuyển tiếp 1400m',
      objective: 'Chuyển từ đi bộ & nước kiệu sang chạy nước đại tốc độ',
      surface: TrackSurface.SYNTHETIC,
      status: PlanStatus.ACTIVE,
      targetSpeed: 55,
      targetDistance: 1400,
      startOffset: -25,
      endOffset: 35,
    },
    {
      key: 'tp-h10-active',
      code: 'GA-000011',
      horseId: horseIds[9],
      trainerId: userIds.trainer4,
      phaseName: 'Duy trì Phong độ Sân Cỏ',
      objective: 'Duy trì điểm thể trạng >= 8.5/10 và kiểm soát nhịp tim',
      surface: TrackSurface.TURF,
      status: PlanStatus.ACTIVE,
      targetSpeed: 60,
      targetDistance: 1600,
      startOffset: -32,
      endOffset: 28,
    },
    {
      key: 'tp-h12-active',
      code: 'GA-000012',
      horseId: horseIds[11],
      trainerId: userIds.trainer4,
      phaseName: 'Tập Sức mạnh Cơ Lưng & Đùi Sau',
      objective: 'Củng cố sức bật hộp xuất phát cho ngựa đường trường',
      surface: TrackSurface.DIRT,
      status: PlanStatus.ACTIVE,
      targetSpeed: 58,
      targetDistance: 1800,
      startOffset: -26,
      endOffset: 34,
    },
    {
      key: 'tp-h16-cancelled',
      code: 'GA-000013',
      horseId: horseIds[15],
      trainerId: userIds.trainer4,
      phaseName: 'Giáo án Tốc độ Cũ (Đã hủy do chấn thương)',
      objective: 'Tạm dừng hoàn toàn để điều trị tổn thương khớp cổ chân',
      surface: TrackSurface.DIRT,
      status: PlanStatus.CANCELLED,
      targetSpeed: 61,
      targetDistance: 1600,
      startOffset: -55,
      endOffset: -10,
      cancelReason: 'Chuyển sang điều trị chấn thương & Khóa Y Tế dài ngày',
    },
  ];

  await tx.trainingPlan.createMany({
    data: planSpecs.map((p) => ({
      id: id(p.key),
      horseId: p.horseId,
      trainerUserId: p.trainerId,
      planCode: p.code,
      phaseName: p.phaseName,
      objective: p.objective,
      trackSurface: p.surface,
      targetSpeed: p.targetSpeed,
      targetDistance: p.targetDistance,
      startDate: days(p.startOffset),
      endDate: days(p.endOffset),
      status: p.status,
      cancelReason: p.cancelReason ?? null,
      completionSummary: p.completionSummary ?? null,
      phases: [
        {
          id: `${p.code}-PH1`,
          name: 'Giai đoạn Nền tảng',
          type: 'FOUNDATION',
          focus: 'FOUNDATION',
          startDate: days(p.startOffset).toISOString().slice(0, 10),
          endDate: days(p.startOffset + 14).toISOString().slice(0, 10),
          durationDays: 14,
          sessionsPerWeek: 5,
          maxWeeklyDistance: Math.max(5000, Math.round(p.targetDistance * 5)),
          surface: 'TURF',
          targetSpeedKmh: Math.max(12, Math.round(p.targetSpeed * 0.72)),
          targetDistanceM: Math.max(400, Math.round(p.targetDistance * 0.8)),
        },
        {
          id: `${p.code}-PH2`,
          name: 'Giai đoạn Tốc độ & Bứt tốc',
          type: 'SPEED',
          focus: 'SPEED',
          startDate: days(p.startOffset + 15).toISOString().slice(0, 10),
          endDate: days(p.startOffset + 29).toISOString().slice(0, 10),
          durationDays: 14,
          sessionsPerWeek: 5,
          maxWeeklyDistance: Math.max(6000, Math.round(p.targetDistance * 6)),
          surface: 'DIRT',
          targetSpeedKmh: p.targetSpeed,
          targetDistanceM: p.targetDistance,
        },
        {
          id: `${p.code}-PH3`,
          name: 'Giai đoạn Thả lỏng Phục hồi',
          type: 'RECOVERY',
          focus: 'RECOVERY',
          startDate: days(p.startOffset + 30).toISOString().slice(0, 10),
          endDate: days(p.endOffset).toISOString().slice(0, 10),
          durationDays: 7,
          sessionsPerWeek: 3,
          maxWeeklyDistance: 3000,
          surface: 'TURF',
          targetSpeedKmh: 15,
          targetDistanceM: 600,
        },
      ],
    })),
    skipDuplicates: true,
  });

  // Build rich WorkoutSessions spanning T7–today + upcoming 5 days
  const workouts: Prisma.WorkoutSessionCreateManyInput[] = [];
  const activeRunners = [
    {
      horseIdx: 0,
      planKey: 'tp-h1-active',
      trainerId: userIds.trainer,
      baseSpeed: 61,
      dist: 1600,
      jockey: 'Trần Văn Kiên',
    },
    {
      horseIdx: 2,
      planKey: 'tp-h3-active',
      trainerId: userIds.trainer,
      baseSpeed: 57,
      dist: 1600,
      jockey: 'Lê Minh Quân',
    },
    {
      horseIdx: 3,
      planKey: 'tp-h4-active',
      trainerId: userIds.trainer2,
      baseSpeed: 55,
      dist: 1400,
      jockey: 'Nguyễn Tấn Lộc',
    },
    {
      horseIdx: 4,
      planKey: 'tp-h5-active',
      trainerId: userIds.trainer2,
      baseSpeed: 60,
      dist: 1600,
      jockey: 'Trần Văn Kiên',
    },
    {
      horseIdx: 5,
      planKey: 'tp-h6-active',
      trainerId: userIds.trainer2,
      baseSpeed: 58,
      dist: 2000,
      jockey: 'Phạm Hữu Đạt',
    },
    {
      horseIdx: 6,
      planKey: 'tp-h7-active',
      trainerId: userIds.trainer3,
      baseSpeed: 62,
      dist: 1200,
      jockey: 'Lê Minh Quân',
    },
    {
      horseIdx: 8,
      planKey: 'tp-h9-active',
      trainerId: userIds.trainer3,
      baseSpeed: 54,
      dist: 1400,
      jockey: 'Nguyễn Tấn Lộc',
    },
    {
      horseIdx: 9,
      planKey: 'tp-h10-active',
      trainerId: userIds.trainer4,
      baseSpeed: 58,
      dist: 1600,
      jockey: 'Phạm Hữu Đạt',
    },
    {
      horseIdx: 11,
      planKey: 'tp-h12-active',
      trainerId: userIds.trainer4,
      baseSpeed: 56,
      dist: 1800,
      jockey: 'Trần Văn Kiên',
    },
  ];

  // Completed sessions over last 35 days (provides >= 5 completed sessions/horse for ACWR & tournament eligibility)
  const pastOffsets = [-34, -27, -20, -14, -9, -4, -1];
  for (const runner of activeRunners) {
    pastOffsets.forEach((off, idx) => {
      const isTrial = idx % 3 === 2;
      const wType = isTrial ? 'TRIAL' : idx % 2 === 0 ? 'BREEZE' : 'CANTER';
      const intensity = wType === 'CANTER' ? 'MEDIUM' : 'HEAVY';
      const speed = Number((runner.baseSpeed - (isTrial ? 0 : 3) + (idx % 3) * 1.1).toFixed(1));
      const dist = wType === 'CANTER' ? Math.max(800, runner.dist - 200) : runner.dist;
      const duration = Number(((dist / 1000 / speed) * 3600).toFixed(1));
      const isAbnormalSample = runner.horseIdx === 6 && off === -4;
      workouts.push({
        id: id(`workout:hist:${runner.horseIdx}:${off}`),
        trainingPlanId: id(runner.planKey),
        horseId: horseIds[runner.horseIdx],
        assignedStaffUserId: runner.trainerId,
        scheduledDate: days(off, 6 + (runner.horseIdx % 3), 0),
        phaseId: `${runner.planKey.toUpperCase()}-PH2`,
        distanceMeters: dist,
        repetitions: 1,
        targetSpeedKmh: speed,
        targetDurationSeconds: Math.round(duration),
        actualTimeSeconds: duration,
        actualDistanceMeters: dist,
        averageSpeedKmh: speed,
        topSpeedKmh: Number((speed + 4.5).toFixed(1)),
        heartRatePeak: isAbnormalSample ? 228 : 184 + (idx % 12),
        heartRateRecovery: isAbnormalSample ? 132 : 44 + (idx % 8),
        recoveryTimeMinutes: isAbnormalSample ? 16 : 7.5,
        staminaScore: isAbnormalSample ? 6.4 : Number((8.4 + ((idx + runner.horseIdx) % 12) * 0.1).toFixed(1)),
        performanceScore: isAbnormalSample ? 6.8 : Number((8.2 + ((idx + runner.horseIdx) % 14) * 0.1).toFixed(1)),
        injuryRiskLevel: isAbnormalSample ? 'MEDIUM' : 'LOW',
        status: WorkoutStatus.COMPLETED,
        workoutType: wType,
        intensity,
        trackSurface: runner.horseIdx % 2 === 0 ? 'TURF' : 'DIRT',
        actualSurface: runner.horseIdx % 2 === 0 ? 'TURF' : 'DIRT',
        trackCondition: 'GOOD',
        completionLevel: 'FULL',
        jockeyName: runner.jockey,
        gateNumber: (runner.horseIdx % 8) + 1,
        resultRecordedAt: days(off, 8, 15),
        resultRecordedById: runner.trainerId,
        abnormalSigns: isAbnormalSample,
        abnormalSignTypes: isAbnormalSample ? ['SLOW_RECOVERY', 'ELEVATED_HR'] : [],
        abnormalNotes: isAbnormalSample
          ? 'Nhịp tim hồi phục sau 10 phút còn cao (132 bpm), đã báo bác sĩ thú y kiểm tra.'
          : null,
        vetAcknowledgedAt: isAbnormalSample ? days(-3, 10, 0) : null,
        vetNotes: isAbnormalSample ? 'Đã bổ sung điện giải & giảm tải 2 ngày tới.' : null,
      });
    });

    // Scheduled sessions for today & next 4 days
    [0, 2, 4].forEach((off, idx) => {
      const hour = 6 + ((runner.horseIdx + idx) % 4);
      const wType = idx === 0 ? 'BREEZE' : idx === 1 ? 'TROT' : 'TRIAL';
      workouts.push({
        id: id(`workout:sched:${runner.horseIdx}:${off}`),
        trainingPlanId: id(runner.planKey),
        horseId: horseIds[runner.horseIdx],
        assignedStaffUserId: runner.trainerId,
        scheduledDate: days(off, hour, 0),
        phaseId: `${runner.planKey.toUpperCase()}-PH2`,
        distanceMeters: wType === 'TROT' ? 800 : runner.dist,
        repetitions: 1,
        targetSpeedKmh: wType === 'TROT' ? 24 : runner.baseSpeed,
        targetDurationSeconds: wType === 'TROT' ? 120 : 95,
        status: WorkoutStatus.SCHEDULED,
        workoutType: wType,
        intensity: wType === 'TROT' ? 'LIGHT' : 'HEAVY',
        trackSurface: runner.horseIdx % 2 === 0 ? 'TURF' : 'DIRT',
        jockeyName: runner.jockey,
        gateNumber: (runner.horseIdx % 8) + 1,
        trainerNotes: 'Kiểm tra nhịp tim trước và sau khi về đích.',
      });
    });
  }

  // Light rehab/walk + BLOCKED/MISSED/CANCELLED coverage
  workouts.push(
    {
      id: id('workout:h2-walk-today'),
      trainingPlanId: id('tp-h2-active'),
      horseId: horseIds[1],
      assignedStaffUserId: userIds.trainer,
      scheduledDate: days(0, 7, 30),
      distanceMeters: 600,
      repetitions: 1,
      status: WorkoutStatus.SCHEDULED,
      workoutType: 'WALK',
      intensity: 'LIGHT',
      trackSurface: 'DIRT',
      trainerNotes: 'Dắt đi bộ nhẹ 15 phút theo phác đồ khóa y tế.',
    },
    {
      id: id('workout:h2-blocked-breeze'),
      trainingPlanId: id('tp-h2-active'),
      horseId: horseIds[1],
      assignedStaffUserId: userIds.trainer,
      scheduledDate: days(-1, 6, 30),
      distanceMeters: 1200,
      repetitions: 1,
      targetSpeedKmh: 58,
      targetDurationSeconds: 75,
      status: WorkoutStatus.BLOCKED,
      workoutType: 'BREEZE',
      intensity: 'HEAVY',
      trackSurface: 'TURF',
      statusReason: 'Tự động khóa do Xích Thố đang có Khóa Y Tế (MLK-2026-002).',
    },
    {
      id: id('workout:h12-missed'),
      trainingPlanId: id('tp-h12-active'),
      horseId: horseIds[11],
      assignedStaffUserId: userIds.trainer4,
      scheduledDate: days(-2, 16, 0),
      distanceMeters: 1200,
      repetitions: 1,
      targetSpeedKmh: 50,
      targetDurationSeconds: 86,
      status: WorkoutStatus.MISSED,
      workoutType: 'CANTER',
      intensity: 'MEDIUM',
      trackSurface: 'DIRT',
      statusReason: 'Bỏ lỡ do mưa lớn làm trơn mặt sân đất buổi chiều.',
    },
    {
      id: id('workout:h16-cancelled'),
      trainingPlanId: id('tp-h16-cancelled'),
      horseId: horseIds[15],
      assignedStaffUserId: userIds.trainer4,
      scheduledDate: days(-12, 7, 0),
      distanceMeters: 1600,
      repetitions: 1,
      targetSpeedKmh: 60,
      targetDurationSeconds: 96,
      status: WorkoutStatus.CANCELLED,
      workoutType: 'TRIAL',
      intensity: 'HEAVY',
      trackSurface: 'DIRT',
      statusReason: 'Hủy giáo án sau khi ghi nhận chấn thương khớp cổ chân trái.',
    },
    // Long-horizon T7 & T8 workouts for 6-month continuous chart
    {
      id: id('workout:t7-h1'),
      trainingPlanId: id('tp-h1-completed'),
      horseId: horseIds[0],
      assignedStaffUserId: userIds.trainer,
      scheduledDate: days(-120, 6, 0),
      distanceMeters: 1600,
      repetitions: 1,
      targetSpeedKmh: 60,
      actualTimeSeconds: 94.5,
      actualDistanceMeters: 1600,
      averageSpeedKmh: 60.9,
      heartRatePeak: 192,
      heartRateRecovery: 48,
      performanceScore: 8.7,
      status: WorkoutStatus.COMPLETED,
      workoutType: 'TRIAL',
      intensity: 'HEAVY',
      trackSurface: 'TURF',
      resultRecordedAt: days(-120, 7, 0),
      resultRecordedById: userIds.trainer,
    },
  );

  await tx.workoutSession.createMany({ data: workouts, skipDuplicates: true });

  // SimulatorSessions (covering WORKOUT, RACE, EXAM + COMPLETED, RUNNING, PENDING, ABORTED_INJURY)
  await tx.simulatorSession.createMany({
    data: [
      {
        id: id('sim:workout-h1-completed'),
        type: SimulatorSessionType.WORKOUT,
        status: SimulatorSessionStatus.COMPLETED,
        horseIds: [horseIds[0]],
        actorUserId: userIds.trainer,
        workoutSessionId: id('workout:hist:0:-1'),
        startedAt: days(-1, 6, 0),
        finishedAt: days(-1, 6, 5),
        lastSnapshot: { distanceM: 1600, speedKmh: 62.4, heartRate: 186, stamina: 88 },
        result: { finishTimeSeconds: 92.3, avgSpeedKmh: 62.4, peakHeartRate: 190 },
      },
      {
        id: id('sim:workout-h3-running'),
        type: SimulatorSessionType.WORKOUT,
        status: SimulatorSessionStatus.RUNNING,
        horseIds: [horseIds[2]],
        actorUserId: userIds.trainer,
        workoutSessionId: id('workout:sched:2:0'),
        startedAt: days(0, 6, 15),
        lastSnapshot: { distanceM: 940, speedKmh: 58.1, heartRate: 179, stamina: 76 },
      },
      {
        id: id('sim:race-cup-t11-pending'),
        type: SimulatorSessionType.RACE,
        status: SimulatorSessionStatus.PENDING,
        horseIds: [horseIds[0], horseIds[2], horseIds[4], horseIds[5]],
        actorUserId: userIds.trainer2,
        startedAt: days(0, 9, 0),
        lastSnapshot: { stage: 'STARTING_GATE', distanceM: 1600, fieldSize: 4 },
      },
      {
        id: id('sim:exam-h2-aborted'),
        type: SimulatorSessionType.EXAM,
        status: SimulatorSessionStatus.ABORTED_INJURY,
        horseIds: [horseIds[1]],
        actorUserId: userIds.vet,
        medicalRecordId: id('medrec:open:h2'),
        startedAt: days(-10, 8, 30),
        finishedAt: days(-10, 8, 34),
        lastSnapshot: { distanceM: 420, anomaly: 'GAIT_ASYMMETRY', heartRate: 196 },
        result: { abortedReason: 'Phát hiện lệch bước nhẹ chân trước phải lúc chạy kiểm tra' },
      },
    ],
    skipDuplicates: true,
  });
}

async function seedMedical(tx: Tx) {
  const fromStr = pastIso(-14);
  const toStr = pastIso(14);

  // Strictly at most 1 OPEN MedicalRecord per horse (PR #153)
  const medicalRecords: Prisma.MedicalRecordCreateManyInput[] = [
    {
      id: id('medrec:open:h2'),
      recordNumber: 'MED-2026-005',
      horseId: horseIds[1],
      veterinarianUserId: userIds.vet,
      status: MedicalRecordStatus.OPEN,
      examinationDate: days(-10, 9, 0),
      examinationType: 'CLINICAL',
      discoverySource: 'IN_WORKOUT',
      severity: SeverityLevel.MODERATE,
      recommendedHorseStatus: HorseStatus.UNDER_OBSERVATION,
      examinationReason: 'Căng gân khoeo chân trước phải sau buổi tập tốc độ',
      temperature: 38.1,
      restingHeartRate: 44,
      respiratoryRate: 18,
      weightKg: 500,
      symptoms: 'Nhạy cảm nhẹ khi ấn vùng gân gấp nông chân trước phải, không sưng nóng lan tỏa.',
      clinicalDiagnosis: 'Viêm nhẹ bao gân gấp nông chân trước phải (Grade II)',
      treatmentProtocol: 'Chườm lạnh 2 lần/ngày, băng ép nhẹ, nghỉ chạy nặng 14 ngày.',
      requiresFollowUp: true,
      followUpDate: days(3, 9, 0),
      treatmentPhases: JSON.stringify([
        {
          phaseName: 'Giảm viêm cấp tính',
          startDate: fromStr,
          endDate: toStr,
          allowedActivity: 'Nghỉ tuyệt đối, chỉ dắt đi bộ nhẹ 15 phút',
          careInstructions: [
            {
              activity: 'Chườm đá cổ chân trước phải 15 phút',
              frequencyPerDay: 2,
              notes: 'Dùng túi gel lạnh',
            },
          ],
        },
      ]),
      prescriptions: JSON.stringify([
        {
          status: 'ACTIVE',
          startDate: fromStr,
          endDate: toStr,
          medicationName: 'Thuốc chống viêm thú y',
          dosage: '1',
          unit: 'VIAL',
          route: 'Tiêm bắp',
          supplyId: supplyIds.antiInflam,
          frequencyPerDay: 2,
          notes: 'Theo dõi sau tiêm sáng & tối',
        },
      ]),
    },
    {
      id: id('medrec:open:h15'),
      recordNumber: 'MED-2026-006',
      horseId: horseIds[14],
      veterinarianUserId: userIds.vet4,
      status: MedicalRecordStatus.OPEN,
      examinationDate: days(-7, 10, 0),
      examinationType: 'CLINICAL',
      discoverySource: 'DAILY_CARE',
      severity: SeverityLevel.SEVERE,
      recommendedHorseStatus: HorseStatus.ISOLATED,
      examinationReason: 'Sốt nhẹ kèm ho khan đường hô hấp trên',
      temperature: 39.2,
      restingHeartRate: 52,
      respiratoryRate: 26,
      weightKg: 442,
      symptoms: 'Ho khan từng cơn vào sáng sớm, dịch mũi trong, ăn kém 20%.',
      clinicalDiagnosis: 'Viêm đường hô hấp trên do thay đổi thời tiết (cách ly theo dõi)',
      treatmentProtocol: 'Cách ly tại STALL-C01, xịt sát khuẩn & siro hỗ trợ hô hấp.',
      requiresFollowUp: true,
      followUpDate: days(2, 10, 0),
      treatmentPhases: JSON.stringify([
        {
          phaseName: 'Cách ly & Hồi phục hô hấp',
          startDate: fromStr,
          endDate: toStr,
          allowedActivity: 'Strict stall rest - nghỉ tại chuồng cách ly',
          careInstructions: [
            {
              activity: 'Theo dõi thân nhiệt & dịch mũi',
              frequencyPerDay: 2,
              notes: 'Báo bác sĩ nếu > 39.5°C',
            },
          ],
        },
      ]),
      prescriptions: JSON.stringify([
        {
          status: 'ACTIVE',
          startDate: fromStr,
          endDate: toStr,
          medicationName: 'Thuốc chống viêm thú y',
          dosage: '1',
          unit: 'VIAL',
          route: 'Tiêm bắp',
          supplyId: supplyIds.antiInflam,
          frequencyPerDay: 2,
          notes: 'Lắc kỹ trước khi dùng',
        },
      ]),
    },
    {
      id: id('medrec:open:h16'),
      recordNumber: 'MED-2026-007',
      horseId: horseIds[15],
      veterinarianUserId: userIds.vet2,
      status: MedicalRecordStatus.OPEN,
      examinationDate: days(-12, 11, 0),
      examinationType: 'EMERGENCY',
      discoverySource: 'IN_WORKOUT',
      severity: SeverityLevel.CRITICAL,
      recommendedHorseStatus: HorseStatus.INJURED,
      examinationReason: 'Khập khiễng rõ chân sau trái sau pha vào cua tốc độ cao',
      temperature: 38.4,
      restingHeartRate: 50,
      respiratoryRate: 22,
      weightKg: 503,
      symptoms: 'Sưng khớp cổ chân sau trái, phản ứng đau khi gập khớp.',
      clinicalDiagnosis: 'Bong gân dây chằng bên khớp cổ chân sau trái',
      treatmentProtocol: 'Cố định băng ép y tế, chườm lạnh 3 lần/ngày, khóa mọi hoạt động chạy.',
      requiresFollowUp: true,
      followUpDate: days(5, 9, 0),
      treatmentPhases: JSON.stringify([
        {
          phaseName: 'Cố định chấn thương cấp',
          startDate: fromStr,
          endDate: toStr,
          allowedActivity: 'Strict stall rest - không dắt đi bộ',
          careInstructions: [
            {
              activity: 'Chườm lạnh Ice-boot khớp cổ chân sau trái',
              frequencyPerDay: 3,
              notes: '20 phút/lần',
            },
          ],
        },
      ]),
      prescriptions: JSON.stringify([
        {
          status: 'ACTIVE',
          startDate: fromStr,
          endDate: toStr,
          medicationName: 'Thuốc chống viêm thú y',
          dosage: '2',
          unit: 'VIAL',
          route: 'Tiêm bắp',
          supplyId: supplyIds.antiInflam,
          frequencyPerDay: 1,
        },
      ]),
    },
    {
      id: id('medrec:open:h13'),
      recordNumber: 'MED-2026-008',
      horseId: horseIds[12],
      veterinarianUserId: userIds.vet3,
      status: MedicalRecordStatus.OPEN,
      examinationDate: days(-3, 14, 0),
      examinationType: 'CLINICAL',
      discoverySource: 'DAILY_CARE',
      severity: SeverityLevel.MILD,
      recommendedHorseStatus: HorseStatus.UNDER_OBSERVATION,
      examinationReason: 'Giảm ăn nhẹ và phân hơi lỏng sau đổi lô cỏ',
      temperature: 37.9,
      restingHeartRate: 40,
      respiratoryRate: 14,
      weightKg: 464,
      symptoms: 'Ăn hết 70% khẩu phần tối, nhu động ruột bình thường.',
      clinicalDiagnosis: 'Rối loạn tiêu hóa nhẹ do thay đổi khẩu phần thô',
      treatmentProtocol: 'Bổ sung men vi sinh và chia nhỏ khẩu phần 4 ngày.',
      requiresFollowUp: true,
      followUpDate: days(1, 14, 0),
    },
    // Closed historical records
    {
      id: id('medrec:closed:h1'),
      recordNumber: 'MED-2026-001',
      horseId: horseIds[0],
      veterinarianUserId: userIds.vet,
      status: MedicalRecordStatus.CLOSED,
      examinationDate: days(-75, 9, 0),
      closedAt: days(-62, 16, 0),
      examinationType: 'CLINICAL',
      discoverySource: 'DAILY_CARE',
      severity: SeverityLevel.MILD,
      recommendedHorseStatus: HorseStatus.ACTIVE,
      symptoms: 'Trầy xước nông cẳng chân trước trái.',
      clinicalDiagnosis: 'Xây xát mô mềm ngoài da',
      treatmentProtocol: 'Sát khuẩn bằng dung dịch Povidone-Iodine 5 ngày.',
      conclusion: 'Vết thương khô hoàn toàn, đủ điều kiện thi đấu lại.',
      treatmentResult: 'CURED',
    },
    {
      id: id('medrec:closed:h4'),
      recordNumber: 'MED-2026-002',
      horseId: horseIds[3],
      veterinarianUserId: userIds.vet2,
      status: MedicalRecordStatus.CLOSED,
      examinationDate: days(-50, 10, 0),
      closedAt: days(-42, 15, 0),
      examinationType: 'PREVENTIVE',
      discoverySource: 'DAILY_CARE',
      severity: SeverityLevel.MILD,
      recommendedHorseStatus: HorseStatus.ACTIVE,
      symptoms: 'Mòn cạnh móng ngoài chân trước trái.',
      clinicalDiagnosis: 'Mất cân bằng góc móng nhẹ',
      treatmentProtocol: 'Gọt chỉnh móng và đóng móng hợp kim chuyên dụng.',
      conclusion: 'Dáng chạy cân bằng trở lại.',
      treatmentResult: 'CURED',
    },
    // DRAFT clinical record
    {
      id: id('medrec:draft:h14'),
      recordNumber: 'MED-2026-009',
      horseId: horseIds[13],
      veterinarianUserId: userIds.vet3,
      status: MedicalRecordStatus.DRAFT,
      examinationDate: days(0, 8, 30),
      examinationType: 'ROUTINE',
      discoverySource: 'DAILY_CARE',
      severity: SeverityLevel.MILD,
      symptoms: 'Khám tổng quát định kỳ trước khi mở tập lại cho Phong Lôi.',
      clinicalDiagnosis: 'Đang chờ kết quả xét nghiệm công thức máu',
      treatmentProtocol: 'Cập nhật ngay sau khi có chỉ số huyết học chiều nay.',
    },
  ];
  await tx.medicalRecord.createMany({ data: medicalRecords, skipDuplicates: true });

  // InjuryLogs across LEFT / RIGHT / BILATERAL and ACTIVE / HEALING / RESOLVED
  await tx.injuryLog.createMany({
    data: [
      {
        id: id('injury:h2-tendon'),
        medicalRecordId: id('medrec:open:h2'),
        horseId: horseIds[1],
        coordinateX: 62.5,
        coordinateY: 74.0,
        viewSide: 'RIGHT_PROFILE',
        layer: 'TENDON',
        anatomicalZone: 'Gân gấp nông chân trước phải',
        bodySide: BodySide.RIGHT,
        injuryType: 'Tendonitis',
        severity: SeverityLevel.MODERATE,
        stage: 'SUBACUTE',
        status: InjuryStatus.HEALING,
        description: 'Đáp ứng tốt sau 10 ngày chườm lạnh, giảm nhạy cảm 60%.',
        discoveryDate: days(-10),
      },
      {
        id: id('injury:h16-hock'),
        medicalRecordId: id('medrec:open:h16'),
        horseId: horseIds[15],
        coordinateX: 28.0,
        coordinateY: 68.5,
        viewSide: 'LEFT_PROFILE',
        layer: 'JOINT',
        anatomicalZone: 'Khớp cổ chân sau trái',
        bodySide: BodySide.LEFT,
        injuryType: 'Joint Sprain',
        severity: SeverityLevel.CRITICAL,
        stage: 'ACUTE',
        status: InjuryStatus.ACTIVE,
        description: 'Sưng mô mềm quanh dây chằng bên khớp cổ chân sau trái.',
        discoveryDate: days(-12),
      },
      {
        id: id('injury:h1-resolved'),
        medicalRecordId: id('medrec:closed:h1'),
        horseId: horseIds[0],
        coordinateX: 59.0,
        coordinateY: 78.0,
        viewSide: 'LEFT_PROFILE',
        layer: 'SKIN',
        anatomicalZone: 'Ống chân trước trái',
        bodySide: BodySide.LEFT,
        injuryType: 'Abrasion',
        severity: SeverityLevel.MILD,
        stage: 'RESOLVED',
        status: InjuryStatus.RESOLVED,
        description: 'Xây xát ngoài da đã liền sẹo hoàn toàn.',
        discoveryDate: days(-75),
      },
      {
        id: id('injury:h4-bilateral'),
        medicalRecordId: id('medrec:closed:h4'),
        horseId: horseIds[3],
        coordinateX: 61.0,
        coordinateY: 89.0,
        viewSide: 'FRONT',
        layer: 'HOOF',
        anatomicalZone: 'Móng trước hai bên',
        bodySide: BodySide.BILATERAL,
        injuryType: 'Hoof Balance',
        severity: SeverityLevel.MILD,
        stage: 'RESOLVED',
        status: InjuryStatus.RESOLVED,
        description: 'Đã cân chỉnh độ nghiêng móng đều hai bên.',
        discoveryDate: days(-50),
      },
    ],
    skipDuplicates: true,
  });

  // MedicalLocks (active locks + 1 unlocked history)
  await tx.medicalLock.createMany({
    data: [
      {
        id: id('lock:h1-hist'),
        lockCode: 'MLK-2026-001',
        horseId: horseIds[0],
        medicalRecordId: id('medrec:closed:h1'),
        veterinarianUserId: userIds.vet,
        lockedAt: days(-75),
        expectedRestDays: 10,
        recheckDate: days(-65),
        appliedMedicalStatus: HorseStatus.UNDER_OBSERVATION,
        lockReason: 'Theo dõi hồi phục xây xát ống chân trước trái',
        unlockConditions: 'Vết thương khô, không đau khi phi nước đại thử',
        isLocked: false,
        unlockedAt: days(-62),
        unlockVetUserId: userIds.vet,
        unlockReason: 'Đạt chuẩn thể lực quay lại tập luyện',
      },
      {
        id: id('lock:h2-active'),
        lockCode: 'MLK-2026-002',
        horseId: horseIds[1],
        medicalRecordId: id('medrec:open:h2'),
        veterinarianUserId: userIds.vet,
        lockedAt: days(-10),
        expectedRestDays: 14,
        recheckDate: days(4),
        appliedMedicalStatus: HorseStatus.UNDER_OBSERVATION,
        lockReason: 'Viêm nhẹ gân gấp nông chân trước phải — cấm bài tập nặng',
        unlockConditions: 'Siêu âm kiểm tra gân bình thường sau ngày tái khám',
        isLocked: true,
      },
      {
        id: id('lock:h15-active'),
        lockCode: 'MLK-2026-003',
        horseId: horseIds[14],
        medicalRecordId: id('medrec:open:h15'),
        veterinarianUserId: userIds.vet4,
        lockedAt: days(-7),
        expectedRestDays: 14,
        recheckDate: days(2),
        appliedMedicalStatus: HorseStatus.ISOLATED,
        lockReason: 'Cách ly viêm đường hô hấp trên — ngăn lây lan khu chuồng chính',
        unlockConditions: 'Hết sốt & hết ho liên tục 72 giờ',
        isLocked: true,
      },
      {
        id: id('lock:h16-active'),
        lockCode: 'MLK-2026-004',
        horseId: horseIds[15],
        medicalRecordId: id('medrec:open:h16'),
        veterinarianUserId: userIds.vet2,
        lockedAt: days(-12),
        expectedRestDays: 21,
        recheckDate: days(5),
        appliedMedicalStatus: HorseStatus.INJURED,
        lockReason: 'Bong gân khớp cổ chân sau trái độ III',
        unlockConditions: 'Giảm sưng hoàn toàn và đi lại không khập khiễng',
        isLocked: true,
      },
    ],
    skipDuplicates: true,
  });

  // All 4 PreventiveTypeCatalog items
  await tx.preventiveTypeCatalog.createMany({
    data: [
      {
        id: preventiveTypeIds.VACCINATION,
        code: 'VACCINATION',
        name: 'Tiêm phòng Cúm & Uốn ván định kỳ',
        category: PreventiveType.VACCINATION,
        intervalDays: 180,
        advanceNoticeDays: 14,
        applyToNewHorses: true,
        description: 'Vaccine EIV + Tetanus bắt buộc theo quy chuẩn thi đấu',
      },
      {
        id: preventiveTypeIds.DEWORMING,
        code: 'DEWORMING',
        name: 'Tẩy giun sán định kỳ',
        category: PreventiveType.DEWORMING,
        intervalDays: 90,
        advanceNoticeDays: 7,
        applyToNewHorses: true,
        description: 'Kiểm soát ký sinh trùng đường ruột bằng Ivermectin',
      },
      {
        id: preventiveTypeIds.FARRIER_HOOF_CARE,
        code: 'FARRIER_HOOF_CARE',
        name: 'Gọt móng & Đóng móng chuyên dụng',
        category: PreventiveType.FARRIER_HOOF_CARE,
        intervalDays: 42,
        advanceNoticeDays: 5,
        applyToNewHorses: true,
        description: 'Bảo dưỡng góc móng, thăng bằng bước chạy và thay đế hợp kim',
      },
      {
        id: preventiveTypeIds.DENTAL,
        code: 'DENTAL',
        name: 'Chăm sóc & Mài răng định kỳ',
        category: PreventiveType.DENTAL,
        intervalDays: 180,
        advanceNoticeDays: 14,
        applyToNewHorses: true,
        description: 'Kiểm tra răng hàm, tránh cọ xát hàm thiếc khi chạy tốc độ',
      },
    ],
    skipDuplicates: true,
  });

  const schedules: Prisma.PreventiveScheduleCreateManyInput[] = [];
  HORSES.filter((h) => h.status !== HorseStatus.RETIRED).forEach((h, idx) => {
    const types: Array<[PreventiveType, string, PreventiveStatus, number]> = [
      [PreventiveType.VACCINATION, preventiveTypeIds.VACCINATION, PreventiveStatus.COMPLETED, -90],
      [
        PreventiveType.FARRIER_HOOF_CARE,
        preventiveTypeIds.FARRIER_HOOF_CARE,
        idx % 5 === 0
          ? PreventiveStatus.OVERDUE
          : idx % 3 === 0
            ? PreventiveStatus.PENDING
            : PreventiveStatus.COMPLETED,
        idx % 5 === 0 ? -3 : idx % 3 === 0 ? 5 : -18,
      ],
      [
        PreventiveType.DEWORMING,
        preventiveTypeIds.DEWORMING,
        idx % 4 === 0 ? PreventiveStatus.PENDING : PreventiveStatus.COMPLETED,
        idx % 4 === 0 ? 7 : -35,
      ],
      [
        PreventiveType.DENTAL,
        preventiveTypeIds.DENTAL,
        idx % 6 === 0 ? PreventiveStatus.OVERDUE : PreventiveStatus.PENDING,
        idx % 6 === 0 ? -5 : 18,
      ],
    ];
    for (const [pType, typeCatalogId, status, off] of types) {
      schedules.push({
        id: id(`prev:${h.id}:${pType}`),
        horseId: h.id,
        typeCatalogId,
        veterinarianUserId: userIds.vet3,
        scheduleType: pType,
        dueDate: days(off, 9, 0),
        completedDate: status === PreventiveStatus.COMPLETED ? days(off, 10, 30) : null,
        lastCompletedDate:
          status === PreventiveStatus.COMPLETED ? days(off, 10, 30) : days(off - 90),
        productAdministered:
          pType === PreventiveType.VACCINATION
            ? 'Fluvac Innovator EHV-4/1'
            : pType === PreventiveType.DEWORMING
              ? 'Eqvalan Ivermectin Paste'
              : 'Quy trình chuẩn CLB EquiFlow',
        batchNumber: `LOT-2026-${String(idx + 10).padStart(3, '0')}`,
        performedByMode: 'INTERNAL',
        performedByName: 'BS. Trần Đình Khôi',
        status,
      });
    }
  });
  await tx.preventiveSchedule.createMany({ data: schedules, skipDuplicates: true });
}

async function seedStableCare(tx: Tx) {
  // Original 4 sample supplies (matching origin/dev)
  const supplies: Array<Prisma.SupplyCatalogCreateManyInput & { id: string }> = [
    {
      id: supplyIds.timothyHay,
      code: 'TIMOTHY',
      name: 'Cỏ khô Timothy',
      category: SupplyCategory.FEED_HAY,
      unit: SupplyUnit.KG,
      unitPrice: 20000,
    },
    {
      id: supplyIds.oatGrain,
      code: 'OATS',
      name: 'Cám yến mạch',
      category: SupplyCategory.FEED_GRAIN,
      unit: SupplyUnit.KG,
      unitPrice: 24000,
    },
    {
      id: supplyIds.electrolyte,
      code: 'ELECTROLYTE',
      name: 'Điện giải cho ngựa',
      category: SupplyCategory.SUPPLEMENT_ELECTROLYTE,
      unit: SupplyUnit.PACKET,
      unitPrice: 45000,
    },
    {
      id: supplyIds.antiInflam,
      code: 'ANTI_INFLAM',
      name: 'Thuốc chống viêm thú y',
      category: SupplyCategory.MEDICINE,
      unit: SupplyUnit.VIAL,
      unitPrice: 180000,
      withdrawalDays: 7,
    },
  ];
  await tx.supplyCatalog.createMany({ data: supplies, skipDuplicates: true });

  // StockBalances across Zones A, B, C, H (mix of healthy and low-stock triggers)
  const stockRows: Prisma.StockBalanceCreateManyInput[] = [];
  const allZones = [zoneIds.A, zoneIds.B, zoneIds.C, zoneIds.H];
  allZones.forEach((zId, zIdx) => {
    supplies.forEach((s, sIdx) => {
      const isLow = (zIdx === 0 && sIdx === 0) || (zIdx === 1 && sIdx === 2);
      const minT = s.code === 'TIMOTHY' ? 30 : 10;
      const qty = isLow ? (s.code === 'TIMOTHY' ? 18 : 4) : 55 + sIdx * 9;
      stockRows.push({
        id: id(`stock:${zId}:${s.id}`),
        zoneId: zId,
        supplyId: s.id,
        quantity: qty,
        minThreshold: minT,
        capacity: s.code === 'TIMOTHY' ? 300 : 180,
        lastInventoryDate: days(-1),
        lastAdjustedById: userIds.grooms[zIdx],
      });
    });
  });
  await tx.stockBalance.createMany({ data: stockRows, skipDuplicates: true });

  // NutritionPlans (all 5 NutritionPlanStatus + MealDto-compliant mealsJson)
  const makeMeals = (hayKg: number, grainKg: number, withElectrolyte: boolean) => [
    {
      mealType: 'MORNING',
      time: '05:30',
      items: [
        {
          supplyId: supplyIds.timothyHay,
          supplyCode: 'TIMOTHY',
          supplyName: 'Cỏ khô Timothy',
          category: 'FEED_HAY',
          amount: Number((hayKg * 0.4).toFixed(1)),
          unit: 'KG',
        },
        {
          supplyId: supplyIds.oatGrain,
          supplyCode: 'OATS',
          supplyName: 'Cám yến mạch',
          category: 'FEED_GRAIN',
          amount: Number((grainKg * 0.5).toFixed(1)),
          unit: 'KG',
        },
      ],
    },
    {
      mealType: 'NOON',
      time: '11:30',
      items: [
        {
          supplyId: supplyIds.timothyHay,
          supplyCode: 'TIMOTHY',
          supplyName: 'Cỏ khô Timothy',
          category: 'FEED_HAY',
          amount: Number((hayKg * 0.25).toFixed(1)),
          unit: 'KG',
        },
        ...(withElectrolyte
          ? [
              {
                supplyId: supplyIds.electrolyte,
                supplyCode: 'ELECTROLYTE',
                supplyName: 'Điện giải cho ngựa',
                category: 'SUPPLEMENT_ELECTROLYTE',
                amount: 1,
                unit: 'PACKET',
              },
            ]
          : []),
      ],
    },
    {
      mealType: 'EVENING',
      time: '18:00',
      items: [
        {
          supplyId: supplyIds.timothyHay,
          supplyCode: 'TIMOTHY',
          supplyName: 'Cỏ khô Timothy',
          category: 'FEED_HAY',
          amount: Number((hayKg * 0.35).toFixed(1)),
          unit: 'KG',
        },
        {
          supplyId: supplyIds.oatGrain,
          supplyCode: 'OATS',
          supplyName: 'Cám yến mạch',
          category: 'FEED_GRAIN',
          amount: Number((grainKg * 0.5).toFixed(1)),
          unit: 'KG',
        },
      ],
    },
  ];

  const nutritionPlans: Prisma.NutritionPlanCreateManyInput[] = [];
  HORSES.filter((h) => h.status !== HorseStatus.RETIRED).forEach((h, idx) => {
    const hayKg = h.status === HorseStatus.ISOLATED || h.status === HorseStatus.INJURED ? 6.5 : 8.5;
    const grainKg =
      h.status === HorseStatus.ISOLATED || h.status === HorseStatus.INJURED ? 1.5 : 3.2;
    nutritionPlans.push({
      id: id(`nutri:approved:${h.id}`),
      planCode: `NP-2026-${String(idx + 1).padStart(3, '0')}`,
      horseId: h.id,
      status: NutritionPlanStatus.APPROVED,
      dailyFeedWeightKg: Number((hayKg + grainKg).toFixed(1)),
      targetWeightRatioPct: Number((((hayKg + grainKg) / h.weightKg) * 100).toFixed(2)),
      horseWeightSnapshot: h.weightKg,
      hayFeedKg: hayKg,
      grainFeedKg: grainKg,
      mealsJson: makeMeals(
        hayKg,
        grainKg,
        h.status === HorseStatus.ACTIVE || h.status === HorseStatus.IN_TRAINING,
      ),
      supplementsJson: JSON.stringify([{ name: 'Vitamin E + Selenium', dosage: '1 gói/ngày' }]),
      specialInstructions: 'Ngâm nhẹ cỏ khô 5 phút trước bữa tối để giảm bụi hô hấp.',
      createdById: userIds.vet4,
      approvedById: userIds.vet,
      approvedAt: days(-25),
      validFrom: days(-25),
      validTo: days(35),
    });
  });
  // Add PENDING_APPROVAL, DRAFT, REJECTED, ARCHIVED samples
  nutritionPlans.push(
    {
      id: id('nutri:pending:h3'),
      planCode: 'NP-2026-101',
      horseId: horseIds[2],
      status: NutritionPlanStatus.PENDING_APPROVAL,
      dailyFeedWeightKg: 12.2,
      targetWeightRatioPct: 2.39,
      horseWeightSnapshot: 510,
      hayFeedKg: 8.7,
      grainFeedKg: 3.5,
      mealsJson: makeMeals(8.7, 3.5, true),
      specialInstructions: 'Tăng 0.3kg yến mạch chuẩn bị giai đoạn tăng tải sân cỏ.',
      createdById: userIds.trainer,
      validFrom: days(1),
      validTo: days(31),
    },
    {
      id: id('nutri:draft:h8'),
      planCode: 'NP-2026-102',
      horseId: horseIds[7],
      status: NutritionPlanStatus.DRAFT,
      dailyFeedWeightKg: 10.5,
      targetWeightRatioPct: 2.3,
      horseWeightSnapshot: 456,
      hayFeedKg: 7.5,
      grainFeedKg: 3.0,
      mealsJson: makeMeals(7.5, 3.0, false),
      createdById: userIds.vet4,
    },
    {
      id: id('nutri:rejected:h13'),
      planCode: 'NP-2026-103',
      horseId: horseIds[12],
      status: NutritionPlanStatus.REJECTED,
      dailyFeedWeightKg: 12.0,
      targetWeightRatioPct: 2.58,
      horseWeightSnapshot: 465,
      hayFeedKg: 7.0,
      grainFeedKg: 5.0,
      mealsJson: makeMeals(7.0, 5.0, false),
      createdById: userIds.trainer3,
      rejectionReason:
        'Tỉ lệ tinh bột cao vượt ngưỡng khuyến nghị khi ngựa đang rối loạn tiêu hóa.',
      vetNotes: 'Giữ tinh bột <= 2.0kg/ngày đến khi phân ổn định.',
    },
    {
      id: id('nutri:archived:h1'),
      planCode: 'NP-2026-104',
      horseId: horseIds[0],
      status: NutritionPlanStatus.ARCHIVED,
      dailyFeedWeightKg: 11.0,
      targetWeightRatioPct: 2.22,
      horseWeightSnapshot: 495,
      hayFeedKg: 8.0,
      grainFeedKg: 3.0,
      mealsJson: makeMeals(8.0, 3.0, true),
      createdById: userIds.vet4,
      approvedById: userIds.vet,
      approvedAt: days(-90),
      validFrom: days(-90),
      validTo: days(-26),
    },
  );
  await tx.nutritionPlan.createMany({ data: nutritionPlans, skipDuplicates: true });

  // Shifts: Morning, Afternoon, Night
  await tx.shiftCatalog.createMany({
    data: [
      {
        id: shiftIds.MORNING,
        code: 'MORNING',
        name: 'Ca Sáng (05:00 - 13:00)',
        startTime: '05:00',
        endTime: '13:00',
        isOvernight: false,
        sortOrder: 1,
        description: 'Cho ăn sáng, dọn chuồng, tắm chải và hỗ trợ tập buổi sáng',
      },
      {
        id: shiftIds.AFTERNOON,
        code: 'AFTERNOON',
        name: 'Ca Chiều (13:00 - 21:00)',
        startTime: '13:00',
        endTime: '21:00',
        isOvernight: false,
        sortOrder: 2,
        description: 'Dắt đi bộ, chườm lạnh, cho ăn bữa tối và kiểm tra chuồng',
      },
      {
        id: shiftIds.NIGHT,
        code: 'NIGHT',
        name: 'Ca Đêm (21:00 - 05:00)',
        startTime: '21:00',
        endTime: '05:00',
        isOvernight: true,
        sortOrder: 3,
        description: 'Trực đêm an toàn chuồng trại, theo dõi ngựa bệnh & cách ly',
      },
    ],
    skipDuplicates: true,
  });

  // ShiftRoster covering ALL 10 Active Grooms over a 7-day rolling window (-1..+5)
  const rosterAssignments: Array<[string, string, string]> = [
    [zoneIds.A, shiftIds.MORNING, userIds.grooms[0]],
    [zoneIds.A, shiftIds.MORNING, userIds.grooms[3]],
    [zoneIds.A, shiftIds.AFTERNOON, userIds.grooms[9]],
    [zoneIds.A, shiftIds.NIGHT, userIds.grooms[4]],
    [zoneIds.B, shiftIds.MORNING, userIds.grooms[1]],
    [zoneIds.B, shiftIds.AFTERNOON, userIds.grooms[5]],
    [zoneIds.B, shiftIds.NIGHT, userIds.grooms[6]],
    [zoneIds.C, shiftIds.MORNING, userIds.grooms[2]],
    [zoneIds.C, shiftIds.AFTERNOON, userIds.grooms[7]],
    [zoneIds.H, shiftIds.MORNING, userIds.grooms[8]],
  ];
  const rosters: Prisma.ShiftRosterCreateManyInput[] = [];
  for (let d = -1; d <= 5; d++) {
    const rDate = days(d, 0, 0);
    rosterAssignments.forEach(([zoneId, shiftId, groomUserId], idx) => {
      rosters.push({
        id: id(`roster:d${d}:${idx}`),
        date: rDate,
        shiftId,
        zoneId,
        groomUserId,
        createdById: userIds.manager,
      });
    });
  }
  await tx.shiftRoster.createMany({ data: rosters, skipDuplicates: true });

  // DailyCareTasks for today (d=0) excluding RETIRED horses (BR-STL-07)
  const activeHorses = HORSES.filter((h) => h.status !== HorseStatus.RETIRED);
  const scheduleHorses: ScheduleHorse[] = activeHorses.map((h) => {
    const zCode: 'A' | 'B' | 'C' | 'H' =
      h.stallId === stallIds.C[0] || h.stallId === stallIds.C[1]
        ? 'C'
        : h.stallId === stallIds.H[0]
          ? 'H'
          : stallIds.B.includes(h.stallId!)
            ? 'B'
            : 'A';
    const meds =
      h.id === horseIds[1]
        ? [
            {
              name: 'Thuốc chống viêm thú y',
              dosage: '1',
              unit: 'VIAL',
              route: 'Tiêm bắp',
              supplyId: supplyIds.antiInflam,
              frequencyPerDay: 2,
            },
          ]
        : h.id === horseIds[14]
          ? [
              {
                name: 'Thuốc chống viêm thú y',
                dosage: '1',
                unit: 'VIAL',
                route: 'Tiêm bắp',
                supplyId: supplyIds.antiInflam,
                frequencyPerDay: 2,
              },
            ]
          : undefined;
    const careInstructions =
      h.id === horseIds[1] || h.id === horseIds[15]
        ? [
            {
              activity: 'Chườm lạnh Ice-boot & băng ép vùng chấn thương',
              frequencyPerDay: 2,
              notes: 'Theo dõi độ sưng trước và sau chườm',
              phaseName: 'Điều trị cấp',
            },
          ]
        : undefined;
    return {
      id: h.id,
      zoneId: zoneIds[zCode],
      stallId: h.stallId!,
      stallCode: h.horseCode,
      allocationGroomId: h.groomId,
      isLocked: Boolean(h.isMedicalLocked),
      allowedActivityLevel:
        h.id === horseIds[14] || h.id === horseIds[15] ? 'Strict stall rest' : undefined,
      mealsJson: makeMeals(8, 3, true),
      medications: meds,
      careInstructions,
    };
  });

  const shiftMeta: Record<string, { startTime: string; endTime: string; isOvernight: boolean }> = {
    [shiftIds.MORNING]: { startTime: '05:00', endTime: '13:00', isOvernight: false },
    [shiftIds.AFTERNOON]: { startTime: '13:00', endTime: '21:00', isOvernight: false },
    [shiftIds.NIGHT]: { startTime: '21:00', endTime: '05:00', isOvernight: true },
  };
  const todayPlanned = planDailyTasks(
    scheduleHorses,
    rosterAssignments.map(([zoneId, shiftId, groomUserId]) => ({
      zoneId,
      shiftId,
      groomUserId,
      ...shiftMeta[shiftId],
    })),
  );
  const todayDate = days(0, 0, 0);
  const dailyTasks: Prisma.DailyCareTaskCreateManyInput[] = todayPlanned.map((t, idx) => {
    const done = t.scheduledTime < '09:00';
    return {
      id: id(`task:d0:${t.horseId}:${t.taskType}:${t.mealType ?? 'none'}:${t.scheduledTime}`),
      taskCode: `TSK-${yymm()}-${String(idx + 1).padStart(4, '0')}`,
      date: todayDate,
      horseId: t.horseId,
      stallZoneId: t.zoneId ?? null,
      stallId: t.stallId ?? null,
      taskType: t.taskType,
      title: t.title,
      description: t.description,
      mealType: t.mealType ?? null,
      scheduledTime: t.scheduledTime,
      shiftId: t.shiftId ?? null,
      nutritionPlanId: id(`nutri:approved:${t.horseId}`),
      isMedicalLocked: Boolean(activeHorses.find((h) => h.id === t.horseId)?.isMedicalLocked),
      itemsSnapshotJson: (t.itemsSnapshotJson as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      isCompleted: done,
      completedAt: done ? days(0, 8, 45) : null,
      completedById: done ? (t.assignedGroomUserId ?? userIds.grooms[0]) : null,
      assignedGroomUserId: t.assignedGroomUserId ?? userIds.grooms[0],
    };
  });
  // Explicit DailyTaskType.OTHER night temperature check to ensure all 7 DailyTaskTypes are covered
  dailyTasks.push({
    id: id('task:d0:other:h15-temp'),
    taskCode: `TSK-${yymm()}-9901`,
    date: todayDate,
    horseId: horseIds[14],
    stallZoneId: zoneIds.C,
    stallId: stallIds.C[0],
    taskType: DailyTaskType.OTHER,
    title: 'Đo thân nhiệt & kiểm tra chuồng cách ly ban đêm',
    description: 'Kiểm tra nhiệt độ trực tràng và lượng nước uống khu C.',
    scheduledTime: '21:30',
    shiftId: shiftIds.NIGHT,
    isMedicalLocked: true,
    isCompleted: false,
    assignedGroomUserId: userIds.grooms[4],
  });
  await tx.dailyCareTask.createMany({ data: dailyTasks, skipDuplicates: true });

  // DailyGroomingLog across MORNING / AFTERNOON / EVENING
  await tx.dailyGroomingLog.createMany({
    data: [
      {
        id: id('groomlog:h1-m'),
        horseId: horseIds[0],
        groomUserId: userIds.grooms[0],
        shiftDate: days(0, 6, 30),
        shiftType: ShiftType.MORNING,
        feedCompleted: true,
        cleaningCompleted: true,
        groomingCompleted: true,
        iceBootCompleted: false,
        healthObservations: 'Ăn hết sạch cỏ khô và ngũ cốc, tinh thần hưng phấn.',
      },
      {
        id: id('groomlog:h2-a'),
        horseId: horseIds[1],
        groomUserId: userIds.grooms[3],
        shiftDate: days(-1, 14, 0),
        shiftType: ShiftType.AFTERNOON,
        feedCompleted: true,
        cleaningCompleted: true,
        groomingCompleted: true,
        iceBootCompleted: true,
        healthObservations: 'Đã chườm đá chân phải 15 phút, vùng gân mát và đỡ sưng.',
      },
      {
        id: id('groomlog:h15-e'),
        horseId: horseIds[14],
        groomUserId: userIds.grooms[2],
        shiftDate: days(-1, 19, 0),
        shiftType: ShiftType.EVENING,
        feedCompleted: true,
        cleaningCompleted: true,
        groomingCompleted: false,
        iceBootCompleted: false,
        healthObservations: 'Thân nhiệt tối 38.6°C, uống nước tốt hơn hôm qua.',
      },
    ],
    skipDuplicates: true,
  });

  // RestockRequests covering all 5 RestockStatus
  await tx.restockRequest.createMany({
    data: [
      {
        id: id('restock:pending'),
        requestNumber: 'REQ-SUP-001',
        zoneId: zoneIds.A,
        supplyId: supplyIds.electrolyte,
        requestedQuantity: 60,
        status: RestockStatus.PENDING,
        urgencyReason: 'Tồn kho điện giải khu A sắp xuống dưới ngưỡng tối thiểu trước giải T11',
        requestedById: userIds.grooms[0],
      },
      {
        id: id('restock:approved'),
        requestNumber: 'REQ-SUP-002',
        zoneId: zoneIds.B,
        supplyId: supplyIds.timothyHay,
        requestedQuantity: 400,
        approvedQuantity: 400,
        status: RestockStatus.APPROVED,
        urgencyReason: 'Bổ sung định kỳ cỏ Timothy cho 7 ngựa khu B',
        requestedById: userIds.grooms[1],
        reviewedById: userIds.manager,
        reviewedAt: days(-2),
      },
      {
        id: id('restock:delivering'),
        requestNumber: 'REQ-SUP-003',
        zoneId: zoneIds.C,
        supplyId: supplyIds.antiInflam,
        requestedQuantity: 15,
        approvedQuantity: 15,
        status: RestockStatus.DELIVERING,
        urgencyReason: 'Bổ sung thuốc chống viêm thú y cho khu cách ly C01',
        requestedById: userIds.grooms[2],
        reviewedById: userIds.manager,
        reviewedAt: days(-3),
      },
      {
        id: id('restock:delivered'),
        requestNumber: 'REQ-SUP-004',
        zoneId: zoneIds.A,
        supplyId: supplyIds.oatGrain,
        requestedQuantity: 300,
        approvedQuantity: 300,
        status: RestockStatus.DELIVERED,
        urgencyReason: 'Nhập kho cám yến mạch đợt đầu tháng 11',
        requestedById: userIds.grooms[3],
        reviewedById: userIds.manager2,
        reviewedAt: days(-8),
        deliveredAt: days(-6),
        deliveredById: userIds.grooms[0],
      },
      {
        id: id('restock:rejected'),
        requestNumber: 'REQ-SUP-005',
        zoneId: zoneIds.H,
        supplyId: supplyIds.timothyHay,
        requestedQuantity: 100,
        status: RestockStatus.REJECTED,
        urgencyReason: 'Đề xuất nhập bổ sung cỏ khô Timothy cho khu H',
        rejectionReason: 'Kho tổng vẫn còn đủ dùng thêm 3 tuần, không cần nhập gấp.',
        requestedById: userIds.grooms[8],
        reviewedById: userIds.manager,
        reviewedAt: days(-4),
      },
    ],
    skipDuplicates: true,
  });

  // IncidentReports covering all 4 IncidentStatus
  await tx.incidentReport.createMany({
    data: [
      {
        id: id('inc:reported'),
        sourceEventId: 'evt-inc-001',
        incidentNumber: 'INC-2026-001',
        horseId: horseIds[6],
        stallZoneId: zoneIds.A,
        reportedById: userIds.grooms[4],
        severity: SeverityLevel.MODERATE,
        symptomsJson: ['Bỏ ăn sáng 30%', 'Uể oải nhẹ'],
        description: 'Hồng Kỳ ăn chậm vào ca sáng nay, cần bác sĩ kiểm tra răng và thân nhiệt.',
        status: IncidentStatus.REPORTED,
      },
      {
        id: id('inc:review'),
        sourceEventId: 'evt-inc-002',
        incidentNumber: 'INC-2026-002',
        horseId: horseIds[12],
        stallZoneId: zoneIds.B,
        reportedById: userIds.grooms[6],
        severity: SeverityLevel.MILD,
        symptomsJson: ['Phân lỏng nhẹ'],
        description: 'Ghi nhận phân lỏng sau buổi chiều đổi lô cỏ mới.',
        status: IncidentStatus.UNDER_REVIEW,
        reviewedById: userIds.vet3,
        reviewedAt: days(-2),
        vetNotes: 'Đã mở hồ sơ theo dõi MED-2026-008 & bổ sung men vi sinh.',
        medicalRecordId: id('medrec:open:h13'),
      },
      {
        id: id('inc:resolved'),
        sourceEventId: 'evt-inc-003',
        incidentNumber: 'INC-2026-003',
        horseId: horseIds[0],
        stallZoneId: zoneIds.A,
        reportedById: userIds.grooms[0],
        severity: SeverityLevel.MILD,
        symptomsJson: ['Trầy da nông'],
        description: 'Vết xước nhẹ do cọ vào thành cửa chuồng, đã vệ sinh sát khuẩn.',
        status: IncidentStatus.RESOLVED,
        reviewedById: userIds.vet,
        reviewedAt: days(-74),
        vetNotes: 'Vết thương đã lành hoàn toàn.',
        medicalRecordId: id('medrec:closed:h1'),
      },
      {
        id: id('inc:dismissed'),
        sourceEventId: 'evt-inc-004',
        incidentNumber: 'INC-2026-004',
        horseId: horseIds[4],
        stallZoneId: zoneIds.A,
        reportedById: userIds.grooms[9],
        severity: SeverityLevel.MILD,
        symptomsJson: ['Hắt hơi 2 lần'],
        description: 'Hắt hơi thoáng qua khi vừa rải rơm mới.',
        status: IncidentStatus.DISMISSED,
        reviewedById: userIds.vet2,
        reviewedAt: days(-9),
        vetNotes: 'Phản ứng bụi rơm bình thường, không có dấu hiệu bệnh lý.',
      },
    ],
    skipDuplicates: true,
  });
}

async function seedRacingAndInvoices(tx: Tx) {
  // 16 Tournaments covering all 5 TournamentStatus & all 3 TrackSurface (spans 2 pages @ 10/page)
  const tIds = {
    may: id('tour:2026-05'),
    junA: id('tour:2026-06a'),
    junB: id('tour:2026-06b'),
    july: id('tour:2026-07'),
    aug: id('tour:2026-08'),
    sep: id('tour:2026-09'),
    oct: id('tour:2026-10'),
    closedReg: id('tour:2026-11-closed'),
    closedRegB: id('tour:2026-11-closed-b'),
    openReg: id('tour:2026-11-open'),
    openRegB: id('tour:2026-11-open-b'),
    openRegC: id('tour:2026-11-open-c'),
    upcoming: id('tour:2026-12-upcoming'),
    upcomingB: id('tour:2026-12-b'),
    upcomingC: id('tour:2027-01'),
    cancelled: id('tour:2026-cancelled'),
  };

  await tx.tournament.createMany({
    data: [
      {
        id: tIds.may,
        code: 'CUP-2026-05',
        name: 'Giải Đua Mùa Xuân Phương Nam 2026',
        raceDate: days(-175, 15, 0),
        location: 'Trường đua Phú Thọ Mở Rộng',
        distanceMeters: 1400,
        trackType: TrackSurface.TURF,
        entryFee: 3000000,
        prizePool: 75000000,
        trackCondition: 'GOOD',
        maxFieldSize: 10,
        minAgeYears: 3,
        registrationDeadline: days(-182),
        status: TournamentStatus.COMPLETED,
      },
      {
        id: tIds.junA,
        code: 'CUP-2026-06A',
        name: 'Cúp Tốc Độ Thảo Nguyên Hè 2026',
        raceDate: days(-152, 16, 0),
        location: 'Trường đua Thiên Mã Đà Lạt',
        distanceMeters: 1200,
        trackType: TrackSurface.DIRT,
        entryFee: 3500000,
        prizePool: 90000000,
        trackCondition: 'FAST',
        maxFieldSize: 12,
        minAgeYears: 3,
        registrationDeadline: days(-159),
        status: TournamentStatus.COMPLETED,
      },
      {
        id: tIds.junB,
        code: 'CUP-2026-06B',
        name: 'Giải Vượt Chặng Miền Đông 2026',
        raceDate: days(-135, 15, 30),
        location: 'Trường đua Đại Nam Classic',
        distanceMeters: 2000,
        trackType: TrackSurface.SYNTHETIC,
        entryFee: 4000000,
        prizePool: 110000000,
        trackCondition: 'STANDARD',
        maxFieldSize: 12,
        minAgeYears: 3,
        registrationDeadline: days(-142),
        status: TournamentStatus.COMPLETED,
      },
      {
        id: tIds.july,
        code: 'CUP-2026-07',
        name: 'Giải Đua Mùa Hè Rực Lửa 2026',
        raceDate: days(-115, 15, 0),
        location: 'Trường đua Phú Thọ Mở Rộng',
        distanceMeters: 1600,
        trackType: TrackSurface.TURF,
        entryFee: 3000000,
        prizePool: 80000000,
        trackCondition: 'GOOD',
        maxFieldSize: 10,
        minAgeYears: 3,
        registrationDeadline: days(-122),
        status: TournamentStatus.COMPLETED,
      },
      {
        id: tIds.aug,
        code: 'CUP-2026-08',
        name: 'Cúp Quốc Gia 2026',
        raceDate: days(-85, 15, 30),
        location: 'Trường đua Thiên Mã Đà Lạt',
        distanceMeters: 1800,
        trackType: TrackSurface.DIRT,
        entryFee: 5000000,
        prizePool: 120000000,
        trackCondition: 'FAST',
        maxFieldSize: 12,
        minAgeYears: 3,
        registrationDeadline: days(-92),
        status: TournamentStatus.COMPLETED,
      },
      {
        id: tIds.sep,
        code: 'CUP-2026-09',
        name: 'Cúp Cự Ly Kinh Điển Mùa Thu',
        raceDate: days(-55, 16, 0),
        location: 'Trường đua Phú Thọ Mở Rộng',
        distanceMeters: 2000,
        trackType: TrackSurface.TURF,
        entryFee: 4000000,
        prizePool: 100000000,
        trackCondition: 'FIRM',
        maxFieldSize: 10,
        minAgeYears: 3,
        registrationDeadline: days(-62),
        status: TournamentStatus.COMPLETED,
      },
      {
        id: tIds.oct,
        code: 'CUP-2026-10',
        name: 'Giải Vô Địch Mùa Thu 2026',
        raceDate: days(-22, 15, 0),
        location: 'Trường đua Đại Nam Classic',
        distanceMeters: 1600,
        trackType: TrackSurface.SYNTHETIC,
        entryFee: 5000000,
        prizePool: 150000000,
        trackCondition: 'STANDARD',
        maxFieldSize: 12,
        minAgeYears: 3,
        registrationDeadline: days(-29),
        status: TournamentStatus.COMPLETED,
      },
      {
        id: tIds.closedReg,
        code: 'CUP-2026-11A',
        name: 'Giải Nước Rút Chốt Danh Sách T11',
        raceDate: days(2, 15, 0),
        location: 'Trường đua Đại Nam Classic',
        distanceMeters: 1200,
        trackType: TrackSurface.DIRT,
        entryFee: 3500000,
        prizePool: 70000000,
        trackCondition: 'FAST',
        maxFieldSize: 8,
        minAgeYears: 3,
        registrationDeadline: days(-1),
        status: TournamentStatus.CLOSED_REGISTRATION,
      },
      {
        id: tIds.closedRegB,
        code: 'CUP-2026-11C',
        name: 'Giải Bán Kết Cỏ Xanh T11',
        raceDate: days(4, 15, 30),
        location: 'Trường đua Phú Thọ Mở Rộng',
        distanceMeters: 1800,
        trackType: TrackSurface.TURF,
        entryFee: 4000000,
        prizePool: 115000000,
        trackCondition: 'GOOD',
        maxFieldSize: 10,
        minAgeYears: 3,
        registrationDeadline: days(-1),
        status: TournamentStatus.CLOSED_REGISTRATION,
      },
      {
        id: tIds.openReg,
        code: 'CUP-2026-11B',
        name: 'Cúp Mùa Đông EquiFlow 2026',
        raceDate: days(12, 15, 30),
        location: 'Trường đua Thiên Mã Đà Lạt',
        distanceMeters: 1600,
        trackType: TrackSurface.TURF,
        entryFee: 5000000,
        prizePool: 180000000,
        trackCondition: 'GOOD',
        maxFieldSize: 12,
        minAgeYears: 3,
        registrationDeadline: days(8),
        status: TournamentStatus.OPEN_REGISTRATION,
      },
      {
        id: tIds.openRegB,
        code: 'CUP-2026-11D',
        name: 'Giải Tốc Độ Sân Đất Miền Trung',
        raceDate: days(16, 15, 0),
        location: 'Trường đua Đại Nam Classic',
        distanceMeters: 1200,
        trackType: TrackSurface.DIRT,
        entryFee: 3000000,
        prizePool: 95000000,
        trackCondition: 'FAST',
        maxFieldSize: 10,
        minAgeYears: 3,
        registrationDeadline: days(11),
        status: TournamentStatus.OPEN_REGISTRATION,
      },
      {
        id: tIds.openRegC,
        code: 'CUP-2026-11E',
        name: 'Giải Bền Bỉ Cự Ly Trung Bình T11',
        raceDate: days(21, 16, 0),
        location: 'Trường đua Bình Dương',
        distanceMeters: 2000,
        trackType: TrackSurface.SYNTHETIC,
        entryFee: 4500000,
        prizePool: 135000000,
        trackCondition: 'STANDARD',
        maxFieldSize: 12,
        minAgeYears: 4,
        registrationDeadline: days(16),
        status: TournamentStatus.OPEN_REGISTRATION,
      },
      {
        id: tIds.upcoming,
        code: 'CUP-2026-12',
        name: 'Cúp Tân Niên Chung Kết Năm 2026',
        raceDate: days(35, 16, 0),
        location: 'Trường đua Phú Thọ Mở Rộng',
        distanceMeters: 2200,
        trackType: TrackSurface.TURF,
        entryFee: 6000000,
        prizePool: 250000000,
        trackCondition: 'GOOD',
        maxFieldSize: 12,
        minAgeYears: 3,
        registrationDeadline: days(25),
        status: TournamentStatus.UPCOMING,
      },
      {
        id: tIds.upcomingB,
        code: 'CUP-2026-12B',
        name: 'Giải Vô Địch Đêm Ánh Sáng T12',
        raceDate: days(44, 18, 0),
        location: 'Trường đua Đại Nam Classic',
        distanceMeters: 1600,
        trackType: TrackSurface.SYNTHETIC,
        entryFee: 5000000,
        prizePool: 160000000,
        trackCondition: 'STANDARD',
        maxFieldSize: 12,
        minAgeYears: 3,
        registrationDeadline: days(34),
        status: TournamentStatus.UPCOMING,
      },
      {
        id: tIds.upcomingC,
        code: 'CUP-2027-01',
        name: 'Cúp Khai Xuân Vạn Lý 2027',
        raceDate: days(58, 15, 0),
        location: 'Trường đua Thiên Mã Đà Lạt',
        distanceMeters: 2400,
        trackType: TrackSurface.TURF,
        entryFee: 7000000,
        prizePool: 300000000,
        trackCondition: 'GOOD',
        maxFieldSize: 14,
        minAgeYears: 4,
        registrationDeadline: days(48),
        status: TournamentStatus.UPCOMING,
      },
      {
        id: tIds.cancelled,
        code: 'CUP-2026-09X',
        name: 'Giải Giao Hữu Sân Cỏ Phía Nam (Đã hoãn)',
        raceDate: days(-40, 15, 0),
        location: 'Trường đua Bình Dương',
        distanceMeters: 1400,
        trackType: TrackSurface.TURF,
        entryFee: 2000000,
        prizePool: 40000000,
        maxFieldSize: 8,
        minAgeYears: 3,
        registrationDeadline: days(-47),
        status: TournamentStatus.CANCELLED,
      },
    ],
    skipDuplicates: true,
  });

  // Registrations & 85/10/5 Results
  const reg = (
    tId: string,
    hIdx: number,
    status: RegistrationStatus,
    fee: number,
    off: number,
  ) => ({
    id: id(`treg:${tId}:${horseIds[hIdx]}`),
    tournamentId: tId,
    horseId: horseIds[hIdx],
    registeredByTrainerId: userIds.trainer,
    status,
    entryFeeBilled: fee,
    registrationDate: days(off),
  });

  const registrations: Prisma.TournamentRegistrationCreateManyInput[] = [
    // T5 Completed
    reg(tIds.may, 0, RegistrationStatus.CONFIRMED, 3000000, -183),
    reg(tIds.may, 2, RegistrationStatus.CONFIRMED, 3000000, -183),
    reg(tIds.may, 4, RegistrationStatus.CONFIRMED, 3000000, -183),
    // T6A Completed
    reg(tIds.junA, 3, RegistrationStatus.CONFIRMED, 3500000, -160),
    reg(tIds.junA, 5, RegistrationStatus.CONFIRMED, 3500000, -160),
    reg(tIds.junA, 6, RegistrationStatus.CONFIRMED, 3500000, -160),
    // T6B Completed
    reg(tIds.junB, 0, RegistrationStatus.CONFIRMED, 4000000, -143),
    reg(tIds.junB, 4, RegistrationStatus.CONFIRMED, 4000000, -143),
    reg(tIds.junB, 9, RegistrationStatus.CONFIRMED, 4000000, -143),
    // T7
    reg(tIds.july, 0, RegistrationStatus.CONFIRMED, 3000000, -125),
    reg(tIds.july, 4, RegistrationStatus.CONFIRMED, 3000000, -125),
    reg(tIds.july, 5, RegistrationStatus.CONFIRMED, 3000000, -125),
    // T8
    reg(tIds.aug, 4, RegistrationStatus.CONFIRMED, 5000000, -95),
    reg(tIds.aug, 0, RegistrationStatus.CONFIRMED, 5000000, -95),
    reg(tIds.aug, 6, RegistrationStatus.CONFIRMED, 5000000, -95),
    reg(tIds.aug, 16, RegistrationStatus.DISQUALIFIED, 5000000, -95),
    // T9
    reg(tIds.sep, 5, RegistrationStatus.CONFIRMED, 4000000, -65),
    reg(tIds.sep, 2, RegistrationStatus.CONFIRMED, 4000000, -65),
    reg(tIds.sep, 9, RegistrationStatus.CONFIRMED, 4000000, -65),
    // T10
    reg(tIds.oct, 0, RegistrationStatus.CONFIRMED, 5000000, -32),
    reg(tIds.oct, 2, RegistrationStatus.CONFIRMED, 5000000, -32),
    reg(tIds.oct, 3, RegistrationStatus.CONFIRMED, 5000000, -32),
    reg(tIds.oct, 1, RegistrationStatus.SCRATCHED_MEDICAL, 5000000, -32),
    // T11 Closed A & B
    reg(tIds.closedReg, 4, RegistrationStatus.CONFIRMED, 3500000, -3),
    reg(tIds.closedReg, 6, RegistrationStatus.CONFIRMED, 3500000, -3),
    reg(tIds.closedReg, 11, RegistrationStatus.CONFIRMED, 3500000, -3),
    reg(tIds.closedRegB, 0, RegistrationStatus.CONFIRMED, 4000000, -2),
    reg(tIds.closedRegB, 2, RegistrationStatus.CONFIRMED, 4000000, -2),
    reg(tIds.closedRegB, 5, RegistrationStatus.CONFIRMED, 4000000, -2),
    reg(tIds.closedRegB, 9, RegistrationStatus.CONFIRMED, 4000000, -2),
    // T11 Open B, D, E
    reg(tIds.openReg, 0, RegistrationStatus.REGISTERED, 5000000, -1),
    reg(tIds.openReg, 3, RegistrationStatus.REGISTERED, 5000000, -1),
    reg(tIds.openReg, 5, RegistrationStatus.REGISTERED, 5000000, 0),
    reg(tIds.openRegB, 2, RegistrationStatus.REGISTERED, 3000000, -1),
    reg(tIds.openRegB, 4, RegistrationStatus.REGISTERED, 3000000, -1),
    reg(tIds.openRegB, 6, RegistrationStatus.REGISTERED, 3000000, 0),
    reg(tIds.openRegC, 9, RegistrationStatus.REGISTERED, 4500000, 0),
    reg(tIds.openRegC, 11, RegistrationStatus.REGISTERED, 4500000, 0),
  ];
  await tx.tournamentRegistration.createMany({ data: registrations, skipDuplicates: true });

  const makeResult = (
    tId: string,
    hIdx: number,
    rank: number,
    timeSec: number,
    speed: number,
    gross: number,
    entryFee: number,
    settledAt: Date,
  ): Prisma.TournamentResultCreateManyInput => {
    const trainerCut = Math.round(gross * 0.1);
    const jockeyCut = Math.round(gross * 0.05);
    const netOwnerPayout = Math.max(0, gross - trainerCut - jockeyCut - entryFee);
    return {
      id: id(`tres:${tId}:${horseIds[hIdx]}`),
      registrationId: id(`treg:${tId}:${horseIds[hIdx]}`),
      finalRank: rank,
      finishTimeSeconds: timeSec,
      avgSpeedKmh: speed,
      prizeMoneyWon: gross,
      grossPrize: gross,
      trainerCut,
      jockeyCut,
      entryFeeDeducted: entryFee,
      netOwnerPayout,
      settledAt,
      officialNotes: `Xếp hạng ${rank} chính thức từ ban trọng tài`,
    };
  };

  await tx.tournamentResult.createMany({
    data: [
      makeResult(tIds.may, 0, 1, 82.6, 61.0, 40000000, 3000000, days(-174)),
      makeResult(tIds.may, 2, 2, 83.4, 60.4, 25000000, 3000000, days(-174)),
      makeResult(tIds.may, 4, 3, 84.5, 59.6, 10000000, 3000000, days(-174)),
      makeResult(tIds.junA, 5, 1, 70.8, 61.0, 50000000, 3500000, days(-151)),
      makeResult(tIds.junA, 3, 2, 71.5, 60.4, 25000000, 3500000, days(-151)),
      makeResult(tIds.junA, 6, 3, 72.3, 59.8, 15000000, 3500000, days(-151)),
      makeResult(tIds.junB, 4, 1, 118.2, 60.9, 60000000, 4000000, days(-134)),
      makeResult(tIds.junB, 0, 2, 119.1, 60.4, 30000000, 4000000, days(-134)),
      makeResult(tIds.junB, 9, 3, 120.4, 59.8, 20000000, 4000000, days(-134)),
      makeResult(tIds.july, 0, 1, 93.4, 61.7, 50000000, 3000000, days(-114)),
      makeResult(tIds.july, 4, 2, 94.2, 61.1, 20000000, 3000000, days(-114)),
      makeResult(tIds.july, 5, 3, 95.1, 60.5, 10000000, 3000000, days(-114)),
      makeResult(tIds.aug, 4, 1, 105.6, 61.4, 70000000, 5000000, days(-84)),
      makeResult(tIds.aug, 0, 2, 106.2, 61.0, 35000000, 5000000, days(-84)),
      makeResult(tIds.aug, 6, 3, 107.8, 60.1, 15000000, 5000000, days(-84)),
      makeResult(tIds.sep, 5, 1, 118.4, 60.8, 60000000, 4000000, days(-54)),
      makeResult(tIds.sep, 2, 2, 119.5, 60.2, 25000000, 4000000, days(-54)),
      makeResult(tIds.sep, 9, 3, 120.7, 59.6, 15000000, 4000000, days(-54)),
      makeResult(tIds.oct, 0, 1, 91.9, 62.7, 90000000, 5000000, days(-21)),
      makeResult(tIds.oct, 2, 2, 93.0, 61.9, 40000000, 5000000, days(-21)),
      makeResult(tIds.oct, 3, 3, 94.1, 61.2, 20000000, 5000000, days(-21)),
    ],
    skipDuplicates: true,
  });

  // 6-Month Financial Invoices (2026-07 .. 2026-12), using calculateBoardingFee + covering all 5 InvoiceStatus
  const stayStart = new Date('2026-06-01T00:00:00+07:00');
  const periods = ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'];
  const invoices: Prisma.FinancialInvoiceCreateManyInput[] = [];

  for (const period of periods) {
    // Include active showcase horses across owners
    const billedHorseIndices = [0, 1, 2, 3, 4, 5, 6, 9, 14, 15, 16];
    for (const hIdx of billedHorseIndices) {
      const h = HORSES[hIdx];
      const allocs =
        hIdx === 16
          ? [
              { startDate: stayStart, endDate: days(-20) },
              { startDate: days(-20), endDate: null },
            ]
          : [{ startDate: stayStart, endDate: null }];
      const { boardingDays, boardingFee } = calculateBoardingFee(period, allocs);

      let status: InvoiceStatus = InvoiceStatus.PAID;
      let medicalFee = 0;
      let trainingFee =
        h.status === HorseStatus.INJURED || h.status === HorseStatus.ISOLATED ? 0 : 2500000;
      let prizeCredit = 0;

      if (period === '2026-07' && hIdx === 0) prizeCredit = 39500000;
      if (period === '2026-08' && hIdx === 4) prizeCredit = 54500000;
      if (period === '2026-09' && hIdx === 5) prizeCredit = 47000000;
      if (period === '2026-10' && hIdx === 0) prizeCredit = 71500000;

      if (hIdx === 1 && (period === '2026-09' || period === '2026-10')) {
        status = InvoiceStatus.OVERDUE;
        medicalFee = 3500000;
      } else if (
        hIdx === 16 &&
        (period === '2026-08' || period === '2026-09' || period === '2026-10')
      ) {
        status = InvoiceStatus.OVERDUE;
        medicalFee = 1500000;
      } else if (period === '2026-11') {
        status = hIdx % 2 === 0 ? InvoiceStatus.SENT : InvoiceStatus.PAID;
      } else if (period === '2026-12') {
        status = hIdx === 15 ? InvoiceStatus.CANCELLED : InvoiceStatus.DRAFT;
        trainingFee = status === InvoiceStatus.CANCELLED ? 0 : trainingFee;
      }

      const netAmount = boardingFee.toNumber() + medicalFee + trainingFee - prizeCredit;
      invoices.push({
        id: id(`inv:${period}:${h.id}`),
        horseId: h.id,
        ownerId: h.ownerId,
        billingPeriod: period,
        boardingFee,
        boardingDays,
        boardingMonthlyRate: BOARDING_MONTHLY_RATE,
        dueAt: new Date(`${period}-28T17:00:00+07:00`),
        medicalFee,
        trainingFee,
        prizeCredit,
        netAmount,
        status,
      });
    }
  }
  await tx.financialInvoice.createMany({ data: invoices, skipDuplicates: true });
}

async function seedActivityAndSupport(tx: Tx) {
  // Notifications covering all 7 NotificationCategory values
  await tx.notification.createMany({
    data: [
      {
        id: id('notif:account'),
        userId: userIds.manager,
        type: 'ACCOUNT_PENDING',
        category: NotificationCategory.ACCOUNT,
        title: 'Hồ sơ tài khoản mới chờ duyệt',
        message: 'Trương Quốc Khánh (GROOM) vừa xác thực email và đang chờ duyệt.',
        link: '/accounts?highlight=REQ-GROOM-001',
        params: { requestCode: 'REQ-GROOM-001' },
        dedupeKey: `notif:account:${yymm()}`,
      },
      {
        id: id('notif:horse'),
        userId: userIds.owners[0],
        type: 'HORSE_STATUS_UPDATE',
        category: NotificationCategory.HORSE,
        title: 'Cập nhật lịch đua Bạch Long Mã',
        message: 'Bạch Long Mã đã được đăng ký tham gia Cúp Mùa Đông EquiFlow 2026.',
        link: '/horses?highlight=HR-000001',
        params: { horseCode: 'HR-000001' },
        dedupeKey: 'notif:horse:h1-cup',
        readAt: days(-1),
      },
      {
        id: id('notif:training'),
        userId: userIds.vet,
        type: 'ABNORMAL_WORKOUT_SIGN',
        category: NotificationCategory.TRAINING,
        title: 'Cảnh báo nhịp tim hồi phục Hồng Kỳ',
        message: 'Hồng Kỳ ghi nhận nhịp tim 10 phút sau tập ở mức 132 bpm.',
        link: '/training/overview?highlight=HR-000007',
        params: { horseCode: 'HR-000007' },
        dedupeKey: 'notif:training:h7-hr',
      },
      {
        id: id('notif:lock'),
        userId: userIds.trainer,
        type: 'MEDICAL_LOCK_BLOCKED_SESSION',
        category: NotificationCategory.LOCK,
        title: 'Buổi tập tốc độ Xích Thố bị tự động chặn',
        message: 'Buổi BREEZE bị chặn do chiến mã đang áp dụng Khóa Y Tế MLK-2026-002.',
        link: '/locks?highlight=MLK-2026-002',
        params: { lockCode: 'MLK-2026-002' },
        dedupeKey: 'notif:lock:h2-breeze',
      },
      {
        id: id('notif:medical'),
        userId: userIds.vet2,
        type: 'PREVENTIVE_OVERDUE',
        category: NotificationCategory.MEDICAL,
        title: 'Nhắc lịch gọt móng định kỳ quá hạn',
        message: 'Chiến mã Bạch Long Mã cần được kiểm tra gọt móng trong tuần này.',
        link: '/vaccine?highlight=HR-000001',
        params: { horseCode: 'HR-000001' },
        dedupeKey: 'notif:medical:farrier-due',
      },
      {
        id: id('notif:nutrition'),
        userId: userIds.vet,
        type: 'NUTRITION_PENDING',
        category: NotificationCategory.NUTRITION,
        title: 'Thực đơn mới chờ bác sĩ phê duyệt',
        message: 'Thực đơn NP-2026-101 cho Kim Long đang chờ duyệt.',
        link: '/rations?highlight=NP-2026-101',
        params: { planCode: 'NP-2026-101' },
        dedupeKey: 'notif:nutrition:np-101',
      },
      {
        id: id('notif:system'),
        userId: userIds.owners[3],
        type: 'INVOICE_OVERDUE',
        category: NotificationCategory.SYSTEM,
        title: 'Thông báo hóa đơn lưu chuồng quá hạn',
        message: 'Tài khoản có hóa đơn quá hạn cho Dạ Nguyệt từ kỳ 2026-08 – 2026-10.',
        link: '/billing?highlight=INV-2026-004',
        params: { invoiceNumber: 'INV-2026-004' },
        dedupeKey: 'notif:system:debt-owner4',
      },
    ],
    skipDuplicates: true,
  });

  // AuditLogs
  await tx.auditLog.createMany({
    data: [
      {
        id: id('audit:1'),
        userId: userIds.vet,
        action: 'MEDICAL_LOCK_APPLIED',
        entityName: 'Horse',
        entityId: horseIds[1],
        newValuesJson: JSON.stringify({ lockCode: 'MLK-2026-002', status: 'UNDER_OBSERVATION' }),
        timestamp: days(-10, 9, 15),
      },
      {
        id: id('audit:2'),
        userId: userIds.manager,
        action: 'DEBT_IMPOUND_APPLIED',
        entityName: 'Horse',
        entityId: horseIds[16],
        newValuesJson: JSON.stringify({
          stall: 'STALL-H01',
          billingPeriods: ['2026-08', '2026-09', '2026-10'],
        }),
        timestamp: days(-20, 14, 0),
      },
      {
        id: id('audit:3'),
        userId: userIds.manager,
        action: 'HORSE_RETIRED_STALL_RELEASED',
        entityName: 'StallAllocation',
        entityId: horseIds[17],
        newValuesJson: JSON.stringify({ horseName: 'Lão Tướng', releasedStall: 'STALL-B08' }),
        timestamp: days(-18, 10, 0),
      },
      {
        id: id('audit:4'),
        userId: userIds.trainer,
        action: 'TOURNAMENT_SETTLED',
        entityName: 'Tournament',
        entityId: id('tour:2026-10'),
        newValuesJson: JSON.stringify({
          code: 'CUP-2026-10',
          winner: 'Bạch Long Mã',
          grossPrize: 90000000,
        }),
        timestamp: days(-21, 17, 0),
      },
    ],
    skipDuplicates: true,
  });

  // Keep Counter service sequences ahead of seeded codes so live creates never collide
  const counterTargets: Array<[string, number]> = [
    ['horse_code', 30],
    ['training_plan', 30],
    ['request_code', 20],
    ['forbidden_ref', 10],
  ];
  for (const [name, minValue] of counterTargets) {
    const existing = await tx.counter.findUnique({ where: { name } });
    if (!existing) {
      await tx.counter.create({ data: { name, value: minValue } });
    } else if (existing.value < minValue) {
      await tx.counter.update({ where: { name }, data: { value: minValue } });
    }
  }
}

async function main() {
  const prisma = new PrismaClient({ datasourceUrl: resolveDatabaseUrl() });
  try {
    const password = await bcrypt.hash('EquiFlow@2026', 10);
    await prisma.$transaction(
      async (tx) => {
        if (RESET_FLAG) {
          console.log('[seed] --reset flag detected: clearing existing fixture data...');
          await clearFixtures(tx);
        }
        await seedClub(tx, password);
        await seedMedical(tx);
        await seedTraining(tx);
        await seedStableCare(tx);
        await seedRacingAndInvoices(tx);
        await seedActivityAndSupport(tx);
      },
      { timeout: 60000 },
    );

    const modelCount = Prisma.dmmf.datamodel.models.length;
    console.log(
      `[seed] Canonical EquiFlow seed completed (${RESET_FLAG ? 'reset+seed' : 'idempotent'}) across all ${modelCount} Prisma models.`,
    );
    console.log(
      `[seed] Period covered: ${monthOf(days(-150))}..2026-12 | 19 horses, 32 stalls, 10 active grooms, 4 vets, 4 trainers, 2 managers, 6 owners.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
