import { Injectable } from '@nestjs/common';
import { QueueService } from './queue.service.js';

/**
 * Domain events (spec 4.13: notifications are created by workers from domain
 * events, never inline in request handlers). Emit after the transaction commits.
 */
export type DomainEvent =
  | { type: 'user.registered'; userId: string }
  | { type: 'user.verified'; userId: string }
  | { type: 'post.created'; postId: string; authorId: string }
  | { type: 'post.reposted'; postId: string; originalId: string; authorId: string }
  | { type: 'comment.created'; commentId: string; postId: string; authorId: string; parentId: string | null }
  | { type: 'reaction.created'; targetType: 'post' | 'comment'; targetId: string; userId: string; kind: string }
  | { type: 'mention.created'; sourceType: 'post' | 'comment'; sourceId: string; postId: string; authorId: string; userIds: string[] }
  | { type: 'follow.created'; followerId: string; targetType: string; targetId: string }
  /** A member viewed another's profile for the first time today (UTC day). */
  | { type: 'profile.viewed'; profileId: string; day: string }
  /** A post crossed an impressions or reactions milestone (claimed once in milestones_reached). */
  | { type: 'post.milestone'; postId: string; metric: 'impressions' | 'reactions'; threshold: number }
  | { type: 'connection.requested'; connectionId: string; requesterId: string; addresseeId: string }
  | { type: 'connection.accepted'; connectionId: string; requesterId: string; addresseeId: string }
  | { type: 'moderation.actioned'; actionId: string }
  | { type: 'report.resolved'; reportId: string; outcome: 'actioned' | 'dismissed' }
  | { type: 'appeal.decided'; appealId: string }
  | { type: 'upload.rejected'; fileId: string; ownerId: string }
  | { type: 'trending.updated'; tags: string[] }
  | { type: 'answer.accepted'; postId: string; commentId: string; commentAuthorId: string; actorId: string }
  | { type: 'help.offered'; postId: string; authorId: string; helperId: string }
  | { type: 'scheduled.published'; draftId: string; postId: string; authorId: string }
  | { type: 'scheduled.failed'; draftId: string; authorId: string; reason: string }
  | { type: 'opportunity.applied'; applicationId: string }
  | { type: 'opportunity.application_decided'; applicationId: string; status: 'shortlisted' | 'accepted' | 'declined'; message: string | null }
  | { type: 'chapter.post_pending'; postId: string; chapterId: string; authorId: string }
  | { type: 'chapter.post_reviewed'; postId: string; chapterId: string; action: 'approve' | 'decline' | 'hold' | 'remove'; actorId: string }
  | { type: 'chapter.banned'; chapterId: string; userId: string; actorId: string }
  | { type: 'group.join_requested'; groupId: string; userId: string }
  | { type: 'group.invited'; groupId: string; userIds: string[]; inviterId: string }
  | { type: 'group.request_approved'; groupId: string; userId: string; actorId: string }
  | { type: 'group.post_pending'; postId: string; groupId: string; authorId: string }
  | { type: 'group.post_reviewed'; postId: string; groupId: string; action: 'approve' | 'decline' | 'remove'; actorId: string; note: string | null }
  | { type: 'group.role_changed'; groupId: string; userId: string; role: 'owner' | 'admin' | 'moderator'; actorId: string }
  | { type: 'page.reviewed'; pageId: string; action: 'approve' | 'reject' | 'suspend' | 'restore'; actorId: string }
  | { type: 'page.admin_added'; pageId: string; userId: string; actorId: string }
  | {
      /** Staff acted on a group from the admin console (its admins, or the new and old owner, are told). */
      type: 'group.staff_action';
      groupId: string;
      action: 'suspend' | 'restore' | 'delete' | 'set_owner';
      actorId: string;
      /** When it happened (ISO), so a suspension after a restore is a new notification. */
      at: string;
      ownerId?: string;
      previousOwnerIds?: string[];
    }
  | { type: 'verification.decided'; requestId: string }
  | { type: 'initiative.join_requested'; requestId: string }
  | { type: 'initiative.join_decided'; requestId: string }
  | { type: 'booking.created'; bookingId: string }
  | { type: 'booking.cancelled'; bookingId: string; actorId: string }
  | {
      /** Content calendar: the Charter Mission team acted on a post (or scheduled post) written with Claude. */
      type: 'content.reviewed';
      kind: 'draft' | 'post';
      id: string;
      authorId: string;
      action: 'hold' | 'release' | 'reschedule' | 'cancel' | 'approve' | 'decline';
      actorId: string;
      note: string | null;
      scheduledFor: string | null;
      preview: string;
      /** Posts: the status after the action (published, in_review or declined). */
      postStatus: string | null;
    };

@Injectable()
export class EventsService {
  constructor(private readonly queue: QueueService) {}

  async emit(event: DomainEvent) {
    await this.queue.add('events', event.type, event);
  }

  /** Subscribe in onModuleInit. Handlers must be idempotent (jobs can retry). */
  on<T extends DomainEvent['type']>(type: T, handler: (event: Extract<DomainEvent, { type: T }>) => Promise<void>) {
    this.queue.process('events', async (name, data) => {
      if (name === type) await handler(data as Extract<DomainEvent, { type: T }>);
    });
  }
}
