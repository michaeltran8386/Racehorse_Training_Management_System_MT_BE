import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { SupplyDeliveryGateway } from './supply-delivery.gateway';

@Module({
  imports: [PrismaModule, AuditModule, NotificationsModule],
  controllers: [InventoryController],
  providers: [InventoryService, SupplyDeliveryGateway],
  exports: [InventoryService, SupplyDeliveryGateway],
})
export class InventoryModule {}
