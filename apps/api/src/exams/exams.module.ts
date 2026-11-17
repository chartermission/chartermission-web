import { Logger, Module } from '@nestjs/common';
import { env } from '../config/env.js';
import { MediaModule } from '../media/media.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { AdminExamsService } from './admin-exams.service.js';
import { AdminExamCertificatesService } from './admin-exam-certificates.service.js';
import { AdminExamInstructorsService } from './admin-exam-instructors.service.js';
import { AdminExamInstructorsController } from './exam-instructors.controller.js';
import {
  CHARTER_CENTER_EXAMS_CLIENT,
  DEFAULT_CHARTER_CENTER_API_URL,
  HttpCharterCenterExamsClient,
  MockCharterCenterExamsClient,
  type CharterCenterExamsClient,
} from './charter-center-exams.client.js';
import { ExamAttemptsService } from './exam-attempts.service.js';
import { ExamCertificatesService } from './exam-certificates.service.js';
import { AdminExamsController, AdminExamsSettingsController, ExamJoinController, ExamSignaturesController, ExamsController } from './exams.controller.js';
import { ExamsService } from './exams.service.js';

/**
 * Exams: multiple-choice exams built in the admin console and taken by members on Charter Mission.
 * Members get an exam from its invitation link (it then shows on their Learning page), and those who
 * pass an exam with certificate settings get their certificate from Charter Center.
 */
@Module({
  imports: [MediaModule, PostsModule],
  controllers: [ExamsController, ExamJoinController, ExamSignaturesController, AdminExamsController, AdminExamsSettingsController, AdminExamInstructorsController],
  providers: [
    {
      provide: CHARTER_CENTER_EXAMS_CLIENT,
      useFactory: (): CharterCenterExamsClient => {
        const { CHARTER_CENTER_EXAMS_API: mode, CHARTER_CENTER_API_URL: url, CHARTER_CENTER_API_KEY: apiKey } = env();
        if (mode === 'live') return new HttpCharterCenterExamsClient({ baseUrl: url ?? DEFAULT_CHARTER_CENTER_API_URL, apiKey });
        new Logger('Exams').log('CHARTER_CENTER_EXAMS_API=mock: Charter Center certificates are samples (none are issued on the live site)');
        return new MockCharterCenterExamsClient();
      },
    },
    ExamsService,
    ExamAttemptsService,
    ExamCertificatesService,
    AdminExamsService,
    AdminExamCertificatesService,
    AdminExamInstructorsService,
  ],
  exports: [ExamsService],
})
export class ExamsModule {}
