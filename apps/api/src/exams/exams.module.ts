import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module.js';
import { AdminExamsService } from './admin-exams.service.js';
import { ExamAttemptsService } from './exam-attempts.service.js';
import { AdminExamsController, ExamsController } from './exams.controller.js';
import { ExamsService } from './exams.service.js';

/**
 * Exams: multiple-choice exams built in the admin console and taken by members on Charter Mission.
 * Uses Learning only for the e-learning access rules (exams that follow them).
 */
@Module({
  imports: [LearningModule],
  controllers: [ExamsController, AdminExamsController],
  providers: [ExamsService, ExamAttemptsService, AdminExamsService],
  exports: [ExamsService],
})
export class ExamsModule {}
