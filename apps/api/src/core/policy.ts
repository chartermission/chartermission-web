import type { AuthUser } from './auth-context.js';
import type { Permission } from './permissions.js';

type Owned = { authorId?: string; ownerId?: string; userId?: string };

/**
 * The single policy function (spec 4.17, 8.1). Every write path calls this.
 * Ownership-based actions pass the resource; role-based ones pass nothing.
 */
export function can(user: AuthUser | undefined, action: string, resource?: Owned): boolean {
  if (!user) return false;
  const owner = resource?.authorId ?? resource?.ownerId ?? resource?.userId;
  switch (action) {
    case 'post.edit':
    case 'comment.edit':
      return owner === user.id;
    case 'post.delete':
    case 'comment.delete':
      return owner === user.id || user.permissions.has('moderation.act');
    default:
      return user.permissions.has(action as Permission);
  }
}

/** True while a time-boxed restriction is still running. */
export function isActiveUntil(date: Date | null | undefined, now = new Date()): date is Date {
  return !!date && date.getTime() > now.getTime();
}
