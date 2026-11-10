import { Global, Module } from '@nestjs/common';
import { SessionService } from './session.service.js';
import { MembersService } from './members.service.js';
import { PageRefsService } from './page-refs.service.js';
import { BadgesService } from './badges.service.js';
import { RelationsService } from './relations.service.js';
import { NotifyService } from './notify.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { QueueService } from '../infra/queue.service.js';
import { EventsService } from '../infra/events.service.js';
import { MailService } from '../infra/mail.service.js';
import { AuditService } from '../infra/audit.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { SettingsService } from '../infra/settings.service.js';

const providers = [
  SessionService,
  MembersService,
  PageRefsService,
  BadgesService,
  RelationsService,
  NotifyService,
  RateLimitService,
  QueueService,
  EventsService,
  MailService,
  AuditService,
  AnalyticsService,
  SettingsService,
];

/** Cross-cutting services available to every feature module without importing. */
@Global()
@Module({ providers, exports: providers })
export class CoreModule {}
