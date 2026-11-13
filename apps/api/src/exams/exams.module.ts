import { Logger, Module } from '@nestjs/common';
import { env } from '../config/env.js';
import { MediaModule } from '../media/media.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { AdminExamsService } from './admin-exams.service.js';
import {
  CHARTER_CENTER_EXAMS_CLIENT,
  HttpCharterCenterExamsClient,
  MockCharterCenterExamsClient,
  type CharterCenterExamsClient,
} from './charter-center-exams.client.js';
import { ExamAttemptsService } from './exam-attempts.service.js';
import { ExamCertificatesService } from './exam-certificates.service.js';
import { AdminExamsController, AdminExamsSettingsController, ExamJoinController, ExamsController } from './exams.controller.js';
import { ExamsService } from './exams.service.js';

/**
 * Exams: multiple-choice exams built in the admin console and taken by members on Charter Mission.
 * Members get an exam from its invitation link (it then shows on their Learning page), and everyone
 * who passes gets their certificate from Charter Center.
 */
@Module({
  imports: [MediaModule, PostsModule],
  controllers: [ExamsController, ExamJoinController, AdminExamsController, AdminExamsSettingsController],
  providers: [
    {
      provide: CHARTER_CENTER_EXAMS_CLIENT,
      useFactory: (): CharterCenterExamsClient => {
        const { CHARTER_CENTER_EXAMS_API: mode, CHARTER_CENTER_API_URL: url, CHARTER_CENTER_API_KEY: apiKey } = env();
        if (mode === 'live') {
          if (!url) throw new Error('CHARTER_CENTER_EXAMS_API=live needs CHARTER_CENTER_API_URL');
          return new HttpCharterCenterExamsClient({ baseUrl: url, apiKey });
        }
        new Logger('Exams').log('CHARTER_CENTER_EXAMS_API=mock: Charter Center certificates are samples (none are issued on the live site)');
        return new MockCharterCenterExamsClient();
      },
    },
    ExamsService,
    ExamAttemptsService,
    ExamCertificatesService,
    AdminExamsService,
  ],
  exports: [ExamsService],
})
export class ExamsModule {}
