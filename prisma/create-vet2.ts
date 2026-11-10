import { PrismaClient, Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

async function main() {
  const prisma = new PrismaClient();
  try {
    const email = 'vet2@gmail.com';
    const rawPassword = 'EquiFlow@2006';
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        role: Role.VETERINARIAN,
        status: UserStatus.ACTIVE,
        passwordHash,
      },
      create: {
        email,
        fullName: 'BS. Lý Thanh Tâm',
        role: Role.VETERINARIAN,
        status: UserStatus.ACTIVE,
        passwordHash,
        phoneNumber: '+84901234599',
      },
    });

    console.log(`✅ Đã tạo / cập nhật thành công tài khoản Bác sĩ thú y:`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Họ tên: ${user.fullName}`);
    console.log(`   Vai trò: ${user.role}`);
    console.log(`   Trạng thái: ${user.status}`);
    console.log(`   Mật khẩu: ${rawPassword}`);
  } catch (error) {
    console.error('❌ Lỗi khi tạo tài khoản:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

