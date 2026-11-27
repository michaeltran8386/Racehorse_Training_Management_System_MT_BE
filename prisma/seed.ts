import {
  AdmissionStatus,
  CareCostEntryType,
  ComplaintStatus,
  HandoverStatus,
  HorseTransferStatus,
  InvoiceBillingMethod,
  MailingStatus,
  TrainerAssignmentStatus,
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
import { invoiceUsageSnapshot } from '../src/financial/invoice-line-items.service';
import { yymm } from '../src/common/utils/input';
import { planDailyTasks, ScheduleHorse } from '../src/daily-tasks/daily-schedule';
import {
  BOARDING_MONTHLY_RATE,
  boardingMonth,
  calculateBoardingFee,
} from '../src/financial/boarding-fee';
import {
  MEDICAL_MONTHLY_PACKAGE_FEE,
  TRAINING_MONTHLY_RATE,
} from '../src/financial/financial.service';
import { calculatePrizeSplit } from '../src/tournaments/tournaments.service';
import {
  clubDate,
  clubTime,
  effectiveIntensity,
  effectiveSurface,
  GROOM_BUFFER_MINUTES,
  workoutDurationMinutes,
} from '../src/training/training-rules';

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
const BUSINESS_START = new Date('2025-12-01T00:00:00+07:00');
const BILLING_CUTOVER = '2026-09';
const LAST_INVOICE_PERIOD = '2026-10';
const DAY_MS = 24 * 60 * 60 * 1000;
const days = (offsetDays: number, hour = 0, minute = 0): Date => {
  const base = clubDate(new Date(now.getTime() + offsetDays * DAY_MS));
  const localHour = String(hour).padStart(2, '0');
  const localMin = String(minute).padStart(2, '0');
  return new Date(`${base}T${localHour}:${localMin}:00+07:00`);
};
const dateStrOffset = (offsetDays: number) =>
  clubDate(new Date(now.getTime() + offsetDays * DAY_MS));
const monthOf = (d: Date) => clubDate(d).slice(0, 7);
const pastIso = (offsetDays: number) => dateStrOffset(offsetDays);

const horseIds = Array.from({ length: 19 }, (_, idx) => id(`horse:${idx + 1}`));
const DEFAULT_STALLS_PER_ZONE = 12;
const stallIds = {
  A: Array.from({ length: DEFAULT_STALLS_PER_ZONE }, (_, i) =>
    id(`stall:A${String(i + 1).padStart(2, '0')}`),
  ),
  B: Array.from({ length: DEFAULT_STALLS_PER_ZONE }, (_, i) =>
    id(`stall:B${String(i + 1).padStart(2, '0')}`),
  ),
  C: Array.from({ length: DEFAULT_STALLS_PER_ZONE }, (_, i) =>
    id(`stall:C${String(i + 1).padStart(2, '0')}`),
  ),
  H: Array.from({ length: DEFAULT_STALLS_PER_ZONE }, (_, i) =>
    id(`stall:H${String(i + 1).padStart(2, '0')}`),
  ),
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
  await tx.careCostClaim.deleteMany();
  await tx.invoiceLineItem.deleteMany();
  await tx.careCostEntry.deleteMany({ where: { entryType: CareCostEntryType.REVERSAL } });
  await tx.careCostEntry.deleteMany();
  await tx.careBillingPolicy.deleteMany();
  await tx.businessMailing.deleteMany();
  await tx.complaint.deleteMany();
  await tx.staffWorkItem.deleteMany();
  await tx.admissionHealthReview.deleteMany();
  await tx.admissionHistoryLog.deleteMany();
  await tx.horseAdmissionRecord.deleteMany();
  await tx.horseHandoverRequest.deleteMany();
  await tx.horseTransferRequest.deleteMany();
  await tx.trainerReview.deleteMany();
  await tx.medicalLock.deleteMany();
  await tx.incidentReport.updateMany({ data: { parentIncidentId: null } });
  await tx.auditLog.deleteMany();
  await tx.notification.deleteMany();
  await tx.financialInvoice.deleteMany();
  await tx.tournamentResult.deleteMany();
  await tx.tournamentRegistration.deleteMany();
  await tx.tournament.deleteMany();
  await tx.simulatorSession.deleteMany();
  await tx.workoutSession.deleteMany();
  await tx.trainingTrack.deleteMany();
  await tx.trainingPlan.deleteMany();
  await tx.incidentReport.updateMany({
    where: { parentIncidentId: { not: null } },
    data: { parentIncidentId: null },
  });
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
  avatarUrl: string;
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
    avatarUrl: '/images/horses/horse-01.jpg',
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
    avatarUrl: '/images/horses/horse-02.jpg',
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
    avatarUrl: '/images/horses/horse-03.jpg',
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
    avatarUrl: '/images/horses/horse-04.jpg',
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
    avatarUrl: '/images/horses/horse-05.jpg',
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
    avatarUrl: '/images/horses/horse-06.jpg',
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
    avatarUrl: '/images/horses/horse-07.jpg',
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
    avatarUrl: '/images/horses/horse-08.jpg',
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
    avatarUrl: '/images/horses/horse-09.jpg',
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
    avatarUrl: '/images/horses/horse-10.jpg',
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
    avatarUrl: '/images/horses/horse-11.jpg',
    name: 'Ngàn Hoa',
    microchip: '985000000000011',
    breed: 'Paint',
    dob: new Date('2023-01-17T00:00:00Z'),
    gender: 'Mare',
    color: 'Palomino',
    weightKg: 440,
    status: HorseStatus.ACTIVE,
    ownerId: userIds.owners[3],
    stallId: stallIds.B[3],
    groomId: userIds.grooms[5],
  },
  {
    id: horseIds[11],
    horseCode: 'HR-000012',
    avatarUrl: '/images/horses/horse-12.jpg',
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
    avatarUrl: '/images/horses/horse-13.jpg',
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
    avatarUrl: '/images/horses/horse-14.jpg',
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
    groomId: userIds.grooms[1],
  },
  {
    id: horseIds[14],
    horseCode: 'HR-000015',
    avatarUrl: '/images/horses/horse-15.jpg',
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
    avatarUrl: '/images/horses/horse-16.jpg',
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
    avatarUrl: '/images/horses/horse-17.jpg',
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
    debtImpoundReason: 'Overdue stabling and treatment fees (Aug-Oct 2026).',
  },
  {
    id: horseIds[17],
    horseCode: 'HR-000018',
    avatarUrl: '/images/horses/horse-18.jpg',
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
    avatarUrl: '/images/horses/horse-19.jpg',
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
  const createdBase = BUSINESS_START;

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
      createdAt: createdBase,
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
      createdAt: createdBase,
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
      createdAt: createdBase,
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
      createdAt: createdBase,
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
        expiresAt: days(-1),
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
        expiresAt: days(-1),
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
        expiresAt: days(-1),
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
        revoked: true,
        expiresAt: days(-1),
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

  // Four default zones with 12 physical stalls each.
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
        rows: 3,
        cols: 4,
        description: 'Khu điều trị y tế chuyên sâu & cách ly kiểm dịch',
        sortOrder: 3,
        isActive: true,
      },
      {
        id: zoneIds.H,
        code: 'H',
        name: 'Khu Lưu Giữ Nợ Phí',
        rows: 3,
        cols: 4,
        description: 'Khu lưu giữ tạm thời ngựa có hóa đơn quá hạn nhiều kỳ',
        sortOrder: 4,
        isActive: true,
      },
    ],
    skipDuplicates: true,
  });

  // Expand older default C/H layouts without moving existing stalls or allocations.
  await tx.stallZone.updateMany({
    where: { id: { in: [zoneIds.C, zoneIds.H] }, rows: 2, cols: 2 },
    data: { rows: 3, cols: 4 },
  });

  const occupiedStallSet = new Set(HORSES.map((h) => h.stallId).filter(Boolean) as string[]);
  const makeZoneStalls = (
    zoneCode: 'A' | 'B' | 'C' | 'H',
    zoneId: string,
    rows: number,
    cols: number,
    preserveOriginalGrid = false,
  ): Prisma.StallCreateManyInput[] => {
    const out: Prisma.StallCreateManyInput[] = [];
    const positions = Array.from({ length: rows * cols }, (_, idx) => idx);
    if (preserveOriginalGrid) {
      const original = [0, 1, cols, cols + 1];
      positions.splice(
        0,
        positions.length,
        ...original,
        ...positions.filter((i) => !original.includes(i)),
      );
    }
    for (const [idx, position] of positions.entries()) {
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
        row: Math.floor(position / cols) + 1,
        col: (position % cols) + 1,
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
      ...makeZoneStalls('C', zoneIds.C, 3, 4, true),
      ...makeZoneStalls('H', zoneIds.H, 3, 4, true),
    ],
    skipDuplicates: true,
  });

  // 19 Horses
  await tx.horse.createMany({
    data: HORSES.map((h) => ({
      id: h.id,
      horseCode: h.horseCode,
      avatarUrl: h.avatarUrl,
      name: h.name,
      microchip: h.microchip,
      microchipRfid: h.microchip,
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
  const stayStart = BUSINESS_START;
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

function trainerFor(horseIndex: number): string {
  return horseIndex < 4
    ? userIds.trainer
    : horseIndex < 7
      ? userIds.trainer2
      : horseIndex < 9
        ? userIds.trainer3
        : userIds.trainer4;
}

function zoneFor(h: HorseSpec): string {
  return Object.entries(stallIds).find(([, ids]) => ids.includes(h.stallId!))?.[0] ?? 'B';
}

function phaseFor(planCode: string, start: Date, end: Date, speed = 38) {
  return [
    {
      id: `${planCode}-PH1`,
      name: 'Nền tảng và duy trì thể lực',
      type: 'FOUNDATION',
      focus: 'FOUNDATION',
      startDate: clubDate(start),
      endDate: clubDate(end),
      durationDays: Math.round((+end - +start) / DAY_MS) + 1,
      sessionsPerWeek: 3,
      maxWeeklyDistance: 6000,
      surface: 'TURF',
      targetSpeedKmh: speed,
      targetDistanceM: 1400,
    },
  ];
}

async function seedTraining(tx: Tx) {
  const tracks = [
    { code: 'TRK-TURF', name: 'Đường cỏ chính', surface: 'TURF', capacity: 6 },
    { code: 'TRK-DIRT', name: 'Đường cát thể lực', surface: 'DIRT', capacity: 6 },
    { code: 'TRK-SYNTHETIC', name: 'Đường tổng hợp', surface: 'SYNTHETIC', capacity: 4 },
    { code: 'TRK-REHAB', name: 'Khu đi bộ phục hồi', surface: 'DIRT', capacity: 2 },
  ];
  await tx.trainingTrack.createMany({
    data: tracks.map((t) => ({ ...t, id: id(t.code) })),
    skipDuplicates: true,
  });
  for (const [trainerId, barn] of [
    [userIds.trainer, zoneIds.A],
    [userIds.trainer2, zoneIds.A],
    [userIds.trainer3, zoneIds.B],
    [userIds.trainer4, zoneIds.B],
  ])
    await tx.user.update({ where: { id: trainerId }, data: { assignedBarnId: barn } });
  const groomZones = ['A', 'B', 'C', 'A', 'A', 'B', 'B', 'C', 'H', 'H'] as const;
  for (const [i, groomId] of userIds.grooms.entries())
    await tx.user.update({
      where: { id: groomId },
      data: { assignedBarnId: zoneIds[groomZones[i]] },
    });

  const workouts: Prisma.WorkoutSessionCreateManyInput[] = [];
  for (const [i, h] of HORSES.entries()) {
    if (h.status === HorseStatus.RETIRED || i >= 14) continue;
    const trainerId = trainerFor(i);
    const draft = i === 7;
    const unassigned = [10, 12, 13].includes(i);
    if (unassigned) continue;
    const code = `GA-${String(i + 1).padStart(6, '0')}`;
    const planId = id(`plan:current:${h.id}`);
    const start = days(draft ? 1 : -42),
      end = days(28);
    await tx.trainingPlan.createMany({
      data: [
        {
          id: planId,
          planCode: code,
          horseId: h.id,
          trainerUserId: trainerId,
          phaseName: `${h.name} – ${draft ? 'Dự thảo chu kỳ mới' : h.isMedicalLocked ? 'Phục hồi có giám sát' : 'Chu kỳ thể lực cuối năm'}`,
          objective: h.isMedicalLocked
            ? 'Duy trì vận động nhẹ theo chỉ định thú y'
            : 'Cải thiện sức bền, theo dõi tốc độ và hồi phục hàng tuần',
          startDate: start,
          endDate: end,
          status: draft ? PlanStatus.DRAFT : PlanStatus.ACTIVE,
          phases: phaseFor(code, start, end),
          trackSurface: TrackSurface.TURF,
          targetSpeed: 38,
          targetDistance: 1400,
          createdAt: days(-43),
        },
      ],
      skipDuplicates: true,
    });
    await tx.horse.update({
      where: { id: h.id },
      data: {
        assignedTrainerId: trainerId,
        trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
        trainerAssignedAt: days(-44),
        trainerRespondedAt: days(-44, 10),
        ...(!draft && !h.isMedicalLocked ? { status: HorseStatus.IN_TRAINING } : {}),
      },
    });
    if (draft) continue;
    for (let d = -42; d <= 21; d += 2) {
      const afternoon = i % 7 >= 4;
      const scheduledDate = days(d, afternoon ? 13 : 6, 0);
      const locked = Boolean(h.isMedicalLocked) && d >= -10;
      const status = locked
        ? WorkoutStatus.BLOCKED
        : scheduledDate < now
          ? d === -4 && i === 8
            ? WorkoutStatus.MISSED
            : d === -6 && i === 9
              ? WorkoutStatus.CANCELLED
              : WorkoutStatus.COMPLETED
          : WorkoutStatus.SCHEDULED;
      const completed = status === WorkoutStatus.COMPLETED;
      const workoutType = ['WALK', 'TROT', 'CANTER', 'BREEZE', 'TRIAL', 'SWIM', 'TREADMILL'][
        (i + d + 105) % 7
      ];
      const surface = effectiveSurface(workoutType, zoneFor(h) === 'A' ? 'TURF' : 'DIRT');
      const speed =
        workoutType === 'WALK'
          ? 6
          : workoutType === 'SWIM'
            ? 4
            : workoutType === 'TROT' || workoutType === 'TREADMILL'
              ? 18
              : workoutType === 'CANTER'
                ? 36
                : 56 + (i % 5);
      const distance = workoutType === 'SWIM' ? 200 : workoutType === 'WALK' ? 600 : 1400;
      const abnormal = completed && d === -4 && i === 6;
      workouts.push({
        id: id(`workout:${h.id}:${clubDate(scheduledDate)}`),
        trainingPlanId: planId,
        horseId: h.id,
        assignedStaffUserId:
          userIds.grooms[zoneFor(h) === 'A' ? (i % 7 >= 4 ? 3 : 0) : i % 7 >= 4 ? 5 : 1],
        scheduledDate,
        phaseId: `${code}-PH1`,
        trackId: surface === 'NONE' ? null : id(`TRK-${surface}`),
        distanceMeters: distance,
        repetitions: 1,
        targetSpeedKmh: speed,
        workoutType,
        intensity: effectiveIntensity(
          workoutType,
          ['WALK', 'TROT', 'SWIM', 'TREADMILL'].includes(workoutType) ? 'LIGHT' : 'MEDIUM',
        ),
        trackSurface: surface,
        status,
        statusReason: locked
          ? 'Khóa y tế đang hiệu lực; chờ bác sĩ cho phép trở lại'
          : status === WorkoutStatus.MISSED
            ? 'Mưa lớn, chưa ghi nhận kết quả'
            : status === WorkoutStatus.CANCELLED
              ? 'Điều chỉnh lịch theo yêu cầu chủ ngựa'
              : null,
        actualTimeSeconds: completed ? Number(((distance * 3.6) / speed).toFixed(2)) : null,
        actualDistanceMeters: completed ? distance : null,
        averageSpeedKmh: completed ? speed : null,
        topSpeedKmh: completed ? speed + 4 : null,
        heartRatePeak: completed ? 175 + i : null,
        heartRateRecovery: completed ? (abnormal ? 132 : 42 + i) : null,
        performanceScore: completed ? 7.2 + (i % 4) * 0.4 : null,
        staminaScore: completed ? 8 : null,
        recoveryTimeMinutes: completed ? 8 : null,
        injuryRiskLevel: abnormal ? 'MEDIUM' : 'LOW',
        abnormalSigns: abnormal,
        abnormalSignTypes: abnormal ? ['SLOW_RECOVERY', 'ELEVATED_HR'] : [],
        abnormalNotes: abnormal
          ? 'Nhịp tim hồi phục chậm, đã báo bác sĩ kiểm tra và giảm tải.'
          : null,
        vetAcknowledgedAt: abnormal ? days(-3, 10) : null,
        vetNotes: abnormal
          ? 'Đã kiểm tra, theo dõi thân nhiệt và điều chỉnh bài tập trong hai ngày.'
          : null,
        actualSurface: completed ? surface : null,
        completionLevel: completed ? 'FULL' : null,
        resultNotes: completed ? 'Hoàn thành đủ cự ly, ăn uống và dáng đi ổn định sau tập.' : null,
        resultRecordedAt: completed
          ? new Date(+scheduledDate + (workoutDurationMinutes(workoutType) + 5) * 60000)
          : null,
        resultRecordedById: completed ? trainerId : null,
        createdAt: days(Math.min(d - 1, -43)),
      });
    }
  }
  // The groom and trainer both need a free slot, including preparation and recovery.
  const placed: Array<{ start: number; end: number; groom: string | null; trainer: string }> = [];
  workouts.sort((a, b) => +new Date(a.scheduledDate) - +new Date(b.scheduledDate));
  for (const w of workouts) {
    if ([WorkoutStatus.CANCELLED, WorkoutStatus.BLOCKED].includes(w.status as any)) continue;
    const trainer = trainerFor(HORSES.findIndex((h) => h.id === w.horseId));
    const duration = (workoutDurationMinutes(w.workoutType) + GROOM_BUFFER_MINUTES) * 60000;
    let start = +new Date(w.scheduledDate);
    while (
      placed.some(
        (p) =>
          start < p.end &&
          p.start < start + duration &&
          (p.groom === w.assignedStaffUserId || p.trainer === trainer),
      )
    )
      start += 15 * 60000;
    placed.push({ start, end: start + duration, groom: w.assignedStaffUserId ?? null, trainer });
    w.scheduledDate = new Date(start);
    if (w.resultRecordedAt)
      w.resultRecordedAt = new Date(start + (workoutDurationMinutes(w.workoutType) + 5) * 60000);
    if (w.status === WorkoutStatus.COMPLETED && w.resultRecordedAt! > now) {
      w.status = WorkoutStatus.SCHEDULED;
      for (const field of [
        'resultRecordedAt',
        'resultRecordedById',
        'actualTimeSeconds',
        'actualDistanceMeters',
        'averageSpeedKmh',
        'topSpeedKmh',
        'heartRatePeak',
        'heartRateRecovery',
        'performanceScore',
        'staminaScore',
        'recoveryTimeMinutes',
        'actualSurface',
        'completionLevel',
        'resultNotes',
      ])
        w[field] = null;
    }
  }
  await tx.workoutSession.createMany({ data: workouts, skipDuplicates: true });
  const completed = workouts.filter((w) => w.status === WorkoutStatus.COMPLETED);
  await tx.simulatorSession.createMany({
    data: [
      {
        id: id('sim:workout'),
        type: SimulatorSessionType.WORKOUT,
        status: SimulatorSessionStatus.COMPLETED,
        actorUserId: userIds.trainer,
        horseIds: [completed[0].horseId],
        workoutSessionId: completed[0].id,
        lastSnapshot: { distanceMeters: completed[0].distanceMeters, completed: true },
        createdAt: completed[0].scheduledDate,
      },
      {
        id: id('sim:exam'),
        type: SimulatorSessionType.EXAM,
        status: SimulatorSessionStatus.COMPLETED,
        actorUserId: userIds.vet,
        horseIds: [horseIds[0]],
        medicalRecordId: id('medrec:closed:h1'),
        lastSnapshot: { temperature: 37.8, heartRate: 42 },
        createdAt: days(-75),
      },
      {
        id: id('sim:race'),
        type: SimulatorSessionType.RACE,
        status: SimulatorSessionStatus.PENDING,
        actorUserId: userIds.trainer,
        horseIds: [horseIds[0], horseIds[2]],
        lastSnapshot: { horseIds: [horseIds[0], horseIds[2]], distanceMeters: 1600 },
      },
      {
        id: id('sim:running'),
        type: SimulatorSessionType.EXAM,
        status: SimulatorSessionStatus.RUNNING,
        actorUserId: userIds.vet,
        horseIds: [horseIds[1]],
        medicalRecordId: id('medrec:open:h2'),
        lastSnapshot: { stage: 'VITALS' },
      },
      {
        id: id('sim:aborted'),
        type: SimulatorSessionType.EXAM,
        status: SimulatorSessionStatus.ABORTED_INJURY,
        actorUserId: userIds.vet,
        horseIds: [horseIds[1]],
        medicalRecordId: id('medrec:open:h2'),
        lastSnapshot: { reason: 'Ngừng kiểm tra vận động do đau gân' },
        createdAt: days(-10),
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
  await tx.medicalRecord.createMany({
    data: medicalRecords.map((record, index) => ({
      ...record,
      recordNumber: `BA-${clubDate(new Date(record.examinationDate!)).slice(2, 7).replace('-', '')}-${900 + index}`,
      createdAt: record.examinationDate,
    })),
    skipDuplicates: true,
  });

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
      [
        PreventiveType.VACCINATION,
        preventiveTypeIds.VACCINATION,
        idx === 0 || idx === 2 ? PreventiveStatus.PENDING : PreventiveStatus.COMPLETED,
        idx === 0 || idx === 2 ? 6 : -90,
      ],
      [
        PreventiveType.FARRIER_HOOF_CARE,
        preventiveTypeIds.FARRIER_HOOF_CARE,
        idx % 5 === 0
          ? PreventiveStatus.OVERDUE
          : idx % 3 === 0
            ? PreventiveStatus.PENDING
            : PreventiveStatus.COMPLETED,
        idx % 5 === 0 ? -3 : idx % 3 === 0 ? 3 : -18,
      ],
      [
        PreventiveType.DEWORMING,
        preventiveTypeIds.DEWORMING,
        idx % 4 === 0 ? PreventiveStatus.PENDING : PreventiveStatus.COMPLETED,
        idx % 4 === 0 ? 5 : -35,
      ],
      [
        PreventiveType.DENTAL,
        preventiveTypeIds.DENTAL,
        idx % 6 === 0 ? PreventiveStatus.OVERDUE : PreventiveStatus.PENDING,
        idx % 6 === 0 ? -5 : 2,
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
        performedByMode: 'SELF',
        performedByName: 'BS. Trần Đình Khôi',
        status,
      });
    }
  });
  await tx.preventiveSchedule.createMany({ data: schedules, skipDuplicates: true });
}

async function seedStableCare(tx: Tx) {
  // Preserve the canonical supplies and cover every current supply category.
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
  supplies.push(
    {
      id: id('supply:vitamin-e'),
      code: 'VITAMIN_E',
      name: 'Vitamin E hỗ trợ hồi phục',
      category: SupplyCategory.SUPPLEMENT_VITAMIN,
      unit: SupplyUnit.PACKET,
      unitPrice: 55000,
    },
    {
      id: id('supply:mineral'),
      code: 'MINERAL',
      name: 'Khoáng tổng hợp cho ngựa',
      category: SupplyCategory.SUPPLEMENT_MINERAL,
      unit: SupplyUnit.KG,
      unitPrice: 95000,
    },
    {
      id: id('supply:probiotic'),
      code: 'PROBIOTIC',
      name: 'Men vi sinh hỗ trợ tiêu hóa',
      category: SupplyCategory.SUPPLEMENT_GENERAL,
      unit: SupplyUnit.PACKET,
      unitPrice: 35000,
    },
  );
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
    const baseHay = h.weightKg ? Number((h.weightKg * 0.017).toFixed(1)) : 8.0;
    const baseGrain = h.weightKg ? Number((h.weightKg * 0.006).toFixed(1)) : 2.8;
    const hayKg =
      h.status === HorseStatus.ISOLATED || h.status === HorseStatus.INJURED
        ? Number((baseHay * 0.75).toFixed(1))
        : baseHay;
    const grainKg =
      h.status === HorseStatus.ISOLATED || h.status === HorseStatus.INJURED
        ? Number((baseGrain * 0.5).toFixed(1))
        : baseGrain;
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

  // Recent and upcoming roster assignments for all ten active grooms.
  const rosterAssignments: Array<[string, string, string]> = [
    [zoneIds.A, shiftIds.MORNING, userIds.grooms[0]],
    [zoneIds.A, shiftIds.AFTERNOON, userIds.grooms[3]],
    [zoneIds.A, shiftIds.NIGHT, userIds.grooms[4]],
    [zoneIds.B, shiftIds.MORNING, userIds.grooms[1]],
    [zoneIds.B, shiftIds.AFTERNOON, userIds.grooms[5]],
    [zoneIds.B, shiftIds.NIGHT, userIds.grooms[6]],
    [zoneIds.C, shiftIds.MORNING, userIds.grooms[2]],
    [zoneIds.C, shiftIds.AFTERNOON, userIds.grooms[7]],
    [zoneIds.H, shiftIds.MORNING, userIds.grooms[8]],
    [zoneIds.H, shiftIds.AFTERNOON, userIds.grooms[9]],
  ];
  const rosters: Prisma.ShiftRosterCreateManyInput[] = [];
  for (let d = -14; d <= 21; d++) {
    const rDate = new Date(`${dateStrOffset(d)}T00:00:00.000Z`);
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

  // Detailed recent and upcoming care; retired horses receive no new tasks.
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
    const horseNutri = nutritionPlans.find((np) => np.horseId === h.id);
    const meals = (horseNutri?.mealsJson as any) || makeMeals(8, 3, true);
    return {
      id: h.id,
      zoneId: h.stallId ? zoneIds[zCode] : undefined,
      stallId: h.stallId ?? undefined,
      stallCode: h.horseCode,
      allocationGroomId: h.groomId,
      isLocked: Boolean(h.isMedicalLocked),
      allowedActivityLevel:
        h.id === horseIds[14] || h.id === horseIds[15] ? 'Strict stall rest' : undefined,
      mealsJson: meals,
      medications: meds,
      careInstructions,
    };
  });

  const shiftMeta: Record<string, { startTime: string; endTime: string; isOvernight: boolean }> = {
    [shiftIds.MORNING]: { startTime: '05:00', endTime: '13:00', isOvernight: false },
    [shiftIds.AFTERNOON]: { startTime: '13:00', endTime: '21:00', isOvernight: false },
    [shiftIds.NIGHT]: { startTime: '21:00', endTime: '05:00', isOvernight: true },
  };
  const scheduledWorkouts = await tx.workoutSession.findMany({
    where: { status: WorkoutStatus.SCHEDULED, scheduledDate: { gte: days(0, 0), lt: days(22, 0) } },
    select: { id: true, horseId: true, scheduledDate: true },
  });
  const plannedRosters = rosterAssignments.map(([zoneId, shiftId, groomUserId]) => ({
    zoneId,
    shiftId,
    groomUserId,
    ...shiftMeta[shiftId],
  }));

  const dailyTasks: Prisma.DailyCareTaskCreateManyInput[] = [];
  let taskCounter = 1;

  for (let d = -14; d <= 21; d++) {
    const date = dateStrOffset(d);
    const taskDate = new Date(`${date}T00:00:00.000Z`);
    const planned = planDailyTasks(
      scheduleHorses.map((horse) => ({
        ...horse,
        workouts: scheduledWorkouts
          .filter(
            (workout) => workout.horseId === horse.id && clubDate(workout.scheduledDate) === date,
          )
          .map((workout) => {
            const { hour, minute } = clubTime(workout.scheduledDate);
            return {
              id: workout.id,
              time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
            };
          }),
      })),
      plannedRosters,
    );
    planned.forEach((t) => {
      // Complete only tasks whose scheduled time has passed in club time.
      const scheduledAt = new Date(`${date}T${t.scheduledTime}:00+07:00`);
      const done = !!t.assignedGroomUserId && scheduledAt.getTime() + 15 * 60000 <= now.getTime();
      dailyTasks.push({
        id: id(`task:d${d}:${t.horseId}:${t.taskType}:${t.mealType ?? 'none'}:${t.scheduledTime}`),
        taskCode: t.taskCode ?? `TSK-${yymm()}-${String(taskCounter++).padStart(5, '0')}`,
        date: taskDate,
        horseId: t.horseId,
        stallZoneId: t.zoneId ?? null,
        stallId: t.stallId ?? null,
        taskType: t.taskType,
        title: t.title,
        description: t.description,
        mealType: t.mealType ?? null,
        scheduledTime: t.scheduledTime,
        shiftId: t.shiftId ?? null,
        nutritionPlanId:
          nutritionPlans.find(
            (np) => np.horseId === t.horseId && np.status === NutritionPlanStatus.APPROVED,
          )?.id ?? null,
        isMedicalLocked: Boolean(activeHorses.find((h) => h.id === t.horseId)?.isMedicalLocked),
        itemsSnapshotJson: (t.itemsSnapshotJson as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        isCompleted: done,
        completedAt: done ? new Date(scheduledAt.getTime() + 15 * 60000) : null,
        completionVersion: done ? 1 : 0,
        createdAt: days(d, 0),
        completedById: done ? t.assignedGroomUserId : null,
        assignedGroomUserId: t.assignedGroomUserId ?? null,
      });
    });

    // Explicit DailyTaskType.OTHER night temperature check for Tuyet Anh (C01) for each day
    dailyTasks.push({
      id: id(`task:d${d}:other:h15-temp`),
      taskCode: `TSK-${yymm()}-${String(taskCounter++).padStart(5, '0')}`,
      date: taskDate,
      horseId: horseIds[14],
      stallZoneId: zoneIds.C,
      stallId: stallIds.C[0],
      taskType: DailyTaskType.OTHER,
      title: 'Đo thân nhiệt & kiểm tra chuồng cách ly ban đêm',
      description: 'Kiểm tra nhiệt độ trực tràng và lượng nước uống khu C.',
      scheduledTime: '21:30',
      shiftId: null,
      isMedicalLocked: true,
      isCompleted: false,
      assignedGroomUserId: null,
    });
  }
  // Historical vet-prescribed care retains the legacy task type without adding automatic ice treatment.
  dailyTasks.push({
    id: id('task:historical:ice-boot:h2'),
    taskCode: 'TSK-2609-90001',
    date: new Date('2026-09-15T00:00:00.000Z'),
    horseId: horseIds[1],
    stallZoneId: zoneIds.B,
    stallId: HORSES[1].stallId,
    taskType: DailyTaskType.ICE_BOOT_REST,
    title: 'Chườm lạnh theo chỉ định thú y trong đợt hồi phục tháng 9',
    description: 'Mẫu lịch sử chăm sóc đã hoàn tất theo phác đồ; không tự phát sinh từ khóa y tế.',
    scheduledTime: '14:00',
    shiftId: shiftIds.AFTERNOON,
    isCompleted: true,
    completedAt: new Date('2026-09-15T14:15:00+07:00'),
    completedById: HORSES[1].groomId,
    assignedGroomUserId: HORSES[1].groomId,
  });
  await tx.dailyCareTask.createMany({ data: dailyTasks, skipDuplicates: true });

  // DailyGroomingLog across MORNING / AFTERNOON / EVENING
  const groomingLogs: Prisma.DailyGroomingLogCreateManyInput[] = [];
  [-2, -1].forEach((d) => {
    groomingLogs.push(
      {
        id: id(`groomlog:h1:d${d}`),
        horseId: horseIds[0],
        groomUserId: userIds.grooms[0],
        shiftDate: days(d, 6, 30),
        shiftType: ShiftType.MORNING,
        feedCompleted: true,
        cleaningCompleted: true,
        groomingCompleted: true,
        iceBootCompleted: false,
        healthObservations: 'Ăn hết sạch cỏ khô và ngũ cốc, tinh thần hưng phấn.',
      },
      {
        id: id(`groomlog:h2:d${d}`),
        horseId: horseIds[1],
        groomUserId: userIds.grooms[3],
        shiftDate: days(d, 14, 0),
        shiftType: ShiftType.AFTERNOON,
        feedCompleted: true,
        cleaningCompleted: true,
        groomingCompleted: true,
        iceBootCompleted: true,
        healthObservations: 'Đã chườm đá chân phải 15 phút, vùng gân mát và đỡ sưng.',
      },
      {
        id: id(`groomlog:h15:d${d}`),
        horseId: horseIds[14],
        groomUserId: userIds.grooms[2],
        shiftDate: days(d, 19, 0),
        shiftType: ShiftType.EVENING,
        feedCompleted: true,
        cleaningCompleted: true,
        groomingCompleted: false,
        iceBootCompleted: false,
        healthObservations: 'Thân nhiệt tối 38.6°C, uống nước tốt hơn hôm qua.',
      },
    );
  });
  await tx.dailyGroomingLog.createMany({ data: groomingLogs, skipDuplicates: true });

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
        urgencyReason: 'Tồn kho điện giải khu A xuống dưới ngưỡng dự phòng cho tuần tập tới',
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
      {
        id: id('restock:d1:oats'),
        requestNumber: 'REQ-SUP-006',
        zoneId: zoneIds.A,
        supplyId: supplyIds.oatGrain,
        requestedQuantity: 200,
        approvedQuantity: 200,
        status: RestockStatus.DELIVERED,
        urgencyReason: 'Nhập cám yến mạch theo dự trù khẩu phần tuần tập tới',
        requestedById: userIds.grooms[0],
        reviewedById: userIds.manager,
        reviewedAt: days(-1, 10, 0),
        deliveredAt: days(-1, 10, 5),
        deliveredById: userIds.grooms[0],
      },
      {
        id: id('restock:d3:electrolyte'),
        requestNumber: 'REQ-SUP-007',
        zoneId: zoneIds.B,
        supplyId: supplyIds.electrolyte,
        requestedQuantity: 50,
        approvedQuantity: 50,
        status: RestockStatus.APPROVED,
        urgencyReason: 'Bổ sung gói điện giải khu B chuẩn bị cho vòng bán kết ngày 18/11',
        requestedById: userIds.grooms[1],
        reviewedById: userIds.manager,
        reviewedAt: days(-1, 14, 0),
      },
      {
        id: id('restock:d5:timothy'),
        requestNumber: 'REQ-SUP-008',
        zoneId: zoneIds.C,
        supplyId: supplyIds.timothyHay,
        requestedQuantity: 150,
        status: RestockStatus.PENDING,
        urgencyReason: 'Đề xuất dự trữ cỏ khô Timothy cho mùa giải cuối năm',
        requestedById: userIds.grooms[2],
      },
    ],
    skipDuplicates: true,
  });

  // Phiếu nhập từ lần seed trước từng mang ngày tương lai: kéo về hôm qua (đã nhập kho / đã duyệt).
  await tx.restockRequest.updateMany({
    where: { id: id('restock:d1:oats') },
    data: { reviewedAt: days(-1, 10, 0), deliveredAt: days(-1, 10, 5) },
  });
  await tx.restockRequest.updateMany({
    where: { id: id('restock:d3:electrolyte') },
    data: { reviewedAt: days(-1, 14, 0) },
  });

  // IncidentReports covering all 4 IncidentStatus
  await tx.incidentReport.createMany({
    data: [
      {
        id: id('inc:reported'),
        sourceEventId: 'evt-inc-001',
        incidentNumber: 'INC-20261115-0001',
        horseId: horseIds[6],
        stallZoneId: zoneIds.A,
        reportedById: userIds.grooms[4],
        severity: SeverityLevel.MODERATE,
        symptomsJson: ['LOSS_OF_APPETITE', 'OTHER'],
        description: 'Hồng Kỳ ăn chậm vào ca sáng nay, cần bác sĩ kiểm tra răng và thân nhiệt.',
        status: IncidentStatus.REPORTED,
      },
      {
        id: id('inc:review'),
        sourceEventId: 'evt-inc-002',
        incidentNumber: 'INC-20261113-0001',
        horseId: horseIds[12],
        stallZoneId: zoneIds.B,
        reportedById: userIds.grooms[6],
        severity: SeverityLevel.MILD,
        symptomsJson: ['OTHER'],
        description: 'Ghi nhận phân lỏng sau buổi chiều đổi lô cỏ mới.',
        status: IncidentStatus.UNDER_REVIEW,
        createdAt: days(-3),
        reviewedById: userIds.vet3,
        reviewedAt: days(-2),
        vetNotes: 'Đã mở hồ sơ theo dõi cho Hỏa Phụng và bổ sung men vi sinh.',
        medicalRecordId: id('medrec:open:h13'),
      },
      {
        id: id('inc:resolved'),
        sourceEventId: 'evt-inc-003',
        incidentNumber: 'INC-20260902-0001',
        horseId: horseIds[0],
        stallZoneId: zoneIds.A,
        reportedById: userIds.grooms[0],
        severity: SeverityLevel.MILD,
        symptomsJson: ['WOUND'],
        description: 'Vết xước nhẹ do cọ vào thành cửa chuồng, đã vệ sinh sát khuẩn.',
        status: IncidentStatus.RESOLVED,
        resolvedAt: days(-73),
        createdAt: days(-75),
        reviewedById: userIds.vet,
        reviewedAt: days(-74),
        vetNotes: 'Vết thương đã lành hoàn toàn.',
        medicalRecordId: id('medrec:closed:h1'),
      },
      {
        id: id('inc:dismissed'),
        sourceEventId: 'evt-inc-004',
        incidentNumber: 'INC-20261106-0001',
        horseId: horseIds[4],
        stallZoneId: zoneIds.A,
        reportedById: userIds.grooms[9],
        severity: SeverityLevel.MILD,
        symptomsJson: ['COUGHING'],
        description: 'Hắt hơi thoáng qua khi vừa rải rơm mới.',
        status: IncidentStatus.DISMISSED,
        createdAt: days(-10),
        reviewedById: userIds.vet2,
        reviewedAt: days(-9),
        vetNotes: 'Phản ứng bụi rơm bình thường, không có dấu hiệu bệnh lý.',
      },
    ],
    skipDuplicates: true,
  });
}

async function seedRacingAndInvoices(tx: Tx) {
  const runners = [0, 2, 3, 4, 5, 6, 8, 9, 11];
  for (let m = 0; m < 12; m++) {
    const period = clubDate(new Date(Date.UTC(2025, 11 + m, 1))).slice(0, 7);
    const raceDate = new Date(`${period}-20T15:00:00+07:00`);
    if (raceDate >= now) continue;
    const tourId = id(`tour:${period}`);
    await tx.tournament.createMany({
      data: [
        {
          id: tourId,
          code: `CUP-${period}`,
          name: `Cúp giao hữu EquiFlow tháng ${period.slice(5)}/${period.slice(0, 4)}`,
          raceDate,
          location: m % 2 ? 'Trường đua Đại Nam' : 'Trường đua Thiên Mã',
          distanceMeters: 1600,
          trackType: [TrackSurface.TURF, TrackSurface.DIRT, TrackSurface.SYNTHETIC][m % 3],
          entryFee: 2_000_000,
          prizePool: 55_000_000,
          maxFieldSize: 10,
          minAgeYears: 3,
          registrationDeadline: new Date(+raceDate - 7 * DAY_MS),
          status: TournamentStatus.COMPLETED,
          createdAt: new Date(+raceDate - 30 * DAY_MS),
        },
      ],
      skipDuplicates: true,
    });
    const registrations = runners.map((i, n) => ({
      id: id(`treg:${period}:${i}`),
      tournamentId: tourId,
      horseId: horseIds[i],
      registeredByTrainerId: trainerFor(i),
      status: RegistrationStatus.CONFIRMED,
      entryFeeBilled: 2_000_000,
      registrationDate: new Date(+raceDate - (8 + (n % 3)) * DAY_MS),
    }));
    await tx.tournamentRegistration.createMany({ data: registrations, skipDuplicates: true });
    await tx.tournamentResult.createMany({
      data: registrations.map((r, n) => {
        const rank = ((n + m) % registrations.length) + 1;
        const gross =
          rank === 1 ? 30_000_000 : rank === 2 ? 15_000_000 : rank === 3 ? 10_000_000 : 0;
        const time = 96 + rank * 0.7;
        return {
          id: id(`tres:${period}:${r.horseId}`),
          registrationId: r.id,
          finalRank: rank,
          finishTimeSeconds: time,
          avgSpeedKmh: Number((5760 / time).toFixed(2)),
          prizeMoneyWon: gross,
          ...calculatePrizeSplit(gross, 2_000_000),
          settledAt: new Date(+raceDate + DAY_MS),
          officialNotes: rank <= 3 ? `Hạng ${rank}, đã đối soát tiền thưởng` : 'Hoàn thành cự ly',
        };
      }),
      skipDuplicates: true,
    });
  }
  const futureStatuses = [
    TournamentStatus.OPEN_REGISTRATION,
    TournamentStatus.CLOSED_REGISTRATION,
    TournamentStatus.UPCOMING,
    TournamentStatus.CANCELLED,
    TournamentStatus.UPCOMING,
    TournamentStatus.OPEN_REGISTRATION,
  ];
  for (const [i, status] of futureStatuses.entries()) {
    const tourId = id(`tour:upcoming:${i}`);
    const raceDate = days(7 + i * 5, 15);
    await tx.tournament.createMany({
      data: [
        {
          id: tourId,
          code: `CUP-NEXT-${i + 1}`,
          name: [
            'Cúp Mùa Đông Thiên Mã',
            'Giải Tốc Độ Đại Nam',
            'Cúp Giao Hữu Cuối Năm',
            'Giải Mở Rộng Miền Đông',
            'Cúp Năm Mới',
            'Giải Trẻ EquiFlow',
          ][i],
          raceDate,
          location: i % 2 ? 'Trường đua Đại Nam' : 'Trường đua Thiên Mã',
          distanceMeters: 1400 + (i % 3) * 200,
          trackType: [TrackSurface.TURF, TrackSurface.DIRT, TrackSurface.SYNTHETIC][i % 3],
          entryFee: 3_000_000,
          prizePool: 90_000_000,
          maxFieldSize: 12,
          minAgeYears: 3,
          registrationDeadline:
            status === TournamentStatus.CLOSED_REGISTRATION ? days(-1) : days(3 + i * 4),
          status,
          createdAt: days(-20),
        },
      ],
      skipDuplicates: true,
    });
    if (
      status !== TournamentStatus.OPEN_REGISTRATION &&
      status !== TournamentStatus.CLOSED_REGISTRATION
    )
      continue;
    await tx.tournamentRegistration.createMany({
      data: runners
        .slice(0, 5)
        .map<Prisma.TournamentRegistrationCreateManyInput>((idx, n) => ({
          id: id(`treg:upcoming:${i}:${idx}`),
          tournamentId: tourId,
          horseId: horseIds[idx],
          registeredByTrainerId: trainerFor(idx),
          entryFeeBilled: 3_000_000,
          status:
            n === 4
              ? RegistrationStatus.DISQUALIFIED
              : status === TournamentStatus.CLOSED_REGISTRATION
                ? RegistrationStatus.CONFIRMED
                : RegistrationStatus.REGISTERED,
          registrationDate: days(-3),
        }))
        .concat([
          {
            id: id(`treg:upcoming:${i}:medical`),
            tournamentId: tourId,
            horseId: horseIds[1],
            registeredByTrainerId: userIds.trainer,
            entryFeeBilled: 3_000_000,
            status: RegistrationStatus.SCRATCHED_MEDICAL,
            registrationDate: days(-12),
          },
        ]),
      skipDuplicates: true,
    });
  }

  await tx.careBillingPolicy.upsert({
    where: { id: 'club' },
    update: {},
    create: {
      id: 'club',
      cutoverPeriod: BILLING_CUTOVER,
      examUnitPrice: 3_000_000,
      updatedById: userIds.manager,
    },
  });
  const entries = await tx.careCostEntry.findMany();
  const allocations = await tx.stallAllocation.findMany();
  const results = await tx.tournamentResult.findMany();
  const registrations = await tx.tournamentRegistration.findMany();
  const plans = await tx.trainingPlan.findMany();
  const medical = await tx.medicalRecord.findMany();
  const policy = await tx.careBillingPolicy.findUnique({ where: { id: 'club' } });
  for (let m = 0; m < 11; m++) {
    const period = clubDate(new Date(Date.UTC(2025, 11 + m, 1))).slice(0, 7);
    if (period > LAST_INVOICE_PERIOD) throw new Error('Seed invoice exceeds October 2026');
    const { start, end } = boardingMonth(period);
    for (const [i, h] of HORSES.entries()) {
      const stay = allocations.filter((a) => a.horseId === h.id);
      const { boardingDays, boardingFee } = calculateBoardingFee(period, stay);
      if (!boardingDays) continue;
      const actual = Boolean(policy?.cutoverPeriod && period >= policy.cutoverPeriod);
      const usage = entries.filter(
        (e) => e.horseId === h.id && e.performedAt >= start && e.performedAt < end,
      );
      const snapshot = invoiceUsageSnapshot(usage);
      const medicalFee = actual
        ? snapshot.medicalFee.toNumber()
        : medical.some(
              (r) => r.horseId === h.id && r.examinationDate >= start && r.examinationDate < end,
            )
          ? MEDICAL_MONTHLY_PACKAGE_FEE
          : 0;
      const trainingFee = plans.some(
        (p) =>
          p.horseId === h.id &&
          p.status !== PlanStatus.DRAFT &&
          p.status !== PlanStatus.CANCELLED &&
          p.startDate < end &&
          p.endDate >= start,
      )
        ? TRAINING_MONTHLY_RATE
        : 0;
      const regIds = new Set(registrations.filter((r) => r.horseId === h.id).map((r) => r.id));
      const prizeCredit = results
        .filter(
          (r) =>
            regIds.has(r.registrationId) &&
            r.settledAt &&
            r.settledAt >= start &&
            r.settledAt < end,
        )
        .reduce((sum, r) => sum + Number(r.netOwnerPayout), 0);
      const netAmount = boardingFee.toNumber() + medicalFee + trainingFee - prizeCredit;
      let status: InvoiceStatus = InvoiceStatus.PAID;
      if (i === 16 && period >= '2026-08' && netAmount > 0) status = InvoiceStatus.OVERDUE;
      else if (period === LAST_INVOICE_PERIOD && i === 14) status = InvoiceStatus.DRAFT;
      else if (period === LAST_INVOICE_PERIOD && i === 15) status = InvoiceStatus.CANCELLED;
      else if (period === LAST_INVOICE_PERIOD && i === 9 && netAmount > 0)
        status = InvoiceStatus.SENT;
      const invId = id(`inv:${period}:${h.id}`);
      if (await tx.financialInvoice.findUnique({ where: { id: invId } })) continue;
      await tx.financialInvoice.createMany({
        data: [
          {
            id: invId,
            horseId: h.id,
            ownerId: h.ownerId,
            billingPeriod: period,
            boardingFee,
            boardingDays,
            boardingMonthlyRate: BOARDING_MONTHLY_RATE,
            medicalFee,
            trainingFee,
            prizeCredit,
            netAmount,
            status,
            billingMethod: actual
              ? InvoiceBillingMethod.ACTUAL_USAGE
              : InvoiceBillingMethod.LEGACY_PACKAGE,
            dueAt:
              status === InvoiceStatus.DRAFT || status === InvoiceStatus.CANCELLED
                ? null
                : status === InvoiceStatus.SENT
                  ? days(5, 17)
                  : new Date(+end + 7 * DAY_MS),
            createdAt: end,
            paidAt:
              status === InvoiceStatus.PAID && netAmount > 0 ? new Date(+end + 3 * DAY_MS) : null,
            paymentMethod: status === InvoiceStatus.PAID && netAmount > 0 ? 'BANK_TRANSFER' : null,
            paymentRef:
              status === InvoiceStatus.PAID && netAmount > 0 ? `EQ-${period}-${h.horseCode}` : null,
            paidConfirmedById:
              status === InvoiceStatus.PAID && netAmount > 0 ? userIds.manager : null,
            paidConfirmedByName:
              status === InvoiceStatus.PAID && netAmount > 0 ? 'Trần Quang Minh' : null,
            paymentReportedAt: status === InvoiceStatus.SENT ? days(-1, 16) : null,
          },
        ],
        skipDuplicates: true,
      });
      if (!actual || !usage.length) continue;
      await tx.invoiceLineItem.createMany({
        data: snapshot.lines.map((line) => ({
          ...line,
          id: id(`line:${invId}:${line.careCostEntryId}`),
          invoiceId: invId,
        })),
        skipDuplicates: true,
      });
      if (status !== InvoiceStatus.CANCELLED)
        await tx.careCostClaim.createMany({
          data: usage.map((e) => ({ invoiceId: invId, careCostEntryId: e.id })),
          skipDuplicates: true,
        });
    }
  }
}

async function seedOperatingHistory(tx: Tx) {
  const tasks: Prisma.DailyCareTaskCreateManyInput[] = [];
  const logs: Prisma.DailyGroomingLogCreateManyInput[] = [];
  const costs: Prisma.CareCostEntryCreateManyInput[] = [];
  const rosters: Prisma.ShiftRosterCreateManyInput[] = [];
  const medical: Prisma.MedicalRecordCreateManyInput[] = [];
  const plans: Prisma.TrainingPlanCreateManyInput[] = [];
  const workouts: Prisma.WorkoutSessionCreateManyInput[] = [];
  const restocks: Prisma.RestockRequestCreateManyInput[] = [];
  const preventive: Prisma.PreventiveScheduleCreateManyInput[] = [];
  const monthNames = [
    'Xây nền thể lực',
    'Ổn định nhịp bước',
    'Phát triển sức bền',
    'Chuẩn bị mùa giải',
  ];
  const morningGrooms = {
    A: userIds.grooms[0],
    B: userIds.grooms[1],
    C: userIds.grooms[2],
    H: userIds.grooms[8],
  };
  const afternoonGrooms = {
    A: userIds.grooms[3],
    B: userIds.grooms[5],
    C: userIds.grooms[7],
    H: userIds.grooms[9],
  };
  const dateAt = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
  for (let d = new Date(BUSINESS_START); d < days(-14); d = new Date(+d + DAY_MS)) {
    const date = clubDate(d);
    const day = new Date(`${date}T00:00:00.000Z`);
    for (const [barn, groomUserId] of Object.entries(morningGrooms)) {
      rosters.push({
        id: id(`roster:history:${date}:${barn}:morning`),
        date: day,
        zoneId: zoneIds[barn],
        shiftId: shiftIds.MORNING,
        groomUserId,
        createdById: userIds.manager,
        createdAt: d,
      });
      rosters.push({
        id: id(`roster:history:${date}:${barn}:afternoon`),
        date: day,
        zoneId: zoneIds[barn],
        shiftId: shiftIds.AFTERNOON,
        groomUserId: afternoonGrooms[barn],
        createdById: userIds.manager,
        createdAt: d,
      });
    }
    for (const [i, h] of HORSES.entries()) {
      if (!h.stallId) continue;
      // Dạ Nguyệt moved to the debt barn recently; earlier history remains in B10.
      const barn = i === 16 && d < days(-20) ? 'B' : zoneFor(h);
      const stallId = i === 16 && d < days(-20) ? stallIds.B[9] : h.stallId;
      const meals = [
        { time: '05:30', meal: 'MORNING', hay: 3.2, grain: 1.5 },
        { time: '11:30', meal: 'NOON', hay: 2, grain: 0 },
        { time: '18:00', meal: 'EVENING', hay: 2.8, grain: 1.5 },
      ];
      for (const meal of meals) {
        const groom = meal.meal === 'EVENING' ? afternoonGrooms[barn] : morningGrooms[barn];
        const performedAt = new Date(+dateAt(date, meal.time) + 15 * 60000);
        const taskId = id(`task:history:${date}:${h.id}:${meal.meal}`);
        const items = [
          {
            supplyId: supplyIds.timothyHay,
            supplyName: 'Cỏ khô Timothy',
            amount: meal.hay,
            unit: 'KG',
            price: 20_000,
          },
          ...(meal.grain
            ? [
                {
                  supplyId: supplyIds.oatGrain,
                  supplyName: 'Cám yến mạch',
                  amount: meal.grain,
                  unit: 'KG',
                  price: 24_000,
                },
              ]
            : []),
        ];
        tasks.push({
          id: taskId,
          date: day,
          horseId: h.id,
          stallZoneId: zoneIds[barn],
          stallId,
          taskCode: `TASK-${date.replaceAll('-', '')}-${String(i + 1).padStart(3, '0')}-${meal.meal}`,
          taskType: DailyTaskType.FEEDING,
          mealType: meal.meal,
          title: `Cho ăn ${meal.meal === 'MORNING' ? 'sáng' : meal.meal === 'NOON' ? 'trưa' : 'tối'} – ${h.name}`,
          scheduledTime: meal.time,
          shiftId: meal.meal === 'EVENING' ? shiftIds.AFTERNOON : shiftIds.MORNING,
          assignedGroomUserId: groom,
          completedById: groom,
          isCompleted: true,
          completedAt: performedAt,
          completionVersion: 1,
          itemsSnapshotJson: items.map(({ price: _price, ...item }) => item),
          createdAt: d,
        });
        if (date.slice(0, 7) >= BILLING_CUTOVER)
          for (const item of items)
            costs.push({
              id: id(`cost:${taskId}:${item.supplyId}`),
              operationKey: `seed:${taskId}:1:${item.supplyId}`,
              horseId: h.id,
              sourceTaskId: taskId,
              completionVersion: 1,
              supplyId: item.supplyId,
              stockZoneId: zoneIds[barn],
              performedAt,
              quantity: item.amount,
              unit: item.unit,
              unitPriceSnapshot: item.price,
              amount: item.amount * item.price,
              entryType: CareCostEntryType.CONSUMPTION,
              actorId: groom,
              supplyName: item.supplyName,
              createdAt: performedAt,
            });
      }
      for (const [taskType, time, title] of [
        [DailyTaskType.CLEANING, '12:00', 'Thay độn và vệ sinh máng nước'],
        [DailyTaskType.GROOMING, '16:00', 'Chải lông và kiểm tra móng'],
      ]) {
        const groom = time < '13:00' ? morningGrooms[barn] : afternoonGrooms[barn];
        tasks.push({
          id: id(`task:history:${date}:${h.id}:${taskType}`),
          date: day,
          horseId: h.id,
          stallZoneId: zoneIds[barn],
          stallId,
          taskType: taskType as DailyTaskType,
          title: `${title} – ${h.name}`,
          scheduledTime: time,
          shiftId: time < '13:00' ? shiftIds.MORNING : shiftIds.AFTERNOON,
          assignedGroomUserId: groom,
          completedById: groom,
          isCompleted: true,
          completionVersion: 1,
          completedAt: new Date(+dateAt(date, time) + 15 * 60000),
          createdAt: d,
        });
      }
      logs.push({
        id: id(`groomlog:history:${date}:${h.id}`),
        horseId: h.id,
        groomUserId: morningGrooms[barn],
        shiftDate: dateAt(date, '12:30'),
        shiftType: ShiftType.MORNING,
        feedCompleted: true,
        cleaningCompleted: true,
        groomingCompleted: false,
        healthObservations: [
          'Ăn đủ khẩu phần, phân và nước uống bình thường.',
          'Tinh thần tỉnh táo, không ghi nhận vết trầy mới.',
          'Máng ăn sạch; đã bàn giao lượng thức ăn còn lại cho ca chiều.',
        ][(i + d.getUTCDate()) % 3],
        createdAt: d,
      });
    }
  }
  for (let m = 0; m < 12; m++) {
    const period = clubDate(new Date(Date.UTC(2025, 11 + m, 1))).slice(0, 7);
    const { start, end } = boardingMonth(period);
    if (start > now) continue;
    for (const [i, h] of HORSES.entries()) {
      const examDate = new Date(
        `${period}-${String(3 + (i % 10)).padStart(2, '0')}T13:30:00+07:00`,
      );
      if (
        examDate >= now ||
        (i === 17 && examDate >= days(-18)) ||
        (i === 18 && examDate >= days(-32))
      )
        continue;
      const medId = id(`medrec:history:${period}:${h.id}`);
      medical.push({
        id: medId,
        horseId: h.id,
        veterinarianUserId: [userIds.vet, userIds.vet2, userIds.vet3, userIds.vet4][i % 4],
        recordNumber: `BA-${period.slice(2).replace('-', '')}-${String(i + 1).padStart(3, '0')}`,
        examinationDate: examDate,
        examinationType: 'ROUTINE',
        status: MedicalRecordStatus.CLOSED,
        severity: SeverityLevel.MILD,
        temperature: 37.6 + (i % 4) * 0.1,
        restingHeartRate: 38 + (i % 8),
        respiratoryRate: 12 + (i % 5),
        weightKg: h.weightKg - 8 + (m % 5) * 2,
        symptoms: 'Kiểm tra sức khỏe định kỳ hàng tháng.',
        clinicalDiagnosis: 'Thể trạng ổn định, chưa ghi nhận dấu hiệu cấp tính.',
        treatmentProtocol: 'Duy trì khẩu phần đã duyệt, theo dõi cân nặng và lượng nước uống.',
        conclusion: 'Đã hoàn tất kiểm tra và bàn giao kết quả cho chủ ngựa.',
        treatmentResult: 'Ổn định',
        closedAt: new Date(+examDate + 30 * 60000),
        createdAt: examDate,
      });
      if (period >= BILLING_CUTOVER)
        costs.push({
          id: id(`cost:exam:${medId}`),
          operationKey: `seed:exam:${medId}`,
          horseId: h.id,
          medicalRecordId: medId,
          performedAt: examDate,
          quantity: 1,
          unit: 'Lần khám',
          unitPriceSnapshot: 3_000_000,
          amount: 3_000_000,
          entryType: CareCostEntryType.EXAM,
          actorId: medical[medical.length - 1].veterinarianUserId,
          supplyName: 'Khám định kỳ',
          recordNumber: medical[medical.length - 1].recordNumber,
          veterinarianName: [
            'BS. Phạm Minh Trí',
            'BS. Nguyễn Thảo Vy',
            'BS. Trần Đình Khôi',
            'BS. Lê Phương Anh',
          ][i % 4],
          createdAt: examDate,
        });
      if (h.stallId && m % 3 === 0)
        preventive.push({
          id: id(`preventive:history:${period}:${h.id}`),
          horseId: h.id,
          typeCatalogId: preventiveTypeIds.DEWORMING,
          scheduleType: PreventiveType.DEWORMING,
          notes: 'Tẩy giun định kỳ theo quý',
          dueDate: examDate,
          status: PreventiveStatus.COMPLETED,
          completedDate: examDate,
          veterinarianUserId: userIds.vet,
          productAdministered: 'Thuốc tẩy giun theo chỉ định',
          performedByMode: 'SELF',
        });
      if (i >= 14 || h.status === HorseStatus.RETIRED || start >= days(-42)) continue;
      const planEnd = new Date(Math.min(+end - DAY_MS, +days(-43)));
      const code = `GA-${String(100 + m * 20 + i).padStart(6, '0')}`;
      const planId = id(`plan:history:${period}:${h.id}`);
      plans.push({
        id: planId,
        planCode: code,
        horseId: h.id,
        trainerUserId: trainerFor(i),
        phaseName: `${monthNames[m % 4]} – ${h.name} – ${period}`,
        objective: 'Theo dõi tiến bộ theo chu kỳ và phối hợp bộ phận thú y',
        startDate: start,
        endDate: planEnd,
        status: i === 13 && m === 9 ? PlanStatus.CANCELLED : PlanStatus.COMPLETED,
        cancelReason: i === 13 && m === 9 ? 'Chủ ngựa yêu cầu chuyển sang nghỉ dưỡng' : null,
        completionSummary:
          i === 13 && m === 9
            ? null
            : 'Đã hoàn thành chu kỳ; nhịp tim hồi phục và dáng chạy ổn định.',
        phases: phaseFor(code, start, planEnd),
        trackSurface: TrackSurface.TURF,
        createdAt: start,
      });
      for (let date = new Date(+start + DAY_MS); date <= planEnd; date = new Date(+date + DAY_MS)) {
        if (![1, 3, 5].includes(date.getUTCDay()) || (i === 13 && m === 9)) continue;
        const afternoon = i % 7 >= 4;
        const slot = (i % 7) % 4;
        const scheduledDate = dateAt(
          clubDate(date),
          `${String((afternoon ? 13 : 6) + Math.floor((slot * 75) / 60)).padStart(2, '0')}:${String((slot * 75) % 60).padStart(2, '0')}`,
        );
        const speed = 30 + (m % 4) * 2 + (i % 5);
        workouts.push({
          id: id(`workout:history:${clubDate(date)}:${h.id}`),
          trainingPlanId: planId,
          horseId: h.id,
          phaseId: `${code}-PH1`,
          trackId: id(zoneFor(h) === 'A' ? 'TRK-TURF' : 'TRK-DIRT'),
          assignedStaffUserId:
            userIds.grooms[zoneFor(h) === 'A' ? (i % 7 >= 4 ? 3 : 0) : i % 7 >= 4 ? 5 : 1],
          scheduledDate,
          distanceMeters: 1400,
          repetitions: 1,
          targetSpeedKmh: speed,
          status: WorkoutStatus.COMPLETED,
          workoutType: 'CANTER',
          intensity: 'MEDIUM',
          trackSurface: zoneFor(h) === 'A' ? 'TURF' : 'DIRT',
          actualSurface: zoneFor(h) === 'A' ? 'TURF' : 'DIRT',
          actualDistanceMeters: 1400,
          actualTimeSeconds: Number((5040 / speed).toFixed(2)),
          averageSpeedKmh: speed,
          topSpeedKmh: speed + 4,
          heartRatePeak: 170 + i,
          heartRateRecovery: 42 + (i % 8),
          performanceScore: 7 + (m % 3) * 0.5,
          completionLevel: 'FULL',
          resultNotes: 'Hoàn tất cự ly; đã đi bộ hạ nhiệt và kiểm tra chân.',
          resultRecordedAt: new Date(+scheduledDate + 65 * 60000),
          resultRecordedById: trainerFor(i),
          createdAt: date,
        });
      }
    }
    for (const barn of ['A', 'B', 'C', 'H'] as const) {
      for (const [supplyId, name, quantity] of [
        [supplyIds.timothyHay, 'cỏ khô Timothy', 2400],
        [supplyIds.oatGrain, 'yến mạch', 900],
      ] as const) {
        const deliveredAt = new Date(`${period}-01T04:00:00+07:00`);
        restocks.push({
          id: id(`restock:history:${period}:${barn}:${supplyId}`),
          requestNumber: `RST-${period.replace('-', '')}-${barn}-${supplyId.slice(0, 4)}`,
          zoneId: zoneIds[barn],
          supplyId,
          requestedQuantity: quantity,
          approvedQuantity: quantity,
          status: RestockStatus.DELIVERED,
          urgencyReason: `Bổ sung ${name} theo dự trù tháng ${period}`,
          requestedById: morningGrooms[barn],
          reviewedById: userIds.manager,
          reviewedAt: new Date(+deliveredAt - 12 * 3600000),
          deliveredAt,
          deliveredById: morningGrooms[barn],
          createdAt: new Date(+deliveredAt - DAY_MS),
        });
      }
    }
  }
  // Batch inserts stay below PostgreSQL's parameter limit for a full year of care records.
  const insert = async (
    delegate: { createMany: (...args: any[]) => Promise<any> },
    data: any[],
  ) => {
    for (let offset = 0; offset < data.length; offset += 500)
      await delegate.createMany({ data: data.slice(offset, offset + 500), skipDuplicates: true });
  };
  await insert(tx.shiftRoster, rosters);
  await insert(tx.medicalRecord, medical);
  await insert(tx.preventiveSchedule, preventive);
  await insert(tx.trainingPlan, plans);
  await insert(tx.workoutSession, workouts);
  await insert(tx.dailyCareTask, tasks);
  await insert(tx.dailyGroomingLog, logs);
  const supplies = await tx.supplyCatalog.findMany();
  const recentTasks = await tx.dailyCareTask.findMany({
    where: { isCompleted: true, date: { gte: days(-15) } },
  });
  for (const task of recentTasks) {
    if (!task.completedAt || !task.completedById || !Array.isArray(task.itemsSnapshotJson))
      continue;
    for (const item of task.itemsSnapshotJson as Array<{
      supplyId?: string;
      amount?: number;
      dosage?: string;
    }>) {
      const supply = supplies.find((s) => s.id === item.supplyId);
      const quantity = Number(item.amount ?? item.dosage);
      if (!supply || !Number.isFinite(quantity) || quantity <= 0) continue;
      costs.push({
        id: id(`cost:${task.id}:${supply.id}`),
        operationKey: `seed:${task.id}:1:${supply.id}`,
        horseId: task.horseId,
        sourceTaskId: task.id,
        completionVersion: task.completionVersion,
        supplyId: supply.id,
        stockZoneId: task.stallZoneId,
        performedAt: task.completedAt,
        quantity,
        unit: supply.unit,
        unitPriceSnapshot: supply.unitPrice,
        amount: Number(supply.unitPrice) * quantity,
        entryType: CareCostEntryType.CONSUMPTION,
        actorId: task.completedById,
        supplyName: supply.name,
        createdAt: task.completedAt,
      });
    }
  }
  await insert(tx.careCostEntry, costs);
  await insert(tx.restockRequest, restocks);
  // A completed care action corrected once; the charge and its reversal remain auditable.
  const original = costs.find(
    (c) =>
      c.entryType === CareCostEntryType.CONSUMPTION &&
      monthOf(new Date(c.performedAt)) === '2026-10',
  );
  if (original)
    await tx.careCostEntry.createMany({
      data: [
        {
          ...original,
          id: id('cost:reversal'),
          operationKey: 'seed:cost:reversal',
          reversesEntryId: original.id,
          entryType: CareCostEntryType.REVERSAL,
          quantity: -Number(original.quantity),
          amount: -Number(original.amount),
          performedAt: new Date(+new Date(original.performedAt) + 5 * 60000),
        },
      ],
      skipDuplicates: true,
    });
  await tx.trainerReview.createMany({
    data: plans
      .filter((p) => p.status === PlanStatus.COMPLETED)
      .map((p, i) => ({
        id: id(`review:${p.id}`),
        trainingPlanId: p.id!,
        trainerUserId: p.trainerUserId,
        ownerUserId: HORSES.find((h) => h.id === p.horseId)!.ownerId,
        rating: [5, 4, 5, 3, 4, 2][i % 6],
        comment: [
          'Ngựa tiến bộ đều, báo cáo rõ ràng.',
          'Phối hợp tốt với bác sĩ và nhân viên chăm sóc.',
          'Cần cập nhật kết quả nhanh hơn sau buổi tập.',
          'Khối lượng tập cần cân đối thêm thời gian phục hồi.',
        ][i % 4],
        createdAt: new Date(+new Date(p.endDate) + DAY_MS),
      })),
    skipDuplicates: true,
  });
}

async function seedAdmissionsAndPeople(tx: Tx) {
  // Intake profiles cover each pending and unsuccessful admission stage.
  const states = [
    AdmissionStatus.PENDING_VERIFICATION,
    AdmissionStatus.APPOINTED,
    AdmissionStatus.INSPECTION_IN_PROGRESS,
    AdmissionStatus.REJECTED,
    AdmissionStatus.CANCELLED,
  ];
  for (const [i, status] of states.entries()) {
    const horseId = id(`horse:intake:${i}`),
      admissionId = id(`admission:intake:${i}`);
    const chip = `98500000000100${i}`;
    await tx.horse.createMany({
      data: [
        {
          id: horseId,
          horseCode: `HR-${String(20 + i).padStart(6, '0')}`,
          name: ['Ánh Dương', 'Ngân Hà', 'Hắc Long Mã', 'Sơn Tùng', 'Bình Minh'][i],
          ownerId: userIds.owners[i % 3],
          microchip: chip,
          microchipRfid: chip,
          breed: 'Thoroughbred',
          color: 'Bay',
          gender: i % 2 ? 'Mare' : 'Stallion',
          dob: new Date('2022-04-15T00:00:00+07:00'),
          weightKg: 460 + i * 7,
          avatarUrl: `/images/horses/horse-${String(i + 1).padStart(2, '0')}.jpg`,
          status:
            status === AdmissionStatus.REJECTED
              ? HorseStatus.REJECTED
              : HorseStatus.PENDING_ADMISSION,
          createdAt: days(-6),
        },
      ],
      skipDuplicates: true,
    });
    const inspected =
      status === AdmissionStatus.INSPECTION_IN_PROGRESS || status === AdmissionStatus.REJECTED;
    const appointed = status === AdmissionStatus.APPOINTED || inspected;
    await tx.horseAdmissionRecord.createMany({
      data: [
        {
          id: admissionId,
          admissionCode: `ADM-2026-${String(20 + i).padStart(3, '0')}`,
          horseId,
          ownerId: userIds.owners[i % 3],
          status,
          declaredMicrochip: chip,
          scannedMicrochip: inspected ? chip : null,
          microchipVerified: inspected,
          legalVerified: inspected,
          legalDocumentsNote: inspected
            ? 'Đã đối chiếu hộ chiếu ngựa và xác nhận quyền sở hữu.'
            : null,
          appointmentDate: appointed
            ? days(status === AdmissionStatus.APPOINTED ? 2 : -1, 14, i * 10)
            : null,
          appointmentEndDate: appointed
            ? days(status === AdmissionStatus.APPOINTED ? 2 : -1, 14, i * 10 + 10)
            : null,
          managerUserId: appointed ? userIds.manager : null,
          veterinarianUserId: inspected ? userIds.vet : null,
          isHealthEligible: inspected ? status !== AdmissionStatus.REJECTED : null,
          healthFinalizedAt: inspected ? days(-1, 16) : null,
          healthCheckNotes: inspected
            ? status === AdmissionStatus.REJECTED
              ? 'Chưa đạt điều kiện kiểm dịch; cần hoàn thiện hồ sơ xét nghiệm.'
              : 'Đủ điều kiện tiếp nhận sau thẩm định.'
            : null,
          rejectionReason:
            status === AdmissionStatus.REJECTED
              ? 'Chưa hoàn thành yêu cầu kiểm dịch đầu vào'
              : null,
          ownerNotes:
            'Đăng ký chăm sóc lưu chuồng và huấn luyện dài hạn, cập nhật sức khỏe hàng tuần.',
          createdAt: days(-6),
        },
      ],
      skipDuplicates: true,
    });
    const path = [
      AdmissionStatus.PENDING_VERIFICATION,
      ...(appointed ? [AdmissionStatus.APPOINTED] : []),
      ...(inspected ? [AdmissionStatus.INSPECTION_IN_PROGRESS] : []),
      ...([AdmissionStatus.REJECTED, AdmissionStatus.CANCELLED].includes(status as any)
        ? [status]
        : []),
    ];
    await tx.admissionHistoryLog.createMany({
      data: path.map((step, n) => ({
        id: id(`admission:log:${admissionId}:${n}`),
        admissionId,
        fromStatus: n ? path[n - 1] : null,
        toStatus: step,
        actorUserId: n ? userIds.manager : userIds.owners[i % 3],
        actorName: n
          ? 'Trần Quang Minh'
          : ['Phạm Gia Bảo', 'Đặng Hoàng Yến', 'Vũ Quốc Hưng'][i % 3],
        note: n ? 'Cập nhật kết quả xử lý hồ sơ tiếp nhận.' : 'Chủ ngựa nộp hồ sơ đăng ký.',
        createdAt: days(-6 + n, 10),
      })),
      skipDuplicates: true,
    });
    if (inspected)
      await tx.admissionHealthReview.createMany({
        data: [
          {
            id: id(`admission:health:${admissionId}`),
            admissionId,
            veterinarianUserId: userIds.vet,
            veterinarianName: 'BS. Phạm Minh Trí',
            isHealthEligible: status !== AdmissionStatus.REJECTED,
            notes:
              status === AdmissionStatus.REJECTED
                ? 'Cần bổ sung xét nghiệm kiểm dịch.'
                : 'Sinh hiệu và khả năng vận động đạt yêu cầu.',
            createdAt: days(-1, 15),
          },
        ],
        skipDuplicates: true,
      });
  }
  // Approved intake histories explain how the resident herd entered the club.
  for (const [i, h] of HORSES.entries()) {
    const admissionId = id(`admission:resident:${h.id}`);
    await tx.horseAdmissionRecord.createMany({
      data: [
        {
          id: admissionId,
          admissionCode: `ADM-2025-${String(i + 1).padStart(3, '0')}`,
          horseId: h.id,
          ownerId: h.ownerId,
          status: AdmissionStatus.APPROVED,
          declaredMicrochip: h.microchip,
          scannedMicrochip: h.microchip,
          microchipVerified: true,
          legalVerified: true,
          isHealthEligible: true,
          veterinarianUserId: userIds.vet,
          approvedByUserId: userIds.manager,
          healthCheckNotes: 'Đạt điều kiện lưu chuồng; đã bàn giao kết quả khám đầu vào.',
          healthFinalizedAt: BUSINESS_START,
          admittedAt: BUSINESS_START,
          createdAt: new Date(+BUSINESS_START - 3 * DAY_MS),
        },
      ],
      skipDuplicates: true,
    });
    const path = [
      AdmissionStatus.PENDING_VERIFICATION,
      AdmissionStatus.APPOINTED,
      AdmissionStatus.INSPECTION_IN_PROGRESS,
      AdmissionStatus.APPROVED,
    ];
    await tx.admissionHistoryLog.createMany({
      data: path.map((step, n) => ({
        id: id(`admission:resident:log:${h.id}:${n}`),
        admissionId,
        fromStatus: n ? path[n - 1] : null,
        toStatus: step,
        actorUserId: userIds.manager,
        actorName: 'Trần Quang Minh',
        note: [
          'Tiếp nhận hồ sơ chủ ngựa',
          'Hẹn kiểm tra pháp lý và sức khỏe',
          'Đã đối chiếu vi mạch và kết quả khám',
          'Phê duyệt tiếp nhận; bàn giao nhân viên chăm sóc',
        ][n],
        createdAt: new Date(+BUSINESS_START - (3 - n) * DAY_MS),
      })),
      skipDuplicates: true,
    });
    await tx.admissionHealthReview.createMany({
      data: [
        {
          id: id(`admission:resident:health:${h.id}`),
          admissionId,
          veterinarianUserId: userIds.vet,
          veterinarianName: 'BS. Phạm Minh Trí',
          isHealthEligible: true,
          notes: 'Hoàn thành khám sàng lọc và xác nhận đủ điều kiện nhập trại.',
          createdAt: BUSINESS_START,
        },
      ],
      skipDuplicates: true,
    });
  }
  const handovers: Array<[number, HandoverStatus, number]> = [
    [10, HandoverStatus.PENDING, 36],
    [13, HandoverStatus.PENDING, 6],
    [8, HandoverStatus.ACCEPTED, -24],
    [12, HandoverStatus.REJECTED, -24],
    [7, HandoverStatus.EXPIRED, -24],
    [13, HandoverStatus.CANCELLED, -48],
  ];
  for (const [n, [i, status, hours]] of handovers.entries()) {
    const expiresAt = new Date(+now + hours * 3600000),
      trainer = trainerFor(i);
    await tx.horseHandoverRequest.createMany({
      data: [
        {
          id: id(`handover:${n}`),
          horseId: horseIds[i],
          fromManagerId: userIds.manager,
          toTrainerId: trainer,
          status,
          token: sha256Hex(`seed:handover:${n}`),
          expiresAt,
          acceptedAt: status === HandoverStatus.ACCEPTED ? days(-3) : null,
          planDeadlineAt: status === HandoverStatus.ACCEPTED ? days(-1) : null,
          notes:
            status === HandoverStatus.REJECTED
              ? 'Đề nghị bàn giao lại khi hoàn tất đánh giá thể lực.'
              : 'Bàn giao hồ sơ sức khỏe, khẩu phần và lịch sử vận động.',
          createdAt: new Date(+expiresAt - 48 * 3600000),
        },
      ],
      skipDuplicates: true,
    });
    if (status === HandoverStatus.PENDING || status === HandoverStatus.REJECTED)
      await tx.horse.update({
        where: { id: horseIds[i] },
        data: {
          assignedTrainerId: trainer,
          trainerAssignmentStatus:
            status === HandoverStatus.PENDING
              ? TrainerAssignmentStatus.PENDING_ACCEPTANCE
              : TrainerAssignmentStatus.DECLINED,
          trainerAssignedAt: new Date(+expiresAt - 48 * 3600000),
          trainerResponseDeadline: expiresAt,
          trainerRespondedAt: status === HandoverStatus.REJECTED ? days(-2) : null,
          trainerDeclineReason:
            status === HandoverStatus.REJECTED ? 'Chưa đủ kết quả đánh giá thể lực' : null,
        },
      });
  }
  for (const [i, status] of Object.values(HorseTransferStatus).entries()) {
    const h = HORSES[[11, 6, 5, 4][i]];
    await tx.horseTransferRequest.createMany({
      data: [
        {
          id: id(`transfer:${status}`),
          horseId: h.id,
          fromOwnerId: status === HorseTransferStatus.APPROVED ? userIds.owners[5] : h.ownerId,
          toOwnerId: status === HorseTransferStatus.APPROVED ? h.ownerId : userIds.owners[5],
          requestedById: userIds.manager,
          reason: 'Điều chỉnh danh mục chiến mã theo thỏa thuận giữa hai chủ ngựa.',
          status,
          fromConfirmedAt: status === HorseTransferStatus.APPROVED ? days(-31) : null,
          toConfirmedAt: status === HorseTransferStatus.APPROVED ? days(-30) : null,
          decidedAt: status === HorseTransferStatus.PENDING ? null : days(-30),
          rejectedById: status === HorseTransferStatus.REJECTED ? h.ownerId : null,
          rejectReason:
            status === HorseTransferStatus.REJECTED
              ? 'Hai bên chưa thống nhất điều kiện chuyển nhượng.'
              : null,
          createdAt: days(-32),
        },
      ],
      skipDuplicates: true,
    });
  }
  const complaintReasons = [
    'Kết quả buổi tập cập nhật chậm; đề nghị đối chiếu nhật ký và giải trình.',
    'Ca chăm sóc bàn giao thiếu thông tin về lượng thức ăn còn lại.',
    'Chưa ghi đầy đủ chỉ số hồi phục sau buổi tập theo quy trình.',
    'Phản ánh thay đổi giờ tập; đã kiểm tra và xác nhận quản lý duyệt trước.',
  ];
  for (const [i, status] of Object.values(ComplaintStatus).entries()) {
    const closed =
      status === ComplaintStatus.VIOLATION_CONFIRMED || status === ComplaintStatus.DISMISSED;
    await tx.complaint.createMany({
      data: [
        {
          id: id(`complaint:${status}`),
          code: `CMP-${dateStrOffset(-6 - i).replaceAll('-', '')}-${String(i + 1).padStart(3, '0')}`,
          subjectUserId: [userIds.trainer2, userIds.grooms[1], userIds.trainer3, userIds.trainer][
            i
          ],
          reporterId: userIds.manager2,
          reason: complaintReasons[i],
          evidenceJson: [],
          status,
          reviewedById: i ? userIds.manager : null,
          reviewedAt: i ? days(-2) : null,
          responseDueAt: closed ? null : days(3, 17),
          reviewNote: i ? 'Đã đối chiếu lịch làm việc và trao đổi với nhân viên liên quan.' : null,
          conclusion: closed
            ? status === ComplaintStatus.DISMISSED
              ? 'Không có vi phạm; lịch đã được phê duyệt.'
              : 'Xác nhận thiếu sót ghi nhận nhật ký sau tập.'
            : null,
          regulation:
            status === ComplaintStatus.VIOLATION_CONFIRMED
              ? 'Quy trình bàn giao và ghi nhận kết quả huấn luyện'
              : null,
          measures:
            status === ComplaintStatus.VIOLATION_CONFIRMED
              ? 'Nhắc nhở bằng văn bản, đào tạo lại và theo dõi hai tuần.'
              : null,
          createdAt: days(-6 - i),
        },
      ],
      skipDuplicates: true,
    });
  }
  const staff = [
    userIds.manager,
    userIds.manager2,
    userIds.trainer,
    userIds.trainer2,
    userIds.trainer3,
    userIds.trainer4,
    userIds.vet,
    userIds.vet2,
    userIds.vet3,
    userIds.vet4,
  ];
  await tx.staffWorkItem.createMany({
    data: staff.flatMap((userId, i) =>
      [-7, -3, 1, 4, 10, 17].map((d) => ({
        id: id(`staff-work:${userId}:${dateStrOffset(d)}`),
        userId,
        title: [
          'Đối soát hồ sơ và lịch vận hành',
          'Họp phối hợp huấn luyện – thú y',
          'Báo cáo tuần cho chủ ngựa',
        ][Math.abs(d) % 3],
        startsAt: days(d, 15, (i % 2) * 30),
        endsAt: days(d, 15, (i % 2) * 30 + 25),
        location: 'Phòng điều hành CLB',
        status: d < 0 ? 'DONE' : 'PENDING',
        notes: 'Kiểm tra các đầu việc tồn đọng và ghi nhận người chịu trách nhiệm.',
        createdById: userIds.manager,
        createdAt: days(-10),
      })),
    ),
    skipDuplicates: true,
  });
  await tx.incidentReport.createMany({
    data: [
      {
        id: id('inc:merged'),
        horseId: horseIds[1],
        stallZoneId: zoneIds.A,
        reportedById: userIds.grooms[3],
        severity: SeverityLevel.MODERATE,
        symptomsJson: ['LIMPING'],
        description: 'Đi khập khiễng sau tập; đã chuyển bác sĩ theo dõi trong bệnh án hiện hành.',
        status: IncidentStatus.MERGED_INTO_TREATMENT,
        medicalRecordId: id('medrec:open:h2'),
        reviewedById: userIds.vet,
        reviewedAt: days(-9, 10),
        createdAt: days(-10, 9),
        vetNotes: 'Gộp vào đợt điều trị gân, tránh tạo hai bệnh án đang mở.',
      },
    ],
    skipDuplicates: true,
  });
  const invoices = await tx.financialInvoice.findMany();
  await tx.businessMailing.createMany({
    data: invoices
      .filter((inv) => inv.status === InvoiceStatus.PAID)
      .slice(0, 24)
      .map((inv, i) => ({
        id: id(`mail:invoice:${inv.id}`),
        eventCode: 'INVOICE_PAID',
        refId: inv.id,
        userId: inv.ownerId,
        toEmail: `owner${userIds.owners.indexOf(inv.ownerId) === 0 ? '' : userIds.owners.indexOf(inv.ownerId) + 1}@gmail.com`,
        subject: `Xác nhận đối soát hóa đơn ${inv.billingPeriod}`,
        bodyText: `CLB đã đối soát hóa đơn kỳ ${inv.billingPeriod}. Vui lòng xem chi tiết tại trang hóa đơn.`,
        dedupeKey: `seed:mail:${inv.id}`,
        status: i === 0 ? MailingStatus.FAILED : MailingStatus.SENT,
        accepted: i !== 0,
        attempts: 1,
        lastError: i === 0 ? 'Mẫu lịch sử lỗi gửi thư; chưa gửi lại.' : null,
        createdAt: new Date(+inv.createdAt + 3 * DAY_MS),
      })),
    skipDuplicates: true,
  });
}

async function seedActivityAndSupport(tx: Tx) {
  const categories = Object.values(NotificationCategory);
  const users = [
    userIds.manager,
    userIds.trainer,
    userIds.vet,
    ...userIds.grooms,
    ...userIds.owners,
  ];
  await tx.notification.createMany({
    data: users.flatMap((userId, i) =>
      categories.map((category, n) => ({
        id: id(`notif:${userId}:${category}`),
        userId,
        category,
        type: `CLUB_${category}_UPDATE`,
        title: [
          'Cập nhật hồ sơ tài khoản',
          'Cập nhật hồ sơ chiến mã',
          'Báo cáo huấn luyện',
          'Thông tin khóa y tế',
          'Theo dõi sức khỏe định kỳ',
          'Cập nhật thực đơn',
          'Thông báo vận hành CLB',
        ][n],
        message:
          'Có cập nhật thuộc phạm vi công việc của bạn. Vui lòng kiểm tra danh sách để xử lý và bàn giao.',
        link: userIds.owners.includes(userId) ? '/horses' : '/notifications',
        dedupeKey: `seed:notif:${userId}:${category}`,
        readAt: (i + n) % 3 ? days(-1, 16) : null,
        createdAt: days(-3 - n, 10),
      })),
    ),
    skipDuplicates: true,
  });
  const plans = await tx.trainingPlan.findMany();
  await tx.auditLog.createMany({
    data: plans
      .filter((p) => p.status === PlanStatus.COMPLETED)
      .map((p) => ({
        id: id(`audit:plan:${p.id}`),
        userId: p.trainerUserId,
        action: 'TRAINING_PLAN_COMPLETED',
        entityName: 'TrainingPlan',
        entityId: p.id,
        timestamp: p.endDate,
        newValuesJson: JSON.stringify({
          planCode: p.planCode,
          status: p.status,
          summary: p.completionSummary,
        }),
      })),
    skipDuplicates: true,
  });
  const invoices = await tx.financialInvoice.findMany();
  await tx.auditLog.createMany({
    data: invoices.map((inv) => ({
      id: id(`audit:invoice:${inv.id}`),
      userId: userIds.manager,
      action: `INVOICE_${inv.status}`,
      entityName: 'FinancialInvoice',
      entityId: inv.id,
      timestamp: inv.paidAt ?? inv.createdAt,
      newValuesJson: JSON.stringify({
        billingPeriod: inv.billingPeriod,
        status: inv.status,
        netAmount: Number(inv.netAmount),
      }),
    })),
    skipDuplicates: true,
  });
  for (const [name, minValue] of [
    ['horse_code', 100],
    ['training_plan', 500],
    ['request_code', 100],
    ['forbidden_ref', 100],
  ] as const) {
    const existing = await tx.counter.findUnique({ where: { name } });
    if (!existing) await tx.counter.create({ data: { name, value: minValue } });
    else if (existing.value < minValue)
      await tx.counter.update({ where: { name }, data: { value: minValue } });
  }
}

export async function seedFixtures(tx: Tx, passwordHash: string, reset = false) {
  if (reset) await clearFixtures(tx);
  await seedClub(tx, passwordHash);
  await seedMedical(tx);
  await seedTraining(tx);
  await seedStableCare(tx);
  await seedOperatingHistory(tx);
  await seedRacingAndInvoices(tx);
  await seedAdmissionsAndPeople(tx);
  await seedActivityAndSupport(tx);
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  if (RESET_FLAG && process.env.NODE_ENV === 'production') {
    throw new Error(
      'Seed --reset is disabled in production. Back up and use a separate demo database.',
    );
  }
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const password = await bcrypt.hash('EquiFlow@2026', 10);
    await prisma.$transaction(
      async (tx) => {
        await seedFixtures(tx, password, RESET_FLAG);
      },
      { timeout: 300000, maxWait: 10000 },
    );

    const modelCount = Prisma.dmmf.datamodel.models.length;
    console.log(
      `[seed] Canonical EquiFlow seed completed (${RESET_FLAG ? 'reset+seed' : 'idempotent'}) across all ${modelCount} Prisma models.`,
    );
    console.log(
      '[seed] Business history: December 2025 onward; invoices: December 2025–October 2026 only. 24 horses, 48 stalls, 10 active grooms, 4 vets, 4 trainers, 2 managers, 6 owners.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module)
  main().catch((err) => {
    console.error('[seed] Failed:', err);
    process.exit(1);
  });
