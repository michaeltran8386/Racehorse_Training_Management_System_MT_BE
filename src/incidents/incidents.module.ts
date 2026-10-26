import { Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { IncidentsScheduler } from './incidents.scheduler';

@Module({
  controllers: [IncidentsController],
  providers: [IncidentsService, IncidentsScheduler],
  exports: [IncidentsService, IncidentsScheduler],
})
export class IncidentsModule {}
