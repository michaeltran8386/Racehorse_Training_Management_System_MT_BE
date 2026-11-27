import {
  PrismaClient,
  Role,
  UserStatus,
  HorseStatus,
  AdmissionStatus,
  StallStatus,
  PlanStatus,
  WorkoutStatus,
  TrackSurface,
  DailyTaskType,
  PreventiveType,
  PreventiveStatus,
  MedicalRecordStatus,
  SeverityLevel,
  InjuryStatus,
  InvoiceStatus,
  SupplyCategory,
  SupplyUnit,
  Prisma,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('========================================================================');
  console.log('🚀 [seed-demo-flow] KHỞI TẠO CƠ SỞ DỮ LIỆU ATOMIC MASTER CHO TOÀN BỘ HỆ THỐNG');
  console.log('    ĐẢM BẢO 100% TUÂN THỦ QUY TẮC NGHIỆP VỤ - 0 LỖI LOGIC / RÁC DỮ LIỆU');
  console.log('========================================================================');

  const passwordHash = await bcrypt.hash('EquiFlow@2026', 10);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayDate = new Date(`${todayStr}T00:00:00.000Z`);

  // =========================================================================
  // 1. DỌN SẠCH DỮ LIỆU CŨ THEO THỨ TỰ RÀNG BUỘC KHÓA NGOẠI (CLEAN PURGE)
  // =========================================================================
  console.log('🧹 [1/8] Dọn sạch dữ liệu cũ theo đúng thứ tự phụ thuộc khóa ngoại...');

  // Xóa các bảng phụ thuộc cấp thấp trước
  await prisma.simulatorSession.deleteMany({}).catch(() => {});
  await prisma.careCostClaim.deleteMany({}).catch(() => {});
  await prisma.invoiceLineItem.deleteMany({}).catch(() => {});
  await prisma.careCostEntry.deleteMany({}).catch(() => {});
  await prisma.financialInvoice.deleteMany({}).catch(() => {});
  await prisma.restockRequest.deleteMany({}).catch(() => {});
  await prisma.stockBalance.deleteMany({}).catch(() => {});
  await prisma.supplyCatalog.deleteMany({}).catch(() => {});
  await prisma.businessMailing.deleteMany({}).catch(() => {});
  await prisma.complaint.deleteMany({}).catch(() => {});
  await prisma.incidentReport.deleteMany({}).catch(() => {});
  await prisma.dailyCareTask.deleteMany({}).catch(() => {});
  await prisma.dailyGroomingLog.deleteMany({}).catch(() => {});
  await prisma.shiftRoster.deleteMany({}).catch(() => {});
  await prisma.workoutSession.deleteMany({}).catch(() => {});
  await prisma.trainerReview.deleteMany({}).catch(() => {});
  await prisma.trainingPlan.deleteMany({}).catch(() => {});
  await prisma.medicalLock.deleteMany({}).catch(() => {});
  await prisma.injuryLog.deleteMany({}).catch(() => {});
  await prisma.medicalRecord.deleteMany({}).catch(() => {});
  await prisma.preventiveSchedule.deleteMany({}).catch(() => {});
  await prisma.preventiveTypeCatalog.deleteMany({}).catch(() => {});
  await prisma.nutritionPlan.deleteMany({}).catch(() => {});
  await prisma.tournamentResult.deleteMany({}).catch(() => {});
  await prisma.tournamentRegistration.deleteMany({}).catch(() => {});
  await prisma.horseHandoverRequest.deleteMany({}).catch(() => {});
  await prisma.admissionHealthReview.deleteMany({}).catch(() => {});
  await prisma.admissionHistoryLog.deleteMany({}).catch(() => {});
  await prisma.horseAdmissionRecord.deleteMany({}).catch(() => {});
  await prisma.horseTransferRequest.deleteMany({}).catch(() => {});
  await prisma.stallAllocation.deleteMany({}).catch(() => {});
  await prisma.staffWorkItem.deleteMany({}).catch(() => {});
  await prisma.horse.deleteMany({}).catch(() => {});
  await prisma.loginAttempt.deleteMany({}).catch(() => {});

  console.log('  -> Dọn sạch thành công toàn bộ dữ liệu bảng con.');

  // =========================================================================
  // 2. KHỞI TẠO CÁC PHÂN KHU CHUỒNG TRẠI (3 BARN CHUẨN: A, B, C)
  // =========================================================================
  console.log('🏠 [2/8] Khởi tạo các phân khu chuồng trại (Barn A, Barn B, Barn C)...');

  // Vô hiệu hóa triệt để các zone cũ để không gây rác giao diện
  await prisma.stallZone.updateMany({
    where: { code: { notIn: ['BARN-A', 'BARN-B', 'BARN-C'] } },
    data: { isActive: false },
  });

  const zoneA = await prisma.stallZone.upsert({
    where: { code: 'BARN-A' },
    update: { name: 'Barn A', rows: 4, cols: 3, isActive: true },
    create: {
      code: 'BARN-A',
      name: 'Barn A',
      rows: 4,
      cols: 3,
      description: 'Khu chuồng chính A (Chuyên môn HLV Tuấn & HLV Quân)',
    },
  });

  const zoneB = await prisma.stallZone.upsert({
    where: { code: 'BARN-B' },
    update: { name: 'Barn B', rows: 4, cols: 3, isActive: true },
    create: {
      code: 'BARN-B',
      name: 'Barn B',
      rows: 4,
      cols: 3,
      description: 'Khu chuồng biệt lập B (Chuyên môn HLV Nam & HLV Trung)',
    },
  });

  const zoneC = await prisma.stallZone.upsert({
    where: { code: 'BARN-C' },
    update: { name: 'Barn C', rows: 4, cols: 3, isActive: true },
    create: {
      code: 'BARN-C',
      name: 'Barn C',
      rows: 4,
      cols: 3,
      description: 'Khu chuồng mới C (Trống 100% để Hội đồng thực hành tạo tài khoản và phân công)',
    },
  });

  // Reset tạm thời row và col để tránh conflict unique constraint
  await prisma.stall.updateMany({
    where: { zoneId: { in: [zoneA.id, zoneB.id, zoneC.id] } },
    data: { row: null, col: null },
  });

  // Tạo các ô chuồng mẫu theo lưới chuẩn 4x3 (4 hàng x 3 cột = 12 ô chuồng/Barn)
  const stallsA: any[] = [];
  for (let i = 1; i <= 12; i++) {
    const code = `A-${String(i).padStart(2, '0')}`;
    const s = await prisma.stall.upsert({
      where: { code },
      update: {
        zoneId: zoneA.id,
        zone: 'Barn A',
        row: Math.ceil(i / 3),
        col: ((i - 1) % 3) + 1,
        status: i <= 11 ? StallStatus.OCCUPIED : StallStatus.AVAILABLE,
      },
      create: {
        code,
        zone: 'Barn A',
        zoneId: zoneA.id,
        row: Math.ceil(i / 3),
        col: ((i - 1) % 3) + 1,
        status: i <= 11 ? StallStatus.OCCUPIED : StallStatus.AVAILABLE,
      },
    });
    stallsA.push(s);
  }

  const stallsB: any[] = [];
  for (let i = 1; i <= 12; i++) {
    const code = `B-${String(i).padStart(2, '0')}`;
    const s = await prisma.stall.upsert({
      where: { code },
      update: {
        zoneId: zoneB.id,
        zone: 'Barn B',
        row: Math.ceil(i / 3),
        col: ((i - 1) % 3) + 1,
        status: i <= 9 ? StallStatus.OCCUPIED : StallStatus.AVAILABLE,
      },
      create: {
        code,
        zone: 'Barn B',
        zoneId: zoneB.id,
        row: Math.ceil(i / 3),
        col: ((i - 1) % 3) + 1,
        status: i <= 9 ? StallStatus.OCCUPIED : StallStatus.AVAILABLE,
      },
    });
    stallsB.push(s);
  }

  const stallsC: any[] = [];
  for (let i = 1; i <= 12; i++) {
    const code = `C-${String(i).padStart(2, '0')}`;
    const s = await prisma.stall.upsert({
      where: { code },
      update: {
        zoneId: zoneC.id,
        zone: 'Barn C',
        row: Math.ceil(i / 3),
        col: ((i - 1) % 3) + 1,
        status: StallStatus.AVAILABLE,
      },
      create: {
        code,
        zone: 'Barn C',
        zoneId: zoneC.id,
        row: Math.ceil(i / 3),
        col: ((i - 1) % 3) + 1,
        status: StallStatus.AVAILABLE,
      },
    });
    stallsC.push(s);
  }

  // Khởi tạo 4 sân tập thể lực chuẩn cho CLB
  console.log('  -> Khởi tạo 4 sân tập thể lực chuẩn cho CLB (Cỏ A, Cỏ B, Cát, Tổng hợp)...');
  const tracksData = [
    { code: 'TRK-TURF-A', name: 'Đường chạy cỏ A (Chính)', surface: 'TURF', capacity: 6, isActive: true },
    { code: 'TRK-TURF-B', name: 'Đường chạy cỏ B (Phụ)', surface: 'TURF', capacity: 4, isActive: true },
    { code: 'TRK-DIRT-01', name: 'Đường chạy cát chính', surface: 'DIRT', capacity: 8, isActive: true },
    { code: 'TRK-SYN-01', name: 'Đường chạy tổng hợp All-weather', surface: 'SYNTHETIC', capacity: 6, isActive: true },
  ];
  for (const t of tracksData) {
    await prisma.trainingTrack.upsert({
      where: { code: t.code },
      update: { name: t.name, surface: t.surface, capacity: t.capacity, isActive: t.isActive },
      create: { code: t.code, name: t.name, surface: t.surface, capacity: t.capacity, isActive: t.isActive },
    });
  }

  // =========================================================================
  // 3. TÀI KHOẢN DIỄN VIÊN CHÍNH (ĐẦY ĐỦ 5 VAI TRÒ + PHÂN BỔ BIÊN CHẾ CHUẨN)
  // =========================================================================
  console.log('👤 [3/8] Khởi tạo tài khoản Quản lý, Huấn luyện viên, Groom, Thú y, Chủ ngựa...');

  const manager = await prisma.user.upsert({
    where: { email: 'manager@gmail.com' },
    update: { passwordHash, status: UserStatus.ACTIVE, fullName: 'Nguyễn Hoàng Long' },
    create: {
      email: 'manager@gmail.com',
      passwordHash,
      fullName: 'Nguyễn Hoàng Long',
      role: Role.CLUB_MANAGER,
      status: UserStatus.ACTIVE,
      phoneNumber: '0901000001',
    },
  });

  const trainerA = await prisma.user.upsert({
    where: { email: 'trainer@gmail.com' },
    update: { passwordHash, status: UserStatus.ACTIVE, fullName: 'Nguyễn Văn Tuấn', assignedBarnId: zoneA.id },
    create: {
      email: 'trainer@gmail.com',
      passwordHash,
      fullName: 'Nguyễn Văn Tuấn',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
      phoneNumber: '0902000001',
      assignedBarnId: zoneA.id,
    },
  });

  const trainerQuan = await prisma.user.upsert({
    where: { email: 'trainer.quan@gmail.com' },
    update: { passwordHash, status: UserStatus.ACTIVE, fullName: 'Trần Minh Quân', assignedBarnId: zoneA.id },
    create: {
      email: 'trainer.quan@gmail.com',
      passwordHash,
      fullName: 'Trần Minh Quân',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
      phoneNumber: '0902000004',
      assignedBarnId: zoneA.id,
    },
  });

  const trainerB = await prisma.user.upsert({
    where: { email: 'trainer2@gmail.com' },
    update: { passwordHash, status: UserStatus.ACTIVE, fullName: 'Lê Hoàng Nam', assignedBarnId: zoneB.id },
    create: {
      email: 'trainer2@gmail.com',
      passwordHash,
      fullName: 'Lê Hoàng Nam',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
      phoneNumber: '0902000002',
      assignedBarnId: zoneB.id,
    },
  });

  const trainerC = await prisma.user.upsert({
    where: { email: 'trainer3@gmail.com' },
    update: { passwordHash, status: UserStatus.ACTIVE, fullName: 'Phạm Quốc Trung', assignedBarnId: zoneB.id },
    create: {
      email: 'trainer3@gmail.com',
      passwordHash,
      fullName: 'Phạm Quốc Trung',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
      phoneNumber: '0902000003',
      assignedBarnId: zoneB.id,
    },
  });

  const groom1 = await prisma.user.upsert({
    where: { email: 'groom@gmail.com' },
    update: { passwordHash, status: UserStatus.ACTIVE, fullName: 'Trần Thị Mai', assignedBarnId: zoneA.id },
    create: {
      email: 'groom@gmail.com',
      passwordHash,
      fullName: 'Trần Thị Mai',
      role: Role.GROOM,
      status: UserStatus.ACTIVE,
      phoneNumber: '0904000001',
      assignedBarnId: zoneA.id,
    },
  });

  const groom2 = await prisma.user.upsert({
    where: { email: 'groom2@gmail.com' },
    update: { passwordHash, status: UserStatus.ACTIVE, fullName: 'Hoàng Văn Phúc', assignedBarnId: zoneA.id },
    create: {
      email: 'groom2@gmail.com',
      passwordHash,
      fullName: 'Hoàng Văn Phúc',
      role: Role.GROOM,
      status: UserStatus.ACTIVE,
      phoneNumber: '0904000002',
      assignedBarnId: zoneA.id,
    },
  });

  const groom3 = await prisma.user.upsert({
    where: { email: 'groom3@gmail.com' },
    update: { passwordHash, status: UserStatus.ACTIVE, fullName: 'Đỗ Thị Mai', assignedBarnId: zoneB.id },
    create: {
      email: 'groom3@gmail.com',
      passwordHash,
      fullName: 'Đỗ Thị Mai',
      role: Role.GROOM,
      status: UserStatus.ACTIVE,
      phoneNumber: '0904000003',
      assignedBarnId: zoneB.id,
    },
  });

  const groom4 = await prisma.user.upsert({
    where: { email: 'groom4@gmail.com' },
    update: {
      passwordHash: '',
      status: UserStatus.INVITED,
      fullName: 'Lê Quốc Tuấn',
      assignedBarnId: zoneB.id,
      invitedBy: manager.fullName,
    },
    create: {
      email: 'groom4@gmail.com',
      passwordHash: '',
      fullName: 'Lê Quốc Tuấn',
      role: Role.GROOM,
      status: UserStatus.INVITED,
      phoneNumber: '0904000004',
      assignedBarnId: zoneB.id,
      invitedBy: manager.fullName,
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: 'owner@gmail.com' },
    update: {
      passwordHash,
      status: UserStatus.ACTIVE,
      fullName: 'Robert Sterling',
      isBadDebtFlagged: true,
      badDebtFlaggedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000),
      badDebtReason: 'Hóa đơn INV-202609-002 quá hạn 50 ngày chưa thanh toán',
    },
    create: {
      email: 'owner@gmail.com',
      passwordHash,
      fullName: 'Robert Sterling',
      role: Role.HORSE_OWNER,
      status: UserStatus.ACTIVE,
      phoneNumber: '0905000001',
      isBadDebtFlagged: true,
      badDebtFlaggedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000),
      badDebtReason: 'Hóa đơn INV-202609-002 quá hạn 50 ngày chưa thanh toán',
    },
  });

  const vet = await prisma.user.upsert({
    where: { email: 'vet@gmail.com' },
    update: { passwordHash, status: UserStatus.ACTIVE, fullName: 'BS. Hoàng Thị Mai' },
    create: {
      email: 'vet@gmail.com',
      passwordHash,
      fullName: 'BS. Hoàng Thị Mai',
      role: Role.VETERINARIAN,
      status: UserStatus.ACTIVE,
      phoneNumber: '0903115999',
    },
  });

  // Đồng bộ gán Barn cho các HLV & Groom
  await prisma.user.update({ where: { id: trainerA.id }, data: { assignedBarnId: zoneA.id } });
  await prisma.user.update({ where: { id: trainerQuan.id }, data: { assignedBarnId: zoneA.id } });
  await prisma.user.update({ where: { id: trainerB.id }, data: { assignedBarnId: zoneB.id } });
  await prisma.user.update({ where: { id: trainerC.id }, data: { assignedBarnId: zoneB.id } });
  await prisma.user.update({ where: { id: groom1.id }, data: { assignedBarnId: zoneA.id } });
  await prisma.user.update({ where: { id: groom2.id }, data: { assignedBarnId: zoneA.id } });
  await prisma.user.update({ where: { id: groom3.id }, data: { assignedBarnId: zoneB.id } });
  await prisma.user.update({ where: { id: groom4.id }, data: { assignedBarnId: zoneB.id } });

  // Danh mục Giống & Màu lông
  const breeds = ['Thoroughbred', 'Arabian', 'Quarter Horse', 'Warmblood'];
  for (const b of breeds) {
    const existing = await prisma.horseCatalogItem.findFirst({ where: { type: 'BREED', name: b } });
    if (!existing) {
      await prisma.horseCatalogItem.create({
        data: { type: 'BREED', name: b, code: b.toUpperCase().replace(/\s+/g, '_') },
      });
    }
  }
  const colors = ['Bay', 'Chestnut', 'Black', 'White', 'Grey'];
  for (const c of colors) {
    const existing = await prisma.horseCatalogItem.findFirst({ where: { type: 'COLOR', name: c } });
    if (!existing) {
      await prisma.horseCatalogItem.create({
        data: { type: 'COLOR', name: c, code: c.toUpperCase() },
      });
    }
  }

  // =========================================================================
  // 4. KHỞI TẠO ĐÀN CHIẾN MÃ & HUẤN LUYỆN (HLV TUẤN ĐẠT CHUẨN 8/8)
  // =========================================================================
  console.log('🐴 [4/8] Khởi tạo đàn chiến mã, giáo án huấn luyện và phân bổ ô chuồng...');

  // Helper tạo giáo án hoạt động kèm các buổi tập quá khứ và tương lai
  async function createLivePlanWithWorkouts(params: {
    horseId: string;
    trainerUserId: string;
    planCode: string;
    phaseName: string;
    objective: string;
    baseScore: number;
    trackSurface: TrackSurface;
    isLoadSpike?: boolean;
  }) {
    const startDate = new Date(Date.now() - 40 * 24 * 3600 * 1000);
    const endDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const phase1End = new Date(Date.now() - 15 * 24 * 3600 * 1000);
    const phase2Start = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const phase2End = new Date(Date.now() + 15 * 24 * 3600 * 1000);

    const phases = [
      {
        id: `${params.planCode}-PH1`,
        name: 'Giai đoạn 1: Nền tảng',
        type: 'BASE',
        startDate: startDate.toISOString().slice(0, 10),
        endDate: phase1End.toISOString().slice(0, 10),
        sessionsPerWeek: 3,
        maxWeeklyDistance: 6000,
        surface: params.trackSurface,
      },
      {
        id: `${params.planCode}-PH2`,
        name: 'Giai đoạn 2: Tăng tốc & Sức bền',
        type: 'BUILD',
        startDate: phase2Start.toISOString().slice(0, 10),
        endDate: phase2End.toISOString().slice(0, 10),
        sessionsPerWeek: 3,
        maxWeeklyDistance: 8000,
        surface: params.trackSurface,
      },
    ];

    const plan = await prisma.trainingPlan.create({
      data: {
        horseId: params.horseId,
        trainerUserId: params.trainerUserId,
        planCode: params.planCode,
        phaseName: params.phaseName,
        objective: params.objective,
        status: PlanStatus.ACTIVE,
        startDate,
        endDate,
        trackSurface: params.trackSurface,
        phases,
      },
    });

    const prior4wOffsets = [-32, -29, -25, -22, -18, -15, -11, -8];
    const recentOffsets = params.isLoadSpike ? [-6, -3, -1] : [-5, -2];
    const allCompleted = [...prior4wOffsets, ...recentOffsets];

    for (let s = 0; s < allCompleted.length; s++) {
      const off = allCompleted[s];
      const sDate = new Date(Date.now() + off * 24 * 3600 * 1000);
      sDate.setHours(7 + (s % 3), 0, 0, 0);
      const score = Math.min(9.6, Math.max(7.8, params.baseScore + (s % 3) * 0.2 - 0.1));
      const phaseId = off <= -15 ? `${params.planCode}-PH1` : `${params.planCode}-PH2`;
      const isExtraSpikeSession = params.isLoadSpike && off === -1;
      await prisma.workoutSession.create({
        data: {
          trainingPlanId: plan.id,
          horseId: params.horseId,
          assignedStaffUserId: params.trainerUserId,
          scheduledDate: sDate,
          phaseId,
          workoutType: s % 2 === 0 ? 'CANTER' : 'BREEZE',
          intensity: isExtraSpikeSession ? 'HEAVY' : s % 3 === 0 ? 'LIGHT' : 'MEDIUM',
          trackSurface: params.trackSurface,
          distanceMeters: isExtraSpikeSession ? 2000 : 1500,
          repetitions: 2,
          targetSpeedKmh: isExtraSpikeSession ? 62 : 58,
          status: WorkoutStatus.COMPLETED,
          performanceScore: Math.round(score * 10) / 10,
          heartRatePeak: 185 + (s % 4) * 4,
          heartRateRecovery: 95 + (s % 3) * 3,
          resultRecordedAt: new Date(sDate.getTime() + 3600 * 1000),
          trainerNotes: 'Chiến mã duy trì thể lực tốt, bước chạy ổn định.',
        },
      });
    }

    const upcomingOffsets = [2, 4, 7];
    for (let u = 0; u < upcomingOffsets.length; u++) {
      const off = upcomingOffsets[u];
      const uDate = new Date(Date.now() + off * 24 * 3600 * 1000);
      uDate.setHours(8 + u, 30, 0, 0);
      await prisma.workoutSession.create({
        data: {
          trainingPlanId: plan.id,
          horseId: params.horseId,
          assignedStaffUserId: params.trainerUserId,
          scheduledDate: uDate,
          phaseId: `${params.planCode}-PH2`,
          workoutType: u === 0 ? 'CANTER' : 'BREEZE',
          intensity: 'MEDIUM',
          trackSurface: params.trackSurface,
          distanceMeters: 1500,
          repetitions: 2,
          targetSpeedKmh: 60,
          status: WorkoutStatus.SCHEDULED,
          jockeyName: 'Trần Văn Kiên',
          trainerNotes: 'Chuẩn bị bài tập cự ly trung bình trên sân cỏ.',
        },
      });
    }
    return plan;
  }

  // Danh sách chiến mã theo dõi theo Groom
  const groom1Horses: { horse: any; stall: any }[] = [];
  const groom2Horses: { horse: any; stall: any }[] = [];
  const groom3Horses: { horse: any; stall: any }[] = [];

  // --- 4.1. HLV TUẤN (Barn A): Đúng 8 chiến mã (8/8 tải: 5 Active, 1 Draft, 1 Chờ giáo án, 1 Khóa y tế) ---
  console.log('  -> Tạo đúng 8 chiến mã tại Barn A cho HLV Tuấn (8/8 tải chuẩn mực)...');
  const horseNamesA = [
    'Phong Lôi', 'Tuyết Ảnh', 'Lôi Chấn', 'Dạ Nguyệt',
    'Lão Tướng', 'Huyền Vũ', 'Thần Phong', 'Hắc Báo',
  ];

  let medicalLockedHorseA: any = null;

  for (let i = 1; i <= 8; i++) {
    const avatarUrl = `/images/horses/horse-${String(i).padStart(2, '0')}.jpg`;
    const isMedical = i === 8;
    const isWaitingPlan = i === 7;
    const isDraft = i === 6;
    const isActive = i <= 5;

    const horseStatus = isMedical
      ? HorseStatus.INJURED
      : isWaitingPlan
        ? HorseStatus.RESTING
        : HorseStatus.IN_TRAINING;

    const h = await prisma.horse.create({
      data: {
        horseCode: `HR-DEMO-A0${i}`,
        name: horseNamesA[i - 1],
        breed: 'Quarter Horse',
        gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
        color: 'Bay',
        avatarUrl,
        dob: new Date('2022-01-20'),
        weightKg: 470 + i * 5,
        microchip: `98500000100${i}`,
        microchipRfid: `98500000100${i}`,
        status: horseStatus,
        isMedicalLocked: isMedical,
        assignedTrainerId: trainerA.id,
        trainerAssignmentStatus: 'ASSIGNED',
        ownerId: owner.id,
      },
    });

    const stallA = stallsA[i - 1]; // Ô A-01 đến A-08
    const assignedGroomId = i <= 4 ? groom1.id : groom2.id;
    if (i <= 4) groom1Horses.push({ horse: h, stall: stallA });
    else groom2Horses.push({ horse: h, stall: stallA });

    await prisma.stallAllocation.create({
      data: {
        stallId: stallA.id,
        horseId: h.id,
        assignedGroomUserId: assignedGroomId,
        isActive: true,
      },
    });

    if (isActive) {
      await createLivePlanWithWorkouts({
        horseId: h.id,
        trainerUserId: trainerA.id,
        planCode: `GA-DEMO-A0${i}`,
        phaseName: `Giáo án Thể lực & Tốc độ A${i}`,
        objective: 'Tăng cường sức bền và tốc độ nước rút 1200m.',
        baseScore: 8.5 + (i % 3) * 0.2,
        trackSurface: TrackSurface.TURF,
        isLoadSpike: i === 1,
      });
    } else if (isDraft) {
      const startDate = new Date(Date.now() + 2 * 24 * 3600 * 1000);
      const endDate = new Date(Date.now() + 32 * 24 * 3600 * 1000);
      await prisma.trainingPlan.create({
        data: {
          horseId: h.id,
          trainerUserId: trainerA.id,
          planCode: `GA-DEMO-A0${i}`,
          phaseName: `Giáo án Thể lực & Bứt tốc Mùa Thu`,
          objective: 'Rèn luyện khả năng tăng tốc 400m cuối và hồi phục nhịp tim.',
          status: PlanStatus.DRAFT,
          startDate,
          endDate,
          trackSurface: TrackSurface.TURF,
          phases: [
            {
              id: `GA-DEMO-A0${i}-PH1`,
              name: 'Giai đoạn 1: Nền tảng',
              type: 'BASE',
              startDate: startDate.toISOString().slice(0, 10),
              endDate: new Date(Date.now() + 16 * 24 * 3600 * 1000).toISOString().slice(0, 10),
              sessionsPerWeek: 3,
              maxWeeklyDistance: 6000,
              surface: TrackSurface.TURF,
            },
          ],
        },
      });
    } else if (isWaitingPlan) {
      await prisma.horseHandoverRequest.create({
        data: {
          horseId: h.id,
          fromManagerId: manager.id,
          toTrainerId: trainerA.id,
          status: 'ACCEPTED',
          token: `token-accepted-a07-${Date.now()}`,
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
          acceptedAt: new Date(Date.now() - 3600 * 1000),
          planDeadlineAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
        },
      });
    } else if (isMedical) {
      medicalLockedHorseA = h;
    }
  }

  // --- 4.2. HLV QUÂN (Barn A): 2 chiến mã (2/8 tải, còn 6 chỗ trống để demo Happy Case) ---
  console.log('  -> Tạo 2 chiến mã tại Barn A cho HLV Quân (2/8 tải)...');
  const horseNamesQ = ['Tử Điện', 'Thanh Loan'];
  for (let i = 1; i <= 2; i++) {
    const avatarUrl = `/images/horses/horse-${String(i + 8).padStart(2, '0')}.jpg`;
    const h = await prisma.horse.create({
      data: {
        horseCode: `HR-DEMO-Q0${i}`,
        name: horseNamesQ[i - 1],
        breed: 'Thoroughbred',
        gender: 'FEMALE',
        color: 'Chestnut',
        avatarUrl,
        dob: new Date('2022-05-10'),
        weightKg: 460 + i * 10,
        microchip: `98500000400${i}`,
        microchipRfid: `98500000400${i}`,
        status: HorseStatus.IN_TRAINING,
        assignedTrainerId: trainerQuan.id,
        trainerAssignmentStatus: 'ASSIGNED',
        ownerId: owner.id,
      },
    });

    const stallQ = stallsA[7 + i]; // Ô A-09 và A-10
    await prisma.stallAllocation.create({
      data: {
        stallId: stallQ.id,
        horseId: h.id,
        assignedGroomUserId: groom2.id,
        isActive: true,
      },
    });
    groom2Horses.push({ horse: h, stall: stallQ });

    await createLivePlanWithWorkouts({
      horseId: h.id,
      trainerUserId: trainerQuan.id,
      planCode: `GA-DEMO-Q0${i}`,
      phaseName: `Giáo án Nước kiệu Quân ${i}`,
      objective: 'Rèn luyện phản xạ và cự ly trung bình.',
      baseScore: 8.3,
      trackSurface: TrackSurface.TURF,
      isLoadSpike: false,
    });
  }

  // --- 4.3. HLV NAM (Barn B): 4 chiến mã (4/8 tải) ---
  console.log('  -> Tạo 4 chiến mã tại Barn B cho HLV Nam (4/8 tải)...');
  const horseNamesB = ['Tuyết Phong', 'Kim Long', 'Hồng Kỳ', 'Phi Vũ'];
  for (let i = 1; i <= 4; i++) {
    const avatarUrl = `/images/horses/horse-${String(i + 10).padStart(2, '0')}.jpg`;
    const h = await prisma.horse.create({
      data: {
        horseCode: `HR-DEMO-B0${i}`,
        name: horseNamesB[i - 1],
        breed: 'Thoroughbred',
        gender: 'MALE',
        color: 'Bay',
        avatarUrl,
        dob: new Date('2022-03-15'),
        weightKg: 480 + i * 5,
        microchip: `98500000200${i}`,
        microchipRfid: `98500000200${i}`,
        status: HorseStatus.IN_TRAINING,
        assignedTrainerId: trainerB.id,
        trainerAssignmentStatus: 'ASSIGNED',
        ownerId: owner.id,
      },
    });

    const stallB = stallsB[i - 1]; // Ô B-01 đến B-04
    await prisma.stallAllocation.create({
      data: {
        stallId: stallB.id,
        horseId: h.id,
        assignedGroomUserId: groom3.id,
        isActive: true,
      },
    });
    groom3Horses.push({ horse: h, stall: stallB });

    await createLivePlanWithWorkouts({
      horseId: h.id,
      trainerUserId: trainerB.id,
      planCode: `GA-DEMO-B0${i}`,
      phaseName: `Giáo án Tốc độ Nam ${i}`,
      objective: 'Duy trì thể lực và kiểm soát nhịp tim trên sân cát.',
      baseScore: 8.4,
      trackSurface: TrackSurface.DIRT,
      isLoadSpike: false,
    });
  }

  // --- 4.4. HLV TRUNG (Barn B): 3 chiến mã (3/8 tải) ---
  console.log('  -> Tạo 3 chiến mã tại Barn B cho HLV Trung (3/8 tải)...');
  const horseNamesC = ['Ngàn Hoa', 'Thiên Mã', 'Hỏa Phụng'];
  for (let i = 1; i <= 3; i++) {
    const avatarUrl = `/images/horses/horse-${String(i + 14).padStart(2, '0')}.jpg`;
    const h = await prisma.horse.create({
      data: {
        horseCode: `HR-DEMO-C0${i}`,
        name: horseNamesC[i - 1],
        breed: 'Arabian',
        gender: 'MALE',
        color: 'Chestnut',
        avatarUrl,
        dob: new Date('2021-05-10'),
        weightKg: 450 + i * 10,
        microchip: `98500000300${i}`,
        microchipRfid: `98500000300${i}`,
        status: HorseStatus.IN_TRAINING,
        assignedTrainerId: trainerC.id,
        trainerAssignmentStatus: 'ASSIGNED',
        ownerId: owner.id,
      },
    });

    const stallC = stallsB[3 + i]; // Ô B-05 đến B-07
    const assignedGroomId = i === 1 ? groom3.id : null;
    await prisma.stallAllocation.create({
      data: {
        stallId: stallC.id,
        horseId: h.id,
        assignedGroomUserId: assignedGroomId,
        isActive: true,
      },
    });
    if (assignedGroomId) {
      groom3Horses.push({ horse: h, stall: stallC });
    }

    await createLivePlanWithWorkouts({
      horseId: h.id,
      trainerUserId: trainerC.id,
      planCode: `GA-DEMO-C0${i}`,
      phaseName: `Giáo án Nước kiệu Trung ${i}`,
      objective: 'Tập trung phản xạ và phối hợp bước chạy 1000m.',
      baseScore: 8.2,
      trackSurface: TrackSurface.DIRT,
      isLoadSpike: false,
    });
  }

  // --- 4.5. BỐ TRÍ 4 CHIẾN MÃ DEMO CHUYÊN BIỆT CHO CÁC LUỒNG THỰC TẾ ---
  console.log('  -> Tạo 4 chiến mã demo Happy Case & Ngoại lệ (SLA, Khóa y tế, Chưa có chuồng)...');

  // Ngựa Demo 1: "Bạch Long Mã" (HRS-DEMO-01) tại Ô A-11 (Barn A) - CHƯA CÓ HLV
  const demoHorse1 = await prisma.horse.create({
    data: {
      horseCode: 'HRS-DEMO-01',
      name: 'Bạch Long Mã',
      avatarUrl: '/images/horses/horse-18.jpg',
      breed: 'Thoroughbred',
      gender: 'MALE',
      color: 'White',
      dob: new Date('2022-04-12'),
      weightKg: 485.5,
      microchip: '985000009901',
      microchipRfid: '985000009901',
      status: HorseStatus.RESTING,
      assignedTrainerId: null,
      trainerAssignmentStatus: 'UNASSIGNED',
      isMedicalLocked: false,
      ownerId: owner.id,
    },
  });

  await prisma.stallAllocation.create({
    data: {
      stallId: stallsA[10].id, // Chuồng A-11 (Barn A)
      horseId: demoHorse1.id,
      assignedGroomUserId: null, // Để trống để test phân công
      isActive: true,
    },
  });

  // Ngựa Demo 2: "Xích Thố" (HRS-DEMO-02) tại Chuồng B-08 (Barn B) - CHƯA CÓ HLV
  const demoHorse2 = await prisma.horse.create({
    data: {
      horseCode: 'HRS-DEMO-02',
      name: 'Xích Thố',
      avatarUrl: '/images/horses/horse-19.jpg',
      breed: 'Quarter Horse',
      gender: 'MALE',
      color: 'Chestnut',
      dob: new Date('2021-08-25'),
      weightKg: 510.0,
      microchip: '985000009902',
      microchipRfid: '985000009902',
      status: HorseStatus.RESTING,
      assignedTrainerId: null,
      trainerAssignmentStatus: 'UNASSIGNED',
      isMedicalLocked: false,
      ownerId: owner.id,
    },
  });

  await prisma.stallAllocation.create({
    data: {
      stallId: stallsB[7].id, // Chuồng B-08 (Barn B)
      horseId: demoHorse2.id,
      assignedGroomUserId: null,
      isActive: true,
    },
  });

  // Ngựa Demo 3: "Phi Yến" (HRS-DEMO-03) - CHƯA XẾP CHUỒNG (NO-STALL)
  await prisma.horse.create({
    data: {
      horseCode: 'HRS-DEMO-03',
      name: 'Phi Yến',
      avatarUrl: '/images/horses/horse-04.jpg',
      breed: 'Warmblood',
      gender: 'FEMALE',
      color: 'Bay',
      dob: new Date('2023-02-14'),
      weightKg: 430.0,
      microchip: '985000009903',
      microchipRfid: '985000009903',
      status: HorseStatus.RESTING,
      assignedTrainerId: null,
      trainerAssignmentStatus: 'UNASSIGNED',
      ownerId: owner.id,
    },
  });

  // Ngựa Demo 4: "Chiến Thần" (HRS-DEMO-04) tại Barn B (B-09) - ĐANG BỊ KHÓA Y TẾ
  const demoHorse4 = await prisma.horse.create({
    data: {
      horseCode: 'HRS-DEMO-04',
      name: 'Chiến Thần',
      avatarUrl: '/images/horses/horse-02.jpg',
      breed: 'Arabian',
      gender: 'MALE',
      color: 'Black',
      dob: new Date('2021-11-05'),
      weightKg: 495.0,
      microchip: '985000009904',
      microchipRfid: '985000009904',
      status: HorseStatus.INJURED,
      assignedTrainerId: trainerC.id,
      trainerAssignmentStatus: 'ASSIGNED',
      isMedicalLocked: true,
      ownerId: owner.id,
    },
  });

  await prisma.stallAllocation.create({
    data: {
      stallId: stallsB[8].id, // Chuồng B-09 (Barn B)
      horseId: demoHorse4.id,
      assignedGroomUserId: null,
      isActive: true,
    },
  });

  // Tạo 2 yêu cầu bàn giao phục vụ test SLA
  await prisma.horseHandoverRequest.create({
    data: {
      horseId: demoHorse1.id,
      fromManagerId: manager.id,
      toTrainerId: trainerQuan.id,
      status: 'PENDING',
      token: 'token-pending-safe-sla-01',
      expiresAt: new Date(Date.now() + 36 * 3600 * 1000),
      notes: 'Phân công chiến mã Bạch Long Mã cho HLV Quân tiếp nhận (SLA 48h bình thường).',
    },
  });

  await prisma.horseHandoverRequest.create({
    data: {
      horseId: demoHorse2.id,
      fromManagerId: manager.id,
      toTrainerId: trainerB.id,
      status: 'PENDING',
      token: 'token-pending-urgent-sla-02',
      expiresAt: new Date(Date.now() + 8 * 3600 * 1000),
      notes: 'CẢNH BÁO KHẨN CẤP: Yêu cầu bàn giao chiến mã Xích Thố sắp hết hạn sau 8 giờ nữa.',
    },
  });

  // Khởi tạo 2 hồ sơ tiếp nhận chiến mã (HorseAdmissionRecord)
  const admHorse1 = await prisma.horse.create({
    data: {
      horseCode: 'HR-ADM-001',
      name: 'Ánh Dương',
      avatarUrl: '/images/horses/horse-07.jpg',
      breed: 'Thoroughbred',
      gender: 'FEMALE',
      color: 'Chestnut',
      dob: new Date('2022-03-15'),
      weightKg: 465.0,
      microchip: '985000008001',
      microchipRfid: '985000008001',
      status: HorseStatus.PENDING_ADMISSION,
      ownerId: owner.id,
    },
  });

  await prisma.horseAdmissionRecord.create({
    data: {
      admissionCode: 'ADM-2026-001',
      horseId: admHorse1.id,
      ownerId: owner.id,
      status: AdmissionStatus.INSPECTION_IN_PROGRESS,
      appointmentDate: new Date(Date.now() + 24 * 3600 * 1000),
      appointmentNotes: 'Điểm tiếp nhận kiểm dịch Cổng A. Đầy đủ bản gốc giấy tờ gia phả và sổ tiêm chủng.',
      declaredMicrochip: '985000008001',
      scannedMicrochip: '985000008001',
      microchipVerified: true,
      legalVerified: true,
      legalDocumentsNote: 'Chứng nhận nguồn gốc giống Thoroughbred & hồ sơ kiểm dịch đã xác thực hợp lệ.',
      veterinarianUserId: vet.id,
      isHealthEligible: true,
      healthCheckNotes: 'Đạt chuẩn kiểm dịch: Không có triệu chứng truyền nhiễm, tim phổi nhịp đều, cơ bắp phát triển tốt.',
    },
  });

  const admHorse2 = await prisma.horse.create({
    data: {
      horseCode: 'HR-ADM-002',
      name: 'Hải Đăng',
      avatarUrl: '/images/horses/horse-08.jpg',
      breed: 'Quarter Horse',
      gender: 'MALE',
      color: 'Bay',
      dob: new Date('2022-06-20'),
      weightKg: 480.0,
      microchip: '985000008002',
      microchipRfid: '985000008002',
      status: HorseStatus.PENDING_ADMISSION,
      ownerId: owner.id,
    },
  });

  await prisma.horseAdmissionRecord.create({
    data: {
      admissionCode: 'ADM-2026-002',
      horseId: admHorse2.id,
      ownerId: owner.id,
      status: AdmissionStatus.PENDING_VERIFICATION,
      declaredMicrochip: '985000008002',
      legalDocumentsNote: 'Đơn đăng ký mới trực tuyến từ Chủ ngựa Robert Sterling.',
    },
  });

  // =========================================================================
  // 5. PHÂN HỆ Y TẾ & THÚ Y (BỆNH ÁN, KHÓA Y TẾ, LỊCH PHÒNG DỊCH, SỰ CỐ)
  // =========================================================================
  console.log('🩺 [5/8] Khởi tạo hồ sơ bệnh án, Khóa y tế, Lịch phòng bệnh và Báo cáo sự cố...');

  // 5.1. Bệnh án & Khóa y tế cho Hắc Báo (HR-DEMO-A08)
  if (medicalLockedHorseA) {
    const medRecordA = await prisma.medicalRecord.create({
      data: {
        recordNumber: 'BA-2611-001',
        horseId: medicalLockedHorseA.id,
        veterinarianUserId: vet.id,
        status: MedicalRecordStatus.OPEN,
        examinationType: 'Chấn thương thể thao',
        discoverySource: 'Groom báo cáo sau bài tập tốc độ',
        severity: SeverityLevel.MODERATE,
        recommendedHorseStatus: HorseStatus.INJURED,
        symptoms: 'Sưng nóng vùng gân gập ngón nông chân trước bên phải, đi khập khiễng độ 2/5.',
        clinicalDiagnosis: 'Căng gân cơ gập ngón nông chân trước bên phải cấp tính.',
        treatmentProtocol: 'Chườm đá 3 lần/ngày, băng ép cố định, nghỉ ngơi tĩnh 14 ngày, tiêm kháng viêm NSAID.',
        proposeMedicalLock: true,
        lockExpectedRestDays: 14,
        lockUnlockConditions: 'Hết sưng đau hoàn toàn, siêu âm sợi gân phục hồi liên tục và bước đi bình thường.',
        requiresFollowUp: true,
        followUpDate: new Date(Date.now() + 12 * 24 * 3600 * 1000),
      },
    });

    await prisma.medicalLock.create({
      data: {
        horseId: medicalLockedHorseA.id,
        medicalRecordId: medRecordA.id,
        lockCode: 'KH-DEMO-01',
        veterinarianUserId: vet.id,
        lockedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
        expectedRestDays: 14,
        recheckDate: new Date(Date.now() + 12 * 24 * 3600 * 1000),
        appliedMedicalStatus: HorseStatus.INJURED,
        lockReason: 'Chấn thương gân chân trước bên phải sau bài tập nặng, chỉ định bất động',
        unlockConditions: 'Kiểm tra siêu âm sau 12 ngày và có xác nhận của Bác sĩ thú y',
        isLocked: true,
      },
    });

    await prisma.injuryLog.create({
      data: {
        horseId: medicalLockedHorseA.id,
        medicalRecordId: medRecordA.id,
        coordinateX: 0.65,
        coordinateY: 0.72,
        viewSide: 'RIGHT',
        layer: 'MUSCLE',
        anatomicalZone: 'Cổ chân trước',
        injuryType: 'Căng gân cơ (Tendon Strain)',
        bodySide: 'RIGHT',
        severity: SeverityLevel.MODERATE,
        status: InjuryStatus.ACTIVE,
        discoveryDate: new Date(Date.now() - 2 * 24 * 3600 * 1000),
        description: 'Chấn thương phát sinh khi bứt tốc ở 200m cuối sân cỏ.',
      },
    });

    await prisma.incidentReport.create({
      data: {
        incidentNumber: 'INC-20261125-0001',
        horseId: medicalLockedHorseA.id,
        stallZoneId: zoneA.id,
        reportedById: groom2.id,
        severity: SeverityLevel.MODERATE,
        symptomsJson: ['Sưng khớp', 'Đi khập khiễng', 'Nhiệt độ chân tăng'],
        description: 'Chiến mã Hắc Báo sau khi đưa về chuồng A-08 có biểu hiện nhấc chân trước bên phải, sờ vào thấy ấm nóng.',
        status: 'MERGED_INTO_TREATMENT',
        medicalRecordId: medRecordA.id,
        reviewedById: vet.id,
        reviewedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
        vetNotes: 'Đã chuyển thành hồ sơ bệnh án BA-2611-001 và kích hoạt Khóa y tế KH-DEMO-01.',
      },
    });
  }

  // 5.2. Khóa y tế cho Chiến Thần (HRS-DEMO-04)
  const medRecordB = await prisma.medicalRecord.create({
    data: {
      recordNumber: 'BA-2611-002',
      horseId: demoHorse4.id,
      veterinarianUserId: vet.id,
      status: MedicalRecordStatus.OPEN,
      examinationType: 'Viêm bao hoạt dịch',
      severity: SeverityLevel.MODERATE,
      symptoms: 'Viêm bao gân cổ chân sau bên trái.',
      clinicalDiagnosis: 'Bao hoạt dịch khớp cổ chân tích dịch nhẹ.',
      treatmentProtocol: 'Bôi gel lạnh kháng viêm, đi bộ thư giãn 15 phút/ngày.',
      proposeMedicalLock: true,
      lockExpectedRestDays: 10,
    },
  });

  await prisma.medicalLock.create({
    data: {
      horseId: demoHorse4.id,
      medicalRecordId: medRecordB.id,
      lockCode: 'KH-DEMO-02',
      veterinarianUserId: vet.id,
      lockedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
      expectedRestDays: 10,
      recheckDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      appliedMedicalStatus: HorseStatus.INJURED,
      lockReason: 'Viêm bao gân cổ chân sau bên trái, cần hồi phục',
      isLocked: true,
    },
  });

  // 5.3. Danh mục & Lịch phòng dịch định kỳ (Preventive Care)
  console.log('  -> Khởi tạo 4 danh mục phòng dịch & các lịch tiêm phòng, tẩy giun, móng...');
  const catVac = await prisma.preventiveTypeCatalog.create({
    data: {
      code: 'CAT-VAC-01',
      name: 'Tiêm phòng Cúm ngựa (Equine Influenza)',
      category: PreventiveType.VACCINATION,
      intervalDays: 180,
      advanceNoticeDays: 14,
      description: 'Tiêm vaccine phòng cúm định kỳ 6 tháng/lần cho toàn bộ ngựa đua.',
    },
  });

  const catDew = await prisma.preventiveTypeCatalog.create({
    data: {
      code: 'CAT-DEW-01',
      name: 'Tẩy giun đường ruột (Ivermectin Paste)',
      category: PreventiveType.DEWORMING,
      intervalDays: 90,
      advanceNoticeDays: 7,
      description: 'Cho uống thuốc tẩy giun đường tiêu hóa định kỳ 3 tháng/lần.',
    },
  });

  const catHoof = await prisma.preventiveTypeCatalog.create({
    data: {
      code: 'CAT-HOOF-01',
      name: 'Cạo móng & Thay móng sắt (Farrier Hoof Care)',
      category: PreventiveType.FARRIER_HOOF_CARE,
      intervalDays: 42,
      advanceNoticeDays: 5,
      description: 'Bảo dưỡng định hình móng và thay móng sắt thi đấu 6 tuần/lần.',
    },
  });

  const catDent = await prisma.preventiveTypeCatalog.create({
    data: {
      code: 'CAT-DENT-01',
      name: 'Kiểm tra nha khoa & Mài răng (Equine Dental)',
      category: PreventiveType.DENTAL,
      intervalDays: 365,
      advanceNoticeDays: 30,
      description: 'Mài chỉnh góc răng sắc nhọn chống loét miệng 1 năm/lần.',
    },
  });

  // 1 Lịch COMPLETED: Tiêm phòng cúm cho Phong Lôi (HR-DEMO-A01)
  const horseA1 = groom1Horses[0].horse;
  await prisma.preventiveSchedule.create({
    data: {
      horseId: horseA1.id,
      typeCatalogId: catVac.id,
      veterinarianUserId: vet.id,
      scheduleType: PreventiveType.VACCINATION,
      dueDate: new Date(Date.now() - 20 * 24 * 3600 * 1000),
      completedDate: new Date(Date.now() - 20 * 24 * 3600 * 1000),
      lastCompletedDate: new Date(Date.now() - 20 * 24 * 3600 * 1000),
      status: PreventiveStatus.COMPLETED,
      productAdministered: 'ProtecFlu Equine Vaccine',
      batchNumber: 'LOT-VAC-2026-99',
      notes: 'Ngựa phản ứng tốt, không sốt, tiếp tục theo dõi.',
    },
  });

  // 1 Lịch PENDING (Sắp đến hạn): Cạo móng cho Lão Tướng (HR-DEMO-A05)
  const horseA5 = groom2Horses[0].horse;
  await prisma.preventiveSchedule.create({
    data: {
      horseId: horseA5.id,
      typeCatalogId: catHoof.id,
      veterinarianUserId: vet.id,
      scheduleType: PreventiveType.FARRIER_HOOF_CARE,
      dueDate: new Date(Date.now() + 4 * 24 * 3600 * 1000),
      status: PreventiveStatus.PENDING,
      notes: 'Lịch định kỳ 6 tuần, kiểm tra độ mòn móng sắt chân trước.',
    },
  });

  // 1 Lịch OVERDUE (Quá hạn 5 ngày để Dashboard thú y báo đỏ): Tẩy giun cho Hắc Báo
  if (medicalLockedHorseA) {
    await prisma.preventiveSchedule.create({
      data: {
        horseId: medicalLockedHorseA.id,
        typeCatalogId: catDew.id,
        veterinarianUserId: vet.id,
        scheduleType: PreventiveType.DEWORMING,
        dueDate: new Date(Date.now() - 5 * 24 * 3600 * 1000),
        status: PreventiveStatus.OVERDUE,
        notes: 'CẢNH BÁO QUÁ HẠN: Cần cho uống thuốc tẩy giun định kỳ quý 4.',
      },
    });
  }

  // =========================================================================
  // 6. PHÂN HỆ VẬT TƯ & DINH DƯỠNG (SUPPLIES & NUTRITION)
  // =========================================================================
  console.log('🌾 [6/8] Khởi tạo kho vật tư, số dư tồn kho (StockBalance) và kế hoạch dinh dưỡng...');

  const supHay = await prisma.supplyCatalog.create({
    data: {
      code: 'SUP-HAY-01',
      name: 'Cỏ khô Alfalfa nhập khẩu Mỹ',
      category: SupplyCategory.FEED_HAY,
      unit: SupplyUnit.KG,
      unitPrice: new Prisma.Decimal(45000),
      description: 'Cỏ khô Alfalfa chất lượng cao giàu đạm và canxi.',
    },
  });

  const supGrain = await prisma.supplyCatalog.create({
    data: {
      code: 'SUP-GRAIN-01',
      name: 'Cám viên dinh dưỡng cao cấp SpeedFeed',
      category: SupplyCategory.FEED_GRAIN,
      unit: SupplyUnit.KG,
      unitPrice: new Prisma.Decimal(65000),
      description: 'Hỗn hợp ngũ cốc ép đùn bổ sung năng lượng cao cho ngựa đua.',
    },
  });

  const supElec = await prisma.supplyCatalog.create({
    data: {
      code: 'SUP-ELEC-01',
      name: 'Bột bù điện giải & khoáng chất ElectroBoost',
      category: SupplyCategory.SUPPLEMENT_ELECTROLYTE,
      unit: SupplyUnit.PACKET,
      unitPrice: new Prisma.Decimal(120000),
      description: 'Gói bột pha nước bù nước nhanh sau các bài tập nặng.',
    },
  });

  // Tồn kho Barn A & Barn B
  await prisma.stockBalance.create({
    data: {
      zoneId: zoneA.id,
      supplyId: supHay.id,
      quantity: new Prisma.Decimal(500),
      minThreshold: new Prisma.Decimal(100),
      capacity: new Prisma.Decimal(1000),
    },
  });
  await prisma.stockBalance.create({
    data: {
      zoneId: zoneA.id,
      supplyId: supGrain.id,
      quantity: new Prisma.Decimal(300),
      minThreshold: new Prisma.Decimal(80),
      capacity: new Prisma.Decimal(600),
    },
  });
  await prisma.stockBalance.create({
    data: {
      zoneId: zoneB.id,
      supplyId: supHay.id,
      quantity: new Prisma.Decimal(400),
      minThreshold: new Prisma.Decimal(100),
      capacity: new Prisma.Decimal(800),
    },
  });

  // Kế hoạch dinh dưỡng đã phê duyệt cho Phong Lôi
  await prisma.nutritionPlan.create({
    data: {
      planCode: 'DD-DEMO-01',
      horseId: horseA1.id,
      status: 'APPROVED',
      dailyFeedWeightKg: 8.0,
      targetWeightRatioPct: 1.7,
      mealsJson: {
        morning: { hayKg: 3.5, grainKg: 1.5, supplement: 'ElectroBoost 1 gói' },
        afternoon: { hayKg: 4.5, grainKg: 2.5, supplement: 'Men vi sinh đường ruột' },
      },
      createdById: trainerA.id,
      approvedById: manager.id,
      specialInstructions: 'Bổ sung thêm 10 lít nước điện giải sau mỗi buổi tập chạy tốc độ.',
    },
  });

  // =========================================================================
  // 7. PHÂN HỆ TÀI CHÍNH & HÓA ĐƠN (CHI PHÍ, HÓA ĐƠN, NỢ XẤU BAD DEBT)
  // =========================================================================
  console.log('💳 [7/8] Khởi tạo nhật ký chi phí nội trú và 3 hóa đơn mẫu (PAID, SENT, OVERDUE)...');

  // Hóa đơn 1: ĐÃ THANH TOÁN (PAID) tháng 10/2026
  await prisma.financialInvoice.create({
    data: {
      horseId: horseA1.id,
      ownerId: owner.id,
      billingPeriod: '2026-10',
      boardingMonthlyRate: new Prisma.Decimal(6000000),
      boardingDays: 31,
      boardingFee: new Prisma.Decimal(6000000),
      medicalFee: new Prisma.Decimal(1500000),
      trainingFee: new Prisma.Decimal(25000000),
      netAmount: new Prisma.Decimal(32500000),
      status: InvoiceStatus.PAID,
      paidAt: new Date('2026-10-25T10:30:00Z'),
      paymentMethod: 'Chuyển khoản Vietcombank',
      paymentRef: 'VCB-261025-99881',
      paidConfirmedById: manager.id,
      paidConfirmedByName: manager.fullName,
      dueAt: new Date('2026-11-05T00:00:00Z'),
    },
  });

  // Hóa đơn 2: ĐÃ GỬI CHỜ THANH TOÁN (SENT) tháng 11/2026
  await prisma.financialInvoice.create({
    data: {
      horseId: horseA1.id,
      ownerId: owner.id,
      billingPeriod: '2026-11',
      boardingMonthlyRate: new Prisma.Decimal(6000000),
      boardingDays: 30,
      boardingFee: new Prisma.Decimal(6000000),
      medicalFee: new Prisma.Decimal(4000000),
      trainingFee: new Prisma.Decimal(25000000),
      netAmount: new Prisma.Decimal(35000000),
      status: InvoiceStatus.SENT,
      dueAt: new Date(Date.now() + 8 * 24 * 3600 * 1000),
    },
  });

  // Hóa đơn 3: QUÁ HẠN > 30 NGÀY (OVERDUE) tháng 09/2026 -> Lý do kích hoạt Cờ Nợ Xấu (Bad Debt)
  await prisma.financialInvoice.create({
    data: {
      horseId: demoHorse1.id,
      ownerId: owner.id,
      billingPeriod: '2026-09',
      boardingMonthlyRate: new Prisma.Decimal(6000000),
      boardingDays: 30,
      boardingFee: new Prisma.Decimal(6000000),
      medicalFee: new Prisma.Decimal(2000000),
      trainingFee: new Prisma.Decimal(10000000),
      netAmount: new Prisma.Decimal(18000000),
      status: InvoiceStatus.OVERDUE,
      dueAt: new Date('2026-10-05T00:00:00Z'),
    },
  });

  // =========================================================================
  // 8. DỮ LIỆU CA TRỰC HÔM NAY & NHIỆM VỤ CHĂM SÓC GROOM
  // =========================================================================
  console.log('⏰ [8/8] Khởi tạo ca trực hôm nay (ShiftRoster), 4 nhiệm vụ chăm sóc/ngựa & ca tập HLV...');

  let shiftMorning = await prisma.shiftCatalog.findFirst({
    where: { name: { contains: 'Sáng', mode: 'insensitive' } },
  });
  if (!shiftMorning) {
    shiftMorning = await prisma.shiftCatalog.create({
      data: {
        code: 'SHIFT_MORNING',
        name: 'Ca Sáng',
        startTime: '06:00',
        endTime: '14:00',
        description: 'Ca chăm sóc & trực buổi sáng',
      },
    });
  }

  const groomProfiles = [
    { user: groom1, horses: groom1Horses, zone: zoneA, shiftNotes: 'Trực chính phân khu Barn A (Ô A-01 đến A-04, 4/6 ô)' },
    { user: groom2, horses: groom2Horses, zone: zoneA, shiftNotes: 'Trực hỗ trợ phân khu Barn A (Ô A-05 đến A-10, 6/6 ô đầy tải)' },
    { user: groom3, horses: groom3Horses, zone: zoneB, shiftNotes: 'Trực chính phân khu Barn B (Ô B-01 đến B-05, 5/6 ô)' },
  ];

  for (const gp of groomProfiles) {
    await prisma.shiftRoster.create({
      data: {
        groomUserId: gp.user.id,
        date: todayDate,
        shiftId: shiftMorning.id,
        zoneId: gp.zone.id,
        notes: gp.shiftNotes,
      },
    });

    const taskSchedule = [
      {
        title: 'Cho ăn cỏ khô Alfalfa & kiểm tra nước uống',
        time: '06:00',
        type: DailyTaskType.FEEDING,
        isCompleted: true,
        completedHour: 6,
        completedMinute: 20,
      },
      {
        title: 'Dọn chuồng, thay rơm lót & khử khuẩn ô chuồng',
        time: '08:30',
        type: DailyTaskType.CLEANING,
        isCompleted: true,
        completedHour: 8,
        completedMinute: 45,
      },
      {
        title: 'Chải lông, vệ sinh mắt mũi & cạo móng',
        time: '10:00',
        type: DailyTaskType.GROOMING,
        isCompleted: true,
        completedHour: 10,
        completedMinute: 30,
      },
      {
        title: 'Cho ăn thức ăn tinh & bổ sung khoáng chất ca chiều',
        time: '16:30',
        type: DailyTaskType.FEEDING,
        isCompleted: false,
      },
    ];

    let taskIndex = 1;
    for (const hItem of gp.horses) {
      for (const t of taskSchedule) {
        let completedAt: Date | null = null;
        if (t.isCompleted) {
          completedAt = new Date(todayDate);
          completedAt.setHours(t.completedHour!, t.completedMinute!, 0, 0);
        }
        await prisma.dailyCareTask.create({
          data: {
            taskCode: `TASK-${gp.user.email.split('@')[0].toUpperCase()}-${todayStr.replace(/-/g, '')}-${String(taskIndex).padStart(2, '0')}`,
            date: todayDate,
            assignedGroomUserId: gp.user.id,
            horseId: hItem.horse.id,
            stallZoneId: gp.zone.id,
            stallId: hItem.stall.id,
            taskType: t.type,
            title: `${t.title} (${hItem.horse.name})`,
            scheduledTime: t.time,
            isCompleted: t.isCompleted,
            completedAt,
            completedById: t.isCompleted ? gp.user.id : null,
          },
        });
        taskIndex++;
      }
    }
  }

  // Ca tập hôm nay của HLV A tuân thủ đệm an toàn >= 45 phút
  const activePlanA = await prisma.trainingPlan.findFirst({
    where: { trainerUserId: trainerA.id, status: PlanStatus.ACTIVE },
    include: { horse: true },
  });

  if (activePlanA) {
    // Ca 1: 07:00 - 07:45 (Sân Cỏ - TURF) cho Phong Lôi
    const workout1Time = new Date(`${todayStr}T07:00:00+07:00`);
    const planAPhaseId = (activePlanA.phases as any[])?.[0]?.id ?? `${activePlanA.planCode}-PH1`;
    await prisma.workoutSession.create({
      data: {
        trainingPlanId: activePlanA.id,
        phaseId: planAPhaseId,
        horseId: activePlanA.horseId,
        assignedStaffUserId: trainerA.id,
        scheduledDate: workout1Time,
        workoutType: 'CANTER',
        intensity: 'MEDIUM',
        trackSurface: TrackSurface.TURF,
        distanceMeters: 1400,
        repetitions: 1,
        status: WorkoutStatus.COMPLETED,
        performanceScore: 8.8,
        heartRatePeak: 188,
        heartRateRecovery: 96,
        resultRecordedAt: new Date(`${todayStr}T07:45:00+07:00`),
        trainerNotes: 'Bắt nhịp chạy tốt trên thảm cỏ, nhịp tim hồi phục ổn định.',
      },
    });

    // Ca 2: 08:30 - 09:15 (Sân Cát - DIRT) cho Tuyết Ảnh -> Cách Ca 1 kết thúc (07:45) đúng 45 phút đệm an toàn
    const horseA2 = groom1Horses[1]?.horse ?? activePlanA.horse;
    const planA2 = (await prisma.trainingPlan.findFirst({ where: { horseId: horseA2.id, status: PlanStatus.ACTIVE } })) ?? activePlanA;
    const planA2PhaseId = (planA2.phases as any[])?.[0]?.id ?? `${planA2.planCode}-PH1`;
    const workout2Time = new Date(`${todayStr}T08:30:00+07:00`);
    await prisma.workoutSession.create({
      data: {
        trainingPlanId: planA2.id,
        phaseId: planA2PhaseId,
        horseId: horseA2.id,
        assignedStaffUserId: trainerA.id,
        scheduledDate: workout2Time,
        workoutType: 'TROT',
        intensity: 'MEDIUM',
        trackSurface: TrackSurface.DIRT,
        distanceMeters: 1200,
        repetitions: 1,
        status: WorkoutStatus.SCHEDULED,
        trainerNotes: 'Chuyển sân cát sau 45 phút đệm an toàn, khởi động kỹ cổ chân.',
      },
    });

    // Ca 3: 15:30 - 16:15 (Sân Cát - DIRT) cho Lôi Chấn
    const horseA3 = groom1Horses[2]?.horse ?? activePlanA.horse;
    const planA3 = (await prisma.trainingPlan.findFirst({ where: { horseId: horseA3.id, status: PlanStatus.ACTIVE } })) ?? activePlanA;
    const planA3PhaseId = (planA3.phases as any[])?.[0]?.id ?? `${planA3.planCode}-PH1`;
    const workout3Time = new Date(`${todayStr}T15:30:00+07:00`);
    await prisma.workoutSession.create({
      data: {
        trainingPlanId: planA3.id,
        phaseId: planA3PhaseId,
        horseId: horseA3.id,
        assignedStaffUserId: trainerA.id,
        scheduledDate: workout3Time,
        workoutType: 'BREEZE',
        intensity: 'HIGH',
        trackSurface: TrackSurface.DIRT,
        distanceMeters: 1000,
        repetitions: 1,
        status: WorkoutStatus.SCHEDULED,
        trainerNotes: 'Bài tập tốc độ chiều trên sân cát.',
      },
    });

    // Ca 4: 17:00 - 17:45 (Sân Cỏ - TURF) cho Dạ Nguyệt -> Cách Ca 3 kết thúc (16:15) đúng 45 phút đệm an toàn
    const horseA4 = groom1Horses[3]?.horse ?? activePlanA.horse;
    const planA4 = (await prisma.trainingPlan.findFirst({ where: { horseId: horseA4.id, status: PlanStatus.ACTIVE } })) ?? activePlanA;
    const planA4PhaseId = (planA4.phases as any[])?.[0]?.id ?? `${planA4.planCode}-PH1`;
    const workout4Time = new Date(`${todayStr}T17:00:00+07:00`);
    await prisma.workoutSession.create({
      data: {
        trainingPlanId: planA4.id,
        phaseId: planA4PhaseId,
        horseId: horseA4.id,
        assignedStaffUserId: trainerA.id,
        scheduledDate: workout4Time,
        workoutType: 'WALK',
        intensity: 'LIGHT',
        trackSurface: TrackSurface.TURF,
        distanceMeters: 800,
        repetitions: 1,
        status: WorkoutStatus.SCHEDULED,
        trainerNotes: 'Đi bộ thư giãn trên thảm cỏ cuối ngày sau 45 phút đệm an toàn.',
      },
    });

    // Thêm các ca tập demo cho ngày mai (tomorrow) và ngày 2026-11-28 để test xung đột lịch HLV trong Timeline
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    const testDates = Array.from(new Set([tomorrowStr, '2026-11-28', '2026-11-29']));

    for (const dStr of testDates) {
      // HLV Tuấn: bận huấn luyện Tuyết Ảnh lúc 08:00 - 08:45
      await prisma.workoutSession.create({
        data: {
          trainingPlanId: planA2.id,
          phaseId: planA2PhaseId,
          horseId: horseA2.id,
          assignedStaffUserId: trainerA.id,
          scheduledDate: new Date(`${dStr}T08:00:00+07:00`),
          workoutType: 'CANTER',
          intensity: 'MEDIUM',
          trackSurface: TrackSurface.DIRT,
          distanceMeters: 1400,
          repetitions: 1,
          status: WorkoutStatus.SCHEDULED,
          trainerNotes: 'Ca tập sáng của Tuyết Ảnh - Demo phát hiện trùng lịch HLV',
        },
      });

      // HLV Tuấn: bận huấn luyện Lôi Chấn lúc 15:30 - 16:15
      await prisma.workoutSession.create({
        data: {
          trainingPlanId: planA3.id,
          phaseId: planA3PhaseId,
          horseId: horseA3.id,
          assignedStaffUserId: trainerA.id,
          scheduledDate: new Date(`${dStr}T15:30:00+07:00`),
          workoutType: 'BREEZE',
          intensity: 'HIGH',
          trackSurface: TrackSurface.DIRT,
          distanceMeters: 1000,
          repetitions: 1,
          status: WorkoutStatus.SCHEDULED,
          trainerNotes: 'Ca tập chiều của Lôi Chấn - Demo phát hiện trùng lịch HLV',
        },
      });
    }

    // HLV Quân cũng có ca huấn luyện Sấm Sét vào các ngày test
    const activePlanQuan = await prisma.trainingPlan.findFirst({
      where: { trainerUserId: trainerQuan.id, status: PlanStatus.ACTIVE },
      include: { horse: true },
    });
    if (activePlanQuan) {
      const planQuanPhaseId = (activePlanQuan.phases as any[])?.[0]?.id ?? `${activePlanQuan.planCode}-PH1`;
      for (const dStr of testDates) {
        await prisma.workoutSession.create({
          data: {
            trainingPlanId: activePlanQuan.id,
            phaseId: planQuanPhaseId,
            horseId: activePlanQuan.horseId,
            assignedStaffUserId: trainerQuan.id,
            scheduledDate: new Date(`${dStr}T08:30:00+07:00`),
            workoutType: 'TROT',
            intensity: 'MEDIUM',
            trackSurface: TrackSurface.TURF,
            distanceMeters: 1200,
            repetitions: 1,
            status: WorkoutStatus.SCHEDULED,
            trainerNotes: 'Ca tập sáng của Sấm Sét - Demo phát hiện trùng lịch HLV Quân',
          },
        });
      }
    }
  }

  console.log('========================================================================');
  console.log('✅ [seed-demo-flow] HOÀN TẤT SEED ATOMIC MASTER TOÀN HỆ THỐNG THÀNH CÔNG 100%!');
  console.log('------------------------------------------------------------------------');
  console.log('📋 THỐNG KÊ KẾT QUẢ ĐÃ THIẾT LẬP:');
  console.log('   - Khu chuồng (StallZone):    3 Barn hoạt động (Barn A: 12, Barn B: 12, Barn C: 12)');
  console.log('   - Huấn luyện viên (Trainer): Barn A (2/2 HLV: Tuấn 8/8, Quân 2/8); Barn B (2/2 HLV: Nam 4/8, Trung 3/8); Barn C (0 HLV)');
  console.log('   - Nhân viên Groom:           Barn A (2/4 Groom: Mai 4/6 ô, Phúc 6/6 ô đầy tải); Barn B (2/4 Groom: Mai 5/6 ô, Tuấn Đang mời); Barn C (0 Groom)');
  console.log('   - Đàn chiến mã:              20 chiến mã (12 đang tập, 2 khóa y tế, 2 chờ giáo án/SLA, 2 đăng ký tiếp nhận ADM)');
  console.log('   - Y tế & Phòng bệnh:         4 danh mục, 1 khóa y tế, 1 bệnh án, 1 sự cố, 3 lịch phòng bệnh (1 Đạt, 1 Chờ, 1 Quá hạn)');
  console.log('   - Tài chính & Hóa đơn:       3 hóa đơn mẫu (1 PAID, 1 SENT, 1 OVERDUE >30 ngày kích hoạt Cờ Nợ Xấu)');
  console.log('   - Ca trực & Nhiệm vụ Groom:  3 Groom có ca trực sáng, mỗi chiến mã có đúng 4 đầu việc chuẩn');
  console.log('------------------------------------------------------------------------');
  console.log('🔑 THÔNG TIN ĐĂNG NHẬP (Mật khẩu chung: EquiFlow@2026):');
  console.log('   - Quản lý CLB:     manager@gmail.com  (Nguyễn Hoàng Long)');
  console.log('   - HLV Trưởng Barn A: trainer@gmail.com (Nguyễn Văn Tuấn - Đầy tải 8/8)');
  console.log('   - HLV Barn A:      trainer.quan@gmail.com (Trần Minh Quân - 2/8 ngựa)');
  console.log('   - HLV Barn B:      trainer2@gmail.com (Lê Hoàng Nam - 4/8 ngựa)');
  console.log('   - HLV Barn B:      trainer3@gmail.com (Phạm Quốc Trung - 3/8 ngựa)');
  console.log('   - Groom Barn A:    groom@gmail.com (Trần Thị Mai - 4/6 ô)');
  console.log('   - Groom Barn A:    groom2@gmail.com (Hoàng Văn Phúc - 6/6 ô)');
  console.log('   - Groom Barn B:    groom3@gmail.com (Đỗ Thị Mai - 5/6 ô)');
  console.log('   - Groom Barn B:    groom4@gmail.com (Lê Quốc Tuấn - Đang mời)');
  console.log('   - Bác sĩ Thú y:    vet@gmail.com (BS. Hoàng Thị Mai)');
  console.log('   - Chủ ngựa:        owner@gmail.com (Robert Sterling - Có cờ Nợ xấu)');
  console.log('========================================================================');
}

main()
  .catch((e) => {
    console.error('❌ Lỗi seed demo:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
