import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  INVITE_EMAILS_PER_DAY,
  type SendInvitesInput,
  type SendInvitesResult,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, memberProfiles } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { Errors } from '../common/errors.js';
import { MailService } from '../infra/mail.service.js';
import { webUrl } from '../infra/mail-layout.js';
import { RateLimitService } from '../infra/rate-limit.service.js';

/** The address an invitation opens (see packages/contracts/src/invites.ts). */
export function inviteLink(from: string, chapterSlug?: string | null): string {
  const q = new URLSearchParams();
  if (chapterSlug) q.set('chapter', chapterSlug);
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
  ) {}

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

    for (let i = 0; i < emails.length; i += 1)
      await this.limits.consume(
        `invites:${user.id}`,
        INVITE_EMAILS_PER_DAY,
        24 * 3600,
      );

    const subject = chapter
      ? `${me.name} invited you to the ${chapter.name} on Charter Mission`
      : `${me.name} invited you to join Charter Mission`;
    const paragraphs = [
      chapter
        ? `${me.name} would like you to join the ${chapter.name} on Charter Mission, the professional community where Africa and its diaspora build together.`
        : `${me.name} would like you to join Charter Mission, the professional community where Africa and its diaspora build together.`,
      ...(input.message ? [`Their note: “${input.message}”`] : []),
      'Joining is free. You choose what each audience can see on your profile.',
    ];
    for (const to of emails) {
      // In the inviter's language: we don't know the recipient's.
      await this.mail.compose({
        to,
        userId: null,
        template: chapter ? 'invite.chapter' : 'invite.platform',
        subject,
        heading: chapter
          ? `Join the ${chapter.name}`
          : 'You’re invited to Charter Mission',
        paragraphs,
        button: {
          label: 'Accept the invitation',
          url: inviteLink(me.handle, chapter?.slug),
        },
        footer: `You received this email because ${me.name} invited you to Charter Mission. We won’t email you again unless you join.`,
      });
    }
    return { sent: emails.length };
  }
}
