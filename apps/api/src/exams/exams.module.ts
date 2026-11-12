import { Logger, Module } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { env } from '../config/env.js';
import { DB, type Db } from '../db/db.module.js';
import { courses } from '../db/schema.js';
import { AuthModule } from '../auth/auth.module.js';
import { LearningModule } from '../learning/learning.module.js';
import { MediaModule } from '../media/media.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { AdminExamsService } from './admin-exams.service.js';
import {
  CHARTER_CENTER_EXAMS_CLIENT,
  HttpCharterCenterExamsClient,
  MockCharterCenterExamsClient,
  type CharterCenterExamsClient,
} from './charter-center-exams.client.js';
import { ExamAttemptsService } from './exam-attempts.service.js';
import { ExamCertificatesService } from './exam-certificates.service.js';
import { ExamJoinService } from './exam-join.service.js';
import { AdminExamsController, AdminExamsSettingsController, ExamJoinController, ExamsController } from './exams.controller.js';
import { ExamsService } from './exams.service.js';

/**
 * Exams: multiple-choice exams built in the admin console and taken by members on Charter Mission.
 * Charter Center students join from an invitation (their Charter Center name and photo make the
 * account) and, for exams tied to a Charter Center course, get their certificate when they pass.
 * Uses Learning for the e-learning access rules and the synced course titles.
 */
@Module({
  imports: [LearningModule, AuthModule, ProfilesModule, MediaModule, PostsModule],
  controllers: [ExamsController, ExamJoinController, AdminExamsController, AdminExamsSettingsController],
  providers: [
    {
      provide: CHARTER_CENTER_EXAMS_CLIENT,
      inject: [DB],
      useFactory: (db: Db): CharterCenterExamsClient => {
        const { CHARTER_CENTER_EXAMS_API: mode, CHARTER_CENTER_API_URL: url, CHARTER_CENTER_API_KEY: apiKey } = env();
        if (mode === 'live') {
          if (!url) throw new Error('CHARTER_CENTER_EXAMS_API=live needs CHARTER_CENTER_API_URL');
          return new HttpCharterCenterExamsClient({ baseUrl: url, apiKey });
        }
        new Logger('Exams').log('CHARTER_CENTER_EXAMS_API=mock: Charter Center students and certificates are samples');
        return new MockCharterCenterExamsClient(async (courseId) => {
          const [row] = await db.select({ title: courses.title }).from(courses).where(eq(courses.externalId, courseId)).limit(1);
          return row?.title ?? null;
        });
      },
    },
    ExamsService,
    ExamAttemptsService,
    ExamCertificatesService,
    ExamJoinService,
    AdminExamsService,
  ],
  exports: [ExamsService],
})
export class ExamsModule {}
