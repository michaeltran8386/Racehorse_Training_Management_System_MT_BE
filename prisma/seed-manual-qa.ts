/**
 * EquiFlow — Controlled Manual-QA Dataset Expansion (TASK-020)
 *
 * Populates abundant, deterministic, idempotent manual-QA fixtures into the local PostgreSQL database.
 * Safety requirements:
 * 1. Requires explicit `--confirm-local-qa` CLI argument.
 * 2. Refuses execution in production (NODE_ENV=production or production database target).
 * 3. Prints sanitized target host and database before any mutation.
 * 4. Deterministic QA-only IDs/codes/emails (emails prefixed with qa-, codes with QA-, stable RFC4122 UUIDs).
 * 5. Strictly idempotent upserts (no delete, deleteMany, or truncate; never mutates non-QA data).
 */

import {
  PrismaClient,
  Prisma,
  Role,
  UserStatus,
  HorseStatus,
  StallStatus,
  PlanStatus,
  WorkoutStatus,
  TrackSurface,
  PreventiveType,
  PreventiveStatus,
  MedicalRecordStatus,
  SeverityLevel,
  NotificationCategory,
  RetireReason,
  InjuryStatus,
  BodySide,
  TournamentStatus,
  RegistrationStatus,
  InvoiceStatus,
  NutritionPlanStatus,
  DailyTaskType,
  IncidentStatus,
  RestockStatus,
  PermissionRequestStatus,
  InsightType,
  InsightStatus,
  SimulatorSessionType,
  SimulatorSessionStatus,
  ShiftType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import * as dotenv from 'dotenv';
dotenv.config();

// ============================================================================
// 1. SAFETY GATES (Enforced before Prisma construction or mutation)
// ============================================================================

const cliArgs = process.argv.slice(2);
if (!cliArgs.includes('--confirm-local-qa')) {
  console.error('\n[SAFETY GATE REJECTED] Missing required CLI confirmation flag: --confirm-local-qa');
  console.error('This script seeds deterministic manual-QA test data into the local PostgreSQL database.');
  console.error('Usage: npm run db:seed:manual-qa -- --confirm-local-qa\n');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production') {
  console.error('\n[SAFETY GATE REJECTED] Refusing to run manual-QA seed in production environment!\n');
  process.exit(1);
}

const rawDbUrl = (process.env.DATABASE_URL || '').trim();
if (!rawDbUrl) {
  console.error('\n[SAFETY GATE REJECTED] DATABASE_URL is missing or empty. Aborting!\n');
  process.exit(1);
}

if (
  rawDbUrl.toLowerCase().includes('prod') ||
  rawDbUrl.toLowerCase().includes('production')
) {
  console.error('\n[SAFETY GATE REJECTED] DATABASE_URL contains production keywords. Aborting!\n');
  process.exit(1);
}

let parsedDbUrl: URL;
try {
  parsedDbUrl = new URL(rawDbUrl);
} catch (err) {
  console.error(`\n[SAFETY GATE REJECTED] Invalid DATABASE_URL format: ${(err as Error).message}. Aborting!\n`);
  process.exit(1);
}

const rawHostname = parsedDbUrl.hostname.toLowerCase();
const normalizedHostname = rawHostname.replace(/^\[|\]$/g, '');
const allowedLocalHosts = new Set(['localhost', '127.0.0.1', '::1']);

if (!allowedLocalHosts.has(normalizedHostname)) {
  console.error(
    `\n[SAFETY GATE REJECTED] Non-loopback database host "${parsedDbUrl.hostname}" is not permitted.\n` +
    `Only explicit local loopback hosts (localhost, 127.0.0.1, ::1) are allowed for manual QA seeding. Aborting!\n`
  );
  process.exit(1);
}

const targetPort = parsedDbUrl.port || '5432';
const targetDb = parsedDbUrl.pathname.replace(/^\//, '');
console.log(`[QA Target Database] Host: ${parsedDbUrl.hostname}, Port: ${targetPort}, DB: ${targetDb}`);

// ============================================================================
// 2. DETERMINISTIC IDENTIFIER GENERATOR
// ============================================================================

const DOMAIN = {
  USER: 0x01,
  HORSE: 0x02,
  STALL_ZONE: 0x03,
  STALL: 0x04,
  STALL_ALLOCATION: 0x05,
  TRAINING_PLAN: 0x06,
  WORKOUT_SESSION: 0x07,
  MEDICAL_RECORD: 0x08,
  INJURY_LOG: 0x09,
  MEDICAL_LOCK: 0x0a,
  PREVENTIVE_SCHEDULE: 0x0b,
  NUTRITION_PLAN: 0x0c,
  DAILY_GROOMING_LOG: 0x0d,
  TOURNAMENT: 0x0e,
  TOURNAMENT_REGISTRATION: 0x0f,
  TOURNAMENT_RESULT: 0x10,
  FINANCIAL_INVOICE: 0x11,
  NOTIFICATION: 0x12,
  RESTOCK_REQUEST: 0x13,
  STOCK_BALANCE: 0x14,
  SHIFT_ROSTER: 0x15,
  DAILY_CARE_TASK: 0x16,
  INCIDENT_REPORT: 0x17,
  SIMULATOR_SESSION: 0x18,
  PERMISSION_REQUEST: 0x19,
  AI_INSIGHT: 0x1a,
};

/**
 * Returns a deterministic, valid RFC4122 v4 UUID with variant 'a'.
 * Example: toUuid(DOMAIN.USER, 1) -> 00000000-0000-4000-a001-000000000001
 */
function toUuid(domain: number, index: number): string {
  const dHex = domain.toString(16).padStart(3, '0');
  const iHex = index.toString(16).padStart(12, '0');
  return `00000000-0000-4000-a${dHex}-${iHex}`;
}

const prisma = new PrismaClient();

// ============================================================================
// 3. MAIN SEED FUNCTION
// ============================================================================

async function main() {
  console.log('=== Starting Controlled Manual-QA Dataset Expansion (TASK-020) ===');

  const defaultPassword = await bcrypt.hash('EquiFlow@2026', 10);
  const now = new Date('2026-10-26T08:00:00.000Z');

  // --------------------------------------------------------------------------
  // [1/15] QA USERS: 16 users across all 5 roles & lifecycle cases (>= 12)
  // --------------------------------------------------------------------------
  console.log('[1/15] Upserting 16 QA Users...');
  const userDefs = [
    { email: 'qa-cm@gmail.com', name: 'QA Michael Tran (Club Manager)', role: Role.CLUB_MANAGER, status: UserStatus.ACTIVE, phone: '+84909000001' },
    { email: 'qa-trainer1@gmail.com', name: 'QA David Nguyen (Head Trainer 1)', role: Role.HEAD_TRAINER, status: UserStatus.ACTIVE, phone: '+84909000002' },
    { email: 'qa-trainer2@gmail.com', name: 'QA Elena Rostova (Head Trainer 2)', role: Role.HEAD_TRAINER, status: UserStatus.ACTIVE, phone: '+84909000003' },
    { email: 'qa-vet1@gmail.com', name: 'QA Dr. Sarah Connor (Chief Vet)', role: Role.VETERINARIAN, status: UserStatus.ACTIVE, phone: '+84909000004' },
    { email: 'qa-vet2@gmail.com', name: 'QA Dr. Emily Watson (Associate Vet)', role: Role.VETERINARIAN, status: UserStatus.ACTIVE, phone: '+84909000005' },
    { email: 'qa-groom1@gmail.com', name: 'QA John Smith (Groom Alpha)', role: Role.GROOM, status: UserStatus.ACTIVE, phone: '+84909000006' },
    { email: 'qa-groom2@gmail.com', name: 'QA Le Van Phuc (Groom Beta)', role: Role.GROOM, status: UserStatus.ACTIVE, phone: '+84909000007' },
    { email: 'qa-groom3@gmail.com', name: 'QA Tran Thi Mai (Groom Gamma)', role: Role.GROOM, status: UserStatus.ACTIVE, phone: '+84909000008' },
    { email: 'qa-groom4@gmail.com', name: 'QA Nguyen Van Binh (Groom Delta)', role: Role.GROOM, status: UserStatus.ACTIVE, phone: '+84909000009' },
    { email: 'qa-owner1@gmail.com', name: 'QA Robert Sterling (Owner Alpha)', role: Role.HORSE_OWNER, status: UserStatus.ACTIVE, phone: '+84909000010' },
    { email: 'qa-owner2@gmail.com', name: 'QA Phan Duc Long (Owner Beta)', role: Role.HORSE_OWNER, status: UserStatus.ACTIVE, phone: '+84909000011' },
    { email: 'qa-owner3@gmail.com', name: 'QA Victoria Chen (Owner Gamma)', role: Role.HORSE_OWNER, status: UserStatus.ACTIVE, phone: '+84909000012' },
    { email: 'qa-owner4@gmail.com', name: 'QA Marcus Aurelius (Owner Delta)', role: Role.HORSE_OWNER, status: UserStatus.ACTIVE, phone: '+84909000013' },
    { email: 'qa-pending.groom@gmail.com', name: 'QA Tran Nam (Pending Groom)', role: Role.GROOM, status: UserStatus.PENDING_APPROVAL, phone: '+84909000014', requestCode: 'REQ-QA26-001' },
    { email: 'qa-invited.vet@gmail.com', name: 'QA Dr. Bell (Invited Vet)', role: Role.VETERINARIAN, status: UserStatus.INVITED, phone: '+84909000015', invitedBy: 'QA Michael Tran (Club Manager)' },
    { email: 'qa-locked.user@gmail.com', name: 'QA Dang Kiet (Locked Groom)', role: Role.GROOM, status: UserStatus.LOCKED, phone: '+84909000016', statusReason: 'Tạm khóa để kiểm thử thủ công' },
  ];

  const userMap: Record<string, string> = {};
  for (let i = 0; i < userDefs.length; i++) {
    const u = userDefs[i];
    const id = toUuid(DOMAIN.USER, i + 1);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        fullName: u.name,
        role: u.role,
        status: u.status,
        phoneNumber: u.phone,
        requestCode: u.requestCode ?? null,
        invitedBy: u.invitedBy ?? null,
        statusReason: u.statusReason ?? null,
      },
      create: {
        id,
        email: u.email,
        passwordHash: u.status === UserStatus.INVITED ? '' : defaultPassword,
        fullName: u.name,
        role: u.role,
        status: u.status,
        phoneNumber: u.phone,
        requestCode: u.requestCode ?? null,
        invitedBy: u.invitedBy ?? null,
        statusReason: u.statusReason ?? null,
      },
    });
    userMap[u.email] = user.id;
  }

  // --------------------------------------------------------------------------
  // [2/15] QA STALL ZONE & 24 STALLS (>= 24)
  // --------------------------------------------------------------------------
  console.log('[2/15] Upserting Zone QA and 24 Stalls...');
  const qaZoneId = toUuid(DOMAIN.STALL_ZONE, 1);
  await prisma.stallZone.upsert({
    where: { code: 'ZONE-QA' },
    update: {
      name: 'Zone QA - Test Barn',
      rows: 4,
      cols: 6,
      sortOrder: 99,
      description: 'Khu chuồng dành riêng cho kiểm thử thủ công QA',
      isActive: true,
    },
    create: {
      id: qaZoneId,
      code: 'ZONE-QA',
      name: 'Zone QA - Test Barn',
      rows: 4,
      cols: 6,
      sortOrder: 99,
      description: 'Khu chuồng dành riêng cho kiểm thử thủ công QA',
      isActive: true,
    },
  });

  const stallMap: Record<string, string> = {};
  for (let i = 1; i <= 24; i++) {
    const code = `STALL-QA${i.toString().padStart(2, '0')}`;
    const row = Math.floor((i - 1) / 6) + 1;
    const col = ((i - 1) % 6) + 1;
    let status: StallStatus = StallStatus.AVAILABLE;
    let notes: string | null = null;

    if (i <= 20) {
      status = StallStatus.OCCUPIED;
    } else if (i === 23) {
      status = StallStatus.MAINTENANCE;
      notes = 'QA Stall: bảo trì hệ thống van nước tự động';
    } else if (i === 24) {
      status = StallStatus.INACTIVE;
      notes = 'QA Stall: tạm dừng sử dụng để kiểm thử';
    }

    const stallId = toUuid(DOMAIN.STALL, i);
    const stall = await prisma.stall.upsert({
      where: { code },
      update: {
        zone: 'Zone QA - Test Barn',
        zoneId: qaZoneId,
        row,
        col,
        status,
        notes,
      },
      create: {
        id: stallId,
        code,
        zone: 'Zone QA - Test Barn',
        zoneId: qaZoneId,
        row,
        col,
        status,
        notes,
      },
    });
    stallMap[code] = stall.id;
  }

  // --------------------------------------------------------------------------
  // [3/15] QA HORSES: 24 horses across all 7 statuses & 4 owners / 4 grooms
  // --------------------------------------------------------------------------
  console.log('[3/15] Upserting 24 QA Horses...');
  const horseConfigs = [
    // 1-5: ACTIVE (Owner 1 & Owner 2)
    { status: HorseStatus.ACTIVE, isLocked: false, owner: 'qa-owner1@gmail.com', groom: 'qa-groom1@gmail.com', stall: 'STALL-QA01', name: 'QA Zephyr Wind', breed: 'Thoroughbred', color: 'Bay', gender: 'Colt', weightKg: 490 },
    { status: HorseStatus.ACTIVE, isLocked: false, owner: 'qa-owner1@gmail.com', groom: 'qa-groom1@gmail.com', stall: 'STALL-QA02', name: 'QA Stellar Flash', breed: 'Thoroughbred', color: 'Chestnut', gender: 'Filly', weightKg: 480 },
    { status: HorseStatus.ACTIVE, isLocked: false, owner: 'qa-owner1@gmail.com', groom: 'qa-groom1@gmail.com', stall: 'STALL-QA03', name: 'QA Desert Storm', breed: 'Arabian', color: 'Grey', gender: 'Stallion', weightKg: 475 },
    { status: HorseStatus.ACTIVE, isLocked: false, owner: 'qa-owner2@gmail.com', groom: 'qa-groom2@gmail.com', stall: 'STALL-QA04', name: 'QA Silver Bullet', breed: 'Quarter Horse', color: 'Palomino', gender: 'Gelding', weightKg: 510 },
    { status: HorseStatus.ACTIVE, isLocked: false, owner: 'qa-owner2@gmail.com', groom: 'qa-groom2@gmail.com', stall: 'STALL-QA05', name: 'QA Golden Sovereign', breed: 'Thoroughbred', color: 'Black', gender: 'Colt', weightKg: 505 },

    // 6-10: IN_TRAINING (Owner 1 & Owner 2)
    { status: HorseStatus.IN_TRAINING, isLocked: false, owner: 'qa-owner1@gmail.com', groom: 'qa-groom1@gmail.com', stall: 'STALL-QA06', name: 'QA Iron Heart', breed: 'Thoroughbred', color: 'Bay Dark', gender: 'Stallion', weightKg: 495 },
    { status: HorseStatus.IN_TRAINING, isLocked: false, owner: 'qa-owner1@gmail.com', groom: 'qa-groom2@gmail.com', stall: 'STALL-QA07', name: 'QA Phoenix Blaze', breed: 'Thoroughbred', color: 'Chestnut', gender: 'Filly', weightKg: 470 },
    { status: HorseStatus.IN_TRAINING, isLocked: false, owner: 'qa-owner2@gmail.com', groom: 'qa-groom2@gmail.com', stall: 'STALL-QA08', name: 'QA Northern Light', breed: 'Standardbred', color: 'Black', gender: 'Gelding', weightKg: 515 },
    { status: HorseStatus.IN_TRAINING, isLocked: false, owner: 'qa-owner2@gmail.com', groom: 'qa-groom2@gmail.com', stall: 'STALL-QA09', name: 'QA Valkyrie Song', breed: 'Warmblood', color: 'Bay', gender: 'Mare', weightKg: 520 },
    { status: HorseStatus.IN_TRAINING, isLocked: false, owner: 'qa-owner2@gmail.com', groom: 'qa-groom3@gmail.com', stall: 'STALL-QA10', name: 'QA Shadow Runner', breed: 'Thoroughbred', color: 'Grey', gender: 'Colt', weightKg: 485 },

    // 11-13: UNDER_OBSERVATION (Owner 2 & Owner 3)
    { status: HorseStatus.UNDER_OBSERVATION, isLocked: false, owner: 'qa-owner2@gmail.com', groom: 'qa-groom3@gmail.com', stall: 'STALL-QA11', name: 'QA Mystic Mirage', breed: 'Arabian', color: 'Gray Roaming', gender: 'Mare', weightKg: 460 },
    { status: HorseStatus.UNDER_OBSERVATION, isLocked: false, owner: 'qa-owner3@gmail.com', groom: 'qa-groom3@gmail.com', stall: 'STALL-QA12', name: 'QA Amber Sunrise', breed: 'Quarter Horse', color: 'Chestnut', gender: 'Filly', weightKg: 465 },
    { status: HorseStatus.UNDER_OBSERVATION, isLocked: false, owner: 'qa-owner3@gmail.com', groom: 'qa-groom3@gmail.com', stall: 'STALL-QA13', name: 'QA Cobalt Frost', breed: 'Standardbred', color: 'Bay', gender: 'Gelding', weightKg: 500 },

    // 14-16: INJURED (Medical Locked) (Owner 3)
    { status: HorseStatus.INJURED, isLocked: true, owner: 'qa-owner3@gmail.com', groom: 'qa-groom3@gmail.com', stall: 'STALL-QA14', name: 'QA Crimson Falcon', breed: 'Thoroughbred', color: 'Bay Dark', gender: 'Colt', weightKg: 490 },
    { status: HorseStatus.INJURED, isLocked: true, owner: 'qa-owner3@gmail.com', groom: 'qa-groom4@gmail.com', stall: 'STALL-QA15', name: 'QA Obsidian King', breed: 'Thoroughbred', color: 'Black', gender: 'Stallion', weightKg: 510 },
    { status: HorseStatus.INJURED, isLocked: true, owner: 'qa-owner3@gmail.com', groom: 'qa-groom4@gmail.com', stall: 'STALL-QA16', name: 'QA Diamond Spark', breed: 'Warmblood', color: 'Grey', gender: 'Mare', weightKg: 495 },

    // 17-19: ISOLATED (Medical Locked) (Owner 3 & Owner 4)
    { status: HorseStatus.ISOLATED, isLocked: true, owner: 'qa-owner3@gmail.com', groom: 'qa-groom4@gmail.com', stall: 'STALL-QA17', name: 'QA Lunar Eclipse', breed: 'Thoroughbred', color: 'Chestnut', gender: 'Filly', weightKg: 475 },
    { status: HorseStatus.ISOLATED, isLocked: true, owner: 'qa-owner4@gmail.com', groom: 'qa-groom4@gmail.com', stall: 'STALL-QA18', name: 'QA Solstice Ray', breed: 'Arabian', color: 'Bay', gender: 'Gelding', weightKg: 480 },
    { status: HorseStatus.ISOLATED, isLocked: true, owner: 'qa-owner4@gmail.com', groom: 'qa-groom4@gmail.com', stall: 'STALL-QA19', name: 'QA Eclipse Shadow', breed: 'Thoroughbred', color: 'Black', gender: 'Colt', weightKg: 505 },

    // 20-22: RESTING (Owner 4)
    { status: HorseStatus.RESTING, isLocked: false, owner: 'qa-owner4@gmail.com', groom: 'qa-groom4@gmail.com', stall: 'STALL-QA20', name: 'QA Gentle Meadow', breed: 'Quarter Horse', color: 'Palomino', gender: 'Mare', weightKg: 470 },
    { status: HorseStatus.RESTING, isLocked: false, owner: 'qa-owner4@gmail.com', groom: 'qa-groom1@gmail.com', stall: 'STALL-QA21', name: 'QA Tranquil Stream', breed: 'Warmblood', color: 'Bay', gender: 'Gelding', weightKg: 495 },
    { status: HorseStatus.RESTING, isLocked: false, owner: 'qa-owner4@gmail.com', groom: 'qa-groom2@gmail.com', stall: 'STALL-QA22', name: 'QA Serene Breeze', breed: 'Thoroughbred', color: 'Chestnut', gender: 'Filly', weightKg: 480 },

    // 23-24: RETIRED (Owner 1 & Owner 2, no stall)
    { status: HorseStatus.RETIRED, isLocked: false, owner: 'qa-owner1@gmail.com', groom: null, stall: null, name: 'QA Old Champion', breed: 'Thoroughbred', color: 'Bay', gender: 'Gelding', retireReason: RetireReason.RETIRED, weightKg: 520 },
    { status: HorseStatus.RETIRED, isLocked: false, owner: 'qa-owner2@gmail.com', groom: null, stall: null, name: 'QA Golden Veteran', breed: 'Standardbred', color: 'Grey', gender: 'Stallion', retireReason: RetireReason.SOLD, weightKg: 515 },
  ];

  const horseMap: Record<string, string> = {};
  for (let i = 0; i < horseConfigs.length; i++) {
    const idx = i + 1;
    const h = horseConfigs[i];
    const horseCode = `QA-HR-${idx.toString().padStart(6, '0')}`;
    const microchip = `985141099${idx.toString().padStart(6, '0')}`;
    const id = toUuid(DOMAIN.HORSE, idx);

    const horse = await prisma.horse.upsert({
      where: { horseCode },
      update: {
        name: h.name,
        microchip,
        microchipRfid: microchip,
        breed: h.breed,
        dob: new Date('2021-03-15T00:00:00.000Z'),
        gender: h.gender,
        color: h.color,
        weightKg: h.weightKg,
        status: h.status,
        isMedicalLocked: h.isLocked,
        ownerId: userMap[h.owner],
        retireReason: h.retireReason ?? null,
      },
      create: {
        id,
        horseCode,
        name: h.name,
        microchip,
        microchipRfid: microchip,
        breed: h.breed,
        dob: new Date('2021-03-15T00:00:00.000Z'),
        gender: h.gender,
        color: h.color,
        weightKg: h.weightKg,
        status: h.status,
        isMedicalLocked: h.isLocked,
        ownerId: userMap[h.owner],
        retireReason: h.retireReason ?? null,
      },
    });
    horseMap[horseCode] = horse.id;
  }

  // --------------------------------------------------------------------------
  // [4/15] QA STALL ALLOCATIONS: 24 Allocations (>= 24)
  // --------------------------------------------------------------------------
  console.log('[4/15] Upserting 24 Stall Allocations...');
  for (let i = 0; i < 24; i++) {
    const idx = i + 1;
    const allocId = toUuid(DOMAIN.STALL_ALLOCATION, idx);
    const h = horseConfigs[i];
    const horseCode = `QA-HR-${idx.toString().padStart(6, '0')}`;
    const horseId = horseMap[horseCode];

    if (h.stall) {
      const stallId = stallMap[h.stall];
      const groomUserId = h.groom ? userMap[h.groom] : null;
      await prisma.stallAllocation.upsert({
        where: { id: allocId },
        update: {
          stallId,
          horseId,
          assignedGroomUserId: groomUserId,
          isActive: true,
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: null,
        },
        create: {
          id: allocId,
          stallId,
          horseId,
          assignedGroomUserId: groomUserId,
          isActive: true,
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: null,
        },
      });
    } else {
      // Historical allocation for retired horses in maintenance/inactive stalls
      const fallbackStall = i === 22 ? stallMap['STALL-QA23'] : stallMap['STALL-QA24'];
      await prisma.stallAllocation.upsert({
        where: { id: allocId },
        update: {
          stallId: fallbackStall,
          horseId,
          assignedGroomUserId: userMap['qa-groom1@gmail.com'],
          isActive: false,
          startDate: new Date('2025-01-01T00:00:00.000Z'),
          endDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        create: {
          id: allocId,
          stallId: fallbackStall,
          horseId,
          assignedGroomUserId: userMap['qa-groom1@gmail.com'],
          isActive: false,
          startDate: new Date('2025-01-01T00:00:00.000Z'),
          endDate: new Date('2026-06-01T00:00:00.000Z'),
        },
      });
    }
  }

  // --------------------------------------------------------------------------
  // [5/15] QA TRAINING PLANS (12 >= 12) & WORKOUTS (48 >= 48)
  // --------------------------------------------------------------------------
  console.log('[5/15] Upserting 12 Training Plans & 48 Workouts...');
  const planConfigs = [
    // Plans 1..4: ACTIVE (endDate in future: 2026-11-30)
    { status: PlanStatus.ACTIVE, start: '2026-09-01T00:00:00.000Z', end: '2026-11-30T00:00:00.000Z', trainer: 'qa-trainer1@gmail.com' },
    { status: PlanStatus.ACTIVE, start: '2026-09-01T00:00:00.000Z', end: '2026-11-30T00:00:00.000Z', trainer: 'qa-trainer1@gmail.com' },
    { status: PlanStatus.ACTIVE, start: '2026-09-01T00:00:00.000Z', end: '2026-11-30T00:00:00.000Z', trainer: 'qa-trainer1@gmail.com' },
    { status: PlanStatus.ACTIVE, start: '2026-09-01T00:00:00.000Z', end: '2026-11-30T00:00:00.000Z', trainer: 'qa-trainer1@gmail.com' },
    // Plans 5..7: DRAFT (future date range)
    { status: PlanStatus.DRAFT, start: '2026-11-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z', trainer: 'qa-trainer1@gmail.com' },
    { status: PlanStatus.DRAFT, start: '2026-11-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z', trainer: 'qa-trainer2@gmail.com' },
    { status: PlanStatus.DRAFT, start: '2026-11-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z', trainer: 'qa-trainer2@gmail.com' },
    // Plans 8..10: COMPLETED (historical range in past)
    { status: PlanStatus.COMPLETED, start: '2026-07-01T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z', trainer: 'qa-trainer2@gmail.com' },
    { status: PlanStatus.COMPLETED, start: '2026-07-01T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z', trainer: 'qa-trainer2@gmail.com' },
    { status: PlanStatus.COMPLETED, start: '2026-07-01T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z', trainer: 'qa-trainer2@gmail.com' },
    // Plans 11..12: CANCELLED (historical range in past)
    { status: PlanStatus.CANCELLED, start: '2026-08-01T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z', trainer: 'qa-trainer2@gmail.com' },
    { status: PlanStatus.CANCELLED, start: '2026-08-01T00:00:00.000Z', end: '2026-10-15T00:00:00.000Z', trainer: 'qa-trainer2@gmail.com' },
  ];

  const planMap: Record<string, string> = {};
  for (let i = 1; i <= 12; i++) {
    const planId = toUuid(DOMAIN.TRAINING_PLAN, i);
    const planCode = `QA-GA-${i.toString().padStart(6, '0')}`;
    const horseCode = `QA-HR-${i.toString().padStart(6, '0')}`;
    const cfg = planConfigs[i - 1];

    const plan = await prisma.trainingPlan.upsert({
      where: { id: planId },
      update: {
        horseId: horseMap[horseCode],
        trainerUserId: userMap[cfg.trainer],
        planCode,
        phaseName: `Giai đoạn huấn luyện QA ${i}`,
        objective: `Nâng cao năng lực thi đấu đợt QA ${i}`,
        targetSpeed: 52.0 + (i % 5),
        targetDistance: 1200 + (i % 4) * 200,
        trackSurface: i % 2 === 0 ? TrackSurface.TURF : TrackSurface.DIRT,
        startDate: new Date(cfg.start),
        endDate: new Date(cfg.end),
        status: cfg.status,
        phases: [{ id: 'phase-1', name: 'Khởi động', weeks: 2 }, { id: 'phase-2', name: 'Tăng tốc', weeks: 4 }],
      },
      create: {
        id: planId,
        horseId: horseMap[horseCode],
        trainerUserId: userMap[cfg.trainer],
        planCode,
        phaseName: `Giai đoạn huấn luyện QA ${i}`,
        objective: `Nâng cao năng lực thi đấu đợt QA ${i}`,
        targetSpeed: 52.0 + (i % 5),
        targetDistance: 1200 + (i % 4) * 200,
        trackSurface: i % 2 === 0 ? TrackSurface.TURF : TrackSurface.DIRT,
        startDate: new Date(cfg.start),
        endDate: new Date(cfg.end),
        status: cfg.status,
        phases: [{ id: 'phase-1', name: 'Khởi động', weeks: 2 }, { id: 'phase-2', name: 'Tăng tốc', weeks: 4 }],
      },
    });
    planMap[planCode] = plan.id;
  }

  // 48 Workouts (4 per plan):
  // R-1 Lifecycle Consistency Rules:
  // - Every SCHEDULED workout has a deterministic future date (November 2026) within plan range.
  // - COMPLETED, MISSED, CANCELLED fixtures are on suitable historical dates.
  // - Avoid SCHEDULED workouts under COMPLETED or CANCELLED plans.
  // - Preserves all 5 WorkoutStatus values: SCHEDULED (17), COMPLETED (15), BLOCKED (3), MISSED (5), CANCELLED (8).
  interface WorkoutDef {
    status: WorkoutStatus;
    scheduledDate: string;
    workoutType?: string;
    intensity?: string;
    trackSurface?: string;
    actualTimeSeconds?: number;
    heartRatePeak?: number;
    heartRateRecovery?: number;
    performanceScore?: number;
    statusReason?: string;
    trainerNotes?: string;
  }

  const workoutDefs: WorkoutDef[] = [
    // Plan 1 (ACTIVE): 2 COMPLETED (historical), 2 SCHEDULED (future)
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-10-05T07:00:00.000Z', actualTimeSeconds: 78.5, heartRatePeak: 180, heartRateRecovery: 95, performanceScore: 88.0, trainerNotes: 'Buổi tập đạt tiêu chuẩn thể lực' },
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-10-12T07:00:00.000Z', actualTimeSeconds: 77.8, heartRatePeak: 182, heartRateRecovery: 92, performanceScore: 90.0, trainerNotes: 'Nâng cao tốc độ nước rút' },
    {
      status: WorkoutStatus.SCHEDULED,
      scheduledDate: '2026-10-27T00:00:00.000Z',
      workoutType: 'TRIAL',
      intensity: 'MODERATE',
      trackSurface: 'TURF',
      trainerNotes: 'Deterministic QA Head Trainer Trial Run',
    },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-12T07:00:00.000Z' },

    // Plan 2 (ACTIVE): 1 COMPLETED, 1 MISSED (historical), 1 BLOCKED, 1 SCHEDULED (future)
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-10-06T07:00:00.000Z', actualTimeSeconds: 79.2, heartRatePeak: 178, heartRateRecovery: 98, performanceScore: 85.0, trainerNotes: 'Chạy bền cự ly trung bình' },
    { status: WorkoutStatus.MISSED, scheduledDate: '2026-10-15T07:00:00.000Z', statusReason: 'Ngựa mệt mỏi, không tham gia buổi tập', trainerNotes: 'Bỏ lỡ do thể trạng không đảm bảo' },
    { status: WorkoutStatus.BLOCKED, scheduledDate: '2026-11-06T07:00:00.000Z', statusReason: 'Ngựa đang theo dõi sau tiêm phòng', trainerNotes: 'Tạm khóa buổi tập chờ bác sĩ thú y giải tỏa' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-15T07:00:00.000Z' },

    // Plan 3 (ACTIVE): 1 COMPLETED (historical), 1 BLOCKED, 2 SCHEDULED (future)
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-10-07T07:00:00.000Z', actualTimeSeconds: 76.4, heartRatePeak: 185, heartRateRecovery: 90, performanceScore: 92.0, trainerNotes: 'Tốc độ xuất phát ấn tượng' },
    { status: WorkoutStatus.BLOCKED, scheduledDate: '2026-11-07T07:00:00.000Z', statusReason: 'Ngựa có dấu hiệu viêm gân nhẹ', trainerNotes: 'Tạm dừng buổi tập theo chỉ định thú y' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-14T07:00:00.000Z' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-21T07:00:00.000Z' },

    // Plan 4 (ACTIVE): 1 COMPLETED, 1 MISSED (historical), 2 SCHEDULED (future)
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-10-08T07:00:00.000Z', actualTimeSeconds: 80.1, heartRatePeak: 175, heartRateRecovery: 100, performanceScore: 82.0, trainerNotes: 'Tập chạy trên đường đất cát' },
    { status: WorkoutStatus.MISSED, scheduledDate: '2026-10-18T07:00:00.000Z', statusReason: 'Thời tiết mưa bão sân trơn trượt', trainerNotes: 'Buổi tập bị hủy vì điều kiện thời tiết' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-08T07:00:00.000Z' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-22T07:00:00.000Z' },

    // Plan 5 (DRAFT): 4 SCHEDULED (future)
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-04T07:00:00.000Z' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-11T07:00:00.000Z' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-18T07:00:00.000Z' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-25T07:00:00.000Z' },

    // Plan 6 (DRAFT): 3 SCHEDULED, 1 BLOCKED (future)
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-06T07:00:00.000Z' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-13T07:00:00.000Z' },
    { status: WorkoutStatus.BLOCKED, scheduledDate: '2026-11-20T07:00:00.000Z', statusReason: 'Dự kiến trùng lịch kiểm tra y tế định kỳ', trainerNotes: 'Khóa trước lịch để tránh xung đột' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-27T07:00:00.000Z' },

    // Plan 7 (DRAFT): 3 SCHEDULED (future), 1 CANCELLED (slot adjustment)
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-07T07:00:00.000Z' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-14T07:00:00.000Z' },
    { status: WorkoutStatus.CANCELLED, scheduledDate: '2026-10-20T07:00:00.000Z', statusReason: 'Điều chỉnh cấu trúc giáo án nháp', trainerNotes: 'Đã lược bỏ bài tập thừa' },
    { status: WorkoutStatus.SCHEDULED, scheduledDate: '2026-11-28T07:00:00.000Z' },

    // Plan 8 (COMPLETED): 4 COMPLETED (all historical) - ZERO SCHEDULED
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-07-15T07:00:00.000Z', actualTimeSeconds: 75.0, heartRatePeak: 182, heartRateRecovery: 88, performanceScore: 94.0, trainerNotes: 'Hoàn thành xuất sắc giáo án cũ' },
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-08-05T07:00:00.000Z', actualTimeSeconds: 76.2, heartRatePeak: 180, heartRateRecovery: 90, performanceScore: 91.0, trainerNotes: 'Duy trì phong độ ổn định' },
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-08-25T07:00:00.000Z', actualTimeSeconds: 74.8, heartRatePeak: 185, heartRateRecovery: 87, performanceScore: 95.0, trainerNotes: 'Kỷ lục cá nhân trên đường cỏ' },
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-09-15T07:00:00.000Z', actualTimeSeconds: 75.5, heartRatePeak: 181, heartRateRecovery: 89, performanceScore: 93.0, trainerNotes: 'Kiểm tra thể lực cuối kỳ' },

    // Plan 9 (COMPLETED): 3 COMPLETED, 1 MISSED (all historical) - ZERO SCHEDULED
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-07-20T07:00:00.000Z', actualTimeSeconds: 78.0, heartRatePeak: 179, heartRateRecovery: 94, performanceScore: 87.0, trainerNotes: 'Bài tập khởi động đầu kỳ' },
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-08-10T07:00:00.000Z', actualTimeSeconds: 77.1, heartRatePeak: 183, heartRateRecovery: 92, performanceScore: 89.0, trainerNotes: 'Rèn luyện khả năng bứt tốc' },
    { status: WorkoutStatus.MISSED, scheduledDate: '2026-08-30T07:00:00.000Z', statusReason: 'Ngựa bị sốt nhẹ, cho nghỉ ngơi', trainerNotes: 'Bác sĩ thú y yêu cầu nghỉ tập' },
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-09-20T07:00:00.000Z', actualTimeSeconds: 76.5, heartRatePeak: 180, heartRateRecovery: 91, performanceScore: 90.0, trainerNotes: 'Buổi tập tổng kết giáo án' },

    // Plan 10 (COMPLETED): 2 COMPLETED, 1 MISSED, 1 CANCELLED (all historical) - ZERO SCHEDULED
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-07-25T07:00:00.000Z', actualTimeSeconds: 79.5, heartRatePeak: 176, heartRateRecovery: 96, performanceScore: 84.0, trainerNotes: 'Tập thích nghi mặt sân cát' },
    { status: WorkoutStatus.MISSED, scheduledDate: '2026-08-15T07:00:00.000Z', statusReason: 'Trùng lịch di chuyển kiểm định', trainerNotes: 'Không tham gia buổi tập' },
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-09-05T07:00:00.000Z', actualTimeSeconds: 78.3, heartRatePeak: 178, heartRateRecovery: 93, performanceScore: 86.0, trainerNotes: 'Phục hồi thể lực tốt' },
    { status: WorkoutStatus.CANCELLED, scheduledDate: '2026-09-25T07:00:00.000Z', statusReason: 'Giáo án hoàn tất sớm hơn dự kiến', trainerNotes: 'Hủy buổi tập cuối do đạt mục tiêu' },

    // Plan 11 (CANCELLED): 1 COMPLETED, 3 CANCELLED (all historical) - ZERO SCHEDULED
    { status: WorkoutStatus.COMPLETED, scheduledDate: '2026-08-10T07:00:00.000Z', actualTimeSeconds: 81.0, heartRatePeak: 174, heartRateRecovery: 99, performanceScore: 80.0, trainerNotes: 'Buổi duy nhất trước khi giáo án bị hủy' },
    { status: WorkoutStatus.CANCELLED, scheduledDate: '2026-09-01T07:00:00.000Z', statusReason: 'Giáo án bị hủy do thay đổi mục tiêu thi đấu', trainerNotes: 'Hủy theo quyết định của HLV trưởng' },
    { status: WorkoutStatus.CANCELLED, scheduledDate: '2026-09-15T07:00:00.000Z', statusReason: 'Giáo án bị hủy do thay đổi mục tiêu thi đấu', trainerNotes: 'Hủy theo quyết định của HLV trưởng' },
    { status: WorkoutStatus.CANCELLED, scheduledDate: '2026-10-01T07:00:00.000Z', statusReason: 'Giáo án bị hủy do thay đổi mục tiêu thi đấu', trainerNotes: 'Hủy theo quyết định của HLV trưởng' },

    // Plan 12 (CANCELLED): 1 MISSED, 3 CANCELLED (all historical) - ZERO SCHEDULED
    { status: WorkoutStatus.MISSED, scheduledDate: '2026-08-15T07:00:00.000Z', statusReason: 'Ngựa vắng mặt, kế hoạch sau đó bị hủy', trainerNotes: 'Buổi tập không diễn ra' },
    { status: WorkoutStatus.CANCELLED, scheduledDate: '2026-09-05T07:00:00.000Z', statusReason: 'Giáo án bị hủy vì chuyển nhượng ngựa', trainerNotes: 'Hủy toàn bộ các buổi tập còn lại' },
    { status: WorkoutStatus.CANCELLED, scheduledDate: '2026-09-20T07:00:00.000Z', statusReason: 'Giáo án bị hủy vì chuyển nhượng ngựa', trainerNotes: 'Hủy toàn bộ các buổi tập còn lại' },
    { status: WorkoutStatus.CANCELLED, scheduledDate: '2026-10-05T07:00:00.000Z', statusReason: 'Giáo án bị hủy vì chuyển nhượng ngựa', trainerNotes: 'Hủy toàn bộ các buổi tập còn lại' },
  ];

  for (let p = 1; p <= 12; p++) {
    const planCode = `QA-GA-${p.toString().padStart(6, '0')}`;
    const horseCode = `QA-HR-${p.toString().padStart(6, '0')}`;
    const planId = planMap[planCode];

    for (let w = 1; w <= 4; w++) {
      const wIdx = (p - 1) * 4 + w;
      const workoutId = toUuid(DOMAIN.WORKOUT_SESSION, wIdx);
      const def = workoutDefs[wIdx - 1];

      await prisma.workoutSession.upsert({
        where: { id: workoutId },
        update: {
          trainingPlanId: planId,
          horseId: horseMap[horseCode],
          assignedStaffUserId: userMap['qa-trainer1@gmail.com'],
          scheduledDate: new Date(def.scheduledDate),
          distanceMeters: 1200 + (w * 200),
          repetitions: 2,
          targetSpeedKmh: 54.0,
          status: def.status,
          workoutType: def.workoutType ?? (w === 3 && p === 1 ? 'TRIAL' : 'CANTER'),
          intensity: def.intensity ?? 'MODERATE',
          trackSurface: def.trackSurface ?? 'TURF',
          statusReason: def.statusReason ?? null,
          actualTimeSeconds: def.actualTimeSeconds ?? null,
          heartRatePeak: def.heartRatePeak ?? null,
          heartRateRecovery: def.heartRateRecovery ?? null,
          performanceScore: def.performanceScore ?? null,
          trainerNotes: def.trainerNotes ?? null,
        },
        create: {
          id: workoutId,
          trainingPlanId: planId,
          horseId: horseMap[horseCode],
          assignedStaffUserId: userMap['qa-trainer1@gmail.com'],
          scheduledDate: new Date(def.scheduledDate),
          distanceMeters: 1200 + (w * 200),
          repetitions: 2,
          targetSpeedKmh: 54.0,
          status: def.status,
          workoutType: def.workoutType ?? (w === 3 && p === 1 ? 'TRIAL' : 'CANTER'),
          intensity: def.intensity ?? 'MODERATE',
          trackSurface: def.trackSurface ?? 'TURF',
          statusReason: def.statusReason ?? null,
          actualTimeSeconds: def.actualTimeSeconds ?? null,
          heartRatePeak: def.heartRatePeak ?? null,
          heartRateRecovery: def.heartRateRecovery ?? null,
          performanceScore: def.performanceScore ?? null,
          trainerNotes: def.trainerNotes ?? null,
        },
      });
    }
  }

  // --------------------------------------------------------------------------
  // [6/15] MEDICAL RECORDS (12), INJURIES (8), LOCKS (6), PREVENTIVE (12)
  // --------------------------------------------------------------------------
  console.log('[6/15] Upserting 12 Medical Records, 8 Injuries, 6 Locks, 12 Preventives...');
  const medRecordMap: Record<string, string> = {};
  const medStatuses = [
    MedicalRecordStatus.OPEN, MedicalRecordStatus.OPEN, MedicalRecordStatus.OPEN,
    MedicalRecordStatus.OPEN, MedicalRecordStatus.OPEN, MedicalRecordStatus.OPEN,
    MedicalRecordStatus.CLOSED, MedicalRecordStatus.CLOSED, MedicalRecordStatus.CLOSED, MedicalRecordStatus.CLOSED,
    MedicalRecordStatus.DRAFT, MedicalRecordStatus.DRAFT,
  ];

  for (let i = 1; i <= 12; i++) {
    const medId = toUuid(DOMAIN.MEDICAL_RECORD, i);
    const recordNumber = `QA-BA-2610-${i.toString().padStart(3, '0')}`;
    const horseCode = `QA-HR-${(12 + i).toString().padStart(6, '0')}`; // horses 13..24
    const vetEmail = i <= 6 ? 'qa-vet1@gmail.com' : 'qa-vet2@gmail.com';
    const status = medStatuses[i - 1];

    const med = await prisma.medicalRecord.upsert({
      where: { id: medId },
      update: {
        recordNumber,
        horseId: horseMap[horseCode],
        veterinarianUserId: userMap[vetEmail],
        status,
        examinationDate: new Date('2026-10-20T09:00:00.000Z'),
        examinationType: i % 2 === 0 ? 'Emergency Exam' : 'Routine Clinical',
        discoverySource: 'Groom shift daily report',
        severity: i % 3 === 0 ? SeverityLevel.CRITICAL : i % 2 === 0 ? SeverityLevel.SEVERE : SeverityLevel.MODERATE,
        temperature: 38.3,
        restingHeartRate: 40,
        respiratoryRate: 14,
        weightKg: 475.0,
        clinicalExamination: 'Niêm mạc bình thường, phản xạ khớp nhạy',
        symptoms: 'Triệu chứng kiểm thử thủ công lâm sàng',
        clinicalDiagnosis: 'Chẩn đoán xác định phục vụ manual QA',
        treatmentProtocol: 'Phác đồ nghỉ ngơi và hỗ trợ phục hồi',
        closedAt: status === MedicalRecordStatus.CLOSED ? new Date('2026-10-25T16:00:00.000Z') : null,
      },
      create: {
        id: medId,
        recordNumber,
        horseId: horseMap[horseCode],
        veterinarianUserId: userMap[vetEmail],
        status,
        examinationDate: new Date('2026-10-20T09:00:00.000Z'),
        examinationType: i % 2 === 0 ? 'Emergency Exam' : 'Routine Clinical',
        discoverySource: 'Groom shift daily report',
        severity: i % 3 === 0 ? SeverityLevel.CRITICAL : i % 2 === 0 ? SeverityLevel.SEVERE : SeverityLevel.MODERATE,
        temperature: 38.3,
        restingHeartRate: 40,
        respiratoryRate: 14,
        weightKg: 475.0,
        clinicalExamination: 'Niêm mạc bình thường, phản xạ khớp nhạy',
        symptoms: 'Triệu chứng kiểm thử thủ công lâm sàng',
        clinicalDiagnosis: 'Chẩn đoán xác định phục vụ manual QA',
        treatmentProtocol: 'Phác đồ nghỉ ngơi và hỗ trợ phục hồi',
        closedAt: status === MedicalRecordStatus.CLOSED ? new Date('2026-10-25T16:00:00.000Z') : null,
      },
    });
    medRecordMap[recordNumber] = med.id;
  }

  // 8 Injuries (ACTIVE, HEALING, RESOLVED)
  const injuryZones = ['Foreleg Tendon', 'Hindleg Stifle', 'Left Knee', 'Right Hoof', 'Back Muscle', 'Fetlock', 'Shoulder', 'Hock'];
  const injuryStatuses = [
    InjuryStatus.ACTIVE, InjuryStatus.ACTIVE, InjuryStatus.ACTIVE, InjuryStatus.ACTIVE,
    InjuryStatus.HEALING, InjuryStatus.HEALING,
    InjuryStatus.RESOLVED, InjuryStatus.RESOLVED,
  ];

  for (let i = 1; i <= 8; i++) {
    const injId = toUuid(DOMAIN.INJURY_LOG, i);
    const horseCode = `QA-HR-${(13 + i).toString().padStart(6, '0')}`;
    const medRecordCode = `QA-BA-2610-${i.toString().padStart(3, '0')}`;

    await prisma.injuryLog.upsert({
      where: { id: injId },
      update: {
        medicalRecordId: medRecordMap[medRecordCode],
        horseId: horseMap[horseCode],
        coordinateX: 0.35 + (i * 0.05),
        coordinateY: 0.45 + (i * 0.03),
        viewSide: i % 2 === 0 ? 'RIGHT' : 'LEFT',
        layer: i % 2 === 0 ? 'BONE' : 'MUSCLE',
        anatomicalZone: injuryZones[i - 1],
        bodySide: i % 3 === 0 ? BodySide.BILATERAL : i % 2 === 0 ? BodySide.RIGHT : BodySide.LEFT,
        injuryType: `Chấn thương QA ${injuryZones[i - 1]}`,
        severity: i % 2 === 0 ? SeverityLevel.SEVERE : SeverityLevel.MODERATE,
        stage: injuryStatuses[i - 1] === InjuryStatus.RESOLVED ? 'HEALED' : 'ACUTE',
        status: injuryStatuses[i - 1],
        description: `Mô tả chấn thương thủ công QA ${i}`,
      },
      create: {
        id: injId,
        medicalRecordId: medRecordMap[medRecordCode],
        horseId: horseMap[horseCode],
        coordinateX: 0.35 + (i * 0.05),
        coordinateY: 0.45 + (i * 0.03),
        viewSide: i % 2 === 0 ? 'RIGHT' : 'LEFT',
        layer: i % 2 === 0 ? 'BONE' : 'MUSCLE',
        anatomicalZone: injuryZones[i - 1],
        bodySide: i % 3 === 0 ? BodySide.BILATERAL : i % 2 === 0 ? BodySide.RIGHT : BodySide.LEFT,
        injuryType: `Chấn thương QA ${injuryZones[i - 1]}`,
        severity: i % 2 === 0 ? SeverityLevel.SEVERE : SeverityLevel.MODERATE,
        stage: injuryStatuses[i - 1] === InjuryStatus.RESOLVED ? 'HEALED' : 'ACUTE',
        status: injuryStatuses[i - 1],
        description: `Mô tả chấn thương thủ công QA ${i}`,
      },
    });
  }

  // 6 Medical Locks (4 active, 2 unlocked)
  for (let i = 1; i <= 6; i++) {
    const lockId = toUuid(DOMAIN.MEDICAL_LOCK, i);
    const lockCode = `KH-QA${i.toString().padStart(6, '0')}`;
    const horseCode = `QA-HR-${(13 + i).toString().padStart(6, '0')}`;
    const medRecordCode = `QA-BA-2610-${i.toString().padStart(3, '0')}`;
    const isLocked = i <= 4;

    await prisma.medicalLock.upsert({
      where: { id: lockId },
      update: {
        lockCode,
        horseId: horseMap[horseCode],
        medicalRecordId: medRecordMap[medRecordCode],
        veterinarianUserId: userMap['qa-vet1@gmail.com'],
        lockedAt: new Date('2026-10-21T08:00:00.000Z'),
        expectedRestDays: 14,
        recheckDate: new Date('2026-11-04T08:00:00.000Z'),
        appliedMedicalStatus: i <= 3 ? HorseStatus.INJURED : HorseStatus.ISOLATED,
        lockReason: `Lý do khóa y tế kiểm thử QA ${i}`,
        unlockConditions: 'Siêu âm kiểm tra gân bình thường',
        isLocked,
        unlockedAt: isLocked ? null : new Date('2026-10-25T14:00:00.000Z'),
        unlockVetUserId: isLocked ? null : userMap['qa-vet2@gmail.com'],
        unlockReason: isLocked ? null : 'Đã hồi phục hoàn toàn sau điều trị',
      },
      create: {
        id: lockId,
        lockCode,
        horseId: horseMap[horseCode],
        medicalRecordId: medRecordMap[medRecordCode],
        veterinarianUserId: userMap['qa-vet1@gmail.com'],
        lockedAt: new Date('2026-10-21T08:00:00.000Z'),
        expectedRestDays: 14,
        recheckDate: new Date('2026-11-04T08:00:00.000Z'),
        appliedMedicalStatus: i <= 3 ? HorseStatus.INJURED : HorseStatus.ISOLATED,
        lockReason: `Lý do khóa y tế kiểm thử QA ${i}`,
        unlockConditions: 'Siêu âm kiểm tra gân bình thường',
        isLocked,
        unlockedAt: isLocked ? null : new Date('2026-10-25T14:00:00.000Z'),
        unlockVetUserId: isLocked ? null : userMap['qa-vet2@gmail.com'],
        unlockReason: isLocked ? null : 'Đã hồi phục hoàn toàn sau điều trị',
      },
    });
  }

  // 12 Preventive Schedules (VACCINATION, DEWORMING, FARRIER_HOOF_CARE, DENTAL)
  const prevTypes = [PreventiveType.VACCINATION, PreventiveType.DEWORMING, PreventiveType.FARRIER_HOOF_CARE, PreventiveType.DENTAL];
  const prevStatuses = [PreventiveStatus.PENDING, PreventiveStatus.COMPLETED, PreventiveStatus.OVERDUE];

  for (let i = 1; i <= 12; i++) {
    const prevId = toUuid(DOMAIN.PREVENTIVE_SCHEDULE, i);
    const horseCode = `QA-HR-${i.toString().padStart(6, '0')}`;
    const scheduleType = prevTypes[(i - 1) % prevTypes.length];
    const status = prevStatuses[(i - 1) % prevStatuses.length];
    const isCompleted = status === PreventiveStatus.COMPLETED;

    await prisma.preventiveSchedule.upsert({
      where: { id: prevId },
      update: {
        horseId: horseMap[horseCode],
        veterinarianUserId: userMap['qa-vet1@gmail.com'],
        scheduleType,
        dueDate: status === PreventiveStatus.OVERDUE ? new Date('2026-10-10T00:00:00.000Z') : new Date('2026-11-15T00:00:00.000Z'),
        status,
        completedDate: isCompleted ? new Date('2026-10-18T00:00:00.000Z') : null,
        productAdministered: `Sản phẩm phòng ngừa QA ${scheduleType}`,
        batchNumber: `QA-BAT-2026-${i}`,
        performedByMode: 'SELF',
        notes: `Ghi chú lịch phòng ngừa thủ công QA ${i}`,
      },
      create: {
        id: prevId,
        horseId: horseMap[horseCode],
        veterinarianUserId: userMap['qa-vet1@gmail.com'],
        scheduleType,
        dueDate: status === PreventiveStatus.OVERDUE ? new Date('2026-10-10T00:00:00.000Z') : new Date('2026-11-15T00:00:00.000Z'),
        status,
        completedDate: isCompleted ? new Date('2026-10-18T00:00:00.000Z') : null,
        productAdministered: `Sản phẩm phòng ngừa QA ${scheduleType}`,
        batchNumber: `QA-BAT-2026-${i}`,
        performedByMode: 'SELF',
        notes: `Ghi chú lịch phòng ngừa thủ công QA ${i}`,
      },
    });
  }

  // --------------------------------------------------------------------------
  // [7/15] QA INCIDENTS: 12 Incidents across severity & review states (>= 12)
  // --------------------------------------------------------------------------
  console.log('[7/15] Upserting 12 Incidents...');
  const severities = [SeverityLevel.CRITICAL, SeverityLevel.SEVERE, SeverityLevel.MODERATE, SeverityLevel.MILD];
  const incidentStatuses = [
    IncidentStatus.REPORTED, IncidentStatus.REPORTED, IncidentStatus.REPORTED, IncidentStatus.REPORTED,
    IncidentStatus.UNDER_REVIEW, IncidentStatus.UNDER_REVIEW, IncidentStatus.UNDER_REVIEW,
    IncidentStatus.RESOLVED, IncidentStatus.RESOLVED, IncidentStatus.RESOLVED,
    IncidentStatus.DISMISSED, IncidentStatus.DISMISSED,
  ];

  for (let i = 1; i <= 12; i++) {
    const incId = toUuid(DOMAIN.INCIDENT_REPORT, i);
    const incidentNumber = `QA-INC-20261026-${i.toString().padStart(4, '0')}`;
    const horseCode = `QA-HR-${(i % 12 + 1).toString().padStart(6, '0')}`;
    const severity = severities[(i - 1) % severities.length];
    const status = incidentStatuses[i - 1];
    const isReviewed = status !== IncidentStatus.REPORTED;

    await prisma.incidentReport.upsert({
      where: { id: incId },
      update: {
        incidentNumber,
        horseId: horseMap[horseCode],
        stallZoneId: qaZoneId,
        reportedById: userMap['qa-groom1@gmail.com'],
        severity,
        symptomsJson: ['Đi khập khiễng chân sau', 'Nhiệt độ cơ thể tăng nhẹ'],
        description: `Báo cáo sự cố kiểm thử thủ công QA ${i}`,
        status,
        reviewedById: isReviewed ? userMap['qa-vet1@gmail.com'] : null,
        reviewedAt: isReviewed ? now : null,
        vetNotes: isReviewed ? 'Đã kiểm tra lâm sàng và chỉ định chăm sóc' : null,
      },
      create: {
        id: incId,
        incidentNumber,
        horseId: horseMap[horseCode],
        stallZoneId: qaZoneId,
        reportedById: userMap['qa-groom1@gmail.com'],
        severity,
        symptomsJson: ['Đi khập khiễng chân sau', 'Nhiệt độ cơ thể tăng nhẹ'],
        description: `Báo cáo sự cố kiểm thử thủ công QA ${i}`,
        status,
        reviewedById: isReviewed ? userMap['qa-vet1@gmail.com'] : null,
        reviewedAt: isReviewed ? now : null,
        vetNotes: isReviewed ? 'Đã kiểm tra lâm sàng và chỉ định chăm sóc' : null,
      },
    });
  }

  // --------------------------------------------------------------------------
  // [8/15] TOURNAMENTS (12), REGISTRATIONS (32), RESULTS (12)
  // --------------------------------------------------------------------------
  console.log('[8/15] Upserting 12 Tournaments, 32 Registrations, 12 Results...');
  const tournStatuses = [
    TournamentStatus.UPCOMING, TournamentStatus.UPCOMING, TournamentStatus.UPCOMING,
    TournamentStatus.OPEN_REGISTRATION, TournamentStatus.OPEN_REGISTRATION, TournamentStatus.OPEN_REGISTRATION,
    TournamentStatus.CLOSED_REGISTRATION, TournamentStatus.CLOSED_REGISTRATION,
    TournamentStatus.COMPLETED, TournamentStatus.COMPLETED, TournamentStatus.COMPLETED,
    TournamentStatus.CANCELLED,
  ];

  const tourns: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const tournId = toUuid(DOMAIN.TOURNAMENT, i);
    const status = tournStatuses[i - 1];
    let raceDate = new Date('2026-11-20T08:00:00.000Z');
    let deadline = new Date('2026-11-10T18:00:00.000Z');

    if (status === TournamentStatus.OPEN_REGISTRATION) {
      raceDate = new Date('2026-11-15T08:00:00.000Z');
      deadline = new Date('2026-11-05T18:00:00.000Z');
    } else if (status === TournamentStatus.CLOSED_REGISTRATION) {
      raceDate = new Date('2026-11-02T08:00:00.000Z');
      deadline = new Date('2026-10-20T18:00:00.000Z');
    } else if (status === TournamentStatus.COMPLETED) {
      raceDate = new Date('2026-10-15T08:00:00.000Z');
      deadline = new Date('2026-10-05T18:00:00.000Z');
    } else if (status === TournamentStatus.CANCELLED) {
      raceDate = new Date('2026-11-28T08:00:00.000Z');
      deadline = new Date('2026-10-15T18:00:00.000Z');
    }

    await prisma.tournament.upsert({
      where: { id: tournId },
      update: {
        name: `Giải Đua Ngựa Thủ Công QA ${i}`,
        raceDate,
        location: i % 2 === 0 ? 'Trường Đua Phú Thọ' : 'Trường Đua Đại Nam',
        distanceMeters: 1200 + (i % 4) * 400,
        trackType: i % 3 === 0 ? TrackSurface.SYNTHETIC : i % 2 === 0 ? TrackSurface.DIRT : TrackSurface.TURF,
        prizePool: new Prisma.Decimal(20000000 + i * 5000000),
        registrationDeadline: deadline,
        status,
      },
      create: {
        id: tournId,
        name: `Giải Đua Ngựa Thủ Công QA ${i}`,
        raceDate,
        location: i % 2 === 0 ? 'Trường Đua Phú Thọ' : 'Trường Đua Đại Nam',
        distanceMeters: 1200 + (i % 4) * 400,
        trackType: i % 3 === 0 ? TrackSurface.SYNTHETIC : i % 2 === 0 ? TrackSurface.DIRT : TrackSurface.TURF,
        prizePool: new Prisma.Decimal(20000000 + i * 5000000),
        registrationDeadline: deadline,
        status,
      },
    });
    tourns.push(tournId);
  }

  // 32 Registrations (>= 30) distributed across tournaments 4..11 and horses 1..10
  const regStatuses = [
    RegistrationStatus.REGISTERED, RegistrationStatus.REGISTERED,
    RegistrationStatus.CONFIRMED, RegistrationStatus.SCRATCHED_MEDICAL,
  ];

  let regCount = 0;
  const completedRegIds: string[] = [];

  for (let t = 4; t <= 11; t++) {
    const tournId = tourns[t - 1];
    const isCompletedTourn = t >= 9 && t <= 11;

    for (let h = 1; h <= 4; h++) {
      regCount++;
      const regId = toUuid(DOMAIN.TOURNAMENT_REGISTRATION, regCount);
      const horseCode = `QA-HR-${h.toString().padStart(6, '0')}`;
      const horseId = horseMap[horseCode];
      const status = isCompletedTourn ? RegistrationStatus.CONFIRMED : regStatuses[(regCount - 1) % regStatuses.length];

      await prisma.tournamentRegistration.upsert({
        where: { id: regId },
        update: {
          tournamentId: tournId,
          horseId,
          registeredByTrainerId: userMap['qa-trainer1@gmail.com'],
          status,
          registrationDate: new Date('2026-10-01T08:00:00.000Z'),
          notes: `Đăng ký thi đấu QA ${regCount}`,
        },
        create: {
          id: regId,
          tournamentId: tournId,
          horseId,
          registeredByTrainerId: userMap['qa-trainer1@gmail.com'],
          status,
          registrationDate: new Date('2026-10-01T08:00:00.000Z'),
          notes: `Đăng ký thi đấu QA ${regCount}`,
        },
      });

      if (isCompletedTourn) {
        completedRegIds.push(regId);
      }
    }
  }

  // 12 Results (for the 12 registrations in tournaments 9..11)
  for (let r = 0; r < completedRegIds.length; r++) {
    const resId = toUuid(DOMAIN.TOURNAMENT_RESULT, r + 1);
    const regId = completedRegIds[r];
    const rank = (r % 4) + 1;

    await prisma.tournamentResult.upsert({
      where: { id: resId },
      update: {
        registrationId: regId,
        finalRank: rank,
        finishTimeSeconds: 75.2 + rank * 1.5,
        avgSpeedKmh: 60.0 - rank * 1.2,
        prizeMoneyWon: new Prisma.Decimal(rank === 1 ? 25000000 : rank === 2 ? 15000000 : rank === 3 ? 8000000 : 2000000),
        officialNotes: `Kết quả chính thức hạng ${rank} giải đua QA`,
      },
      create: {
        id: resId,
        registrationId: regId,
        finalRank: rank,
        finishTimeSeconds: 75.2 + rank * 1.5,
        avgSpeedKmh: 60.0 - rank * 1.2,
        prizeMoneyWon: new Prisma.Decimal(rank === 1 ? 25000000 : rank === 2 ? 15000000 : rank === 3 ? 8000000 : 2000000),
        officialNotes: `Kết quả chính thức hạng ${rank} giải đua QA`,
      },
    });
  }

  // --------------------------------------------------------------------------
  // [9/15] FINANCIAL INVOICES (16) & NOTIFICATIONS (32)
  // --------------------------------------------------------------------------
  console.log('[9/15] Upserting 16 Financial Invoices & 32 Notifications...');
  const invStatuses = [
    InvoiceStatus.DRAFT, InvoiceStatus.DRAFT, InvoiceStatus.DRAFT, InvoiceStatus.DRAFT,
    InvoiceStatus.SENT, InvoiceStatus.SENT, InvoiceStatus.SENT, InvoiceStatus.SENT,
    InvoiceStatus.PAID, InvoiceStatus.PAID, InvoiceStatus.PAID, InvoiceStatus.PAID,
    InvoiceStatus.OVERDUE, InvoiceStatus.OVERDUE,
    InvoiceStatus.CANCELLED, InvoiceStatus.CANCELLED,
  ];

  for (let i = 1; i <= 16; i++) {
    const invId = toUuid(DOMAIN.FINANCIAL_INVOICE, i);
    const horseCode = `QA-HR-${i.toString().padStart(6, '0')}`;
    const ownerEmail = `qa-owner${((i - 1) % 4) + 1}@gmail.com`;
    const status = invStatuses[i - 1];
    const period = `2026-${(7 + (i % 4)).toString().padStart(2, '0')}`;

    await prisma.financialInvoice.upsert({
      where: { id: invId },
      update: {
        horseId: horseMap[horseCode],
        ownerId: userMap[ownerEmail],
        billingPeriod: period,
        boardingFee: new Prisma.Decimal(5000000),
        medicalFee: new Prisma.Decimal(1500000),
        trainingFee: new Prisma.Decimal(8000000),
        prizeCredit: new Prisma.Decimal(0),
        netAmount: new Prisma.Decimal(14500000),
        status,
        invoiceUrl: `/invoices/qa-inv-${i}.pdf`,
      },
      create: {
        id: invId,
        horseId: horseMap[horseCode],
        ownerId: userMap[ownerEmail],
        billingPeriod: period,
        boardingFee: new Prisma.Decimal(5000000),
        medicalFee: new Prisma.Decimal(1500000),
        trainingFee: new Prisma.Decimal(8000000),
        prizeCredit: new Prisma.Decimal(0),
        netAmount: new Prisma.Decimal(14500000),
        status,
        invoiceUrl: `/invoices/qa-inv-${i}.pdf`,
      },
    });
  }

  // 32 Notifications (>= 30)
  const notifCategories = [
    NotificationCategory.ACCOUNT, NotificationCategory.HORSE,
    NotificationCategory.TRAINING, NotificationCategory.LOCK,
    NotificationCategory.MEDICAL, NotificationCategory.NUTRITION,
    NotificationCategory.SYSTEM,
  ];

  const notifUsers = [
    'qa-cm@gmail.com', 'qa-trainer1@gmail.com', 'qa-vet1@gmail.com',
    'qa-groom1@gmail.com', 'qa-owner1@gmail.com', 'qa-owner2@gmail.com',
  ];

  for (let i = 1; i <= 32; i++) {
    const notifId = toUuid(DOMAIN.NOTIFICATION, i);
    const dedupeKey = `QA_DEDUPE_NOTIF_${i.toString().padStart(4, '0')}`;
    const userEmail = notifUsers[(i - 1) % notifUsers.length];
    const category = notifCategories[(i - 1) % notifCategories.length];

    await prisma.notification.upsert({
      where: { dedupeKey },
      update: {
        userId: userMap[userEmail],
        type: `QA_ALERT_${category}`,
        category,
        title: `Thông báo kiểm thử QA #${i}`,
        message: `Nội dung chi tiết thông báo kiểm thử manual QA #${i} cho ${category}`,
        readAt: i % 2 === 0 ? now : null,
      },
      create: {
        id: notifId,
        userId: userMap[userEmail],
        type: `QA_ALERT_${category}`,
        category,
        title: `Thông báo kiểm thử QA #${i}`,
        message: `Nội dung chi tiết thông báo kiểm thử manual QA #${i} cho ${category}`,
        dedupeKey,
        readAt: i % 2 === 0 ? now : null,
      },
    });
  }

  // --------------------------------------------------------------------------
  // [10/15] STOCK BALANCES (12) & RESTOCK REQUESTS (12)
  // --------------------------------------------------------------------------
  console.log('[10/15] Upserting 12 Stock Balances & 12 Restock Requests...');
  const supplies = await prisma.supplyCatalog.findMany({ where: { isActive: true } });

  for (let i = 0; i < supplies.length; i++) {
    const sp = supplies[i];
    const stockId = toUuid(DOMAIN.STOCK_BALANCE, i + 1);

    await prisma.stockBalance.upsert({
      where: { zoneId_supplyId: { zoneId: qaZoneId, supplyId: sp.id } },
      update: {
        quantity: new Prisma.Decimal(50 + (i * 10)),
        minThreshold: new Prisma.Decimal(20),
        lastInventoryDate: now,
        notes: `Tồn kho QA Zone cho ${sp.name}`,
      },
      create: {
        id: stockId,
        zoneId: qaZoneId,
        supplyId: sp.id,
        quantity: new Prisma.Decimal(50 + (i * 10)),
        minThreshold: new Prisma.Decimal(20),
        lastInventoryDate: now,
        notes: `Tồn kho QA Zone cho ${sp.name}`,
      },
    });
  }

  // 12 Restock Requests (PENDING, APPROVED, DELIVERED, REJECTED)
  const restockStatuses = [
    RestockStatus.PENDING, RestockStatus.PENDING, RestockStatus.PENDING,
    RestockStatus.APPROVED, RestockStatus.APPROVED, RestockStatus.APPROVED,
    RestockStatus.DELIVERED, RestockStatus.DELIVERED, RestockStatus.DELIVERED,
    RestockStatus.REJECTED, RestockStatus.REJECTED, RestockStatus.REJECTED,
  ];

  for (let i = 1; i <= 12; i++) {
    const reqId = toUuid(DOMAIN.RESTOCK_REQUEST, i);
    const requestNumber = `QA-REQ-20261026-${i.toString().padStart(4, '0')}`;
    const sp = supplies[(i - 1) % supplies.length];
    const status = restockStatuses[i - 1];
    const isApprovedOrMore = status === RestockStatus.APPROVED || status === RestockStatus.DELIVERED;
    const isDelivered = status === RestockStatus.DELIVERED;
    const isRejected = status === RestockStatus.REJECTED;

    await prisma.restockRequest.upsert({
      where: { id: reqId },
      update: {
        requestNumber,
        zoneId: qaZoneId,
        supplyId: sp.id,
        requestedQuantity: new Prisma.Decimal(30),
        approvedQuantity: isApprovedOrMore ? new Prisma.Decimal(30) : null,
        status,
        urgencyReason: 'Bổ sung vật tư cho đàn ngựa kiểm thử Zone QA',
        rejectionReason: isRejected ? 'Kho trung tâm vẫn còn đủ tồn kho' : null,
        requestedById: userMap['qa-groom1@gmail.com'],
        reviewedById: isApprovedOrMore || isRejected ? userMap['qa-cm@gmail.com'] : null,
        reviewedAt: isApprovedOrMore || isRejected ? now : null,
        deliveredById: isDelivered ? userMap['qa-cm@gmail.com'] : null,
        deliveredAt: isDelivered ? now : null,
      },
      create: {
        id: reqId,
        requestNumber,
        zoneId: qaZoneId,
        supplyId: sp.id,
        requestedQuantity: new Prisma.Decimal(30),
        approvedQuantity: isApprovedOrMore ? new Prisma.Decimal(30) : null,
        status,
        urgencyReason: 'Bổ sung vật tư cho đàn ngựa kiểm thử Zone QA',
        rejectionReason: isRejected ? 'Kho trung tâm vẫn còn đủ tồn kho' : null,
        requestedById: userMap['qa-groom1@gmail.com'],
        reviewedById: isApprovedOrMore || isRejected ? userMap['qa-cm@gmail.com'] : null,
        reviewedAt: isApprovedOrMore || isRejected ? now : null,
        deliveredById: isDelivered ? userMap['qa-cm@gmail.com'] : null,
        deliveredAt: isDelivered ? now : null,
      },
    });
  }

  // --------------------------------------------------------------------------
  // [11/15] NUTRITION PLANS (12) & DAILY CARE TASKS (28)
  // --------------------------------------------------------------------------
  console.log('[11/15] Upserting 12 Nutrition Plans & 28 Daily Care Tasks...');
  const nutStatuses = [
    NutritionPlanStatus.DRAFT, NutritionPlanStatus.DRAFT, NutritionPlanStatus.DRAFT,
    NutritionPlanStatus.PENDING_APPROVAL, NutritionPlanStatus.PENDING_APPROVAL, NutritionPlanStatus.PENDING_APPROVAL,
    NutritionPlanStatus.APPROVED, NutritionPlanStatus.APPROVED, NutritionPlanStatus.APPROVED,
    NutritionPlanStatus.REJECTED, NutritionPlanStatus.REJECTED,
    NutritionPlanStatus.ARCHIVED,
  ];

  for (let i = 1; i <= 12; i++) {
    const nutId = toUuid(DOMAIN.NUTRITION_PLAN, i);
    const planCode = `QA-NUT-${i.toString().padStart(6, '0')}`;
    const horseCode = `QA-HR-${i.toString().padStart(6, '0')}`;
    const status = nutStatuses[i - 1];
    const isApproved = status === NutritionPlanStatus.APPROVED;
    const isRejected = status === NutritionPlanStatus.REJECTED;

    await prisma.nutritionPlan.upsert({
      where: { id: nutId },
      update: {
        planCode,
        horseId: horseMap[horseCode],
        status,
        dailyFeedWeightKg: 10.5,
        targetWeightRatioPct: 2.2,
        mealsJson: [
          { mealType: 'MORNING', time: '06:00', items: [{ supplyName: 'Cỏ khô Alfalfa', amount: 3.5, unit: 'KG' }] },
          { mealType: 'NOON', time: '12:00', items: [{ supplyName: 'Ngũ cốc yến mạch', amount: 3.0, unit: 'KG' }] },
          { mealType: 'EVENING', time: '18:00', items: [{ supplyName: 'Cỏ khô Timothy', amount: 4.0, unit: 'KG' }] },
        ],
        createdById: userMap['qa-trainer1@gmail.com'],
        approvedById: isApproved ? userMap['qa-vet1@gmail.com'] : null,
        approvedAt: isApproved ? now : null,
        rejectionReason: isRejected ? 'Tỷ lệ ngũ cốc quá cao so với thể trạng ngựa' : null,
      },
      create: {
        id: nutId,
        planCode,
        horseId: horseMap[horseCode],
        status,
        dailyFeedWeightKg: 10.5,
        targetWeightRatioPct: 2.2,
        mealsJson: [
          { mealType: 'MORNING', time: '06:00', items: [{ supplyName: 'Cỏ khô Alfalfa', amount: 3.5, unit: 'KG' }] },
          { mealType: 'NOON', time: '12:00', items: [{ supplyName: 'Ngũ cốc yến mạch', amount: 3.0, unit: 'KG' }] },
          { mealType: 'EVENING', time: '18:00', items: [{ supplyName: 'Cỏ khô Timothy', amount: 4.0, unit: 'KG' }] },
        ],
        createdById: userMap['qa-trainer1@gmail.com'],
        approvedById: isApproved ? userMap['qa-vet1@gmail.com'] : null,
        approvedAt: isApproved ? now : null,
        rejectionReason: isRejected ? 'Tỷ lệ ngũ cốc quá cao so với thể trạng ngựa' : null,
      },
    });
  }

  // 28 Daily Care Tasks (FEEDING, CLEANING, GROOMING, ICE_BOOT_REST, WALKING, MEDICATION, OTHER)
  const taskTypes = [
    DailyTaskType.FEEDING, DailyTaskType.CLEANING, DailyTaskType.GROOMING,
    DailyTaskType.ICE_BOOT_REST, DailyTaskType.WALKING, DailyTaskType.MEDICATION, DailyTaskType.OTHER,
  ];

  for (let i = 1; i <= 28; i++) {
    const taskId = toUuid(DOMAIN.DAILY_CARE_TASK, i);
    const taskCode = `QA-CARE-20261026-${i.toString().padStart(4, '0')}`;
    const horseCode = `QA-HR-${(i % 20 + 1).toString().padStart(6, '0')}`;
    const stallCode = `STALL-QA${(i % 20 + 1).toString().padStart(2, '0')}`;
    const taskType = taskTypes[(i - 1) % taskTypes.length];
    const isCompleted = i <= 14;

    await prisma.dailyCareTask.upsert({
      where: { id: taskId },
      update: {
        taskCode,
        date: new Date('2026-10-26T00:00:00.000Z'),
        horseId: horseMap[horseCode],
        stallZoneId: qaZoneId,
        stallId: stallMap[stallCode],
        taskType,
        title: `Công việc chăm sóc ${taskType} QA #${i}`,
        scheduledTime: '08:00',
        isCompleted,
        completedAt: isCompleted ? now : null,
        completedById: isCompleted ? userMap['qa-groom1@gmail.com'] : null,
        assignedGroomUserId: userMap['qa-groom1@gmail.com'],
      },
      create: {
        id: taskId,
        taskCode,
        date: new Date('2026-10-26T00:00:00.000Z'),
        horseId: horseMap[horseCode],
        stallZoneId: qaZoneId,
        stallId: stallMap[stallCode],
        taskType,
        title: `Công việc chăm sóc ${taskType} QA #${i}`,
        scheduledTime: '08:00',
        isCompleted,
        completedAt: isCompleted ? now : null,
        completedById: isCompleted ? userMap['qa-groom1@gmail.com'] : null,
        assignedGroomUserId: userMap['qa-groom1@gmail.com'],
      },
    });
  }

  // --------------------------------------------------------------------------
  // [12/15] DAILY GROOMING LOGS (8) & SHIFT ROSTERS (6)
  // --------------------------------------------------------------------------
  console.log('[12/15] Upserting 8 Grooming Logs & 6 Shift Rosters...');
  for (let i = 1; i <= 8; i++) {
    const logId = toUuid(DOMAIN.DAILY_GROOMING_LOG, i);
    const horseCode = `QA-HR-${i.toString().padStart(6, '0')}`;

    await prisma.dailyGroomingLog.upsert({
      where: { id: logId },
      update: {
        horseId: horseMap[horseCode],
        groomUserId: userMap['qa-groom1@gmail.com'],
        shiftDate: new Date('2026-10-26T07:00:00.000Z'),
        shiftType: ShiftType.MORNING,
        feedCompleted: true,
        cleaningCompleted: true,
        groomingCompleted: true,
        iceBootCompleted: i % 2 === 0,
        healthObservations: `Nhật ký chăm sóc chuồng ngựa QA #${i}: thể trạng tốt`,
      },
      create: {
        id: logId,
        horseId: horseMap[horseCode],
        groomUserId: userMap['qa-groom1@gmail.com'],
        shiftDate: new Date('2026-10-26T07:00:00.000Z'),
        shiftType: ShiftType.MORNING,
        feedCompleted: true,
        cleaningCompleted: true,
        groomingCompleted: true,
        iceBootCompleted: i % 2 === 0,
        healthObservations: `Nhật ký chăm sóc chuồng ngựa QA #${i}: thể trạng tốt`,
      },
    });
  }

  // Shift Rosters
  const shifts = await prisma.shiftCatalog.findMany();
  for (let i = 1; i <= 6; i++) {
    const rosterId = toUuid(DOMAIN.SHIFT_ROSTER, i);
    const shift = shifts[(i - 1) % shifts.length];
    const groomEmail = `qa-groom${((i - 1) % 4) + 1}@gmail.com`;

    await prisma.shiftRoster.upsert({
      where: { id: rosterId },
      update: {
        date: new Date('2026-10-26T00:00:00.000Z'),
        shiftId: shift.id,
        zoneId: qaZoneId,
        groomUserId: userMap[groomEmail],
        notes: `Phân công trực ca QA ${shift.name}`,
      },
      create: {
        id: rosterId,
        date: new Date('2026-10-26T00:00:00.000Z'),
        shiftId: shift.id,
        zoneId: qaZoneId,
        groomUserId: userMap[groomEmail],
        notes: `Phân công trực ca QA ${shift.name}`,
      },
    });
  }

  // --------------------------------------------------------------------------
  // [13/15] SIMULATOR SESSIONS (4)
  // --------------------------------------------------------------------------
  console.log('[13/15] Upserting 4 Simulator Sessions...');
  const simConfigs = [
    { type: SimulatorSessionType.WORKOUT, status: SimulatorSessionStatus.COMPLETED, horseIdx: 1 },
    { type: SimulatorSessionType.WORKOUT, status: SimulatorSessionStatus.RUNNING, horseIdx: 2 },
    { type: SimulatorSessionType.RACE, status: SimulatorSessionStatus.COMPLETED, horseIdx: 3 },
    { type: SimulatorSessionType.EXAM, status: SimulatorSessionStatus.ABORTED_INJURY, horseIdx: 4 },
  ];

  for (let i = 0; i < simConfigs.length; i++) {
    const idx = i + 1;
    const simId = `QA-SIM-SESSION-${idx.toString().padStart(3, '0')}`;
    const cfg = simConfigs[i];
    const horseCode = `QA-HR-${cfg.horseIdx.toString().padStart(6, '0')}`;

    await prisma.simulatorSession.upsert({
      where: { id: simId },
      update: {
        type: cfg.type,
        status: cfg.status,
        horseIds: [horseMap[horseCode]],
        actorUserId: userMap['qa-trainer1@gmail.com'],
        startedAt: new Date('2026-10-26T07:30:00.000Z'),
        finishedAt: cfg.status === SimulatorSessionStatus.COMPLETED ? new Date('2026-10-26T08:00:00.000Z') : null,
        lastSnapshot: { speed: 52.5, heartRate: 175, distanceMeters: 1600 },
        result: cfg.status === SimulatorSessionStatus.COMPLETED ? { durationSeconds: 105.4, topSpeed: 58.0, avgHeartRate: 162 } : Prisma.JsonNull,
      },
      create: {
        id: simId,
        type: cfg.type,
        status: cfg.status,
        horseIds: [horseMap[horseCode]],
        actorUserId: userMap['qa-trainer1@gmail.com'],
        startedAt: new Date('2026-10-26T07:30:00.000Z'),
        finishedAt: cfg.status === SimulatorSessionStatus.COMPLETED ? new Date('2026-10-26T08:00:00.000Z') : null,
        lastSnapshot: { speed: 52.5, heartRate: 175, distanceMeters: 1600 },
        result: cfg.status === SimulatorSessionStatus.COMPLETED ? { durationSeconds: 105.4, topSpeed: 58.0, avgHeartRate: 162 } : Prisma.JsonNull,
      },
    });
  }

  // --------------------------------------------------------------------------
  // [14/15] PERMISSION REQUESTS (3) & AI INSIGHTS (4)
  // --------------------------------------------------------------------------
  console.log('[14/15] Upserting 3 Permission Requests & 4 AI Insights...');
  const permRequests = [
    { screen: '/horses/edit', ref: '403-QA26-0001', status: PermissionRequestStatus.OPEN },
    { screen: '/training/plans/create', ref: '403-QA26-0002', status: PermissionRequestStatus.GRANTED },
    { screen: '/tournaments/manage', ref: '403-QA26-0003', status: PermissionRequestStatus.DISMISSED },
  ];

  for (let i = 0; i < permRequests.length; i++) {
    const pr = permRequests[i];
    const prId = 99000 + (i + 1); // Deterministic high integer ID
    await prisma.permissionRequest.upsert({
      where: { id: prId },
      update: {
        userId: userMap['qa-groom1@gmail.com'],
        screen: pr.screen,
        reference: pr.ref,
        status: pr.status,
        resolvedAt: pr.status !== PermissionRequestStatus.OPEN ? now : null,
        resolvedBy: pr.status !== PermissionRequestStatus.OPEN ? 'QA Michael Tran (Club Manager)' : null,
      },
      create: {
        id: prId,
        userId: userMap['qa-groom1@gmail.com'],
        screen: pr.screen,
        reference: pr.ref,
        status: pr.status,
        resolvedAt: pr.status !== PermissionRequestStatus.OPEN ? now : null,
        resolvedBy: pr.status !== PermissionRequestStatus.OPEN ? 'QA Michael Tran (Club Manager)' : null,
      },
    });
  }

  // 4 AI Insights
  const insightTypes = [
    InsightType.WORKOUT_RECOMMENDATION,
    InsightType.INJURY_RISK_WARNING,
    InsightType.RECOVERY_ADVICE,
    InsightType.WORKOUT_RECOMMENDATION,
  ];

  for (let i = 1; i <= 4; i++) {
    const insightId = toUuid(DOMAIN.AI_INSIGHT, i);
    const horseCode = `QA-HR-${i.toString().padStart(6, '0')}`;
    const type = insightTypes[i - 1];

    await prisma.aIInsight.upsert({
      where: { id: insightId },
      update: {
        horseId: horseMap[horseCode],
        insightType: type,
        trainingLoadIndex: 75.0 + (i * 3),
        riskScore: 0.15 + (i * 0.1),
        recommendationsJson: JSON.stringify({
          summary: `Khuyến nghị AI kiểm thử QA #${i}`,
          details: ['Tối ưu bài tập nước kiệu', 'Theo dõi sát nhịp tim phục hồi'],
        }),
        status: InsightStatus.GENERATED,
      },
      create: {
        id: insightId,
        horseId: horseMap[horseCode],
        insightType: type,
        trainingLoadIndex: 75.0 + (i * 3),
        riskScore: 0.15 + (i * 0.1),
        recommendationsJson: JSON.stringify({
          summary: `Khuyến nghị AI kiểm thử QA #${i}`,
          details: ['Tối ưu bài tập nước kiệu', 'Theo dõi sát nhịp tim phục hồi'],
        }),
        status: InsightStatus.GENERATED,
      },
    });
  }

  // --------------------------------------------------------------------------
  // [14b/15] TASK-013 DETERMINISTIC MANUAL-QA FIXTURES (CR-017)
  // --------------------------------------------------------------------------
  console.log('[14b/15] Upserting TASK-013 Deterministic Manual-QA Fixtures...');
  const trialHorseId = '00000000-0000-4000-a013-000000000001';
  const examHorseId = '00000000-0000-4000-a013-000000000002';
  const trialPlanId = '00000000-0000-4000-a013-000000000011';
  const trialWorkoutId = '00000000-0000-4000-a013-000000000021';
  const examRecId = '00000000-0000-4000-a013-000000000031';

  // 1. QA T013 Trial Horse
  await prisma.horse.upsert({
    where: { horseCode: 'QA-T013-HORSE-001' },
    update: {
      name: 'QA T013 Trial Horse',
      breed: 'Thoroughbred',
      color: 'Bay',
      gender: 'STALLION',
      dob: new Date('2021-04-15'),
      weightKg: 495,
      status: HorseStatus.ACTIVE,
      isMedicalLocked: false,
      ownerId: userMap['qa-owner1@gmail.com'],
    },
    create: {
      id: trialHorseId,
      horseCode: 'QA-T013-HORSE-001',
      name: 'QA T013 Trial Horse',
      microchip: '985141099013001',
      microchipRfid: '985141099013001',
      breed: 'Thoroughbred',
      color: 'Bay',
      gender: 'STALLION',
      dob: new Date('2021-04-15'),
      weightKg: 495,
      status: HorseStatus.ACTIVE,
      isMedicalLocked: false,
      ownerId: userMap['qa-owner1@gmail.com'],
    },
  });

  // 2. QA T013 Trial Plan
  await prisma.trainingPlan.upsert({
    where: { planCode: 'QA-T013-PLAN-001' },
    update: {
      horseId: trialHorseId,
      trainerUserId: userMap['qa-trainer1@gmail.com'],
      status: PlanStatus.ACTIVE,
      startDate: new Date(Date.now() - 7 * 24 * 3600 * 1000),
      endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      phaseName: 'Giai đoạn thử tải nâng cao',
      objective: 'Chạy thử mô phỏng kiểm chuẩn TASK-013',
      notes: '[TASK-013-MANUAL-QA] Deterministic QA trial training plan',
    },
    create: {
      id: trialPlanId,
      planCode: 'QA-T013-PLAN-001',
      horseId: trialHorseId,
      trainerUserId: userMap['qa-trainer1@gmail.com'],
      status: PlanStatus.ACTIVE,
      startDate: new Date(Date.now() - 7 * 24 * 3600 * 1000),
      endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      phaseName: 'Giai đoạn thử tải nâng cao',
      objective: 'Chạy thử mô phỏng kiểm chuẩn TASK-013',
      notes: '[TASK-013-MANUAL-QA] Deterministic QA trial training plan',
    },
  });

  // Clean up any existing session for the trial workouts and deterministic QA horses so they start in clean SCHEDULED / launchable state
  const zephyrWorkoutId = toUuid(DOMAIN.WORKOUT_SESSION, 3);
  await prisma.simulatorSession.deleteMany({
    where: {
      OR: [
        { workoutSessionId: trialWorkoutId },
        { workoutSessionId: zephyrWorkoutId },
        { horseIds: { has: trialHorseId } },
        { horseIds: { has: examHorseId } },
        { horseIds: { has: horseMap['QA-HR-000001'] } },
      ],
    },
  });

  // 3. QA-T013-TRIAL-001 Workout
  await prisma.workoutSession.upsert({
    where: { id: trialWorkoutId },
    update: {
      trainingPlanId: trialPlanId,
      horseId: trialHorseId,
      assignedStaffUserId: userMap['qa-trainer1@gmail.com'],
      scheduledDate: new Date(Date.now() - 3600 * 1000),
      distanceMeters: 1800,
      repetitions: 1,
      targetSpeedKmh: 54.0,
      status: WorkoutStatus.SCHEDULED,
      workoutType: 'TRIAL',
      intensity: 'MODERATE',
      trackSurface: 'TURF',
      trainerNotes: '[TASK-013-MANUAL-QA] QA-T013-TRIAL-001: 1800m TURF MODERATE deterministic trial',
      statusReason: null,
      actualTimeSeconds: null,
      actualDistanceMeters: null,
      averageSpeedKmh: null,
      topSpeedKmh: null,
      actualSurface: null,
      trackCondition: null,
      completionLevel: null,
      resultRecordedAt: null,
      resultRecordedById: null,
      resultUpdatedAt: null,
      resultUpdatedById: null,
      resultNotes: null,
      abnormalSigns: false,
      abnormalSignTypes: [],
      abnormalNotes: null,
      heartRatePeak: null,
      heartRateRecovery: null,
      performanceScore: null,
    },
    create: {
      id: trialWorkoutId,
      trainingPlanId: trialPlanId,
      horseId: trialHorseId,
      assignedStaffUserId: userMap['qa-trainer1@gmail.com'],
      scheduledDate: new Date(Date.now() - 3600 * 1000),
      distanceMeters: 1800,
      repetitions: 1,
      targetSpeedKmh: 54.0,
      status: WorkoutStatus.SCHEDULED,
      workoutType: 'TRIAL',
      intensity: 'MODERATE',
      trackSurface: 'TURF',
      trainerNotes: '[TASK-013-MANUAL-QA] QA-T013-TRIAL-001: 1800m TURF MODERATE deterministic trial',
    },
  });

  // Clean Zephyr workout result residue if it was previously simulated
  await prisma.workoutSession.update({
    where: { id: zephyrWorkoutId },
    data: {
      status: WorkoutStatus.SCHEDULED,
      actualTimeSeconds: null,
      actualDistanceMeters: null,
      averageSpeedKmh: null,
      topSpeedKmh: null,
      actualSurface: null,
      trackCondition: null,
      completionLevel: null,
      resultRecordedAt: null,
      resultRecordedById: null,
      resultUpdatedAt: null,
      resultUpdatedById: null,
      resultNotes: null,
      abnormalSigns: false,
      abnormalSignTypes: [],
      abnormalNotes: null,
      heartRatePeak: null,
      heartRateRecovery: null,
      performanceScore: null,
    },
  });

  // 4. QA T013 Exam Horse (weightKg explicitly NULL for R-12 deterministic test)
  await prisma.horse.upsert({
    where: { horseCode: 'QA-T013-EXAM-001' },
    update: {
      name: 'QA T013 Exam Horse',
      breed: 'Thoroughbred',
      color: 'Chestnut',
      gender: 'MARE',
      dob: new Date('2021-06-20'),
      weightKg: null,
      status: HorseStatus.UNDER_OBSERVATION,
      isMedicalLocked: false,
      ownerId: userMap['qa-owner1@gmail.com'],
    },
    create: {
      id: examHorseId,
      horseCode: 'QA-T013-EXAM-001',
      name: 'QA T013 Exam Horse',
      microchip: '985141099013002',
      microchipRfid: '985141099013002',
      breed: 'Thoroughbred',
      color: 'Chestnut',
      gender: 'MARE',
      dob: new Date('2021-06-20'),
      weightKg: null,
      status: HorseStatus.UNDER_OBSERVATION,
      isMedicalLocked: false,
      ownerId: userMap['qa-owner1@gmail.com'],
    },
  });

  // Clean up any existing exam simulator sessions for exam horse so it starts clean
  await prisma.simulatorSession.deleteMany({
    where: {
      type: SimulatorSessionType.EXAM,
      horseIds: { has: examHorseId },
    },
  });

  // 5. QA-T013-REC-001 Medical Record
  await prisma.medicalRecord.upsert({
    where: { id: examRecId },
    update: {
      recordNumber: 'QA-T013-REC-001',
      horseId: examHorseId,
      veterinarianUserId: userMap['qa-vet1@gmail.com'],
      examinationDate: new Date(),
      examinationType: 'Routine Clinical',
      status: MedicalRecordStatus.OPEN,
      clinicalExamination: '[TASK-013-MANUAL-QA] Clinical examination baseline',
      clinicalDiagnosis: 'Khám định kỳ tổng quát',
      symptoms: 'QA-T013-EXAM-001',
      treatmentProtocol: 'Theo dõi sinh hiệu thường quy',
      discoverySource: 'VET Self-Discovered',
    },
    create: {
      id: examRecId,
      recordNumber: 'QA-T013-REC-001',
      horseId: examHorseId,
      veterinarianUserId: userMap['qa-vet1@gmail.com'],
      examinationDate: new Date(),
      examinationType: 'Routine Clinical',
      status: MedicalRecordStatus.OPEN,
      clinicalExamination: '[TASK-013-MANUAL-QA] Clinical examination baseline',
      clinicalDiagnosis: 'Khám định kỳ tổng quát',
      symptoms: 'QA-T013-EXAM-001',
      treatmentProtocol: 'Theo dõi sinh hiệu thường quy',
      discoverySource: 'VET Self-Discovered',
    },
  });

  // --------------------------------------------------------------------------
  // [15/15] VERIFICATION SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n[15/15] QA Manual Dataset Summary:');
  const qaUsersCount = await prisma.user.count({ where: { email: { startsWith: 'qa-' } } });
  const qaHorsesCount = await prisma.horse.count({ where: { horseCode: { startsWith: 'QA-HR-' } } });
  const qaStallsCount = await prisma.stall.count({ where: { code: { startsWith: 'STALL-QA' } } });
  const qaPlansCount = await prisma.trainingPlan.count({ where: { planCode: { startsWith: 'QA-GA-' } } });
  const qaWorkoutsCount = await prisma.workoutSession.count({ where: { trainingPlan: { planCode: { startsWith: 'QA-GA-' } } } });
  const qaMedCount = await prisma.medicalRecord.count({ where: { recordNumber: { startsWith: 'QA-BA-' } } });
  const qaInjCount = await prisma.injuryLog.count({ where: { horse: { horseCode: { startsWith: 'QA-HR-' } } } });
  const qaLocksCount = await prisma.medicalLock.count({ where: { lockCode: { startsWith: 'KH-QA' } } });
  const qaPrevCount = await prisma.preventiveSchedule.count({ where: { horse: { horseCode: { startsWith: 'QA-HR-' } } } });
  const qaIncCount = await prisma.incidentReport.count({ where: { incidentNumber: { startsWith: 'QA-INC-' } } });
  const qaTournCount = await prisma.tournament.count({ where: { name: { startsWith: 'Giải Đua Ngựa Thủ Công QA' } } });
  const qaRegCount = await prisma.tournamentRegistration.count({ where: { tournament: { name: { startsWith: 'Giải Đua Ngựa Thủ Công QA' } } } });
  const qaResCount = await prisma.tournamentResult.count({ where: { registration: { tournament: { name: { startsWith: 'Giải Đua Ngựa Thủ Công QA' } } } } });
  const qaInvCount = await prisma.financialInvoice.count({ where: { horse: { horseCode: { startsWith: 'QA-HR-' } } } });
  const qaNotifCount = await prisma.notification.count({ where: { dedupeKey: { startsWith: 'QA_DEDUPE_NOTIF_' } } });
  const qaNutCount = await prisma.nutritionPlan.count({ where: { planCode: { startsWith: 'QA-NUT-' } } });
  const qaCareCount = await prisma.dailyCareTask.count({ where: { taskCode: { startsWith: 'QA-CARE-' } } });
  const qaRestockCount = await prisma.restockRequest.count({ where: { requestNumber: { startsWith: 'QA-REQ-' } } });
  const qaSimCount = await prisma.simulatorSession.count({ where: { id: { startsWith: 'QA-SIM-' } } });

  console.log({
    qaUsersCount,
    qaHorsesCount,
    qaStallsCount,
    qaPlansCount,
    qaWorkoutsCount,
    qaMedCount,
    qaInjCount,
    qaLocksCount,
    qaPrevCount,
    qaIncCount,
    qaTournCount,
    qaRegCount,
    qaResCount,
    qaInvCount,
    qaNotifCount,
    qaNutCount,
    qaCareCount,
    qaRestockCount,
    qaSimCount,
  });

  console.log('=== TASK-020 Controlled Manual-QA Dataset Expansion Completed Successfully ===\n');
}

main()
  .catch((err) => {
    console.error('\n[FATAL ERROR during seed-manual-qa]:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
