import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DailyTasksModule } from '../daily-tasks/daily-tasks.module';
import { AuditModule } from '../audit/audit.module';
import { TrainingController } from './training.controller';
import { TrainingCommonService } from './training-common.service';
import { TrainingPlansService } from './training-plans.service';
import { WorkoutsService } from './workouts.service';
import { TrainingInsightsService } from './training-insights.service';
import { TrainingScheduler } from './training.scheduler';
import { TrainerReviewsService } from './trainer-reviews.service';
import { TracksService } from './tracks.service';
import { WorkoutSlotSuggestionsService } from './workout-slot-suggestions.service';

@Module({
  imports: [PrismaModule, AuditModule, DailyTasksModule],
  controllers: [TrainingController],
  providers: [
    WorkoutSlotSuggestionsService,
    TracksService,
    TrainingCommonService,
    TrainingPlansService,
    WorkoutsService,
    TrainingInsightsService,
    TrainerReviewsService,
    TrainingScheduler,
  ],
  exports: [
    TrainingScheduler,
    TrainingCommonService,
    TrainingPlansService,
    WorkoutsService,
    TrainingInsightsService,
  ],
})
export class TrainingModule {}
