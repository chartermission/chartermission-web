import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { connections, follows } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';

/**
 * Notifications for networking events (CM-NTF-01), created from domain events (spec 4.13),
 * never inline in request handlers. Handlers re-check state so retries are harmless.
 */
@Injectable()
export class ProfilesEvents implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly members: MembersService,
  ) {}

  onModuleInit() {
    this.events.on('connection.requested', async (e) => {
      const [row] = await this.db.select({ status: connections.status }).from(connections).where(eq(connections.id, e.connectionId));
      if (row?.status !== 'pending') return;
      const actor = await this.members.ref(e.requesterId);
      if (!actor) return;
      await this.notify.notify({
        userId: e.addresseeId,
        type: 'connection_request',
        actorId: e.requesterId,
        objectType: 'connection',
        objectId: e.connectionId,
        segments: [
          { text: actor.name, strong: true },
          { text: ' wants to connect with you', strong: false },
        ],
        href: '/network?tab=requests',
        icon: 'avatar',
        dedupeKey: `connection_request:${e.connectionId}`,
        email: {
          subject: `${actor.name} wants to connect on Charter Mission`,
          heading: `${actor.name} wants to connect`,
          paragraphs: [`${actor.name}${actor.headline ? ` (${actor.headline})` : ''} sent you a connection request.`],
          buttonLabel: 'Review request',
        },
      });
    });

    this.events.on('connection.accepted', async (e) => {
      const [row] = await this.db.select({ status: connections.status }).from(connections).where(eq(connections.id, e.connectionId));
      if (row?.status !== 'accepted') return;
      const actor = await this.members.ref(e.addresseeId);
      if (!actor) return;
      await this.notify.notify({
        userId: e.requesterId,
        type: 'connection_accepted',
        actorId: e.addresseeId,
        objectType: 'connection',
        objectId: e.connectionId,
        segments: [
          { text: actor.name, strong: true },
          { text: ' accepted your connection request', strong: false },
        ],
        href: `/members/${actor.handle}`,
        icon: 'avatar',
        dedupeKey: `connection_accepted:${e.connectionId}`,
        email: {
          subject: `${actor.name} accepted your connection request`,
          heading: `You’re now connected with ${actor.name}`,
          paragraphs: [`${actor.name} accepted your connection request on Charter Mission.`],
          buttonLabel: 'View profile',
        },
      });
    });

    this.events.on('follow.created', async (e) => {
      if (e.targetType !== 'member') return;
      const [still] = await this.db
        .select({ id: follows.followerId })
        .from(follows)
        .where(and(eq(follows.followerId, e.followerId), eq(follows.targetType, 'member'), eq(follows.targetId, e.targetId)));
      if (!still) return;
      const actor = await this.members.ref(e.followerId);
      if (!actor) return;
      await this.notify.notify({
        userId: e.targetId,
        type: 'follow',
        actorId: e.followerId,
        objectType: 'member',
        objectId: e.followerId,
        segments: [
          { text: actor.name, strong: true },
          { text: ' started following you', strong: false },
        ],
        href: `/members/${actor.handle}`,
        icon: 'avatar',
        dedupeKey: `follow:${e.followerId}`,
      });
    });
  }
}
