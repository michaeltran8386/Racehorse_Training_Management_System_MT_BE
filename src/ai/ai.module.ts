import { Module } from '@nestjs/common';
import { FinancialModule } from '../financial/financial.module';
import { HorsesModule } from '../horses/horses.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MedicalModule } from '../medical/medical.module';
import { ShiftRostersModule } from '../shift-rosters/shift-rosters.module';
import { TrainingModule } from '../training/training.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiToolsService } from './ai.tools';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [
    HorsesModule,
    TrainingModule,
    ShiftRostersModule,
    InventoryModule,
    FinancialModule,
    IncidentsModule,
    MedicalModule,
  ],
  controllers: [AiController],
  providers: [AiService, AiToolsService, KnowledgeService],
})
export class AiModule {}
