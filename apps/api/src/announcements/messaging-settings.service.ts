import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { MemberRef, MessagingSettings, MessagingSettingsView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { memberProfiles, users } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { AuditService } from '../infra/audit.service.js';
import { Errors } from '../common/errors.js';

export const NO_SENDER_MESSAGE = 'Choose the Charter Mission account messages are sent from in Messages settings';

/**
 * Which official account bulk messages and inbox replies come from (platform setting "messaging"). With none
 * chosen and exactly one official account, that one is used.
 */
@Injectable()
export class MessagingSettingsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly members: MembersService,
    private readonly audit: AuditService,
  ) {}

  /** Active official accounts, by name. */
  private async officialIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(and(eq(users.isOfficial, true), inArray(users.status, ['active', 'unverified'])))
      .orderBy(memberProfiles.displayName);
    return rows.map((r) => r.id);
  }

  /** The account messages go out from now, or null when none is set (and there isn't exactly one to fall back on). */
  async effectiveSenderId(): Promise<string | null> {
    const [{ senderId }, options] = await Promise.all([this.settings.get('messaging'), this.officialIds()]);
    if (senderId && options.includes(senderId)) return senderId;
    return !senderId && options.length === 1 ? options[0]! : null;
  }

  /** The sender, or 409 telling the admin to choose one. */
  async requireSender(): Promise<string> {
    const id = await this.effectiveSenderId();
    if (!id) throw Errors.conflict(NO_SENDER_MESSAGE);
    return id;
  }

  async view(): Promise<MessagingSettingsView> {
    const [{ senderId }, options, effective] = await Promise.all([this.settings.get('messaging'), this.officialIds(), this.effectiveSenderId()]);
    const refs = await this.members.refs(options);
    return {
      senderId,
      sender: effective ? (refs.get(effective) ?? null) : null,
      options: options.map((id) => refs.get(id)).filter((r): r is MemberRef => !!r),
    };
  }

  async update(actorId: string, input: MessagingSettings, ip?: string): Promise<MessagingSettingsView> {
    if (input.senderId && !(await this.officialIds()).includes(input.senderId)) {
      throw Errors.validation({ senderId: 'Choose one of the official accounts' });
    }
    const before = await this.settings.get('messaging');
    await this.settings.set('messaging', { senderId: input.senderId }, actorId);
    await this.audit.record({ actorId, action: 'settings.messaging.updated', targetType: 'setting', targetId: 'messaging', before, after: input, ip });
    return this.view();
  }
}
