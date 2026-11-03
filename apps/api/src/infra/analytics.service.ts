import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, type Db } from '../db/db.module.js';
import { analyticsEvents } from '../db/schema.js';
import { pseudonym } from '../common/crypto.js';

/** The fixed event set (spec 4.16). Nothing else is collected. */
export type AnalyticsEventName =
  | 'account_registered'
  | 'email_verified'
  | 'onboarding_completed'
  | 'post_created'
  | 'comment_created'
  | 'report_created'
  | 'report_resolved'
  | 'connection_requested'
  | 'connection_accepted';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger('Analytics');
  constructor(@InjectDb() private readonly db: Db) {}

  /** Fire-and-forget; analytics never breaks a request. */
  track(name: AnalyticsEventName, userId?: string | null, countryCode?: string | null) {
    this.db
      .insert(analyticsEvents)
      .values({ name, memberPseudoId: userId ? pseudonym(userId) : null, countryCode: countryCode ?? null })
      .catch((err: unknown) => this.logger.warn(`track ${name} failed: ${String(err)}`));
  }
}
