import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import { InjectDb, type Db } from '../db/db.module.js';
import { QueueService } from '../infra/queue.service.js';
import { EventsService } from '../infra/events.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { computeTrending } from './trending.js';

/**
 * Runs the trending computation on queue "trending", job "compute": every
 * trending_rules.recomputeMinutes, and on demand (the moderation team adds a
 * job after admins pin or suppress a tag).
 */
@Injectable()
export class TrendingService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger('Trending');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly queue: QueueService,
    private readonly events: EventsService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.queue.process('trending', async (name) => {
      if (name === 'compute') await this.run();
    });
  }

  async onApplicationBootstrap() {
    try {
      const rules = await this.settings.get('trending_rules');
      await this.queue.every('trending', 'compute', rules.recomputeMinutes * 60_000);
    } catch (err) {
      this.logger.warn(`Could not schedule trending: ${String(err)}`);
    }
  }

  async run(now = new Date()) {
    const { enteredTop5 } = await computeTrending(this.db, now);
    if (enteredTop5.length) await this.events.emit({ type: 'trending.updated', tags: enteredTop5 });
  }
}
