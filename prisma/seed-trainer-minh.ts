import {
  PrismaClient,
  Role,
  UserStatus,
  HorseStatus,
  StallStatus,
  PlanStatus,
  WorkoutStatus,
  TrainerAssignmentStatus,
  TrackSurface,
  HandoverStatus,
  MedicalLockSource,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('=== BẮT ĐẦU CẤU HÌNH TOÀN DIỆN CHO TÀI KHOẢN HLV MINH ===');
  console.log('Email: trainer.minh@gmail.com');
  console.log('Mật khẩu: Minhmaiki456@');

  const passwordHash = await bcrypt.hash('Minhmaiki456@', 10);
  const now = new Date();

  // Các mốc ngày để kiểm thử:
  // 1. Ngày hôm nay
  const todayStr = now.toISOString().split('T')[0];
  // 2. Ngày mai
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  // Ngày demo cố định theo giao diện giáo án (2026-11-28 và 2026-11-29) nằm trong khung thời gian hợp lệ
  const targetDemoDates = ['2026-11-28', '2026-11-29'];

  // 1. Kiểm tra hoặc tạo các tài khoản liên kết (Manager, Vet, Groom, Owner)
  console.log('[1/7] Thiết lập các tài khoản liên quan...');
  const manager = await prisma.user.findFirst({
    where: { role: Role.CLUB_MANAGER },
  });
  if (!manager) {
    throw new Error('Chưa có tài khoản CLUB_MANAGER trong hệ thống!');
  }

  const vet = await prisma.user.findFirst({
    where: { role: Role.VETERINARIAN },
  });
  if (!vet) {
    throw new Error('Chưa có tài khoản VETERINARIAN trong hệ thống!');
  }

  const groom = await prisma.user.findFirst({
    where: { role: Role.GROOM },
  });
  if (!groom) {
    throw new Error('Chưa có tài khoản GROOM trong hệ thống!');
  }

  const owner = await prisma.user.findFirst({
    where: { role: Role.HORSE_OWNER },
  });
  if (!owner) {
    throw new Error('Chưa có tài khoản HORSE_OWNER trong hệ thống!');
  }

  // 2. Thiết lập Barn A và Barn C
  console.log('[2/7] Xác nhận Khu chuồng Barn A và Barn C...');
  const barnA = await prisma.stallZone.upsert({
    where: { code: 'BARN-A' },
    update: { isActive: true, rows: 5, cols: 3 },
    create: {
      code: 'BARN-A',
      name: 'Barn A',
      rows: 5,
      cols: 3,
      isActive: true,
      description: 'Khu chuồng chính A',
    },
  });

  const barnC = await prisma.stallZone.upsert({
    where: { code: 'BARN-C' },
    update: { isActive: true },
    create: {
      code: 'BARN-C',
      name: 'Barn C',
      rows: 4,
      cols: 3,
      isActive: true,
      description: 'Khu chuồng biệt lập C',
    },
  });

  // Tạo / Cập nhật các ô chuồng cho 7 chiến mã của HLV Minh tại Barn A: A-09 đến A-15
  const stallCodes = ['A-09', 'A-10', 'A-11', 'A-12', 'A-13', 'A-14', 'A-15'];
  const stallsMap: Record<string, any> = {};
  for (let i = 0; i < stallCodes.length; i++) {
    const code = stallCodes[i];
    const num = parseInt(code.replace('A-', ''), 10);
    const s = await prisma.stall.upsert({
      where: { code },
      update: {
        zoneId: barnA.id,
        zone: 'Barn A',
        status: StallStatus.OCCUPIED,
      },
      create: {
        code,
        zone: 'Barn A',
        zoneId: barnA.id,
        status: StallStatus.OCCUPIED,
        row: Math.ceil(num / 3),
        col: ((num - 1) % 3) + 1,
      },
    });
    stallsMap[code] = s;
  }

  // Chuồng C-01 cho Hắc Long Mã (chờ bàn giao)
  const stallC01 = await prisma.stall.upsert({
    where: { code: 'C-01' },
    update: {
      zoneId: barnC.id,
      zone: 'Barn C',
      status: StallStatus.OCCUPIED,
    },
    create: {
      code: 'C-01',
      zone: 'Barn C',
      zoneId: barnC.id,
      status: StallStatus.OCCUPIED,
      row: 1,
      col: 1,
    },
  });

  // 3. Khởi tạo tài khoản Huấn luyện viên Lê Văn Minh
  console.log('[3/7] Khởi tạo tài khoản HLV Lê Văn Minh (trainer.minh@gmail.com)...');
  const trainerMinh = await prisma.user.upsert({
    where: { email: 'trainer.minh@gmail.com' },
    update: {
      passwordHash,
      status: UserStatus.ACTIVE,
      fullName: 'Lê Văn Minh',
      role: Role.HEAD_TRAINER,
      phoneNumber: '0908889999',
    },
    create: {
      email: 'trainer.minh@gmail.com',
      passwordHash,
      fullName: 'Lê Văn Minh',
      role: Role.HEAD_TRAINER,
      status: UserStatus.ACTIVE,
      phoneNumber: '0908889999',
    },
  });

  // 4. Lấy sân tập thể lực TRK-TURF-A và TRK-DIRT-01
  console.log('[4/7] Xác nhận đường chạy thể lực...');
  const trackTurfA = await prisma.trainingTrack.findFirst({
    where: { surface: 'TURF', isActive: true },
  });
  const trackDirt = await prisma.trainingTrack.findFirst({
    where: { surface: 'DIRT', isActive: true },
  });

  // 5. Cấu hình đúng 7 chiến mã trực tiếp cho HLV Minh (7/8 tải định mức chuẩn, KHÔNG 9/8)
  console.log('[5/7] Khởi tạo và phân công đúng 7 chiến mã trực tiếp cho HLV Minh (7/8 tải)...');

  // Helper xóa phân bổ chuồng cũ để gán mới an toàn (để trống assignedGroomUserId để không làm quá tải định mức Groom)
  const assignStall = async (horseId: string, stallId: string) => {
    await prisma.stallAllocation.deleteMany({ where: { horseId } });
    await prisma.stallAllocation.create({
      data: {
        stallId,
        horseId,
        assignedGroomUserId: null,
        isActive: true,
      },
    });
  };

  // Ngựa 1: Bạch Long Mã (HRS-BLM-01) - Đang tập, Gây bận Ca Sáng (08:00 - 08:45)
  const bachLongMa = await prisma.horse.upsert({
    where: { horseCode: 'HRS-BLM-01' },
    update: {
      name: 'Bạch Long Mã',
      status: HorseStatus.IN_TRAINING,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
    create: {
      horseCode: 'HRS-BLM-01',
      name: 'Bạch Long Mã',
      breed: 'Thoroughbred',
      dob: new Date('2021-05-10'),
      gender: 'Stallion',
      color: 'Gray',
      weightKg: 495,
      microchip: '985141000111111',
      microchipRfid: 'RFID-BLM-111111',
      avatarUrl: '/images/horses/horse-01.jpg',
      status: HorseStatus.IN_TRAINING,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
  });
  await assignStall(bachLongMa.id, stallsMap['A-11'].id);

  // Ngựa 2: Xích Thổ (HRS-XT-01) - Đang tập, Gây bận Ca Chiều (15:30 - 16:15)
  const xichTho = await prisma.horse.upsert({
    where: { horseCode: 'HRS-XT-01' },
    update: {
      name: 'Xích Thổ',
      status: HorseStatus.IN_TRAINING,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
    create: {
      horseCode: 'HRS-XT-01',
      name: 'Xích Thổ',
      breed: 'Thoroughbred',
      dob: new Date('2021-06-15'),
      gender: 'Colt',
      color: 'Chestnut',
      weightKg: 512,
      microchip: '985141000222222',
      microchipRfid: 'RFID-XT-222222',
      avatarUrl: '/images/horses/horse-02.jpg',
      status: HorseStatus.IN_TRAINING,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
  });
  await assignStall(xichTho.id, stallsMap['A-09'].id);

  // Ngựa 3: Phi Tiêu (HRS-PT-02) - Đang tập, Dùng để test popup "Sinh lịch buổi tập"
  const phiTieu = await prisma.horse.upsert({
    where: { horseCode: 'HRS-PT-02' },
    update: {
      name: 'Phi Tiêu',
      status: HorseStatus.IN_TRAINING,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
    create: {
      horseCode: 'HRS-PT-02',
      name: 'Phi Tiêu',
      breed: 'Thoroughbred',
      dob: new Date('2021-08-20'),
      gender: 'Filly',
      color: 'Bay',
      weightKg: 485,
      microchip: '985141000333333',
      microchipRfid: 'RFID-PT-333333',
      avatarUrl: '/images/horses/horse-03.jpg',
      status: HorseStatus.IN_TRAINING,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
  });
  await assignStall(phiTieu.id, stallsMap['A-10'].id);

  // Ngựa 4: Thanh Phong (HRS-MINH-04) - Nghỉ ngơi (Vừa hoàn thành giáo án)
  const thanhPhong = await prisma.horse.upsert({
    where: { horseCode: 'HRS-MINH-04' },
    update: {
      name: 'Thanh Phong',
      status: HorseStatus.RESTING,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
    create: {
      horseCode: 'HRS-MINH-04',
      name: 'Thanh Phong',
      breed: 'Quarter Horse',
      dob: new Date('2022-01-15'),
      gender: 'Gelding',
      color: 'Brown',
      weightKg: 490,
      microchip: '985141000444444',
      microchipRfid: 'RFID-MINH-444444',
      avatarUrl: '/images/horses/horse-04.jpg',
      status: HorseStatus.RESTING,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
  });
  await assignStall(thanhPhong.id, stallsMap['A-12'].id);

  // Ngựa 5: Huyết Long (HRS-MINH-05) - Nghỉ ngơi (Vừa hủy giáo án)
  const huyetLong = await prisma.horse.upsert({
    where: { horseCode: 'HRS-MINH-05' },
    update: {
      name: 'Huyết Long',
      status: HorseStatus.RESTING,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
    create: {
      horseCode: 'HRS-MINH-05',
      name: 'Huyết Long',
      breed: 'Thoroughbred',
      dob: new Date('2022-02-18'),
      gender: 'Colt',
      color: 'Dark Bay',
      weightKg: 505,
      microchip: '985141000555555',
      microchipRfid: 'RFID-MINH-555555',
      avatarUrl: '/images/horses/horse-05.jpg',
      status: HorseStatus.RESTING,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
  });
  await assignStall(huyetLong.id, stallsMap['A-13'].id);

  // Ngựa 6: Kim Long (HRS-MINH-06) - Chấn thương / Khóa y tế
  const kimLong = await prisma.horse.upsert({
    where: { horseCode: 'HRS-MINH-06' },
    update: {
      name: 'Kim Long',
      status: HorseStatus.INJURED,
      isMedicalLocked: true,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
    create: {
      horseCode: 'HRS-MINH-06',
      name: 'Kim Long',
      breed: 'Thoroughbred',
      dob: new Date('2021-11-05'),
      gender: 'Stallion',
      color: 'Palomino',
      weightKg: 515,
      microchip: '985141000666666',
      microchipRfid: 'RFID-MINH-666666',
      avatarUrl: '/images/horses/horse-06.jpg',
      status: HorseStatus.INJURED,
      isMedicalLocked: true,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
  });
  await assignStall(kimLong.id, stallsMap['A-14'].id);

  // Tạo khóa y tế cho Kim Long từ Bác sĩ Thảo
  await prisma.medicalLock.deleteMany({ where: { horseId: kimLong.id } });
  await prisma.medicalLock.create({
    data: {
      lockCode: 'KH-MINH-06',
      horseId: kimLong.id,
      veterinarianUserId: vet.id,
      source: MedicalLockSource.VET,
      lockedAt: new Date(),
      expectedRestDays: 14,
      recheckDate: new Date(Date.now() + 14 * 86400000),
      appliedMedicalStatus: HorseStatus.INJURED,
      lockReason: 'Viêm gân cổ chân sau trái, yêu cầu nghỉ ngơi phục hồi tối thiểu 14 ngày.',
      isLocked: true,
    },
  });

  // Ngựa 7: Thần Mã (HRS-MINH-07) - Sẵn sàng thi đấu
  const thanMa = await prisma.horse.upsert({
    where: { horseCode: 'HRS-MINH-07' },
    update: {
      name: 'Thần Mã',
      status: HorseStatus.ACTIVE,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
    create: {
      horseCode: 'HRS-MINH-07',
      name: 'Thần Mã',
      breed: 'Arabian',
      dob: new Date('2020-09-10'),
      gender: 'Stallion',
      color: 'Black',
      weightKg: 475,
      microchip: '985141000777777',
      microchipRfid: 'RFID-MINH-777777',
      avatarUrl: '/images/horses/horse-07.jpg',
      status: HorseStatus.ACTIVE,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: trainerMinh.id,
      trainerAssignmentStatus: TrainerAssignmentStatus.ASSIGNED,
    },
  });
  await assignStall(thanMa.id, stallsMap['A-15'].id);

  // Ngựa 8: Hắc Long Mã (HRS-HLM-99) - CHƯA PHÂN CÔNG (UNASSIGNED) tại chuồng C-01, chờ bàn giao SLA
  const hacLongMa = await prisma.horse.upsert({
    where: { horseCode: 'HRS-HLM-99' },
    update: {
      name: 'Hắc Long Mã',
      status: HorseStatus.ACTIVE,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: null,
      trainerAssignmentStatus: TrainerAssignmentStatus.UNASSIGNED,
    },
    create: {
      horseCode: 'HRS-HLM-99',
      name: 'Hắc Long Mã',
      breed: 'Thoroughbred',
      dob: new Date('2022-03-15'),
      gender: 'Colt',
      color: 'Black',
      weightKg: 510,
      microchip: '985141000999999',
      microchipRfid: 'RFID-HLM-999999',
      avatarUrl: '/images/horses/horse-08.jpg',
      status: HorseStatus.ACTIVE,
      isMedicalLocked: false,
      ownerId: owner.id,
      assignedTrainerId: null,
      trainerAssignmentStatus: TrainerAssignmentStatus.UNASSIGNED,
    },
  });
  await assignStall(hacLongMa.id, stallC01.id);

  // Tạo yêu cầu bàn giao SLA cho Hắc Long Mã gửi tới HLV Minh (SLA 36h)
  await prisma.horseHandoverRequest.deleteMany({ where: { horseId: hacLongMa.id } });
  await prisma.horseHandoverRequest.create({
    data: {
      horseId: hacLongMa.id,
      fromManagerId: manager.id,
      toTrainerId: trainerMinh.id,
      status: HandoverStatus.PENDING,
      token: 'token-pending-minh-sla-01',
      expiresAt: new Date(Date.now() + 36 * 3600 * 1000),
      notes: 'Phân công chiến mã Hắc Long Mã cho HLV Minh tiếp nhận (SLA 36h). Khi nhận sẽ đạt 8/8 chiến mã.',
    },
  });

  // 6. Cấu hình Giáo án & Buổi tập xung đột cho HLV Minh
  console.log('[6/7] Khởi tạo giáo án và buổi tập xung đột lịch HLV...');

  // Dọn sạch buổi tập cũ của các ngựa này và của HLV Minh để tránh rác
  await prisma.workoutSession.deleteMany({
    where: {
      OR: [
        { horseId: { in: [bachLongMa.id, xichTho.id, phiTieu.id, thanhPhong.id, huyetLong.id, kimLong.id, thanMa.id] } },
        { assignedStaffUserId: trainerMinh.id },
      ],
    },
  });
  await prisma.trainingPlan.deleteMany({
    where: {
      OR: [
        { horseId: { in: [bachLongMa.id, xichTho.id, phiTieu.id, thanhPhong.id, huyetLong.id, kimLong.id, thanMa.id] } },
        { trainerUserId: trainerMinh.id },
      ],
    },
  });

  // Giáo án 1: Bạch Long Mã - Đang chạy (Active)
  const planBachLongMa = await prisma.trainingPlan.create({
    data: {
      planCode: 'GA-MINH-BLM',
      horseId: bachLongMa.id,
      trainerUserId: trainerMinh.id,
      phaseName: 'Giai đoạn thể lực cơ bản',
      objective: 'Tăng cường sức bền nền tảng trên mặt sân cỏ.',
      status: PlanStatus.ACTIVE,
      trackSurface: TrackSurface.TURF,
      startDate: new Date('2026-11-28T00:00:00.000Z'),
      endDate: new Date('2026-12-12T00:00:00.000Z'),
      phases: [
        {
          id: 'PH-BLM-01',
          name: 'Giai đoạn 1: Thể lực cơ bản',
          type: 'BASE',
          focus: 'BASE',
          startDate: '2026-11-28',
          endDate: '2026-12-12',
          durationDays: 14,
          sessionsPerWeek: 4,
          maxWeeklyDistance: 8000,
          surface: 'TURF',
          targetSpeedKmh: 48,
          targetDistanceM: 1400,
        },
      ],
    },
  });

  // Giáo án 2: Xích Thổ - Đang chạy (Active)
  const planXichTho = await prisma.trainingPlan.create({
    data: {
      planCode: 'GA-MINH-XT',
      horseId: xichTho.id,
      trainerUserId: trainerMinh.id,
      phaseName: 'Giai đoạn thể lực nâng cao',
      objective: 'Rèn luyện cơ đùi và bứt tốc cự ly 1200m trên sân cát.',
      status: PlanStatus.ACTIVE,
      trackSurface: TrackSurface.DIRT,
      startDate: new Date('2026-11-28T00:00:00.000Z'),
      endDate: new Date('2026-12-12T00:00:00.000Z'),
      phases: [
        {
          id: 'PH-XT-01',
          name: 'Giai đoạn 1: Thể lực nâng cao',
          type: 'BUILD',
          focus: 'BUILD',
          startDate: '2026-11-28',
          endDate: '2026-12-12',
          durationDays: 14,
          sessionsPerWeek: 4,
          maxWeeklyDistance: 7000,
          surface: 'DIRT',
          targetSpeedKmh: 58,
          targetDistanceM: 1200,
        },
      ],
    },
  });

  // Giáo án 3: Phi Tiêu - Đang chạy (Giai đoạn 1: 2026-11-28 -> 2026-12-04, 0 buổi tập để HLV Minh bấm sinh lịch)
  await prisma.trainingPlan.create({
    data: {
      planCode: 'GA-MINH-PT',
      horseId: phiTieu.id,
      trainerUserId: trainerMinh.id,
      phaseName: 'Giai đoạn 1: Nền tảng',
      objective: 'Làm quen nhịp chạy và duy trì cự ly ngắn 1000m.',
      status: PlanStatus.ACTIVE,
      trackSurface: TrackSurface.TURF,
      startDate: new Date('2026-11-28T00:00:00.000Z'),
      endDate: new Date('2026-12-04T00:00:00.000Z'),
      phases: [
        {
          id: 'PH-PT-01',
          name: 'Giai đoạn 1: Nền tảng',
          type: 'BASE',
          focus: 'BASE',
          startDate: '2026-11-28',
          endDate: '2026-12-04',
          durationDays: 7,
          sessionsPerWeek: 5,
          maxWeeklyDistance: 8000,
          surface: 'TURF',
          targetSpeedKmh: 45,
          targetDistanceM: 1000,
        },
      ],
    },
  });

  // Giáo án 4: Huyết Long - Bản nháp (DRAFT) để demo nút "Kích hoạt giáo án"
  const planHuyetLong = await prisma.trainingPlan.create({
    data: {
      planCode: 'GA-MINH-HL',
      horseId: huyetLong.id,
      trainerUserId: trainerMinh.id,
      phaseName: 'Giáo án Phục hồi sau dưỡng sức',
      objective: 'Phục hồi cơ bắp và thích nghi nhẹ nhàng với bài tập đi bộ cự ly ngắn.',
      status: PlanStatus.DRAFT,
      trackSurface: TrackSurface.TURF,
      startDate: new Date('2026-11-30T00:00:00.000Z'),
      endDate: new Date('2026-12-14T00:00:00.000Z'),
      phases: [
        {
          id: 'PH-HL-01',
          name: 'Giai đoạn 1: Phục hồi nhẹ',
          type: 'RECOVERY',
          focus: 'RECOVERY',
          startDate: '2026-11-30',
          endDate: '2026-12-14',
          durationDays: 14,
          sessionsPerWeek: 3,
          maxWeeklyDistance: 5000,
          surface: 'TURF',
          targetSpeedKmh: 35,
          targetDistanceM: 800,
        },
      ],
    },
  });

  // Buổi tập dự kiến cho bản nháp Huyết Long (thuộc phase PH-HL-01)
  await prisma.workoutSession.createMany({
    data: [
      {
        trainingPlanId: planHuyetLong.id,
        phaseId: 'PH-HL-01',
        horseId: huyetLong.id,
        trackId: trackTurfA?.id,
        assignedStaffUserId: trainerMinh.id,
        jockeyName: trainerMinh.fullName,
        scheduledDate: new Date('2026-11-30T09:00:00+07:00'),
        workoutType: 'WALK',
        intensity: 'LIGHT',
        trackSurface: TrackSurface.TURF,
        distanceMeters: 800,
        repetitions: 1,
        targetSpeedKmh: 35,
        status: WorkoutStatus.SCHEDULED,
        trainerNotes: 'Đi bộ thả lỏng phục hồi cơ đùi',
      },
      {
        trainingPlanId: planHuyetLong.id,
        phaseId: 'PH-HL-01',
        horseId: huyetLong.id,
        trackId: trackTurfA?.id,
        assignedStaffUserId: trainerMinh.id,
        jockeyName: trainerMinh.fullName,
        scheduledDate: new Date('2026-12-02T09:00:00+07:00'),
        workoutType: 'WALK',
        intensity: 'LIGHT',
        trackSurface: TrackSurface.TURF,
        distanceMeters: 800,
        repetitions: 1,
        targetSpeedKmh: 35,
        status: WorkoutStatus.SCHEDULED,
        trainerNotes: 'Đi bộ thả lỏng nhịp nhàng',
      },
    ],
  });

  // Giáo án 5: Thần Mã - Đã hoàn thành (COMPLETED, tiến độ 100% 4/4 buổi)
  const planThanMa = await prisma.trainingPlan.create({
    data: {
      planCode: 'GA-MINH-TM',
      horseId: thanMa.id,
      trainerUserId: trainerMinh.id,
      phaseName: 'Giáo án Hoàn thiện tốc độ thi đấu',
      objective: 'Bứt tốc nước rút 1600m và kiểm soát nhịp tim đỉnh cao.',
      status: PlanStatus.COMPLETED,
      completionSummary: 'Chiến mã hoàn thành xuất sắc 100% giáo án, chỉ số tim mạch và tốc độ đạt chuẩn thi đấu.',
      trackSurface: TrackSurface.TURF,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-11-15T00:00:00.000Z'),
      phases: [
        {
          id: 'PH-TM-01',
          name: 'Giai đoạn 1: Bứt tốc nước rút',
          type: 'SPEED',
          focus: 'SPEED',
          startDate: '2026-10-01',
          endDate: '2026-11-15',
          durationDays: 45,
          sessionsPerWeek: 4,
          maxWeeklyDistance: 6000,
          surface: 'TURF',
          targetSpeedKmh: 60,
          targetDistanceM: 1600,
        },
      ],
    },
  });

  // 4 buổi tập quá khứ ĐÃ HOÀN THÀNH cho Thần Mã (đều gắn phaseId: 'PH-TM-01')
  await prisma.workoutSession.createMany({
    data: [
      {
        trainingPlanId: planThanMa.id,
        phaseId: 'PH-TM-01',
        horseId: thanMa.id,
        trackId: trackTurfA?.id,
        assignedStaffUserId: trainerMinh.id,
        jockeyName: trainerMinh.fullName,
        scheduledDate: new Date('2026-10-10T08:00:00+07:00'),
        workoutType: 'CANTER',
        intensity: 'MEDIUM',
        trackSurface: TrackSurface.TURF,
        distanceMeters: 1600,
        actualDistanceMeters: 1600,
        repetitions: 1,
        targetSpeedKmh: 58,
        actualTimeSeconds: 101.5,
        averageSpeedKmh: 56.7,
        topSpeedKmh: 58.2,
        heartRatePeak: 182,
        heartRateRecovery: 95,
        performanceScore: 8.8,
        status: WorkoutStatus.COMPLETED,
        resultRecordedAt: new Date('2026-10-10T09:00:00+07:00'),
        trainerNotes: 'Chạy đà ổn định, nhịp thở đều.',
      },
      {
        trainingPlanId: planThanMa.id,
        phaseId: 'PH-TM-01',
        horseId: thanMa.id,
        trackId: trackTurfA?.id,
        assignedStaffUserId: trainerMinh.id,
        jockeyName: trainerMinh.fullName,
        scheduledDate: new Date('2026-10-20T08:00:00+07:00'),
        workoutType: 'BREEZE',
        intensity: 'HEAVY',
        trackSurface: TrackSurface.TURF,
        distanceMeters: 1600,
        actualDistanceMeters: 1600,
        repetitions: 1,
        targetSpeedKmh: 60,
        actualTimeSeconds: 98.6,
        averageSpeedKmh: 58.4,
        topSpeedKmh: 60.1,
        heartRatePeak: 185,
        heartRateRecovery: 92,
        performanceScore: 9.0,
        status: WorkoutStatus.COMPLETED,
        resultRecordedAt: new Date('2026-10-20T09:00:00+07:00'),
        trainerNotes: 'Tăng tốc nước rút tốt, giữ vững nhịp tim.',
      },
      {
        trainingPlanId: planThanMa.id,
        phaseId: 'PH-TM-01',
        horseId: thanMa.id,
        trackId: trackTurfA?.id,
        assignedStaffUserId: trainerMinh.id,
        jockeyName: trainerMinh.fullName,
        scheduledDate: new Date('2026-10-30T08:00:00+07:00'),
        workoutType: 'BREEZE',
        intensity: 'HEAVY',
        trackSurface: TrackSurface.TURF,
        distanceMeters: 1600,
        actualDistanceMeters: 1600,
        repetitions: 1,
        targetSpeedKmh: 60,
        actualTimeSeconds: 96.3,
        averageSpeedKmh: 59.8,
        topSpeedKmh: 61.5,
        heartRatePeak: 188,
        heartRateRecovery: 90,
        performanceScore: 9.3,
        status: WorkoutStatus.COMPLETED,
        resultRecordedAt: new Date('2026-10-30T09:00:00+07:00'),
        trainerNotes: 'Bứt phá xuất sắc ở 400m cuối.',
      },
      {
        trainingPlanId: planThanMa.id,
        phaseId: 'PH-TM-01',
        horseId: thanMa.id,
        trackId: trackTurfA?.id,
        assignedStaffUserId: trainerMinh.id,
        jockeyName: trainerMinh.fullName,
        scheduledDate: new Date('2026-11-10T08:00:00+07:00'),
        workoutType: 'BREEZE',
        intensity: 'HEAVY',
        trackSurface: TrackSurface.TURF,
        distanceMeters: 1600,
        actualDistanceMeters: 1600,
        repetitions: 1,
        targetSpeedKmh: 62,
        actualTimeSeconds: 94.1,
        averageSpeedKmh: 61.2,
        topSpeedKmh: 63.0,
        heartRatePeak: 190,
        heartRateRecovery: 88,
        performanceScore: 9.5,
        status: WorkoutStatus.COMPLETED,
        resultRecordedAt: new Date('2026-11-10T09:00:00+07:00'),
        trainerNotes: 'Đạt đỉnh phong độ, sẵn sàng tham gia giải đua.',
      },
    ],
  });

  // Tạo các buổi tập xung đột lịch HLV Minh trên các ngày:
  // - Bạch Long Mã: 08:00 - 08:45 (Sân Cỏ A)
  // - Xích Thổ: 15:30 - 16:15 (Sân Cát)
  for (const dStr of targetDemoDates) {
    // Ca sáng: 08:00 - 08:45 (Bạch Long Mã)
    await prisma.workoutSession.create({
      data: {
        trainingPlanId: planBachLongMa.id,
        phaseId: 'PH-BLM-01',
        horseId: bachLongMa.id,
        trackId: trackTurfA?.id,
        assignedStaffUserId: trainerMinh.id,
        jockeyName: trainerMinh.fullName,
        scheduledDate: new Date(`${dStr}T08:00:00+07:00`),
        workoutType: 'CANTER',
        intensity: 'MEDIUM',
        trackSurface: TrackSurface.TURF,
        distanceMeters: 1400,
        repetitions: 1,
        targetSpeedKmh: 48,
        status: WorkoutStatus.SCHEDULED,
        trainerNotes: 'Bài tập sáng của Bạch Long Mã - Huấn luyện viên bận',
      },
    });

    // Ca chiều: 15:30 - 16:15 (Xích Thổ)
    await prisma.workoutSession.create({
      data: {
        trainingPlanId: planXichTho.id,
        phaseId: 'PH-XT-01',
        horseId: xichTho.id,
        trackId: trackDirt?.id,
        assignedStaffUserId: trainerMinh.id,
        jockeyName: trainerMinh.fullName,
        scheduledDate: new Date(`${dStr}T15:30:00+07:00`),
        workoutType: 'BREEZE',
        intensity: 'HEAVY',
        trackSurface: TrackSurface.DIRT,
        distanceMeters: 1200,
        repetitions: 1,
        targetSpeedKmh: 58,
        status: WorkoutStatus.SCHEDULED,
        trainerNotes: 'Bài tập chiều của Xích Thổ - Huấn luyện viên bận',
      },
    });
  }

  // 7. Tổng kết và kiểm tra định mức (Capacity Validation)
  console.log('[7/7] Kiểm tra tính toàn vẹn và định mức...');
  const assignedHorsesCount = await prisma.horse.count({
    where: { assignedTrainerId: trainerMinh.id },
  });

  console.log('----------------------------------------------------');
  console.log(`✅ Cấu hình hoàn tất thành công!`);
  console.log(`👤 Tài khoản: ${trainerMinh.email}`);
  console.log(`🔑 Mật khẩu: Minhmaiki456@`);
  console.log(`🏷️ Họ tên: ${trainerMinh.fullName} (HEAD_TRAINER)`);
  console.log(`🐎 Định mức chiến mã quản lý trực tiếp: ${assignedHorsesCount} / 8`);
  if (assignedHorsesCount > 8) {
    throw new Error(`VI PHẠM ĐỊNH MỨC: HLV Minh đang có ${assignedHorsesCount} con ngựa (> 8)!`);
  }
  console.log(`📥 Yêu cầu bàn giao chờ tiếp nhận: 1 chiến mã (Hắc Long Mã tại chuồng C-01)`);
  console.log(`⚡ Xung đột lịch HLV đã cài sẵn: 08:00 (Bạch Long Mã) & 15:30 (Xích Thổ)`);
  console.log('----------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('❌ Lỗi trong quá trình cấu hình tài khoản HLV Minh:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
