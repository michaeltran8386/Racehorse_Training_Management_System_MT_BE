import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FinancialController } from './financial.controller';
import { FinancialService } from './financial.service';
import { FinancialScheduler } from './financial.scheduler';
import { PayOSService } from './payos.service';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [FinancialController],
  providers: [FinancialService, FinancialScheduler, PayOSService],
  exports: [FinancialScheduler, FinancialService, PayOSService],
})
export class FinancialModule {}
