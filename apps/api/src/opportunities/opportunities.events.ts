import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { opportunities, opportunityApplications, pages } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';

const DECISION_COPY = {
  shortlisted: { verb: ' shortlisted you for ', subject: 'You’ve been shortlisted', lead: 'Good news: you’re on the shortlist.' },
  accepted: { verb: ' accepted your application for ', subject: 'Your application was accepted', lead: 'Congratulations: your application was accepted.' },
  declined: { verb: ' reviewed your application for ', subject: 'An update on your application', lead: 'Thanks for applying. This time the poster has gone with other applicants.' },
} as const;

/**
 * Notifications for applications (created from domain events, never inline). Handlers re-read
 * the application so a retry after a later change sends nothing stale.
 *
 * Listings imported by staff (source 'import') are reviewed by the Charter Mission team in the
 * admin console, so their poster (the staff member who imported them) isn't told about each
 * application. Decisions on a listing posted as a page come from the page, not from the member or
 * staff member who made them.
 */
@Injectable()
export class OpportunitiesEvents implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly members: MembersService,
  ) {}

  onModuleInit() {
    this.events.on('opportunity.applied', async (e) => {
      const row = await this.load(e.applicationId);
      if (!row || row.a.status !== 'submitted') return;
      if (row.o.source === 'import') return;
      const actor = await this.members.ref(row.a.applicantId);
      if (!actor) return;
      await this.notify.notify({
        userId: row.o.posterId,
        type: 'opportunity_application_received',
        actorId: row.a.applicantId,
        objectType: 'opportunity',
        objectId: row.o.id,
        segments: [
          { text: actor.name, strong: true },
          { text: ' applied to ', strong: false },
          { text: row.o.title, strong: true },
        ],
        href: `/opportunities/${row.o.slug}/applicants`,
        icon: 'briefcase',
        dedupeKey: `opportunity-applied:${row.o.id}`,
        windowMinutes: 60,
        email: {
          subject: `New applicant: ${row.o.title}`,
          heading: `${actor.name} applied to ${row.o.title}`,
          paragraphs: [`${actor.name} sent their profile and a note. Review applicants in Charter Mission to shortlist, accept or decline.`],
          buttonLabel: 'Review applicants',
        },
      });
    });

    this.events.on('opportunity.application_decided', async (e) => {
      const row = await this.load(e.applicationId);
      if (!row || row.a.status !== e.status) return;
      // Imported listings are reviewed by the Charter Mission team in the admin console (whoever
      // decides, not the staff member who imported them, and even when posted as an organisation's
      // page), so the decision comes from Charter Mission. Other page listings: the page decided.
      const decider =
        row.o.source === 'import'
          ? { name: 'Charter Mission', actorId: null }
          : row.pageName
            ? { name: row.pageName, actorId: null }
            : { name: (await this.members.ref(row.o.posterId))?.name, actorId: row.o.posterId };
      if (!decider.name) return;
      const copy = DECISION_COPY[e.status];
      const message = e.message?.trim();
      await this.notify.notify({
        userId: row.a.applicantId,
        type: 'opportunity_application_updated',
        actorId: decider.actorId,
        objectType: 'opportunity',
        objectId: row.o.id,
        segments: [
          { text: decider.name, strong: true },
          { text: copy.verb, strong: false },
          { text: row.o.title, strong: true },
          ...(message ? [{ text: `: “${message.length > 140 ? `${message.slice(0, 139)}…` : message}”`, strong: false }] : []),
        ],
        href: `/opportunities/${row.o.slug}`,
        icon: 'briefcase',
        dedupeKey: `opportunity-decided:${row.a.id}:${e.status}`,
        email: {
          subject: `${copy.subject}: ${row.o.title}`,
          heading: copy.subject,
          paragraphs: [
            `${copy.lead} ${decider.name} updated your application for ${row.o.title} at ${row.o.organisation}.`,
            ...(message ? [`Their message: “${message}”`] : []),
          ],
          buttonLabel: 'View the opportunity',
        },
      });
    });
  }

  private async load(applicationId: string) {
    const [row] = await this.db
      .select({ a: opportunityApplications, o: opportunities, pageName: pages.name })
      .from(opportunityApplications)
      .innerJoin(opportunities, eq(opportunities.id, opportunityApplications.opportunityId))
      .leftJoin(pages, eq(pages.id, opportunities.pageId))
      .where(eq(opportunityApplications.id, applicationId))
      .limit(1);
    return row;
  }
}
