import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { pageAdmins, pages } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';

/** Notifications for page reviews and new page admins (from domain events, never inline). */
@Injectable()
export class PagesEvents implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly members: MembersService,
  ) {}

  onModuleInit() {
    this.events.on('page.reviewed', async (e) => {
      const [page] = await this.db.select().from(pages).where(eq(pages.id, e.pageId)).limit(1);
      if (!page) return;
      // Re-read the status so a retry after a later decision sends nothing stale.
      const live = e.action === 'approve' || e.action === 'restore';
      if (live !== (page.status === 'active')) return;
      const admins = await this.db.select({ userId: pageAdmins.userId }).from(pageAdmins).where(eq(pageAdmins.pageId, page.id));
      const note = page.reviewNote?.trim();
      const copy = {
        approve: { text: ' is live. Add a logo and publish your first post.', subject: `${page.name} is live`, lead: `Your page ${page.name} passed review and is now live on Charter Mission.` },
        restore: { text: ' is live again.', subject: `${page.name} is live again`, lead: `Your page ${page.name} has been restored and is live again.` },
        reject: { text: ' wasn’t approved', subject: `${page.name} wasn’t approved`, lead: `Your page ${page.name} wasn’t approved this time. Edit the page to fix what’s listed and it goes back for review.` },
        suspend: { text: ' was suspended', subject: `${page.name} was suspended`, lead: `Your page ${page.name} has been suspended and is hidden from members.` },
      }[e.action];
      for (const admin of admins) {
        await this.notify.notify({
          userId: admin.userId,
          type: live ? 'page_approved' : 'page_rejected',
          objectType: 'page',
          objectId: page.id,
          segments: [
            { text: page.name, strong: true },
            { text: copy.text + (!live && note ? `: “${note.length > 140 ? `${note.slice(0, 139)}…` : note}”` : ''), strong: false },
          ],
          href: `/pages/${page.slug}`,
          icon: live ? 'check' : 'alert',
          dedupeKey: `page-reviewed:${page.id}:${e.action}`,
          email: {
            subject: copy.subject,
            heading: copy.subject,
            paragraphs: [copy.lead, ...(!live && note ? [`Reviewer’s note: “${note}”`] : [])],
            buttonLabel: 'Open the page',
          },
        });
      }
    });

    this.events.on('page.admin_added', async (e) => {
      const [page] = await this.db.select({ id: pages.id, slug: pages.slug, name: pages.name }).from(pages).where(eq(pages.id, e.pageId)).limit(1);
      if (!page || e.userId === e.actorId) return;
      const actor = await this.members.ref(e.actorId);
      await this.notify.notify({
        userId: e.userId,
        type: 'page_admin_added',
        actorId: e.actorId,
        objectType: 'page',
        objectId: page.id,
        segments: [
          { text: actor?.name ?? 'The Charter Mission team', strong: true },
          { text: ' made you an admin of ', strong: false },
          { text: page.name, strong: true },
        ],
        href: `/pages/${page.slug}`,
        icon: 'users',
        dedupeKey: `page-admin-added:${page.id}:${e.userId}`,
        email: {
          subject: `You now manage ${page.name}`,
          heading: `You’re an admin of ${page.name}`,
          paragraphs: [`You can now edit the page and post as ${page.name} on Charter Mission.`],
          buttonLabel: 'Open the page',
        },
      });
    });
  }
}
