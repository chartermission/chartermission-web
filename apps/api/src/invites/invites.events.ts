import { Injectable, type OnModuleInit } from '@nestjs/common';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';
import { InvitesService } from './invites.service.js';

/** When someone who joined through an invitation confirms their email, the inviter hears about it. */
@Injectable()
export class InvitesEvents implements OnModuleInit {
  constructor(
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly invites: InvitesService,
    private readonly members: MembersService,
  ) {}

  onModuleInit() {
    this.events.on('user.verified', async (e) => {
      const referral = await this.invites.onVerified(e.userId);
      if (!referral) return;
      const joiner = await this.members.ref(e.userId);
      if (!joiner) return;
      const connected = referral.kind === 'member';
      await this.notify.notify({
        userId: referral.inviterId,
        type: 'invite_joined',
        actorId: e.userId,
        objectType: 'user',
        objectId: e.userId,
        segments: [{ text: connected ? ' joined Charter Mission through your invitation. You’re now connected.' : ' joined Charter Mission through your invitation.', strong: false }],
        href: `/${joiner.handle}`,
        icon: 'avatar',
        dedupeKey: `invite_joined:${e.userId}`,
        windowMinutes: 60 * 24 * 365,
        email: {
          subject: `${joiner.name} joined Charter Mission through your invitation`,
          heading: `${joiner.name} accepted your invitation`,
          paragraphs: [connected ? `${joiner.name} joined Charter Mission through your invitation, and you’re now connected.` : `${joiner.name} joined Charter Mission through your invitation.`],
          buttonLabel: 'View profile',
        },
      });
    });
  }
}
