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
  | { type: 'opportunity.application_decided'; applicationId: string; status: 'shortlisted' | 'accepted' | 'declined'; message: string | null };

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
