import {
  PrismaClient,
  Role,
  UserStatus,
  PermissionRequestStatus,
  HorseStatus,
  StallStatus,
  PlanStatus,
  WorkoutStatus,
  TrackSurface,
  PreventiveType,
  PreventiveStatus,
  HorseCatalogType,
  MedicalRecordStatus,
  SeverityLevel,
  NotificationCategory,
  RetireReason,
  InjuryStatus,
  BodySide,
  TournamentStatus,
  RegistrationStatus,
  InvoiceStatus,
  SupplyCategory,
  SupplyUnit,
  DailyTaskType,
  IncidentStatus,
  RestockStatus,
  NutritionPlanStatus,
  InsightType,
  InsightStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Seeding 100% Comprehensive EquiFlow Memorable Database ---');

  const defaultPassword = await bcrypt.hash('EquiFlow@2026', 10);
  const now = new Date();
  const clubDay = (offset: number) =>
    new Date(now.getTime() + 7 * 3600000 + offset * 86400000).toISOString().slice(0, 10);

  // ----------------------------------------------------------------
  // 1. Users Covering All 5 Roles and 7 Account Lifecycles (SC-1.01)
  // ----------------------------------------------------------------
  const manager = await prisma.user.upsert({
    where: { email: 'manager@gmail.com' },
    update: { fullName: 'Trần Quang Minh (Quản Lý)' },
    create: {
      email: 'manager@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Trần Quang Minh (Quản Lý)',
      phoneNumber: '+84901234567',
      role: Role.CLUB_MANAGER,
      status: UserStatus.ACTIVE,
    },
  });

  const trainer = await prisma.user.upsert({
    where: { email: 'trainer@gmail.com' },
    update: { fullName: 'Nguyễn Văn Tuấn (HLV Trưởng)' },
    create: {
      email: 'trainer@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Nguyễn Văn Tuấn (HLV Trưởng)',
      phoneNumber: '+84901234568',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
    },
  });

  const trainer2 = await prisma.user.upsert({
    where: { email: 'trainer2@gmail.com' },
    update: { fullName: 'Lê Hoàng Nam (HLV Tuyển)' },
    create: {
      email: 'trainer2@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Lê Hoàng Nam (HLV Tuyển)',
      phoneNumber: '+84901234574',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
    },
  });

  const vet = await prisma.user.upsert({
    where: { email: 'vet@gmail.com' },
    update: { fullName: 'BS. Phạm Minh Trí (Thú Y Trưởng)' },
    create: {
      email: 'vet@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'BS. Phạm Minh Trí (Thú Y Trưởng)',
      phoneNumber: '+84901234569',
      role: Role.VETERINARIAN,
      status: UserStatus.ACTIVE,
    },
  });

  const groom1 = await prisma.user.upsert({
    where: { email: 'groom@gmail.com' },
    update: { fullName: 'Lê Văn Bình (Groom Chăm Sóc)' },
    create: {
      email: 'groom@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Lê Văn Bình (Groom Chăm Sóc)',
      phoneNumber: '+84901234570',
      role: Role.GROOM,
      status: UserStatus.ACTIVE,
    },
  });

  const groom2 = await prisma.user.upsert({
    where: { email: 'groom2@gmail.com' },
    update: { fullName: 'Hoàng Văn Phúc (Groom Cao Cấp)' },
    create: {
      email: 'groom2@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Hoàng Văn Phúc (Groom Cao Cấp)',
      phoneNumber: '+84901234572',
      role: Role.GROOM,
      status: UserStatus.ACTIVE,
    },
  });

  const owner1 = await prisma.user.upsert({
    where: { email: 'owner@gmail.com' },
    update: { fullName: 'Đặng Gia Bảo (Chủ Ngựa)' },
    create: {
      email: 'owner@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Đặng Gia Bảo (Chủ Ngựa)',
      phoneNumber: '+84901234571',
      role: Role.HORSE_OWNER,
      status: UserStatus.ACTIVE,
    },
  });

  const owner2 = await prisma.user.upsert({
    where: { email: 'owner2@gmail.com' },
    update: { fullName: 'Vũ Hoàng Long (Chủ Ngựa VIP)' },
    create: {
      email: 'owner2@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Vũ Hoàng Long (Chủ Ngựa VIP)',
      phoneNumber: '+84901234573',
      role: Role.HORSE_OWNER,
      status: UserStatus.ACTIVE,
    },
  });

  // Account Lifecycle Edge Cases (PENDING_APPROVAL, INVITED, LOCKED, INACTIVE, REJECTED, PENDING_EMAIL)
  const pendingUser = await prisma.user.upsert({
    where: { email: 'pending.groom@gmail.com' },
    update: { fullName: 'Trần Văn Nam (Chờ Duyệt)' },
    create: {
      email: 'pending.groom@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Trần Văn Nam (Chờ Duyệt)',
      phoneNumber: '+84909888111',
      role: Role.GROOM,
      status: UserStatus.PENDING_APPROVAL,
    },
  });

  await prisma.user.upsert({
    where: { email: 'invited.vet@gmail.com' },
    update: { fullName: 'BS. Alexander Bell (Được Mời)' },
    create: {
      email: 'invited.vet@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'BS. Alexander Bell (Được Mời)',
      phoneNumber: '+84909888222',
      role: Role.VETERINARIAN,
      status: UserStatus.INVITED,
    },
  });

  await prisma.user.upsert({
    where: { email: 'locked.user@gmail.com' },
    update: { fullName: 'Đặng Tuấn Kiệt (Bị Khóa)' },
    create: {
      email: 'locked.user@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Đặng Tuấn Kiệt (Bị Khóa)',
      phoneNumber: '+84909888333',
      role: Role.GROOM,
      status: UserStatus.LOCKED,
    },
  });

  await prisma.user.upsert({
    where: { email: 'inactive.user@gmail.com' },
    update: { fullName: 'Nguyễn Văn Tạm (Ngừng Hoạt Động)' },
    create: {
      email: 'inactive.user@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Nguyễn Văn Tạm (Ngừng Hoạt Động)',
      phoneNumber: '+84909888444',
      role: Role.GROOM,
      status: UserStatus.INACTIVE,
    },
  });

  await prisma.user.upsert({
    where: { email: 'rejected.user@gmail.com' },
    update: { fullName: 'Lê Văn Từ Chối (Bị Từ Chối)' },
    create: {
      email: 'rejected.user@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Lê Văn Từ Chối (Bị Từ Chối)',
      phoneNumber: '+84909888555',
      role: Role.GROOM,
      status: UserStatus.REJECTED,
    },
  });

  await prisma.user.upsert({
    where: { email: 'email.pending@gmail.com' },
    update: { fullName: 'Hoàng Thị Thảo (Chờ Xác Thực Email)' },
    create: {
      email: 'email.pending@gmail.com',
      passwordHash: defaultPassword,
      fullName: 'Hoàng Thị Thảo (Chờ Xác Thực Email)',
      phoneNumber: '+84909888666',
      role: Role.HORSE_OWNER,
      status: UserStatus.PENDING_EMAIL,
    },
  });

  // Permission Requests covering PermissionRequestStatus: OPEN, GRANTED, DISMISSED
  await prisma.permissionRequest.deleteMany({
    where: { userId: { in: [groom1.id, trainer.id, groom2.id] } },
  });

  await prisma.permissionRequest.createMany({
    data: [
      {
        userId: groom1.id,
        screen: 'MedicalRecords',
        reference: 'Groom Lê Văn Bình xin quyền xem hồ sơ bệnh án chi tiết để hỗ trợ điều trị',
        status: PermissionRequestStatus.OPEN,
      },
      {
        userId: trainer.id,
        screen: 'Tournaments',
        reference: 'HLV Nguyễn Văn Tuấn xin cấp quyền phê duyệt kết quả thi đấu nội bộ',
        status: PermissionRequestStatus.GRANTED,
        resolvedAt: new Date(Date.now() - 2 * 86400000),
        resolvedBy: manager.fullName,
      },
      {
        userId: groom2.id,
        screen: 'Financials',
        reference: 'Groom Hoàng Văn Phúc xin quyền điều chỉnh hóa đơn tài chính',
        status: PermissionRequestStatus.DISMISSED,
        resolvedAt: new Date(Date.now() - 5 * 86400000),
        resolvedBy: manager.fullName,
      },
    ],
  });

  console.log(
    `[1/12] Seeded 14 Users across all 5 Roles and 7 Account Lifecycles & 3 Permission Requests`,
  );

  // ----------------------------------------------------------------
  // 2. Khu chuồng (Stall Zones)
  // ----------------------------------------------------------------
  const zoneDefs = [
    {
      code: 'ZONE-A',
      name: 'Zone A - Barn 1',
      rows: 2,
      cols: 4,
      sortOrder: 1,
      description: 'Khu chuồng đua tiêu chuẩn số 1 (8 ô chuồng)',
    },
    {
      code: 'ZONE-B',
      name: 'Zone B - Barn 2',
      rows: 2,
      cols: 4,
      sortOrder: 2,
      description: 'Khu chuồng huấn luyện & phục hồi số 2 (8 ô chuồng)',
    },
    {
      code: 'ZONE-C',
      name: 'Zone C - Isolation',
      rows: 1,
      cols: 4,
      sortOrder: 3,
      description: 'Khu cách ly kiểm dịch y tế (4 ô chuồng)',
    },
  ];

  const zoneIds: Record<string, string> = {};
  for (const z of zoneDefs) {
    const zone = await prisma.stallZone.upsert({
      where: { code: z.code },
      update: { name: z.name, rows: z.rows, cols: z.cols, description: z.description },
      create: z,
    });
    zoneIds[z.name] = zone.id;
    zoneIds[z.code] = zone.id;
  }

  // ----------------------------------------------------------------
  // 3. Toàn bộ 20 ô chuồng với các trạng thái: OCCUPIED, AVAILABLE, MAINTENANCE, INACTIVE
  // ----------------------------------------------------------------
  const stallDefs: Array<{
    code: string;
    zone: string;
    row: number;
    col: number;
    status: StallStatus;
    notes?: string;
  }> = [];

  // Zone A: 2x4 = 8 ô (STALL-A01 đến STALL-A08)
  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= 4; c++) {
      const idx = (r - 1) * 4 + c;
      stallDefs.push({
        code: `STALL-A0${idx}`,
        zone: 'Zone A - Barn 1',
        row: r,
        col: c,
        status: StallStatus.AVAILABLE,
      });
    }
  }

  // Zone B: 2x4 = 8 ô (STALL-B01 đến STALL-B08)
  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= 4; c++) {
      const idx = (r - 1) * 4 + c;
      stallDefs.push({
        code: `STALL-B0${idx}`,
        zone: 'Zone B - Barn 2',
        row: r,
        col: c,
        status: idx === 8 ? StallStatus.MAINTENANCE : StallStatus.AVAILABLE,
        notes: idx === 8 ? 'Bảo trì thay đệm lót và van cấp nước tự động' : undefined,
      });
    }
  }

  // Zone C: 1x4 = 4 ô (STALL-C01 đến STALL-C04)
  for (let c = 1; c <= 4; c++) {
    stallDefs.push({
      code: `STALL-C0${c}`,
      zone: 'Zone C - Isolation',
      row: 1,
      col: c,
      status: c === 4 ? StallStatus.INACTIVE : StallStatus.AVAILABLE,
      notes:
        c === 4 ? 'Ô chuồng ngừng sử dụng (đang cải tạo hệ thống khử trùng áp lực âm)' : undefined,
    });
  }

  for (const s of stallDefs) {
    const place = { zoneId: zoneIds[s.zone], row: s.row, col: s.col, notes: s.notes || null };
    await prisma.stall.upsert({
      where: { code: s.code },
      update: { ...place, status: s.status },
      create: { ...s, ...place },
    });
  }
  console.log(
    `[2/12] Seeded 3 Zones and 20 Stalls (covering AVAILABLE, OCCUPIED, MAINTENANCE, INACTIVE)`,
  );

  // ----------------------------------------------------------------
  // 4. Danh mục Giống & Màu lông (SC-1.06)
  // ----------------------------------------------------------------
  const catalog: Array<{ type: HorseCatalogType; names: string[] }> = [
    {
      type: HorseCatalogType.BREED,
      names: [
        'Thoroughbred',
        'Arabian',
        'Arabian Cross',
        'Quarter Horse',
        'Warmblood',
        'Standardbred',
        'Appaloosa',
        'Paint',
      ],
    },
    {
      type: HorseCatalogType.COLOR,
      names: ['Bay', 'Bay Dark', 'Chestnut', 'Black', 'Grey', 'Gray Roaming', 'Roan', 'Palomino'],
    },
  ];
  for (const { type, names } of catalog) {
    for (const [i, name] of names.entries()) {
      const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      await prisma.horseCatalogItem.upsert({
        where: { type_code: { type, code } },
        update: {},
        create: { type, code, name, sortOrder: i + 1 },
      });
    }
  }

  // ----------------------------------------------------------------
  // 5. Đàn ngựa tên dễ nhớ, bao quát 100% tất cả 7 trạng thái HorseStatus:
  // ACTIVE, INJURED, IN_TRAINING, UNDER_OBSERVATION, RESTING, ISOLATED, RETIRED
  // ----------------------------------------------------------------
  const horsesData = [
    {
      horseCode: 'HR-000001',
      name: 'Bạch Long Mã',
      microchip: '985141002341001',
      breed: 'Thoroughbred',
      dob: new Date('2021-04-12'),
      gender: 'Colt',
      color: 'Bay Dark',
      status: HorseStatus.ACTIVE,
      isMedicalLocked: false,
      ownerId: owner1.id,
      stallCode: 'STALL-A01',
      groomId: groom1.id,
    },
    {
      horseCode: 'HR-000002',
      name: 'Xích Thố',
      microchip: '985141002342002',
      breed: 'Thoroughbred',
      dob: new Date('2020-03-15'),
      gender: 'Stallion',
      color: 'Chestnut',
      status: HorseStatus.INJURED,
      isMedicalLocked: true,
      ownerId: owner1.id,
      stallCode: 'STALL-A02',
      groomId: groom1.id,
    },
    {
      horseCode: 'HR-000003',
      name: 'Hắc Báo',
      microchip: '985141002343003',
      breed: 'Arabian Cross',
      dob: new Date('2022-01-20'),
      gender: 'Filly',
      color: 'Gray Roaming',
      status: HorseStatus.IN_TRAINING,
      isMedicalLocked: false,
      ownerId: owner1.id,
      stallCode: 'STALL-A03',
      groomId: groom1.id,
    },
    {
      horseCode: 'HR-000004',
      name: 'Thần Phong',
      microchip: '985141002344004',
      breed: 'Thoroughbred',
      dob: new Date('2021-08-05'),
      gender: 'Gelding',
      color: 'Bay',
      status: HorseStatus.UNDER_OBSERVATION,
      isMedicalLocked: false,
      ownerId: owner2.id,
      stallCode: 'STALL-A04',
      groomId: groom2.id,
    },
    {
      horseCode: 'HR-000005',
      name: 'Kim Quy',
      microchip: '985141002345005',
      breed: 'Quarter Horse',
      dob: new Date('2022-05-18'),
      gender: 'Mare',
      color: 'Palomino',
      status: HorseStatus.RESTING,
      isMedicalLocked: false,
      ownerId: owner2.id,
      stallCode: 'STALL-B01',
      groomId: groom2.id,
    },
    {
      horseCode: 'HR-000006',
      name: 'Phi Long',
      microchip: '985141002346006',
      breed: 'Standardbred',
      dob: new Date('2021-02-14'),
      gender: 'Mare',
      color: 'Black',
      status: HorseStatus.ISOLATED,
      isMedicalLocked: false,
      ownerId: owner2.id,
      stallCode: 'STALL-C01',
      groomId: groom2.id,
    },
    {
      horseCode: 'HR-000007',
      name: 'Chiến Mã Hoàng Gia',
      microchip: '985141002347007',
      breed: 'Thoroughbred',
      dob: new Date('2017-06-25'),
      gender: 'Gelding',
      color: 'Grey',
      status: HorseStatus.RETIRED,
      isMedicalLocked: false,
      ownerId: owner1.id,
      stallCode: null,
      groomId: null,
    },
    {
      horseCode: 'HR-000008',
      name: 'Hỏa Phụng',
      microchip: '985141002348008',
      breed: 'Warmblood',
      dob: new Date('2021-07-30'),
      gender: 'Colt',
      color: 'Chestnut',
      status: HorseStatus.ACTIVE,
      isMedicalLocked: false,
      ownerId: owner1.id,
      stallCode: 'STALL-B02',
      groomId: groom1.id,
    },
    {
      horseCode: 'HR-000009',
      name: 'Băng Thiên Mã',
      microchip: '985141002349009',
      breed: 'Thoroughbred',
      dob: new Date('2021-12-05'),
      gender: 'Gelding',
      color: 'Grey',
      status: HorseStatus.ACTIVE,
      isMedicalLocked: false,
      ownerId: owner2.id,
      stallCode: 'STALL-B03',
      groomId: groom2.id,
    },
  ];

  const createdHorses: Record<string, any> = {};

  for (const h of horsesData) {
    const horse = await prisma.horse.upsert({
      where: { horseCode: h.horseCode },
      update: {
        horseCode: h.horseCode,
        name: h.name,
        microchip: h.microchip,
        breed: h.breed,
        dob: h.dob,
        gender: h.gender,
        color: h.color,
        status: h.status,
        isMedicalLocked: h.isMedicalLocked,
        ownerId: h.ownerId,
        retireReason: h.status === HorseStatus.RETIRED ? RetireReason.RETIRED : null,
        deleteReason:
          h.status === HorseStatus.RETIRED
            ? 'Tuổi tác đạt ngưỡng và nghỉ hưu vinh danh sau chức vô địch Derby'
            : null,
        deletedAt: h.status === HorseStatus.RETIRED ? new Date('2025-11-20') : null,
      },
      create: {
        horseCode: h.horseCode,
        name: h.name,
        microchip: h.microchip,
        microchipRfid: h.microchip,
        breed: h.breed,
        dob: h.dob,
        gender: h.gender,
        color: h.color,
        status: h.status,
        isMedicalLocked: h.isMedicalLocked,
        ownerId: h.ownerId,
        retireReason: h.status === HorseStatus.RETIRED ? RetireReason.RETIRED : null,
        deleteReason:
          h.status === HorseStatus.RETIRED
            ? 'Tuổi tác đạt ngưỡng và nghỉ hưu vinh danh sau chức vô địch Derby'
            : null,
        deletedAt: h.status === HorseStatus.RETIRED ? new Date('2025-11-20') : null,
      },
    });
    createdHorses[h.horseCode] = horse;

    if (h.stallCode && h.groomId) {
      const stall = await prisma.stall.findUnique({ where: { code: h.stallCode } });
      if (stall) {
        await prisma.stallAllocation.upsert({
          where: { id: `alloc-${horse.id}` },
          update: { stallId: stall.id, assignedGroomUserId: h.groomId, isActive: true },
          create: {
            id: `alloc-${horse.id}`,
            stallId: stall.id,
            horseId: horse.id,
            assignedGroomUserId: h.groomId,
            isActive: true,
          },
        });
        await prisma.stall.update({
          where: { id: stall.id },
          data: { status: StallStatus.OCCUPIED },
        });
      }
    }
  }
  console.log(`[3/12] Seeded 9 Horses covering 100% of HorseStatus values with memorable names`);

  // ----------------------------------------------------------------
  // 6. Medical Locks (Active Locks và Released Lock lịch sử)
  // ----------------------------------------------------------------
  const horse1 = createdHorses['HR-000001'];
  const horse2 = createdHorses['HR-000002'];
  const horse3 = createdHorses['HR-000003'];
  const horse4 = createdHorses['HR-000004'];
  const horse5 = createdHorses['HR-000005'];
  const horse6 = createdHorses['HR-000006'];
  const horse7 = createdHorses['HR-000007'];
  const horse8 = createdHorses['HR-000008'];
  const horse9 = createdHorses['HR-000009'];

  // Active Lock 1: Xích Thố (INJURED)
  await prisma.medicalLock.upsert({
    where: { lockCode: 'LOCK-HR-000002-001' },
    update: { isLocked: true, appliedMedicalStatus: HorseStatus.INJURED },
    create: {
      lockCode: 'LOCK-HR-000002-001',
      horseId: horse2.id,
      veterinarianUserId: vet.id,
      lockedAt: new Date(Date.now() - 3 * 86400000),
      expectedRestDays: 14,
      recheckDate: new Date(Date.now() + 11 * 86400000),
      appliedMedicalStatus: HorseStatus.INJURED,
      lockReason:
        'Viêm cấp tính dây chằng treo (Suspensory ligament acute desmitis) trong bài chạy thử',
      unlockConditions: 'Siêu âm lại hoàn toàn bình phục và vượt qua bài test co duỗi flexion test',
      isLocked: true,
    },
  });


  // Released Lock: Bạch Long Mã (Lịch sử đã mở khóa)
  await prisma.medicalLock.upsert({
    where: { lockCode: 'LOCK-HR-000001-HIST' },
    update: { isLocked: false },
    create: {
      lockCode: 'LOCK-HR-000001-HIST',
      horseId: horse1.id,
      veterinarianUserId: vet.id,
      lockedAt: new Date(Date.now() - 45 * 86400000),
      expectedRestDays: 14,
      recheckDate: new Date(Date.now() - 31 * 86400000),
      appliedMedicalStatus: HorseStatus.INJURED,
      lockReason: 'Đụng dập nhẹ phần mềm vùng cổ chân sau buổi tập đường cát',
      unlockConditions: 'Hết sưng nóng và vận động bình thường',
      isLocked: false,
      unlockedAt: new Date(Date.now() - 30 * 86400000),
      unlockVetUserId: vet.id,
      unlockReason:
        'Đã hoàn toàn bình phục sau 2 tuần chườm lạnh và vật lý trị liệu, kết quả siêu âm bình thường',
    },
  });

  // ----------------------------------------------------------------
  // 7. Injury Logs (Covering InjuryStatus: ACTIVE, HEALING, RESOLVED)
  // ----------------------------------------------------------------
  await prisma.injuryLog.upsert({
    where: { id: `inj-${horse2.id}-active` },
    update: {},
    create: {
      id: `inj-${horse2.id}-active`,
      horseId: horse2.id,
      coordinateX: 0.46,
      coordinateY: 0.62,
      viewSide: 'LEFT',
      layer: 'MUSCLE',
      anatomicalZone: 'Superficial Digital Flexor Tendon (SDFT)',
      bodySide: BodySide.LEFT,
      injuryType: 'Căng gân gấp ngón nông & tràn dịch bao hoạt dịch nhẹ',
      severity: SeverityLevel.MODERATE,
      stage: 'ACUTE',
      status: InjuryStatus.ACTIVE,
      description: 'Căng gân gấp ngón nông quan sát thấy sau buổi tập trên đường cát.',
      discoveryDate: new Date(Date.now() - 10 * 86400000),
      recoveryHistory: [
        {
          id: 'rec-01',
          stage: 'ACUTE',
          evaluationDate: new Date(Date.now() - 10 * 86400000).toISOString(),
          severity: 'MODERATE',
          notes: 'Nóng cục bộ và nhạy cảm đau dọc vùng bàn chân giữa.',
          updatedByName: vet.fullName,
        },
      ],
    },
  });

  await prisma.injuryLog.upsert({
    where: { id: `inj-${horse3.id}-healing` },
    update: {},
    create: {
      id: `inj-${horse3.id}-healing`,
      horseId: horse3.id,
      coordinateX: 0.35,
      coordinateY: 0.55,
      viewSide: 'RIGHT',
      layer: 'MUSCLE',
      anatomicalZone: 'Right Hind Biceps Femoris',
      bodySide: BodySide.RIGHT,
      injuryType: 'Căng cơ đùi sau',
      severity: SeverityLevel.MILD,
      stage: 'RECOVERING',
      status: InjuryStatus.HEALING,
      description: 'Căng cơ đùi sau chân phải trong bài tập bứt tốc, đang phục hồi tốt.',
      discoveryDate: new Date(Date.now() - 15 * 86400000),
      recoveryHistory: [
        {
          id: 'rec-h2',
          stage: 'RECOVERING',
          evaluationDate: new Date(Date.now() - 3 * 86400000).toISOString(),
          severity: 'MILD',
          notes: 'Đã giảm sưng 80%, cho phép tập đi bộ nhẹ và ngâm chân đá.',
          updatedByName: vet.fullName,
        },
      ],
    },
  });

  await prisma.injuryLog.upsert({
    where: { id: `inj-${horse1.id}-healed` },
    update: {},
    create: {
      id: `inj-${horse1.id}-healed`,
      horseId: horse1.id,
      coordinateX: 0.68,
      coordinateY: 0.72,
      viewSide: 'RIGHT',
      layer: 'BONE',
      anatomicalZone: 'Right Fetlock Joint Abrasion',
      bodySide: BodySide.RIGHT,
      injuryType: 'Trầy xước da khớp bàn ngón chân sau',
      severity: SeverityLevel.MILD,
      stage: 'HEALED',
      status: InjuryStatus.RESOLVED,
      description: 'Vết trầy nhẹ do quẹt vào rào chắn thi đấu, đã lành sẹo hoàn toàn.',
      discoveryDate: new Date(Date.now() - 40 * 86400000),
      recoveryHistory: [
        {
          id: 'rec-h1',
          stage: 'HEALED',
          evaluationDate: new Date(Date.now() - 30 * 86400000).toISOString(),
          severity: 'MILD',
          notes: 'Vết thương biểu mô hóa hoàn toàn, không để lại di chứng.',
          updatedByName: vet.fullName,
        },
      ],
    },
  });

  // ----------------------------------------------------------------
  // 8. Hồ Sơ Bệnh Án bao quát đầy đủ trạng thái: OPEN, CLOSED, DRAFT
  // ----------------------------------------------------------------
  await prisma.medicalRecord.upsert({
    where: { id: `med-${horse1.id}-1` },
    update: {},
    create: {
      id: `med-${horse1.id}-1`,
      recordNumber: 'BA-2610-001',
      horseId: horse1.id,
      veterinarianUserId: vet.id,
      status: MedicalRecordStatus.OPEN,
      examinationType: 'Khám thể lực tiền thi đấu',
      severity: SeverityLevel.MILD,
      temperature: 37.8,
      restingHeartRate: 36,
      respiratoryRate: 14,
      weightKg: 495.0,
      clinicalExamination: 'Màng niêm mạc hồng hào, phản xạ âm tim đều, nhịp thở êm.',
      symptoms: 'Không có triệu chứng bất thường, thể trạng sung sức.',
      clinicalDiagnosis: 'Thể lực hoàn hảo, sẵn sàng cho bài tập tốc độ cao.',
      treatmentProtocol: 'Duy trì chế độ dinh dưỡng giàu năng lượng và bổ sung điện giải sau tập.',
      createdAt: new Date(Date.now() - 5 * 86400000),
    },
  });

  await prisma.medicalRecord.upsert({
    where: { id: `med-${horse2.id}-1` },
    update: {},
    create: {
      id: `med-${horse2.id}-1`,
      recordNumber: 'BA-2610-002',
      horseId: horse2.id,
      veterinarianUserId: vet.id,
      status: MedicalRecordStatus.OPEN,
      examinationType: 'Khám chấn thương cấp tính',
      severity: SeverityLevel.SEVERE,
      temperature: 38.3,
      restingHeartRate: 46,
      respiratoryRate: 18,
      weightKg: 510.0,
      clinicalExamination:
        'Sưng nóng rõ rệt vùng gân gót chân trước bên trái, phản xạ co giật đau cấp 3/5.',
      symptoms: 'Khập khiễng khi sải bước nhanh, né tránh chịu lực hoàn toàn chân trước trái.',
      clinicalDiagnosis: 'Viêm rách vi thể gân treo chi trước (Suspensory Ligament Desmitis).',
      treatmentProtocol:
        'Chườm lạnh hydrotherapy 3 lần/ngày, băng ép cố định, tiêm kháng viêm NSAID và đặt lệnh Khóa Y Tế.',
      requiresFollowUp: true,
      followUpDate: new Date(Date.now() + 11 * 86400000),
      createdAt: new Date(Date.now() - 3 * 86400000),
    },
  });

  await prisma.medicalRecord.upsert({
    where: { id: `med-${horse1.id}-closed` },
    update: {},
    create: {
      id: `med-${horse1.id}-closed`,
      recordNumber: 'BA-2609-001',
      horseId: horse1.id,
      veterinarianUserId: vet.id,
      status: MedicalRecordStatus.CLOSED,
      examinationType: 'Viêm phế quản nhẹ theo mùa',
      severity: SeverityLevel.MILD,
      temperature: 38.1,
      restingHeartRate: 40,
      respiratoryRate: 16,
      weightKg: 490.0,
      symptoms: 'Ho nhẹ vào sáng sớm khi xuất chuồng, có ít dịch mũi trong.',
      clinicalDiagnosis: 'Viêm đường hô hấp trên thể nhẹ (Equine Bronchitis).',
      treatmentProtocol: 'Xông khí dung tinh dầu khuynh diệp, uống kháng sinh amoxicillin 5 ngày.',
      conclusion: 'Ngựa đã hết ho hoàn toàn, phổi trong, thể lực hồi phục 100%.',
      treatmentResult: 'Khỏi bệnh hoàn toàn',
      closedAt: new Date(Date.now() - 25 * 86400000),
      createdAt: new Date(Date.now() - 35 * 86400000),
    },
  });

  await prisma.medicalRecord.upsert({
    where: { id: `med-${horse4.id}-draft` },
    update: {},
    create: {
      id: `med-${horse4.id}-draft`,
      recordNumber: 'BA-2610-DRAFT',
      horseId: horse4.id,
      veterinarianUserId: vet.id,
      status: MedicalRecordStatus.DRAFT,
      examinationType: 'Kiểm tra mắt định kỳ',
      symptoms: 'Chảy nước mắt nhẹ mắt trái.',
      clinicalDiagnosis: 'Nghi ngờ kích ứng cát bụi đường chạy.',
      treatmentProtocol: 'Nhỏ mắt dung dịch nước muối sinh lý 0.9%.',
      createdAt: new Date(),
    },
  });
  console.log(
    `[4/12] Seeded Medical Records (OPEN, CLOSED, DRAFT) & Injury Logs (ACTIVE, HEALING, RESOLVED)`,
  );

  // ----------------------------------------------------------------
  // 9. Kế Hoạch Dinh Dưỡng bao quát NutritionPlanStatus:
  // APPROVED, PENDING_APPROVAL, DRAFT, REJECTED, ARCHIVED
  // ----------------------------------------------------------------
  await prisma.nutritionPlan.upsert({
    where: { id: `np-${horse1.id}` },
    update: {},
    create: {
      id: `np-${horse1.id}`,
      planCode: 'DD-000001',
      horseId: horse1.id,
      status: NutritionPlanStatus.APPROVED,
      dailyFeedWeightKg: 12.5,
      targetWeightRatioPct: 2.5,
      horseWeightSnapshot: 495.0,
      hayFeedKg: 8.5,
      grainFeedKg: 4.0,
      specialInstructions: 'Bổ sung điện giải sau bài tập chạy nước rút và vitamin E chống oxy hóa.',
      createdById: trainer.id,
      approvedById: vet.id,
      approvedAt: new Date(Date.now() - 15 * 86400000),
      mealsJson: [
        { time: '06:00', type: 'Sáng', hayKg: 3.0, grainKg: 1.5, notes: 'Cỏ khô Timothy + Cám yến mạch' },
        { time: '12:00', type: 'Trưa', hayKg: 2.5, grainKg: 1.0, notes: 'Cỏ khô Alfalfa' },
        { time: '17:30', type: 'Chiều', hayKg: 3.0, grainKg: 1.5, notes: 'Hạt dinh dưỡng + Bột điện giải' },
      ],
    },
  });

  await prisma.nutritionPlan.upsert({
    where: { id: `np-${horse2.id}` },
    update: {},
    create: {
      id: `np-${horse2.id}`,
      planCode: 'DD-000002',
      horseId: horse2.id,
      status: NutritionPlanStatus.PENDING_APPROVAL,
      dailyFeedWeightKg: 9.0,
      targetWeightRatioPct: 1.8,
      horseWeightSnapshot: 510.0,
      hayFeedKg: 7.5,
      grainFeedKg: 1.5,
      specialInstructions:
        'Chế độ ăn giảm năng lượng trong thời gian nghỉ dưỡng điều trị gân, tăng chất xơ và glucosamine.',
      createdById: trainer.id,
      mealsJson: [
        { time: '06:30', type: 'Sáng', hayKg: 3.5, grainKg: 0.5, notes: 'Cỏ khô đồng cỏ tự nhiên' },
        { time: '17:00', type: 'Chiều', hayKg: 4.0, grainKg: 1.0, notes: 'Bổ sung khoáng phục hồi khớp' },
      ],
    },
  });

  await prisma.nutritionPlan.upsert({
    where: { id: `np-${horse3.id}` },
    update: {},
    create: {
      id: `np-${horse3.id}`,
      planCode: 'DD-000003',
      horseId: horse3.id,
      status: NutritionPlanStatus.DRAFT,
      dailyFeedWeightKg: 11.0,
      targetWeightRatioPct: 2.3,
      horseWeightSnapshot: 480.0,
      hayFeedKg: 7.5,
      grainFeedKg: 3.5,
      specialInstructions: 'Kế hoạch thử nghiệm tăng tỷ lệ chất béo thực vật để tối ưu sức bền.',
      createdById: trainer.id,
    },
  });

  await prisma.nutritionPlan.upsert({
    where: { id: `np-${horse4.id}` },
    update: {},
    create: {
      id: `np-${horse4.id}`,
      planCode: 'DD-000004',
      horseId: horse4.id,
      status: NutritionPlanStatus.REJECTED,
      dailyFeedWeightKg: 14.0,
      targetWeightRatioPct: 2.9,
      horseWeightSnapshot: 490.0,
      rejectionReason: 'Hàm lượng tinh bột quá cao, có nguy cơ gây viêm móng (Laminitis). Cần giảm cám hạt.',
      vetNotes: 'Đề nghị điều chỉnh lại lượng cám hạt xuống dưới 4kg/ngày.',
      createdById: trainer.id,
      approvedById: vet.id,
      approvedAt: new Date(Date.now() - 5 * 86400000),
    },
  });

  await prisma.nutritionPlan.upsert({
    where: { id: `np-${horse7.id}` },
    update: {},
    create: {
      id: `np-${horse7.id}`,
      planCode: 'DD-000000',
      horseId: horse7.id,
      status: NutritionPlanStatus.ARCHIVED,
      dailyFeedWeightKg: 8.0,
      targetWeightRatioPct: 1.6,
      horseWeightSnapshot: 505.0,
      specialInstructions: 'Chế độ ăn lưu trữ thời kỳ nghỉ hưu vinh danh.',
      createdById: trainer.id,
      approvedById: vet.id,
    },
  });
  console.log(`[5/12] Seeded Nutrition Plans covering all 5 NutritionPlanStatus values`);

  // ----------------------------------------------------------------
  // 10. Giáo án Huấn Luyện bao quát 100% PlanStatus:
  // ACTIVE, COMPLETED, DRAFT, CANCELLED
  // ----------------------------------------------------------------
  const plan1 = await prisma.trainingPlan.upsert({
    where: { id: `plan-${horse1.id}` },
    update: {},
    create: {
      id: `plan-${horse1.id}`,
      planCode: 'GA-000001',
      horseId: horse1.id,
      trainerUserId: trainer.id,
      phaseName: 'Huấn luyện tốc độ & Bứt phá Derby 2026',
      objective: 'Đạt đỉnh phong độ cự ly 2000m, tăng tốc 400m cuối.',
      targetSpeed: 58.0,
      targetDistance: 2000,
      trackSurface: TrackSurface.TURF,
      startDate: new Date(now.getTime() - 20 * 86400000),
      endDate: new Date(now.getTime() + 40 * 86400000),
      status: PlanStatus.ACTIVE,
      phases: [
        {
          id: 'ph-1',
          name: 'Tích lũy hiếu khí & Thể lực nền',
          type: 'BASE',
          startDate: clubDay(-20),
          endDate: clubDay(-6),
          sessionsPerWeek: 5,
          maxWeeklyDistance: 9000,
          surface: 'TURF',
          targetSpeedKmh: 38,
        },
        {
          id: 'ph-2',
          name: 'Nước rút tốc độ cao',
          type: 'SPEED',
          startDate: clubDay(-5),
          endDate: clubDay(20),
          sessionsPerWeek: 5,
          maxWeeklyDistance: 12000,
          surface: 'TURF',
          targetSpeedKmh: 58,
        },
      ],
    },
  });

  await prisma.trainingPlan.upsert({
    where: { id: `plan-${horse1.id}-completed` },
    update: {},
    create: {
      id: `plan-${horse1.id}-completed`,
      planCode: 'GA-000000',
      horseId: horse1.id,
      trainerUserId: trainer.id,
      phaseName: 'Giai đoạn xây dựng nền tảng mùa xuân 2026',
      objective: 'Hoàn thành khối lượng tích lũy 10,000m chạy bước vừa.',
      targetSpeed: 40.0,
      targetDistance: 1500,
      trackSurface: TrackSurface.DIRT,
      startDate: new Date(now.getTime() - 90 * 86400000),
      endDate: new Date(now.getTime() - 30 * 86400000),
      status: PlanStatus.COMPLETED,
    },
  });

  await prisma.trainingPlan.upsert({
    where: { id: `plan-${horse6.id}-draft` },
    update: { status: PlanStatus.DRAFT },
    create: {
      id: `plan-${horse6.id}-draft`,
      planCode: 'GA-000004',
      horseId: horse6.id,
      trainerUserId: trainer.id,
      phaseName: 'Kế hoạch huấn luyện thử nghiệm cự ly ngắn (Bản nháp)',
      objective: 'Đánh giá khả năng xuất phát cổng và thích ứng đường cỏ.',
      targetSpeed: 55.0,
      targetDistance: 1200,
      trackSurface: TrackSurface.TURF,
      startDate: new Date(now.getTime() + 5 * 86400000),
      endDate: new Date(now.getTime() + 45 * 86400000),
      status: PlanStatus.DRAFT,
    },
  });

  await prisma.trainingPlan.upsert({
    where: { id: `plan-${horse2.id}-cancelled` },
    update: {},
    create: {
      id: `plan-${horse2.id}-cancelled`,
      planCode: 'GA-000005',
      horseId: horse2.id,
      trainerUserId: trainer.id,
      phaseName: 'Giáo án huấn luyện hè đã hủy (Chuyển sang điều trị gân)',
      objective: 'Hủy bài chạy nước rút do phát hiện chấn thương dây chằng.',
      targetSpeed: 52.0,
      targetDistance: 1600,
      trackSurface: TrackSurface.TURF,
      startDate: new Date(now.getTime() - 10 * 86400000),
      endDate: new Date(now.getTime() + 20 * 86400000),
      status: PlanStatus.CANCELLED,
    },
  });

  // Active Plan for Horse 2 (Xích Thố) - Phục hồi nhẹ
  const plan2 = await prisma.trainingPlan.upsert({
    where: { id: `plan-${horse2.id}` },
    update: {},
    create: {
      id: `plan-${horse2.id}`,
      planCode: 'GA-000002',
      horseId: horse2.id,
      trainerUserId: trainer.id,
      phaseName: 'Phục hồi chức năng & Vận động nhẹ',
      objective: 'Chỉ cho phép bài tập đi bộ nhẹ không quá 800m.',
      targetSpeed: 20.0,
      targetDistance: 800,
      trackSurface: TrackSurface.TURF,
      startDate: new Date(now.getTime() - 5 * 86400000),
      endDate: new Date(now.getTime() + 25 * 86400000),
      status: PlanStatus.ACTIVE,
    },
  });

  // Active Plan for Horse 8 & 9 with 4 completed workouts to satisfy Flow 5 Tournament eligibility
  const planHorse8 = await prisma.trainingPlan.upsert({
    where: { id: `plan-${horse8.id}-active` },
    update: { status: PlanStatus.ACTIVE },
    create: {
      id: `plan-${horse8.id}-active`,
      planCode: 'GA-000008',
      horseId: horse8.id,
      trainerUserId: trainer.id,
      phaseName: 'Huấn luyện chuẩn bị thi đấu cự ly trung bình',
      objective: 'Đạt chuẩn thể lực và tốc độ giải đấu.',
      targetSpeed: 58.0,
      targetDistance: 1600,
      trackSurface: TrackSurface.TURF,
      startDate: new Date(now.getTime() - 25 * 86400000),
      endDate: new Date(now.getTime() + 35 * 86400000),
      status: PlanStatus.ACTIVE,
    },
  });

  for (let i = 1; i <= 4; i++) {
    const daysAgo = 22 - i * 4;
    await prisma.workoutSession.upsert({
      where: { id: `w${i}-${horse8.id}` },
      update: {
        status: WorkoutStatus.COMPLETED,
        scheduledDate: new Date(now.getTime() - daysAgo * 86400000),
      },
      create: {
        id: `w${i}-${horse8.id}`,
        trainingPlanId: planHorse8.id,
        horseId: horse8.id,
        assignedStaffUserId: groom1.id,
        scheduledDate: new Date(now.getTime() - daysAgo * 86400000),
        distanceMeters: 1400,
        actualTimeSeconds: 84 + i,
        heartRatePeak: 174,
        heartRateRecovery: 108,
        performanceScore: 8.7,
        status: WorkoutStatus.COMPLETED,
        workoutType: 'CANTER',
        intensity: 'MEDIUM',
        trackSurface: 'TURF',
        averageSpeedKmh: 59.2,
        topSpeedKmh: 63.8,
        trainerNotes: `Hoàn thành bài tập chuẩn bị thi đấu ${i}/4`,
      },
    });
  }

  // Workouts Covering All WorkoutStatus: COMPLETED, SCHEDULED, BLOCKED, MISSED, CANCELLED
  await prisma.workoutSession.upsert({
    where: { id: `w1-${horse1.id}` },
    update: {},
    create: {
      id: `w1-${horse1.id}`,
      phaseId: 'ph-1',
      trainingPlanId: plan1.id,
      horseId: horse1.id,
      assignedStaffUserId: groom1.id,
      scheduledDate: new Date(now.getTime() - 14 * 86400000),
      distanceMeters: 1200,
      actualTimeSeconds: 72.0,
      heartRatePeak: 175,
      heartRateRecovery: 108,
      performanceScore: 8.9,
      status: WorkoutStatus.COMPLETED,
      workoutType: 'CANTER',
      intensity: 'MEDIUM',
      trackSurface: 'TURF',
      averageSpeedKmh: 60.0,
      topSpeedKmh: 64.2,
      recoveryTimeMinutes: 4.5,
      staminaScore: 86,
      injuryRiskLevel: 'LOW',
      trainerNotes: 'Xuất phát cổng mượt mà, sải chân dài uy lực 200m cuối.',
    },
  });

  await prisma.workoutSession.upsert({
    where: { id: `w2-${horse1.id}` },
    update: {},
    create: {
      id: `w2-${horse1.id}`,
      phaseId: 'ph-1',
      trainingPlanId: plan1.id,
      horseId: horse1.id,
      assignedStaffUserId: groom1.id,
      scheduledDate: new Date(now.getTime() - 7 * 86400000),
      distanceMeters: 1600,
      actualTimeSeconds: 98.5,
      heartRatePeak: 182,
      heartRateRecovery: 114,
      performanceScore: 8.6,
      status: WorkoutStatus.COMPLETED,
      workoutType: 'TRIAL',
      intensity: 'HEAVY',
      trackSurface: 'DIRT',
      averageSpeedKmh: 58.5,
      topSpeedKmh: 63.8,
      recoveryTimeMinutes: 5.2,
      staminaScore: 88,
      injuryRiskLevel: 'LOW',
      trainerNotes: 'Sức bền tuyệt vời ở khúc cua đường cát.',
    },
  });

  await prisma.workoutSession.upsert({
    where: { id: `w3-${horse1.id}` },
    update: {},
    create: {
      id: `w3-${horse1.id}`,
      phaseId: 'ph-2',
      trainingPlanId: plan1.id,
      horseId: horse1.id,
      assignedStaffUserId: groom1.id,
      scheduledDate: new Date(now.getTime() + 2 * 86400000),
      distanceMeters: 1400,
      targetDurationSeconds: 84,
      status: WorkoutStatus.SCHEDULED,
      workoutType: 'CANTER',
      intensity: 'MEDIUM',
      trackSurface: 'TURF',
      trainerNotes: 'Duy trì nhịp thở ổn định và giảm tốc mượt mà.',
    },
  });

  await prisma.workoutSession.upsert({
    where: { id: `w-blocked-${horse2.id}` },
    update: {},
    create: {
      id: `w-blocked-${horse2.id}`,
      trainingPlanId: plan2.id,
      horseId: horse2.id,
      assignedStaffUserId: groom1.id,
      scheduledDate: new Date(now.getTime() + 1 * 86400000),
      distanceMeters: 1600,
      status: WorkoutStatus.BLOCKED,
      workoutType: 'TRIAL',
      intensity: 'HEAVY',
      trackSurface: 'TURF',
      trainerNotes: 'Bị chặn tự động bởi Khóa Y Tế LOCK-HR-000002-001 (RULE-MED-01)',
    },
  });

  await prisma.workoutSession.upsert({
    where: { id: `w-missed-${horse1.id}` },
    update: {},
    create: {
      id: `w-missed-${horse1.id}`,
      trainingPlanId: plan1.id,
      horseId: horse1.id,
      assignedStaffUserId: groom1.id,
      scheduledDate: new Date(now.getTime() - 1 * 86400000),
      distanceMeters: 1000,
      status: WorkoutStatus.MISSED,
      workoutType: 'TROT',
      intensity: 'LIGHT',
      trackSurface: 'TURF',
      trainerNotes: 'Bỏ lỡ do thời tiết mưa to ngập đường chạy.',
    },
  });

  await prisma.workoutSession.upsert({
    where: { id: `w-cancelled-${horse3.id}` },
    update: {},
    create: {
      id: `w-cancelled-${horse3.id}`,
      trainingPlanId: plan1.id,
      horseId: horse3.id,
      assignedStaffUserId: groom1.id,
      scheduledDate: new Date(now.getTime() - 2 * 86400000),
      distanceMeters: 1200,
      status: WorkoutStatus.CANCELLED,
      workoutType: 'CANTER',
      intensity: 'MEDIUM',
      trackSurface: 'TURF',
      trainerNotes: 'Hủy buổi tập do điều chỉnh lịch khám thú y đột xuất.',
    },
  });

  console.log(
    `[6/12] Seeded Training Plans (ACTIVE, COMPLETED, DRAFT, CANCELLED) & Workouts (COMPLETED, SCHEDULED, BLOCKED, MISSED, CANCELLED)`,
  );

  // ----------------------------------------------------------------
  // 11. Chăm Sóc Định Kỳ (Catalogs & Schedules: PENDING, COMPLETED, OVERDUE)
  // ----------------------------------------------------------------
  const catTetanus = await prisma.preventiveTypeCatalog.upsert({
    where: { code: 'VAC_TETANUS' },
    update: {},
    create: {
      code: 'VAC_TETANUS',
      name: 'Tiêm phòng uốn ván & cúm ngựa (Tetanus & Equine Influenza)',
      category: PreventiveType.VACCINATION,
      intervalDays: 180,
      advanceNoticeDays: 14,
      applyToNewHorses: true,
      description: 'Phòng ngừa uốn ván Clostridium tetani và virus cúm ngựa định kỳ 6 tháng.',
    },
  });

  const catDeworm = await prisma.preventiveTypeCatalog.upsert({
    where: { code: 'DEWORM_BROAD' },
    update: {},
    create: {
      code: 'DEWORM_BROAD',
      name: 'Tẩy giun định kỳ phổ rộng (Broad-spectrum Deworming)',
      category: PreventiveType.DEWORMING,
      intervalDays: 90,
      advanceNoticeDays: 7,
      applyToNewHorses: true,
      description: 'Sử dụng Ivermectin / Praziquantel luân phiên mỗi quý.',
    },
  });

  const catFarrier = await prisma.preventiveTypeCatalog.upsert({
    where: { code: 'FARRIER_TRIM' },
    update: {},
    create: {
      code: 'FARRIER_TRIM',
      name: 'Cắt gọt và đóng móng định kỳ (Farrier Hoof Care)',
      category: PreventiveType.FARRIER_HOOF_CARE,
      intervalDays: 45,
      advanceNoticeDays: 5,
      applyToNewHorses: true,
      description: 'Cắt tỉa móng, cân bằng góc chân và thay móng sắt thi đấu mỗi 6 tuần.',
    },
  });

  const catDental = await prisma.preventiveTypeCatalog.upsert({
    where: { code: 'DENTAL_FLOAT' },
    update: {},
    create: {
      code: 'DENTAL_FLOAT',
      name: 'Khám và mài răng định kỳ (Equine Dental Float)',
      category: PreventiveType.DENTAL,
      intervalDays: 365,
      advanceNoticeDays: 30,
      applyToNewHorses: true,
      description: 'Kiểm tra mài gờ răng nhọn hàm trên và hàm dưới hàng năm.',
    },
  });

  // PENDING
  await prisma.preventiveSchedule.upsert({
    where: { id: `prev-vac-${horse1.id}` },
    update: {},
    create: {
      id: `prev-vac-${horse1.id}`,
      horseId: horse1.id,
      typeCatalogId: catTetanus.id,
      veterinarianUserId: vet.id,
      scheduleType: PreventiveType.VACCINATION,
      dueDate: new Date(now.getTime() + 150 * 86400000),
      lastCompletedDate: new Date(now.getTime() - 30 * 86400000),
      productAdministered: 'Equi-Flu/Tetanus Duo 2ml',
      batchNumber: 'LOT-2026-TF09',
      performedByMode: 'SELF',
      performedByName: vet.fullName,
      status: PreventiveStatus.PENDING,
      notes: 'Đã tiêm phòng mũi định kỳ đầu mùa thi đấu, không phản ứng phụ.',
    },
  });

  // COMPLETED
  await prisma.preventiveSchedule.upsert({
    where: { id: `prev-deworm-${horse1.id}` },
    update: {},
    create: {
      id: `prev-deworm-${horse1.id}`,
      horseId: horse1.id,
      typeCatalogId: catDeworm.id,
      veterinarianUserId: vet.id,
      scheduleType: PreventiveType.DEWORMING,
      dueDate: new Date(now.getTime() - 10 * 86400000),
      completedDate: new Date(now.getTime() - 10 * 86400000),
      lastCompletedDate: new Date(now.getTime() - 10 * 86400000),
      productAdministered: 'Equimax Paste 14g',
      batchNumber: 'LOT-EQM-2026',
      performedByMode: 'SELF',
      performedByName: vet.fullName,
      status: PreventiveStatus.COMPLETED,
      notes: 'Tẩy giun định kỳ quý 3, thể trạng hấp thụ tốt.',
    },
  });

  // OVERDUE
  await prisma.preventiveSchedule.upsert({
    where: { id: `prev-dental-${horse2.id}` },
    update: {},
    create: {
      id: `prev-dental-${horse2.id}`,
      horseId: horse2.id,
      typeCatalogId: catDental.id,
      veterinarianUserId: vet.id,
      scheduleType: PreventiveType.DENTAL,
      dueDate: new Date(now.getTime() - 15 * 86400000),
      lastCompletedDate: new Date(now.getTime() - 380 * 86400000),
      performedByMode: 'EXTERNAL_SPECIALIST',
      performedByName: 'BS. Lê Minh Hoàng (Chuyên gia Nha khoa)',
      status: PreventiveStatus.OVERDUE,
      notes: 'Đã quá hạn khám nha khoa định kỳ, cần lên lịch mài răng sau khi hồi phục gân.',
    },
  });
  console.log(`[7/12] Seeded Preventive Care across all 4 Types and 3 Statuses (PENDING, COMPLETED, OVERDUE)`);

  // ----------------------------------------------------------------
  // 12. Báo Cáo Sự Cố Chuồng Trại (Incident Reports: REPORTED, UNDER_REVIEW, RESOLVED, DISMISSED)
  // ----------------------------------------------------------------
  await prisma.incidentReport.upsert({
    where: { id: `inc-${horse1.id}-001` },
    update: {},
    create: {
      id: `inc-${horse1.id}-001`,
      incidentNumber: 'INC-20261025-001',
      horseId: horse1.id,
      stallZoneId: zoneIds['ZONE-A'],
      reportedById: groom1.id,
      severity: SeverityLevel.MILD,
      status: IncidentStatus.REPORTED,
      symptomsJson: ['trầy xước nhẹ', 'va chạm rào'],
      description: 'Bạch Long Mã va quẹt nhẹ vào cánh cửa chuồng khi dắt ra bãi thả sáng nay.',
      vetNotes: 'Chưa có dấu hiệu sưng nóng, theo dõi tiếp.',
    },
  });

  await prisma.incidentReport.upsert({
    where: { id: `inc-${horse4.id}-002` },
    update: {},
    create: {
      id: `inc-${horse4.id}-002`,
      incidentNumber: 'INC-20261026-002',
      horseId: horse4.id,
      stallZoneId: zoneIds['ZONE-A'],
      reportedById: groom2.id,
      reviewedById: vet.id,
      reviewedAt: new Date(Date.now() - 1 * 86400000),
      severity: SeverityLevel.MODERATE,
      status: IncidentStatus.UNDER_REVIEW,
      symptomsJson: ['khập khiễng', 'ngại tiếp đất'],
      description: 'Thần Phong có biểu hiện hơi khựng lại khi tiếp đất chân trước ở cuối bài chạy.',
      vetNotes: 'Đang tiến hành chụp X-quang khớp bàn ngón để loại trừ nứt xương kín.',
    },
  });

  await prisma.incidentReport.upsert({
    where: { id: `inc-${horse2.id}-003` },
    update: {},
    create: {
      id: `inc-${horse2.id}-003`,
      incidentNumber: 'INC-20261020-003',
      horseId: horse2.id,
      stallZoneId: zoneIds['ZONE-B'],
      reportedById: groom1.id,
      reviewedById: manager.id,
      reviewedAt: new Date(Date.now() - 8 * 86400000),
      severity: SeverityLevel.MILD,
      status: IncidentStatus.RESOLVED,
      symptomsJson: ['vật cản nguy hiểm'],
      description: 'Phát hiện mảnh đinh rỉ rơi ở lối đi chuồng B, có thể gây nguy cơ đâm thủng móng.',
      vetNotes: 'Đã dọn dẹp sạch sẽ toàn bộ lối đi bằng xe hút nam châm từ tính.',
    },
  });

  await prisma.incidentReport.upsert({
    where: { id: `inc-${horse3.id}-004` },
    update: {},
    create: {
      id: `inc-${horse3.id}-004`,
      incidentNumber: 'INC-20261015-004',
      horseId: horse3.id,
      stallZoneId: zoneIds['ZONE-A'],
      reportedById: groom2.id,
      reviewedById: manager.id,
      reviewedAt: new Date(Date.now() - 12 * 86400000),
      severity: SeverityLevel.MILD,
      status: IncidentStatus.DISMISSED,
      symptomsJson: ['tiếng ồn bất thường'],
      description: 'Báo cáo tiếng động lạ ban đêm nghi có động vật hoang dã xâm nhập.',
      vetNotes: 'Kiểm tra camera an ninh không phát hiện bất thường, đóng hồ sơ.',
    },
  });
  console.log(`[8/12] Seeded Incident Reports covering all 4 IncidentStatus values`);

  // ----------------------------------------------------------------
  // 13. AI Insights (Covering InsightStatus & InsightType)
  // ----------------------------------------------------------------
  await prisma.aIInsight.upsert({
    where: { id: `insight-${horse1.id}-1` },
    update: {},
    create: {
      id: `insight-${horse1.id}-1`,
      horseId: horse1.id,
      insightType: InsightType.WORKOUT_RECOMMENDATION,
      trainingLoadIndex: 82.5,
      riskScore: 12.0,
      status: InsightStatus.GENERATED,
      recommendationsJson: JSON.stringify([
        'Tăng cự ly bài tập lên 2000m trong tuần tới do thể lực phục hồi cực nhanh.',
        'Duy trì bài tập nước rút vào sáng sớm khi thời tiết mát mẻ.',
      ]),
    },
  });

  await prisma.aIInsight.upsert({
    where: { id: `insight-${horse2.id}-2` },
    update: {},
    create: {
      id: `insight-${horse2.id}-2`,
      horseId: horse2.id,
      insightType: InsightType.INJURY_RISK_WARNING,
      trainingLoadIndex: 45.0,
      riskScore: 78.5,
      status: InsightStatus.ACKNOWLEDGED,
      recommendationsJson: JSON.stringify([
        'Cảnh báo tải trọng: Nguy cơ tái phát viêm gân nếu quay lại tập chạy trước 14 ngày.',
        'Đề xuất duy trì Khóa Y Tế và vật lý trị liệu chườm lạnh.',
      ]),
    },
  });

  await prisma.aIInsight.upsert({
    where: { id: `insight-${horse3.id}-3` },
    update: {},
    create: {
      id: `insight-${horse3.id}-3`,
      horseId: horse3.id,
      insightType: InsightType.RECOVERY_ADVICE,
      trainingLoadIndex: 68.0,
      riskScore: 28.0,
      status: InsightStatus.APPLIED,
      recommendationsJson: JSON.stringify([
        'Áp dụng liệu pháp ngâm chân đá 20 phút ngay sau buổi tập bứt tốc.',
        'Bổ sung điện giải và vitamin C trong khẩu phần ăn trưa.',
      ]),
    },
  });

  await prisma.aIInsight.upsert({
    where: { id: `insight-${horse4.id}-4` },
    update: {},
    create: {
      id: `insight-${horse4.id}-4`,
      horseId: horse4.id,
      insightType: InsightType.WORKOUT_RECOMMENDATION,
      trainingLoadIndex: 55.0,
      riskScore: 35.0,
      status: InsightStatus.DISMISSED,
      recommendationsJson: JSON.stringify([
        'Đề xuất chạy thử sân cát (đã bác bỏ vì ngựa chỉ phù hợp sân cỏ).',
      ]),
    },
  });
  console.log(`[9/12] Seeded AI Insights covering all InsightType and InsightStatus values`);

  // ----------------------------------------------------------------
  // 14. Flow 5: Tournaments, Registrations, Results & Financial Invoices
  // ----------------------------------------------------------------
  const t1 = await prisma.tournament.upsert({
    where: { id: 'seed-tourn-1' },
    update: { name: 'Grand Autumn Cup 2026 (Cúp Mùa Thu)' },
    create: {
      id: 'seed-tourn-1',
      name: 'Grand Autumn Cup 2026 (Cúp Mùa Thu)',
      raceDate: new Date('2026-10-10'),
      location: 'Saigon Racecourse - Track A',
      distanceMeters: 2400,
      trackType: TrackSurface.TURF,
      prizePool: 500000000,
      registrationDeadline: new Date('2026-10-01'),
      status: TournamentStatus.COMPLETED,
    },
  });

  await prisma.tournament.upsert({
    where: { id: 'seed-tourn-2' },
    update: {
      name: 'Saigon Spring Sprint 2026 (Giải Tốc Độ Mùa Xuân)',
      status: TournamentStatus.OPEN_REGISTRATION,
      registrationDeadline: new Date(now.getTime() + 15 * 86400000),
      raceDate: new Date(now.getTime() + 25 * 86400000),
    },
    create: {
      id: 'seed-tourn-2',
      name: 'Saigon Spring Sprint 2026 (Giải Tốc Độ Mùa Xuân)',
      raceDate: new Date(now.getTime() + 25 * 86400000),
      location: 'Saigon Racecourse - Sprint Track',
      distanceMeters: 1200,
      trackType: TrackSurface.SYNTHETIC,
      prizePool: 200000000,
      registrationDeadline: new Date(now.getTime() + 15 * 86400000),
      status: TournamentStatus.OPEN_REGISTRATION,
    },
  });

  await prisma.tournament.upsert({
    where: { id: 'seed-tourn-3' },
    update: { name: 'National Endurance Derby 2026 (Đại Hội Thể Lực Quốc Gia)' },
    create: {
      id: 'seed-tourn-3',
      name: 'National Endurance Derby 2026 (Đại Hội Thể Lực Quốc Gia)',
      raceDate: new Date('2026-12-20'),
      location: 'Da Lat Highland Turf Club',
      distanceMeters: 3200,
      trackType: TrackSurface.DIRT,
      prizePool: 750000000,
      registrationDeadline: new Date('2026-12-05'),
      status: TournamentStatus.UPCOMING,
    },
  });

  await prisma.tournament.upsert({
    where: { id: 'seed-tourn-cancelled' },
    update: { name: 'Phu Tho Summer Classic 2026 (Giải Hè Phú Thọ)' },
    create: {
      id: 'seed-tourn-cancelled',
      name: 'Phu Tho Summer Classic 2026 (Giải Hè Phú Thọ)',
      raceDate: new Date('2026-08-15'),
      location: 'Phu Tho Racecourse - Track B',
      distanceMeters: 1600,
      trackType: TrackSurface.TURF,
      prizePool: 150000000,
      registrationDeadline: new Date('2026-08-01'),
      status: TournamentStatus.CANCELLED,
    },
  });

  await prisma.tournament.upsert({
    where: { id: 'seed-tourn-closed-1' },
    update: {
      name: 'Central Highlands Gold Cup 2026 (Cúp Vàng Cao Nguyên)',
      status: TournamentStatus.CLOSED_REGISTRATION,
      registrationDeadline: new Date(now.getTime() - 2 * 86400000),
      raceDate: new Date(now.getTime() + 10 * 86400000),
    },
    create: {
      id: 'seed-tourn-closed-1',
      name: 'Central Highlands Gold Cup 2026 (Cúp Vàng Cao Nguyên)',
      raceDate: new Date(now.getTime() + 10 * 86400000),
      location: 'Pleiku Racecourse - Plateau Turf',
      distanceMeters: 2000,
      trackType: TrackSurface.TURF,
      prizePool: 400000000,
      registrationDeadline: new Date(now.getTime() - 2 * 86400000),
      status: TournamentStatus.CLOSED_REGISTRATION,
    },
  });

  await prisma.tournament.upsert({
    where: { id: 'seed-tourn-comp-2' },
    update: { name: 'Da Nang Grand Sprint 2026 (Giải Đà Nẵng)' },
    create: {
      id: 'seed-tourn-comp-2',
      name: 'Da Nang Grand Sprint 2026 (Giải Đà Nẵng)',
      raceDate: new Date(now.getTime() - 15 * 86400000),
      location: 'Da Nang Coastal Track - Synthetic',
      distanceMeters: 1200,
      trackType: TrackSurface.SYNTHETIC,
      prizePool: 180000000,
      registrationDeadline: new Date(now.getTime() - 25 * 86400000),
      status: TournamentStatus.COMPLETED,
    },
  });

  // Registrations & Results for t1
  const reg1 = await prisma.tournamentRegistration.upsert({
    where: { tournamentId_horseId: { tournamentId: t1.id, horseId: horse1.id } },
    update: {},
    create: {
      id: 'seed-reg-1',
      tournamentId: t1.id,
      horseId: horse1.id,
      registeredByTrainerId: trainer.id,
      status: RegistrationStatus.CONFIRMED,
      registrationDate: new Date('2026-09-28'),
      notes: 'Bạch Long Mã đạt phong độ đỉnh cao cho cúp mùa thu',
    },
  });

  await prisma.tournamentResult.upsert({
    where: { registrationId: reg1.id },
    update: {},
    create: {
      id: 'seed-res-1',
      registrationId: reg1.id,
      finalRank: 1,
      finishTimeSeconds: 142.5,
      avgSpeedKmh: 60.63,
      prizeMoneyWon: 250000000,
      officialNotes: 'Vô địch Grand Autumn Cup 2026 - Bứt phá xuất sắc 400m cuối',
    },
  });

  const reg2 = await prisma.tournamentRegistration.upsert({
    where: { tournamentId_horseId: { tournamentId: t1.id, horseId: horse2.id } },
    update: {},
    create: {
      id: 'seed-reg-2',
      tournamentId: t1.id,
      horseId: horse2.id,
      registeredByTrainerId: trainer.id,
      status: RegistrationStatus.CONFIRMED,
      registrationDate: new Date('2026-09-29'),
      notes: 'Tốc độ bám đuổi tốt ở giữa chặng',
    },
  });

  await prisma.tournamentResult.upsert({
    where: { registrationId: reg2.id },
    update: {},
    create: {
      id: 'seed-res-2',
      registrationId: reg2.id,
      finalRank: 2,
      finishTimeSeconds: 143.8,
      avgSpeedKmh: 60.08,
      prizeMoneyWon: 150000000,
      officialNotes: 'Á quân Grand Autumn Cup 2026',
    },
  });

  const reg3 = await prisma.tournamentRegistration.upsert({
    where: { tournamentId_horseId: { tournamentId: t1.id, horseId: horse3.id } },
    update: {},
    create: {
      id: 'seed-reg-3',
      tournamentId: t1.id,
      horseId: horse3.id,
      registeredByTrainerId: trainer.id,
      status: RegistrationStatus.CONFIRMED,
      registrationDate: new Date('2026-09-30'),
      notes: 'Cán đích ổn định',
    },
  });

  await prisma.tournamentResult.upsert({
    where: { registrationId: reg3.id },
    update: {},
    create: {
      id: 'seed-res-3',
      registrationId: reg3.id,
      finalRank: 3,
      finishTimeSeconds: 145.2,
      avgSpeedKmh: 59.5,
      prizeMoneyWon: 100000000,
      officialNotes: 'Hạng ba - Huy chương Đồng',
    },
  });

  // Additional registrations covering SCRATCHED_MEDICAL & DISQUALIFIED
  const tClosed = await prisma.tournament.findUnique({ where: { id: 'seed-tourn-closed-1' } });
  if (tClosed) {
    await prisma.tournamentRegistration.upsert({
      where: { tournamentId_horseId: { tournamentId: tClosed.id, horseId: horse2.id } },
      update: {},
      create: {
        id: 'seed-reg-scratched',
        tournamentId: tClosed.id,
        horseId: horse2.id,
        registeredByTrainerId: trainer.id,
        status: RegistrationStatus.SCRATCHED_MEDICAL,
        registrationDate: new Date(now.getTime() - 4 * 86400000),
        notes: 'Rút lui khỏi giải do lệnh Khóa Y Tế phát hiện viêm gân chi trước',
      },
    });

    await prisma.tournamentRegistration.upsert({
      where: { tournamentId_horseId: { tournamentId: tClosed.id, horseId: horse8.id } },
      update: {},
      create: {
        id: 'seed-reg-dq',
        tournamentId: tClosed.id,
        horseId: horse8.id,
        registeredByTrainerId: trainer.id,
        status: RegistrationStatus.DISQUALIFIED,
        registrationDate: new Date(now.getTime() - 3 * 86400000),
        notes: 'Phạm quy xuất phát trước hiệu lệnh cổng (False Start)',
      },
    });
  }

  // Financial Invoices covering all 5 InvoiceStatus values:
  // PAID, SENT, DRAFT, OVERDUE, CANCELLED
  await prisma.financialInvoice.upsert({
    where: { id: 'seed-inv-1' },
    update: {},
    create: {
      id: 'seed-inv-1',
      horseId: horse1.id,
      ownerId: owner1.id,
      billingPeriod: '2026-10',
      boardingFee: 15000000,
      medicalFee: 8500000,
      trainingFee: 12000000,
      prizeCredit: 50000000, // 70% of prize money
      netAmount: -14500000, // Negative means Club Payout to Owner!
      status: InvoiceStatus.PAID,
      invoiceUrl: '/invoices/INV-2026-10-HR-000001.pdf',
    },
  });

  await prisma.financialInvoice.upsert({
    where: { id: 'seed-inv-2' },
    update: { status: InvoiceStatus.SENT },
    create: {
      id: 'seed-inv-2',
      horseId: horse1.id,
      ownerId: owner1.id,
      billingPeriod: '2026-09',
      boardingFee: 15000000,
      medicalFee: 3200000,
      trainingFee: 12000000,
      prizeCredit: 0,
      netAmount: 30200000,
      status: InvoiceStatus.SENT,
      invoiceUrl: '/invoices/INV-2026-09-HR-000001.pdf',
    },
  });

  await prisma.financialInvoice.upsert({
    where: { id: 'seed-inv-3' },
    update: {},
    create: {
      id: 'seed-inv-3',
      horseId: horse1.id,
      ownerId: owner1.id,
      billingPeriod: '2026-11',
      boardingFee: 15000000,
      medicalFee: 1500000,
      trainingFee: 12000000,
      prizeCredit: 0,
      netAmount: 28500000,
      status: InvoiceStatus.DRAFT,
      invoiceUrl: null,
    },
  });

  await prisma.financialInvoice.upsert({
    where: { id: 'seed-inv-overdue' },
    update: {},
    create: {
      id: 'seed-inv-overdue',
      horseId: horse4.id,
      ownerId: owner2.id,
      billingPeriod: '2026-08',
      boardingFee: 15000000,
      medicalFee: 5000000,
      trainingFee: 10000000,
      prizeCredit: 0,
      netAmount: 30000000,
      status: InvoiceStatus.OVERDUE,
      invoiceUrl: '/invoices/INV-2026-08-HR-000004.pdf',
    },
  });

  await prisma.financialInvoice.upsert({
    where: { id: 'seed-inv-cancelled' },
    update: {},
    create: {
      id: 'seed-inv-cancelled',
      horseId: horse5.id,
      ownerId: owner2.id,
      billingPeriod: '2026-07',
      boardingFee: 15000000,
      medicalFee: 0,
      trainingFee: 8000000,
      prizeCredit: 0,
      netAmount: 23000000,
      status: InvoiceStatus.CANCELLED,
      invoiceUrl: null,
    },
  });

  console.log(
    `[10/12] Seeded Tournaments (5 statuses), Registrations (4 statuses) & Financial Invoices (5 statuses)`,
  );

  // ----------------------------------------------------------------
  // 15. Flow 4 Phase 1: Danh mục Ca trực (ShiftCatalog)
  // ----------------------------------------------------------------
  const shiftDefs = [
    {
      code: 'SHIFT_MORNING',
      name: 'Ca Sáng (05:00 - 13:00)',
      startTime: '05:00',
      endTime: '13:00',
      isOvernight: false,
      sortOrder: 1,
      description: 'Ca sáng: Cho ăn bữa 1, dọn chuồng, chuẩn bị ngựa tập buổi sáng',
    },
    {
      code: 'SHIFT_AFTERNOON',
      name: 'Ca Chiều (13:00 - 21:00)',
      startTime: '13:00',
      endTime: '21:00',
      isOvernight: false,
      sortOrder: 2,
      description: 'Ca chiều: Tắm rửa, chải lông, ngâm chân đá, cho ăn bữa chiều',
    },
    {
      code: 'SHIFT_NIGHT',
      name: 'Ca Đêm (21:00 - 05:00)',
      startTime: '21:00',
      endTime: '05:00',
      isOvernight: true,
      sortOrder: 3,
      description: 'Ca đêm: Trực tuần tra an ninh chuồng trại, kiểm tra sức khỏe đột xuất',
    },
  ];

  const shiftIds: Record<string, string> = {};
  for (const s of shiftDefs) {
    const shift = await prisma.shiftCatalog.upsert({
      where: { code: s.code },
      update: {
        name: s.name,
        startTime: s.startTime,
        endTime: s.endTime,
        isOvernight: s.isOvernight,
        description: s.description,
      },
      create: s,
    });
    shiftIds[s.code] = shift.id;
  }

  // ----------------------------------------------------------------
  // 16. Flow 4 Phase 1: Danh mục Vật tư & Y tế (SupplyCatalog) & RestockRequests (5 statuses)
  // ----------------------------------------------------------------
  const supplyDefs = [
    {
      code: 'SUP-HAY-TIMOTHY',
      name: 'Cỏ khô Timothy nhập khẩu (Bao 25kg)',
      category: SupplyCategory.FEED_HAY,
      unit: SupplyUnit.KG,
      unitPrice: 35000,
      description: 'Cỏ khô giàu chất xơ cho ngựa đua tiêu chuẩn',
    },
    {
      code: 'SUP-HAY-ALFALFA',
      name: 'Cỏ Alfalfa đạm cao (Bao 20kg)',
      category: SupplyCategory.FEED_HAY,
      unit: SupplyUnit.KG,
      unitPrice: 48000,
      description: 'Cỏ đạm cao bổ sung cho ngựa trong giai đoạn tập nặng',
    },
    {
      code: 'SUP-GRAIN-OATS',
      name: 'Yến mạch nguyên cám (Bao 40kg)',
      category: SupplyCategory.FEED_GRAIN,
      unit: SupplyUnit.KG,
      unitPrice: 28000,
      description: 'Nguồn năng lượng chính cho ngựa chuẩn bị xuất trận',
    },
    {
      code: 'SUP-DISINFECT-SPRAY',
      name: 'Dung dịch sát trùng chuồng trại Virkon S (Can 5L)',
      category: SupplyCategory.CLEANING_SUPPLY,
      unit: SupplyUnit.BOTTLE,
      unitPrice: 650000,
      description: 'Khử trùng diệt khuẩn bề mặt ô chuồng và lối đi',
    },
    {
      code: 'SUP-VITA-MULTI',
      name: 'Vitamin tổng hợp EquiVita (Hộp 100 gói)',
      category: SupplyCategory.SUPPLEMENT_VITAMIN,
      unit: SupplyUnit.PACKET,
      unitPrice: 18000,
      description: 'Vi khoáng tăng cường miễn dịch và độ bóng mượt lông',
    },
  ];

  const createdSupplies: Record<string, any> = {};
  for (const sup of supplyDefs) {
    const item = await prisma.supplyCatalog.upsert({
      where: { code: sup.code },
      update: {
        name: sup.name,
        category: sup.category,
        unit: sup.unit,
        unitPrice: sup.unitPrice,
        description: sup.description,
      },
      create: sup,
    });
    createdSupplies[sup.code] = item;
  }

  // RestockRequests covering all 5 RestockStatus values:
  // PENDING, APPROVED, DELIVERING, DELIVERED, REJECTED
  const haySupply = createdSupplies['SUP-HAY-TIMOTHY'];
  const spraySupply = createdSupplies['SUP-DISINFECT-SPRAY'];
  const vitaSupply = createdSupplies['SUP-VITA-MULTI'];
  const oatSupply = createdSupplies['SUP-GRAIN-OATS'];
  const zoneAId = zoneIds['ZONE-A'];

  await prisma.restockRequest.upsert({
    where: { id: 'req-restock-pending' },
    update: {},
    create: {
      id: 'req-restock-pending',
      requestNumber: 'REQ-20261028-001',
      zoneId: zoneAId,
      supplyId: haySupply.id,
      requestedQuantity: 30.0,
      status: RestockStatus.PENDING,
      urgencyReason: 'Dự phòng nhu cầu tăng cường khẩu phần cho đợt tập huấn mới',
      requestedById: groom1.id,
    },
  });

  await prisma.restockRequest.upsert({
    where: { id: 'req-restock-approved' },
    update: {},
    create: {
      id: 'req-restock-approved',
      requestNumber: 'REQ-20261027-002',
      zoneId: zoneAId,
      supplyId: spraySupply.id,
      requestedQuantity: 15.0,
      approvedQuantity: 15.0,
      status: RestockStatus.APPROVED,
      requestedById: groom1.id,
      reviewedById: manager.id,
      reviewedAt: new Date(Date.now() - 1 * 86400000),
    },
  });

  await prisma.restockRequest.upsert({
    where: { id: 'req-restock-delivering' },
    update: {},
    create: {
      id: 'req-restock-delivering',
      requestNumber: 'REQ-20261026-003',
      zoneId: zoneAId,
      supplyId: vitaSupply.id,
      requestedQuantity: 10.0,
      approvedQuantity: 10.0,
      status: RestockStatus.DELIVERING,
      requestedById: groom2.id,
      reviewedById: manager.id,
      reviewedAt: new Date(Date.now() - 2 * 86400000),
    },
  });

  await prisma.restockRequest.upsert({
    where: { id: 'req-restock-delivered' },
    update: {},
    create: {
      id: 'req-restock-delivered',
      requestNumber: 'REQ-20261025-004',
      zoneId: zoneAId,
      supplyId: oatSupply.id,
      requestedQuantity: 20.0,
      approvedQuantity: 20.0,
      status: RestockStatus.DELIVERED,
      requestedById: groom1.id,
      reviewedById: manager.id,
      reviewedAt: new Date(Date.now() - 3 * 86400000),
      deliveredById: manager.id,
      deliveredAt: new Date(Date.now() - 1 * 86400000),
    },
  });

  await prisma.restockRequest.upsert({
    where: { id: 'req-restock-rejected' },
    update: {},
    create: {
      id: 'req-restock-rejected',
      requestNumber: 'REQ-20261024-005',
      zoneId: zoneAId,
      supplyId: haySupply.id,
      requestedQuantity: 100.0,
      status: RestockStatus.REJECTED,
      urgencyReason: 'Đề xuất nhập trữ số lượng lớn ngoài kế hoạch',
      rejectionReason: 'Vượt quá hạn mức ngân sách tháng 10 và kho bãi chưa đủ chỗ chứa',
      requestedById: groom2.id,
      reviewedById: manager.id,
      reviewedAt: new Date(Date.now() - 4 * 86400000),
    },
  });

  // ----------------------------------------------------------------
  // 17. Daily Care Tasks (Covering DailyTaskType: FEEDING, CLEANING, GROOMING, ICE_BOOT_REST, WALKING)
  // ----------------------------------------------------------------
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  const stallA1 = await prisma.stall.findUnique({ where: { code: 'STALL-A01' } });
  const stallA2 = await prisma.stall.findUnique({ where: { code: 'STALL-A02' } });

  await prisma.dailyCareTask.upsert({
    where: {
      date_horseId_taskType_mealType_scheduledTime: {
        date: todayDate,
        horseId: horse1.id,
        taskType: DailyTaskType.FEEDING,
        mealType: 'MORNING',
        scheduledTime: '06:00',
      },
    },
    update: {},
    create: {
      taskCode: 'TASK-20261030-001',
      date: todayDate,
      horseId: horse1.id,
      stallZoneId: zoneAId,
      stallId: stallA1?.id,
      taskType: DailyTaskType.FEEDING,
      title: 'Cho ăn sáng: Cỏ khô Timothy + Cám yến mạch',
      mealType: 'MORNING',
      scheduledTime: '06:00',
      isCompleted: true,
      completedAt: new Date(),
      completedById: groom1.id,
      assignedGroomUserId: groom1.id,
    },
  });

  await prisma.dailyCareTask.upsert({
    where: {
      date_horseId_taskType_mealType_scheduledTime: {
        date: todayDate,
        horseId: horse1.id,
        taskType: DailyTaskType.CLEANING,
        mealType: 'MORNING',
        scheduledTime: '07:30',
      },
    },
    update: {},
    create: {
      taskCode: 'TASK-20261030-002',
      date: todayDate,
      horseId: horse1.id,
      stallZoneId: zoneAId,
      stallId: stallA1?.id,
      taskType: DailyTaskType.CLEANING,
      title: 'Dọn vệ sinh chuồng A01 & thay đệm lót rơm mới',
      mealType: 'MORNING',
      scheduledTime: '07:30',
      isCompleted: true,
      completedAt: new Date(),
      completedById: groom1.id,
      assignedGroomUserId: groom1.id,
    },
  });

  await prisma.dailyCareTask.upsert({
    where: {
      date_horseId_taskType_mealType_scheduledTime: {
        date: todayDate,
        horseId: horse2.id,
        taskType: DailyTaskType.ICE_BOOT_REST,
        mealType: 'NOON',
        scheduledTime: '11:00',
      },
    },
    update: {},
    create: {
      taskCode: 'TASK-20261030-003',
      date: todayDate,
      horseId: horse2.id,
      stallZoneId: zoneAId,
      stallId: stallA2?.id,
      taskType: DailyTaskType.ICE_BOOT_REST,
      title: 'Chườm đá lạnh phục hồi gân chân (Hydrotherapy Ice Boot)',
      mealType: 'NOON',
      scheduledTime: '11:00',
      isCompleted: true,
      completedAt: new Date(),
      completedById: groom1.id,
      assignedGroomUserId: groom1.id,
      isMedicalLocked: true,
      medicalLockNotes: 'Thực hiện theo chỉ định phác đồ điều trị của BS. Trí',
    },
  });

  await prisma.dailyCareTask.upsert({
    where: {
      date_horseId_taskType_mealType_scheduledTime: {
        date: todayDate,
        horseId: horse1.id,
        taskType: DailyTaskType.GROOMING,
        mealType: 'AFTERNOON',
        scheduledTime: '15:30',
      },
    },
    update: {},
    create: {
      taskCode: 'TASK-20261030-004',
      date: todayDate,
      horseId: horse1.id,
      stallZoneId: zoneAId,
      stallId: stallA1?.id,
      taskType: DailyTaskType.GROOMING,
      title: 'Chải lông và massage cơ bắp chiều',
      mealType: 'AFTERNOON',
      scheduledTime: '15:30',
      isCompleted: false,
      assignedGroomUserId: groom1.id,
    },
  });

  await prisma.dailyCareTask.upsert({
    where: {
      date_horseId_taskType_mealType_scheduledTime: {
        date: todayDate,
        horseId: horse2.id,
        taskType: DailyTaskType.WALKING,
        mealType: 'AFTERNOON',
        scheduledTime: '16:30',
      },
    },
    update: {},
    create: {
      taskCode: 'TASK-20261030-005',
      date: todayDate,
      horseId: horse2.id,
      stallZoneId: zoneAId,
      stallId: stallA2?.id,
      taskType: DailyTaskType.WALKING,
      title: 'Dắt đi dạo nhẹ nhàng 15 phút quanh sân chuồng',
      mealType: 'AFTERNOON',
      scheduledTime: '16:30',
      isCompleted: false,
      assignedGroomUserId: groom1.id,
    },
  });

  console.log(
    `[11/12] Seeded Supplies, Restock Requests (5 statuses) & Daily Care Tasks (completed + pending)`,
  );

  // ----------------------------------------------------------------
  // 18. Thông Báo & Nhật Ký Hệ Thống (Notifications & Audit Logs)
  // ----------------------------------------------------------------
  await prisma.notification.deleteMany({
    where: { userId: { in: [manager.id, trainer.id, vet.id, groom1.id, owner1.id] } },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: manager.id,
        type: 'SYSTEM_ALERT',
        category: NotificationCategory.SYSTEM,
        title: 'Báo cáo vận hành hàng tuần',
        message: 'Hệ thống đã tự động sao lưu dữ liệu và kiểm tra toàn vẹn an toàn.',
        senderName: 'Hệ thống Quản trị',
        readAt: null,
      },
      {
        userId: trainer.id,
        type: 'WORKOUT_COMPLETED',
        category: NotificationCategory.TRAINING,
        title: 'Hoàn thành bài tập xuất sắc',
        message: 'Bạch Long Mã đã hoàn thành bài tập chạy 1200m với điểm số 8.9.',
        senderName: trainer.fullName,
        readAt: null,
      },
      {
        userId: vet.id,
        type: 'TRAINING_LOCK_PLACED',
        category: NotificationCategory.LOCK,
        title: 'Lệnh Khóa Y Tế đang có hiệu lực',
        message: 'Xích Thố (HR-000002) đang trong thời gian nghỉ dưỡng điều trị viêm gân chi trước.',
        senderName: vet.fullName,
        readAt: null,
      },
      {
        userId: groom1.id,
        type: 'STALL_ASSIGNED',
        category: NotificationCategory.HORSE,
        title: 'Phân công chăm sóc chính',
        message: 'Bạn đã được phân công chăm sóc chính cho Bạch Long Mã tại ô chuồng STALL-A01.',
        senderName: manager.fullName,
        readAt: new Date(Date.now() - 2 * 86400000),
      },
      {
        userId: owner1.id,
        type: 'PREVENTIVE_COMPLETED',
        category: NotificationCategory.MEDICAL,
        title: 'Cập nhật tình trạng sức khỏe',
        message: 'Bạch Long Mã đã hoàn thành mũi tiêm phòng định kỳ uốn ván & cúm ngựa.',
        senderName: vet.fullName,
        readAt: new Date(Date.now() - 1 * 86400000),
      },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      {
        userId: manager.id,
        action: 'USER_REGISTER',
        entityName: 'User',
        entityId: pendingUser.id,
        newValuesJson: JSON.stringify({ email: pendingUser.email, role: pendingUser.role, status: 'PENDING_APPROVAL' }),
      },
      {
        userId: vet.id,
        action: 'LOCK_APPLIED',
        entityName: 'MedicalLock',
        entityId: 'LOCK-HR-000002-001',
        newValuesJson: JSON.stringify({ horseCode: 'HR-000002', reason: 'Viêm gân cấp tính' }),
      },
      {
        userId: trainer.id,
        action: 'WORKOUT_COMPLETED',
        entityName: 'WorkoutSession',
        entityId: `w1-${horse1.id}`,
        newValuesJson: JSON.stringify({ horseCode: 'HR-000001', distanceMeters: 1200, score: 8.9 }),
      },
    ],
  });

  console.log(
    `[12/12] Seeded In-app Notifications & Audit Trail Records. Seeding 100% Completed Successfully!`,
  );
}

main()
  .catch((e) => {
    console.error('Error during database seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
