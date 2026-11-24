import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { groupMembers, groups } from '../db/schema.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';
import { AdminGroupsService } from './admin-groups.service.js';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Notifications for staff actions on groups (from domain events, never inline): the people who run a
 * group hear when it is suspended, restored or deleted, with the team's note; a new owner (and the
 * previous one, now an admin) hear about the change.
 */
@Injectable()
export class AdminGroupsEvents implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly admin: AdminGroupsService,
  ) {}

  onModuleInit() {
    this.events.on('group.staff_action', async (e) => {
      const [group] = await this.db.select().from(groups).where(eq(groups.id, e.groupId)).limit(1);
      if (!group) return;

      if (e.action === 'set_owner') {
        if (!e.ownerId) return;
        // Re-read the roles, so a retry after another change sends nothing stale.
        const rows = await this.db.select({ userId: groupMembers.userId, role: groupMembers.role }).from(groupMembers).where(eq(groupMembers.groupId, group.id));
        const roleOf = new Map(rows.map((r) => [r.userId, r.role]));
        if (roleOf.get(e.ownerId) === 'owner') {
          await this.notify.notify({
            userId: e.ownerId,
            type: 'group_role_changed',
            objectType: 'group',
            objectId: group.id,
            segments: [
              { text: 'The Charter Mission team made you the owner of ', strong: false },
              { text: group.name, strong: true },
            ],
            href: `/groups/${group.slug}`,
            icon: 'shield',
            dedupeKey: `group-owner:${group.id}:${e.ownerId}:${e.at}`,
            email: {
              subject: `You now own ${group.name}`,
              heading: `You’re the owner of ${group.name}`,
              paragraphs: [`The Charter Mission team made you the owner of ${group.name}. You can now change its settings, manage its admins and hand it on to another member.`],
              buttonLabel: 'Open the group',
            },
          });
        }
        for (const previous of e.previousOwnerIds ?? []) {
          if (previous === e.ownerId || roleOf.get(previous) !== 'admin') continue;
          await this.notify.notify({
            userId: previous,
            type: 'group_role_changed',
            objectType: 'group',
            objectId: group.id,
            segments: [
              { text: 'The Charter Mission team gave ', strong: false },
              { text: group.name, strong: true },
              { text: ' a new owner. You stay on as an admin.', strong: false },
            ],
            href: `/groups/${group.slug}`,
            icon: 'shield',
            dedupeKey: `group-owner-previous:${group.id}:${previous}:${e.at}`,
            email: {
              subject: `${group.name} has a new owner`,
              heading: `${group.name} has a new owner`,
              paragraphs: [`The Charter Mission team handed ${group.name} to another member. You stay on as an admin of the group.`],
              buttonLabel: 'Open the group',
            },
          });
        }
        return;
      }

      // Re-read the state, so a retry after a later change sends nothing stale.
      const still =
        e.action === 'suspend' ? group.status === 'suspended' && !group.deletedAt : e.action === 'delete' ? !!group.deletedAt : !group.deletedAt && group.status !== 'suspended';
      if (!still) return;
      const note = group.statusNote?.trim();
      const copy = {
        suspend: {
          text: ' was suspended by the Charter Mission team',
          subject: `${group.name} was suspended`,
          lead: `The Charter Mission team suspended your group ${group.name}. Members can’t open it or see its posts; you and the other admins still can.`,
        },
        restore: {
          text: ' is open again',
          subject: `${group.name} is open again`,
          lead: `The Charter Mission team restored your group ${group.name}. Members can open it and see its posts again.`,
        },
        delete: {
          text: ' was deleted by the Charter Mission team',
          subject: `${group.name} was deleted`,
          lead: `The Charter Mission team deleted your group ${group.name}. Its posts are no longer shown to anyone.`,
        },
      }[e.action];
      const withNote = e.action !== 'restore' && !!note;
      for (const userId of await this.admin.runnerIds(group)) {
        await this.notify.notify({
          userId,
          type: 'group_status',
          actorId: null,
          objectType: 'group',
          objectId: group.id,
          segments: [
            { text: group.name, strong: true },
            { text: copy.text + (withNote ? `: “${clip(note, 140)}”` : '.'), strong: false },
          ],
          href: e.action === 'delete' ? '/groups' : `/groups/${group.slug}`,
          icon: e.action === 'restore' ? 'check' : 'alert',
          dedupeKey: `group-status:${group.id}:${e.action}:${e.at}`,
          email: {
            subject: copy.subject,
            heading: copy.subject,
            paragraphs: [copy.lead, ...(withNote ? [`The team’s note: “${note}”`] : [])],
            buttonLabel: e.action === 'delete' ? 'See your groups' : 'Open the group',
          },
        });
      }
    });
  }
}
