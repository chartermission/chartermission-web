import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { connections, follows, milestonesReached, notifications } from '../db/schema.js';

/** Followers milestones announced once each (LinkedIn-style). */
export const FOLLOWER_MILESTONES = [10, 50, 100, 500, 1000, 5000, 10000, 50000, 100000];
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
          { text: ' accepted your connection request', strong: false },
        ],
        href: `/${actor.handle}`,
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
      // Grouped per day like LinkedIn ("Amina and 4 others started following you"). One follower opens their
      // profile; several open your own, where your followers are listed.
      const day = new Date().toISOString().slice(0, 10);
      const dedupeKey = `follow:${day}`;
      const [today] = await this.db
        .select({ actorIds: notifications.actorIds })
        .from(notifications)
        .where(and(eq(notifications.userId, e.targetId), eq(notifications.dedupeKey, dedupeKey)))
        .limit(1);
      const several = !!today && today.actorIds.some((id) => id !== e.followerId);
      const own = several ? await this.members.ref(e.targetId) : null;
      await this.notify.notify({
        userId: e.targetId,
        type: 'follow',
        actorId: e.followerId,
        objectType: 'member',
        objectId: e.followerId,
        segments: [{ text: ' started following you', strong: false }],
        href: own ? `/${own.handle}` : `/${actor.handle}`,
        icon: 'avatar',
        dedupeKey,
        windowMinutes: 24 * 60,
      });
      await this.followerMilestone(e.targetId);
    });
  }

  /** "You reached 100 followers": each milestone once (claimed in milestones_reached), the highest one reached. */
  private async followerMilestone(userId: string) {
    const [{ n } = { n: 0 }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(follows)
      .where(and(eq(follows.targetType, 'member'), eq(follows.targetId, userId)));
    const reached = FOLLOWER_MILESTONES.filter((m) => m <= n);
    if (!reached.length) return;
    const claimed = await this.db
      .insert(milestonesReached)
      .values(reached.map((threshold) => ({ subjectType: 'member', subjectId: userId, metric: 'followers', threshold })))
      .onConflictDoNothing()
      .returning({ threshold: milestonesReached.threshold });
    if (!claimed.length) return;
    const top = Math.max(...claimed.map((c) => c.threshold));
    const me = await this.members.ref(userId);
    await this.notify.notify({
      userId,
      type: 'follower_milestone',
      objectType: 'member',
      objectId: userId,
      segments: [
        { text: 'You reached a milestone: ', strong: false },
        { text: top.toLocaleString('en-US'), strong: true },
        { text: ' followers', strong: false },
      ],
      href: me ? `/${me.handle}` : '/',
      icon: 'users',
      dedupeKey: `follower_milestone:${top}`,
    });
  }
}
