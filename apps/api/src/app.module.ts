import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { DbModule } from './db/db.module.js';
import { RedisModule } from './infra/redis.js';
import { CoreModule } from './core/core.module.js';
import { SessionMiddleware } from './core/session.middleware.js';
import { CsrfGuard } from './core/guards.js';
import { ErrorFilter } from './common/error.filter.js';
import { AuthModule } from './auth/auth.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { MediaModule } from './media/media.module.js';
import { PostsModule } from './posts/posts.module.js';
import { TopicsModule } from './topics/topics.module.js';
import { FeedModule } from './feed/feed.module.js';
import { HomeModule } from './home/home.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ModerationModule } from './moderation/moderation.module.js';
import { AdminModule } from './admin/admin.module.js';
import { LearningModule } from './learning/learning.module.js';
import { EventsModule } from './events/events.module.js';
import { AmbassadorsModule } from './ambassadors/ambassadors.module.js';
import { StoriesModule } from './stories/stories.module.js';
import { ChaptersModule } from './chapters/chapters.module.js';
import { OpportunitiesModule } from './opportunities/opportunities.module.js';
import { PagesModule } from './pages/pages.module.js';
import { PeopleModule } from './people/people.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { PreviewModule } from './preview/preview.module.js';

@Module({
  imports: [
    DbModule,
    RedisModule,
    CoreModule,
    AuthModule,
    ProfilesModule,
    MediaModule,
    PostsModule,
    TopicsModule,
    FeedModule,
    HomeModule,
    NotificationsModule,
    ModerationModule,
    AdminModule,
    LearningModule,
    EventsModule,
    AmbassadorsModule,
    StoriesModule,
    ChaptersModule,
    OpportunitiesModule,
    PagesModule,
    PeopleModule,
    MessagesModule,
    PreviewModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SessionMiddleware).forRoutes('*path');
  }
}
