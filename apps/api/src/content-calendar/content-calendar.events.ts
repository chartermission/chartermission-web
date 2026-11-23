import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { DomainEvent } from '../infra/events.service.js';
import { EventsService } from '../infra/events.service.js';
import { NotifyService } from '../core/notify.service.js';

type Reviewed = Extract<DomainEvent, { type: 'content.reviewed' }>;

const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "24 Nov 2026, 14:00 UTC": the author's time zone isn't known here. */
function when(iso: string | null): string {
  if (!iso) return 'the time you chose';
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(d);
  return `${date}, ${time} UTC`;
}

/** What the author is told, per action (plain words, the team's note added when there is one). */
function copyFor(e: Reviewed): { line: string; subject: string; paragraph: string; good: boolean; href: string; button: string } {
  const scheduled = '/drafts?tab=scheduled';
  const drafts = '/drafts';
  if (e.kind === 'post') {
    if (e.action === 'approve') {
      const chapter = e.postStatus === 'in_review';
      return {
        line: chapter
          ? 'The Charter Mission team approved your post. It now waits for the chapter team’s approval'
          : 'The Charter Mission team approved your post. It is now live',
        subject: chapter ? 'Your post was approved' : 'Your post is live',
        paragraph: chapter
          ? 'The Charter Mission team approved your post. The chapter you posted in reviews posts too, so it goes live once its team approves it.'
          : 'The Charter Mission team approved your post. Members can now see it.',
        good: true,
        href: `/posts/${e.id}`,
        button: 'Open your post',
      };
    }
    return {
      line: 'The Charter Mission team didn’t approve your post',
      subject: 'Your post wasn’t approved',
      paragraph: 'The Charter Mission team didn’t approve your post, so it wasn’t published. Only you can still see it.',
      good: false,
      href: `/posts/${e.id}`,
      button: 'Open your post',
    };
  }
  switch (e.action) {
    case 'hold':
      return {
        line: 'The Charter Mission team paused your scheduled post',
        subject: 'Your scheduled post is paused',
        paragraph: 'The Charter Mission team paused your scheduled post. It won’t be published until they release it.',
        good: false,
        href: scheduled,
        button: 'Open scheduled posts',
      };
    case 'release':
      return {
        line: `The Charter Mission team released your scheduled post. It will be published on ${when(e.scheduledFor)}`,
        subject: 'Your scheduled post will be published',
        paragraph: `The Charter Mission team released your scheduled post. It will be published on ${when(e.scheduledFor)}.`,
        good: true,
        href: scheduled,
        button: 'Open scheduled posts',
      };
    case 'reschedule':
      return {
        line: `The Charter Mission team moved your scheduled post to ${when(e.scheduledFor)}`,
        subject: 'Your scheduled post has a new time',
        paragraph: `The Charter Mission team moved your scheduled post. It will now be published on ${when(e.scheduledFor)}.`,
        good: true,
        href: scheduled,
        button: 'Open scheduled posts',
      };
    case 'cancel':
      return {
        line: 'The Charter Mission team cancelled your scheduled post. It is back in your drafts',
        subject: 'Your scheduled post was cancelled',
        paragraph: 'The Charter Mission team cancelled your scheduled post, so it won’t be published. It is back in your drafts.',
        good: false,
        href: drafts,
        button: 'Open your drafts',
      };
    case 'approve':
      return {
        line: `The Charter Mission team approved your scheduled post. It will be published on ${when(e.scheduledFor)}`,
        subject: 'Your scheduled post was approved',
        paragraph: `The Charter Mission team approved your scheduled post. It will be published on ${when(e.scheduledFor)}.`,
        good: true,
        href: scheduled,
        button: 'Open scheduled posts',
      };
    case 'decline':
      return {
        line: 'The Charter Mission team didn’t approve your scheduled post. It is back in your drafts',
        subject: 'Your scheduled post wasn’t approved',
        paragraph: 'The Charter Mission team didn’t approve your scheduled post, so it won’t be published. It is back in your drafts.',
        good: false,
        href: drafts,
        button: 'Open your drafts',
      };
  }
}

/** Tells the author (in the app and by email) what the Charter Mission team did with their post. */
@Injectable()
export class ContentCalendarEvents implements OnModuleInit {
  constructor(
    private readonly events: EventsService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit() {
    this.events.on('content.reviewed', (e) => this.onReviewed(e));
  }

  private async onReviewed(e: Reviewed) {
    const copy = copyFor(e);
    const note = e.note?.trim();
    await this.notify.notify({
      userId: e.authorId,
      type: 'content_review',
      objectType: e.kind,
      objectId: e.id,
      segments: [
        { text: copy.line, strong: false },
        ...(note ? [{ text: `: “${clip(note)}”`, strong: false }] : [{ text: '.', strong: false }]),
      ],
      href: copy.href,
      icon: copy.good ? 'check' : 'alert',
      dedupeKey: `content-review:${e.kind}:${e.id}:${e.action}:${Date.now()}`,
      email: {
        subject: copy.subject,
        heading: copy.subject,
        paragraphs: [copy.paragraph, `Your post: “${clip(e.preview, 200)}”`, ...(note ? [`Their note: “${note}”`] : [])],
        buttonLabel: copy.button,
      },
    });
  }
}
