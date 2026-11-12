import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  INVITE_EMAILS_PER_DAY,
  type AdminReferrals,
  type InvitePreview,
  type InviteRef,
  type MyReferrals,
  type SendInvitesInput,
  type SendInvitesResult,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, connections, events, follows, memberProfiles, referrals, users } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { PreviewService } from '../preview/preview.service.js';
import { env } from '../config/env.js';
import type { AuthUser } from '../core/auth-context.js';
import { Errors } from '../common/errors.js';
import { MailService } from '../infra/mail.service.js';
import { webUrl } from '../infra/mail-layout.js';
import { RateLimitService } from '../infra/rate-limit.service.js';

/** Paths the API serves (media, preview pictures) as the web app reaches them. */
const apiBase = () => new URL(env().API_PUBLIC_URL).pathname.replace(/\/$/, '');

/** The address an invitation opens (see packages/contracts/src/invites.ts). */
export function inviteLink(from: string, chapterSlug?: string | null, eventSlug?: string | null): string {
  const q = new URLSearchParams();
  if (chapterSlug) q.set('chapter', chapterSlug);
  else if (eventSlug) q.set('event', eventSlug);
  q.set('from', from);
  return webUrl(`/invite?${q.toString()}`);
}

/** POST /invites: Charter Mission emails the invitation for the member, with their note. */
@Injectable()
export class InvitesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly mail: MailService,
    private readonly limits: RateLimitService,
    private readonly members: MembersService,
    private readonly previews: PreviewService,
  ) {}

  /** GET /invites/preview: the inviter and what they invite to, for the invitation page. */
  async preview(q: InviteRef): Promise<InvitePreview> {
    const [inviter] = await this.db
      .select({
        handle: memberProfiles.handle,
        name: memberProfiles.displayName,
        headline: memberProfiles.headline,
        tone: memberProfiles.avatarTone,
        visibility: memberProfiles.profileVisibility,
        status: users.status,
        id: users.id,
      })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(eq(sql`lower(${memberProfiles.handle})`, q.from.toLowerCase()))
      .limit(1);
    const live = inviter && inviter.status === 'active';
    const ref = live ? await this.members.ref(inviter.id) : null;
    // The photo through the public link-preview address: media itself is for signed-in members.
    const inviterPicture = live ? ((await this.previews.forPath(`/${inviter.handle}`).catch(() => null))?.image ?? null) : null;
    const [{ n: memberCount } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.status, 'active'));
    const absolute = (url: string | null) => (url && !/^https?:\/\//.test(url) ? `${apiBase()}${url}` : url);

    let target: InvitePreview['target'] = null;
    if (q.kind === 'chapter' && q.slug) {
      const [row] = await this.db
        .select({ id: chapters.id, slug: chapters.slug })
        .from(chapters)
        .where(and(eq(chapters.slug, q.slug), eq(chapters.status, 'active')))
        .limit(1);
      const info = row ? await this.previews.forPath(`/chapters/${row.slug}`) : null;
      if (row && info) {
        const [{ n } = { n: 0 }] = await this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(follows)
          .where(and(eq(follows.targetType, 'chapter'), eq(follows.targetId, row.id)));
        target = { path: `/chapters/${row.slug}`, title: info.title.replace(/ · Charter Mission$/, ''), description: info.description, imageUrl: absolute(info.image), memberCount: n };
      }
    } else if (q.kind === 'event' && q.slug) {
      const [row] = await this.db
        .select({
          slug: events.slug,
          startsAt: events.startsAt,
          endsAt: events.endsAt,
          timezone: events.timezone,
          format: events.format,
          venueName: events.venueName,
          venueCity: events.venueCity,
          onlinePlatform: events.onlinePlatform,
          registeredCount: events.registeredCount,
        })
        .from(events)
        .where(and(eq(events.slug, q.slug), eq(events.status, 'published'), isNull(events.cancelledAt)))
        .limit(1);
      const info = row ? await this.previews.forPath(`/events/${row.slug}`) : null;
      if (row && info) {
        const place = [row.venueName, row.venueCity].filter(Boolean).join(', ') || row.onlinePlatform || null;
        target = {
          path: `/events/${row.slug}`,
          title: info.title.replace(/ · Charter Mission$/, ''),
          description: info.description,
          imageUrl: absolute(info.image),
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          timezone: row.timezone,
          format: row.format,
          place,
          registeredCount: row.registeredCount,
        };
      }
    }
    return {
      kind: target ? q.kind : 'member',
      inviter:
        live && ref
          ? {
              handle: inviter.handle,
              name: inviter.name,
              // Only a public profile's headline is shown to someone who isn't signed in.
              headline: inviter.visibility === 'public' ? inviter.headline : null,
              avatarUrl: ref.avatarUrl ? absolute(inviterPicture) : null,
              tone: ref.tone,
              verified: ref.verified,
            }
          : null,
      target,
      memberCount,
    };
  }

  /** GET /invites/mine: who joined through this member's invitations. */
  async mine(user: AuthUser): Promise<MyReferrals> {
    const rows = await this.db
      .select({ inviteeId: referrals.inviteeId, kind: referrals.kind, at: referrals.createdAt })
      .from(referrals)
      .innerJoin(users, eq(users.id, referrals.inviteeId))
      .where(and(eq(referrals.inviterId, user.id), inArray(users.status, ['active', 'unverified'])))
      .orderBy(desc(referrals.createdAt))
      .limit(200);
    const refs = await this.members.refs(rows.map((r) => r.inviteeId));
    return {
      total: rows.length,
      people: rows.flatMap((r) => {
        const member = refs.get(r.inviteeId);
        return member ? [{ member, kind: r.kind as InvitePreview['kind'], joinedAt: r.at.toISOString() }] : [];
      }),
    };
  }

  /** GET /admin/referrals: the members who brought the most people, and the latest sign-ups through invitations. */
  async adminReport(): Promise<AdminReferrals> {
    const leadersRows = await this.db
      .select({
        inviterId: referrals.inviterId,
        joined: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where ${users.emailVerifiedAt} is not null)::int`,
      })
      .from(referrals)
      .innerJoin(users, eq(users.id, referrals.inviteeId))
      .groupBy(referrals.inviterId)
      .orderBy(desc(sql`count(*)`))
      .limit(50);
    const recentRows = await this.db
      .select({ inviterId: referrals.inviterId, inviteeId: referrals.inviteeId, kind: referrals.kind, slug: referrals.targetSlug, at: referrals.createdAt, verifiedAt: users.emailVerifiedAt })
      .from(referrals)
      .innerJoin(users, eq(users.id, referrals.inviteeId))
      .orderBy(desc(referrals.createdAt))
      .limit(100);
    const [{ n: total } = { n: 0 }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(referrals);
    const refs = await this.members.refs([...new Set([...leadersRows.map((r) => r.inviterId), ...recentRows.flatMap((r) => [r.inviterId, r.inviteeId])])]);
    return {
      total,
      leaders: leadersRows.flatMap((r) => {
        const inviter = refs.get(r.inviterId);
        return inviter ? [{ inviter, joined: r.joined, verified: r.verified }] : [];
      }),
      recent: recentRows.flatMap((r) => {
        const inviter = refs.get(r.inviterId);
        const invitee = refs.get(r.inviteeId);
        return inviter && invitee
          ? [{ inviter, invitee, kind: r.kind as InvitePreview['kind'], slug: r.slug, joinedAt: r.at.toISOString(), verified: !!r.verifiedAt }]
          : [];
      }),
    };
  }

  /** Once someone who came through an invitation confirms their email: tell the inviter, and connect them for a personal invitation. */
  async onVerified(userId: string): Promise<{ inviterId: string; kind: string } | null> {
    const [row] = await this.db.select().from(referrals).where(eq(referrals.inviteeId, userId)).limit(1);
    if (!row) return null;
    if (row.kind === 'member') {
      const [a, b] = [row.inviterId, userId];
      const [existing] = await this.db
        .select({ id: connections.id })
        .from(connections)
        .where(
          and(
            inArray(connections.status, ['pending', 'accepted']),
            sql`least(${connections.requesterId}, ${connections.addresseeId}) = least(${a}::uuid, ${b}::uuid) and greatest(${connections.requesterId}, ${connections.addresseeId}) = greatest(${a}::uuid, ${b}::uuid)`,
          ),
        )
        .limit(1);
      if (!existing) {
        await this.db
          .insert(connections)
          .values({ requesterId: row.inviterId, addresseeId: userId, status: 'accepted', respondedAt: new Date(), note: null })
          .onConflictDoNothing();
      }
    }
    return { inviterId: row.inviterId, kind: row.kind };
  }

  async send(
    user: AuthUser,
    input: SendInvitesInput,
  ): Promise<SendInvitesResult> {
    if (!user.emailVerified) throw Errors.emailNotVerified();
    const emails = [...new Set(input.emails)].filter(
      (e) => e !== user.email.toLowerCase(),
    );
    if (!emails.length)
      throw Errors.validation({ emails: 'Add someone else’s email address' });

    const [me] = await this.db
      .select({
        name: memberProfiles.displayName,
        handle: memberProfiles.handle,
      })
      .from(memberProfiles)
      .where(eq(memberProfiles.userId, user.id))
      .limit(1);
    if (!me) throw Errors.forbidden();
    let chapter: { name: string; slug: string } | null = null;
    if (input.chapterSlug) {
      const [row] = await this.db
        .select({ name: chapters.name, slug: chapters.slug })
        .from(chapters)
        .where(
          and(
            eq(chapters.slug, input.chapterSlug),
            eq(chapters.status, 'active'),
          ),
        )
        .limit(1);
      if (!row) throw Errors.notFound('That chapter');
      chapter = row;
    }

    let event: { title: string; slug: string } | null = null;
    if (input.eventSlug && !chapter) {
      const [row] = await this.db
        .select({ title: events.title, slug: events.slug })
        .from(events)
        .where(and(eq(events.slug, input.eventSlug), eq(events.status, 'published'), isNull(events.cancelledAt)))
        .limit(1);
      if (!row) throw Errors.notFound('That event');
      event = row;
    }

    for (let i = 0; i < emails.length; i += 1)
      await this.limits.consume(
        `invites:${user.id}`,
        INVITE_EMAILS_PER_DAY,
        24 * 3600,
      );

    const subject = chapter
      ? `${me.name} invited you to the ${chapter.name} on Charter Mission`
      : event
        ? `${me.name} invited you to ${event.title} on Charter Mission`
        : `${me.name} invited you to join Charter Mission`;
    const paragraphs = [
      chapter
        ? `${me.name} would like you to join the ${chapter.name} on Charter Mission, the professional community where Africa and its diaspora build together.`
        : event
          ? `${me.name} would like you to come to ${event.title} on Charter Mission, the professional community where Africa and its diaspora build together.`
          : `${me.name} would like you to join Charter Mission, the professional community where Africa and its diaspora build together.`,
      ...(input.message ? [`Their note: “${input.message}”`] : []),
      event
        ? 'Joining is free. Once you’re in, you can register for the event in one click.'
        : 'Joining is free. You choose what each audience can see on your profile.',
    ];
    for (const to of emails) {
      // In the inviter's language: we don't know the recipient's.
      await this.mail.compose({
        to,
        userId: null,
        template: chapter ? 'invite.chapter' : event ? 'invite.event' : 'invite.platform',
        subject,
        heading: chapter ? `Join the ${chapter.name}` : event ? event.title : 'You’re invited to Charter Mission',
        paragraphs,
        button: {
          label: event ? 'See the event' : 'Accept the invitation',
          url: inviteLink(me.handle, chapter?.slug, event?.slug),
        },
        footer: `You received this email because ${me.name} invited you to Charter Mission. We won’t email you again unless you join.`,
      });
    }
    return { sent: emails.length };
  }
}
