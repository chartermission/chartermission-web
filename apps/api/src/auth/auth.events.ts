import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';

/** In-app welcome once the email is verified (from the user.verified domain event, spec 4.13). */
@Injectable()
export class AuthEvents implements OnModuleInit {
  constructor(
    private readonly events: EventsService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit() {
    this.events.on('user.verified', async (e) => {
      await this.notify.notify({
        userId: e.userId,
        type: 'welcome',
        objectType: 'user',
        objectId: e.userId,
        segments: [
          { text: 'Welcome to Charter Mission. ', strong: true },
          { text: 'Your email is confirmed. Finish your profile so the right people can find you.', strong: false },
        ],
        href: '/onboarding',
        icon: 'users',
        // One welcome per member, however often the event is retried.
        dedupeKey: `welcome:${e.userId}`,
        windowMinutes: 60 * 24 * 365,
      });
    });
  }
}
