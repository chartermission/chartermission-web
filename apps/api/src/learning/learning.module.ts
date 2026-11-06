import { Logger, Module } from '@nestjs/common';
import { env } from '../config/env.js';
import { CHARTER_CENTER_CLIENT, FixtureCharterCenterClient, HttpCharterCenterClient, type CharterCenterClient } from './charter-center.client.js';
import { FixtureLinkChecker, HttpLinkChecker, LINK_CHECKER } from './link-checker.js';
import { CoursesService } from './courses.service.js';
import { AdminCoursesService } from './admin-courses.service.js';
import { LearningJobsService } from './learning-jobs.service.js';
import { AdminLearningController, LearningController } from './learning.controller.js';

/**
 * Learning (spec 4.10). CHARTER_CENTER_API_URL set → the real API and real HTTP link checks;
 * unset → the bundled fixture catalogue and a deterministic fixture link checker (no network).
 */
@Module({
  controllers: [LearningController, AdminLearningController],
  providers: [
    {
      provide: CHARTER_CENTER_CLIENT,
      useFactory: (): CharterCenterClient => {
        const { CHARTER_CENTER_API_URL: url, CHARTER_CENTER_API_KEY: apiKey } = env();
        if (url) return new HttpCharterCenterClient({ baseUrl: url, apiKey });
        new Logger('Learning').log('CHARTER_CENTER_API_URL is not set; using the fixture catalogue');
        return new FixtureCharterCenterClient();
      },
    },
    {
      provide: LINK_CHECKER,
      inject: [CHARTER_CENTER_CLIENT],
      useFactory: (client: CharterCenterClient) =>
        client instanceof FixtureCharterCenterClient ? new FixtureLinkChecker(client.fixture) : new HttpLinkChecker(),
    },
    CoursesService,
    AdminCoursesService,
    LearningJobsService,
  ],
  exports: [CoursesService, LearningJobsService],
})
export class LearningModule {}
