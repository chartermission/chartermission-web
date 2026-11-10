import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { pages, verificationRequests } from '../db/schema.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';

/** Tells the applicant how their verification request was decided. */
@Injectable()
export class VerificationEvents implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit() {
    this.events.on('verification.decided', async (e) => {
      const [row] = await this.db
        .select({ r: verificationRequests, pageName: pages.name, pageSlug: pages.slug })
        .from(verificationRequests)
        .leftJoin(pages, eq(pages.id, verificationRequests.pageId))
        .where(eq(verificationRequests.id, e.requestId))
        .limit(1);
      if (!row || row.r.status === 'pending') return;
      const approved = row.r.status === 'approved';
      const subject = row.pageName ?? 'Your profile';
      const href = row.pageSlug ? `/pages/${row.pageSlug}` : '/settings/verification';
      const note = row.r.decisionNote?.trim();
      await this.notify.notify({
        userId: row.r.userId,
        type: approved ? 'verification_approved' : 'verification_declined',
        objectType: 'verification_request',
        objectId: row.r.id,
        segments: approved
          ? [
              { text: subject, strong: true },
              { text: ' is now verified. The tick shows beside the name everywhere.', strong: false },
            ]
          : [
              { text: 'Your verification request', strong: true },
              { text: `${row.pageName ? ` for ${row.pageName}` : ''} wasn’t approved${note ? `: “${note.length > 140 ? `${note.slice(0, 139)}…` : note}”` : ''}`, strong: false },
            ],
        href,
        icon: approved ? 'check' : 'alert',
        dedupeKey: `verification-decided:${row.r.id}`,
        email: approved
          ? {
              subject: `${row.pageName ?? 'You'}${row.pageName ? ' is' : '’re'} verified on Charter Mission`,
              heading: `${subject} is verified`,
              paragraphs: ['Your verification request was approved. The verified tick now shows beside the name across Charter Mission.'],
              buttonLabel: row.pageName ? 'Open the page' : 'See your verification',
            }
          : {
              subject: 'An update on your verification request',
              heading: 'Your verification request wasn’t approved',
              paragraphs: [
                `We reviewed the request${row.pageName ? ` for ${row.pageName}` : ''} and couldn’t approve it this time.`,
                ...(note ? [`Reviewer’s note: “${note}”`] : []),
                'You can apply again in 30 days.',
              ],
              buttonLabel: 'See the details',
            },
      });
    });
  }
}
