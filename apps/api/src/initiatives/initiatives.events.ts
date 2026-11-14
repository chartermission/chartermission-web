import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { initiativeJoinRequests, initiativeMembers, initiatives } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';

/**
 * Notifications for join requests (from domain events, never inline). Handlers re-read the request,
 * so a retry after a later change sends nothing stale.
 */
@Injectable()
export class InitiativesEvents implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly members: MembersService,
  ) {}

  onModuleInit() {
    this.events.on('initiative.join_requested', async (e) => {
      const row = await this.load(e.requestId);
      if (!row || row.r.status !== 'pending') return;
      const actor = await this.members.ref(row.r.userId);
      if (!actor) return;
      const organisers = await this.db
        .select({ userId: initiativeMembers.userId })
        .from(initiativeMembers)
        .where(and(eq(initiativeMembers.initiativeId, row.i.id), eq(initiativeMembers.organiser, true)));
      const recipients = new Set([row.i.leadId, ...organisers.map((o) => o.userId)]);
      for (const userId of recipients) {
        await this.notify.notify({
          userId,
          type: 'initiative_join_requested',
          actorId: row.r.userId,
          objectType: 'initiative',
          objectId: row.i.id,
          segments: [
            { text: actor.name, strong: true },
            { text: ' asked to join ', strong: false },
            { text: row.i.title, strong: true },
          ],
          href: `/initiatives/${row.i.slug}/manage`,
          icon: 'users',
          dedupeKey: `initiative-join:${row.i.id}`,
          windowMinutes: 60,
          email: {
            subject: `${actor.name} asked to join ${row.i.title}`,
            heading: `${actor.name} wants to join ${row.i.title}`,
            paragraphs: [`${actor.name} sent a note about how they can help. Review it on Charter Mission to accept or decline.`],
            buttonLabel: 'Review requests',
          },
        });
      }
    });

    this.events.on('initiative.join_decided', async (e) => {
      const row = await this.load(e.requestId);
      if (!row || (row.r.status !== 'accepted' && row.r.status !== 'declined')) return;
      const accepted = row.r.status === 'accepted';
      const message = row.r.message?.trim();
      await this.notify.notify({
        userId: row.r.userId,
        type: 'initiative_join_decided',
        actorId: row.r.decidedBy,
        objectType: 'initiative',
        objectId: row.i.id,
        segments: [
          { text: accepted ? 'You’re on the team of ' : 'Your request to join ', strong: false },
          { text: row.i.title, strong: true },
          { text: accepted ? '' : ' wasn’t accepted this time', strong: false },
          ...(message ? [{ text: `: “${message.length > 140 ? `${message.slice(0, 139)}…` : message}”`, strong: false }] : []),
        ],
        href: `/initiatives/${row.i.slug}`,
        icon: accepted ? 'check' : 'alert',
        dedupeKey: `initiative-decided:${row.r.id}`,
        email: {
          subject: accepted ? `Welcome to ${row.i.title}` : `An update on your request to join ${row.i.title}`,
          heading: accepted ? `You’re on the team of ${row.i.title}` : `Your request to join ${row.i.title}`,
          paragraphs: [
            accepted
              ? 'The organisers accepted your request. You now appear on the team, and you’ll see the initiative’s updates in your feed.'
              : 'Thanks for offering to help. The organisers didn’t accept your request this time.',
            ...(message ? [`Their message: “${message}”`] : []),
          ],
          buttonLabel: 'Open the initiative',
        },
      });
    });
  }

  private async load(requestId: string) {
    const [row] = await this.db
      .select({ r: initiativeJoinRequests, i: initiatives })
      .from(initiativeJoinRequests)
      .innerJoin(initiatives, eq(initiatives.id, initiativeJoinRequests.initiativeId))
      .where(eq(initiativeJoinRequests.id, requestId))
      .limit(1);
    return row && !row.i.deletedAt ? row : null;
  }
}
