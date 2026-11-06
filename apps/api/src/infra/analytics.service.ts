import { Injectable, Logger } from '@nestjs/common';
import { InjectDb, type Db } from '../db/db.module.js';
import { analyticsEvents } from '../db/schema.js';
import { pseudonym } from '../common/crypto.js';
import type { AnalyticsEventName } from '@chartermission/contracts';

/** The fixed event set (spec 4.16), defined in contracts. Nothing else is collected. */
export type { AnalyticsEventName };

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger('Analytics');
  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * Fire-and-forget; analytics never breaks a request. `subjectId` is the id of the thing acted on
   * where the event definition says so (event id for event_*, course id for charter_center_click).
   */
  track(name: AnalyticsEventName, userId?: string | null, countryCode?: string | null, subjectId?: string | null) {
    this.db
      .insert(analyticsEvents)
      .values({ name, memberPseudoId: userId ? pseudonym(userId) : null, countryCode: countryCode ?? null, subjectId: subjectId ?? null })
      .catch((err: unknown) => this.logger.warn(`track ${name} failed: ${String(err)}`));
  }
}
