import { RequestMethod, type ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import type { McpAction } from '@chartermission/contracts';

/*
 * What Claude may call with an OAuth access token. Keys are "METHOD route" with the route as
 * declared on the controller, relative to /api/v1 (e.g. "GET posts/:id"), so a request is matched
 * by the handler Nest picked, never by parsing the URL. Everything else answers 403.
 */
export const MCP_ROUTES: ReadonlySet<string> = new Set([
  // Reading
  'GET me',
  'GET me/profile',
  'GET feed',
  'GET feed/new',
  'GET posts/:id',
  'GET posts/:id/comments',
  'GET comments/:id/replies',
  'GET posts/:id/reactions',
  'GET posts/:id/analytics',
  'GET me/analytics',
  'GET notifications',
  'GET notifications/unread-count',
  'GET members',
  'GET members/suggestions',
  'GET members/:handle',
  'GET me/connections',
  'GET me/follows',
  'GET chapters',
  'GET chapters/:slug',
  'GET topics',
  'GET topics/:tag',
  'GET topics/:tag/posts',
  'GET trending',
  'GET hashtags/suggest',
  'GET pages',
  'GET me/pages',
  'GET pages/:slug',
  // Groups: Claude lists the member's groups (scope=mine) and opens one before posting in it.
  'GET groups',
  'GET groups/:slug',
  'GET me/drafts',
  'GET me/drafts/:id',
  // Writing
  'POST posts',
  'POST posts/:id/comments',
  'POST me/drafts',
  'POST me/drafts/:id/publish',
  'POST connections',
  'POST connections/:id/accept',
  'POST follows',
  'POST notifications/read',
  'PATCH posts/:id',
  'PATCH comments/:id',
  'PATCH me/drafts/:id',
  'PUT reactions',
  'DELETE reactions',
  'DELETE posts/:id',
  'DELETE comments/:id',
  'DELETE follows',
  'DELETE me/drafts/:id',
]);

/** Where an action's target id comes from: the response, a path parameter or the request body. */
type TargetSource =
  | { type: string; from: 'result' }
  | { type: string; from: 'param'; name: string }
  | { type: string; from: 'body'; name: string }
  /** Target type and id both from the body ({ targetType, targetId }: reactions and follows). */
  | { from: 'typedBody' };

/** A draft saved with a publish time is a scheduled post: it spends the post allowance. */
const draftAction = (body: unknown): McpAction => {
  const at = body && typeof body === 'object' ? (body as Record<string, unknown>).scheduledFor : undefined;
  return at !== undefined && at !== null ? 'post.schedule' : 'draft.save';
};

/** Logged (and, when MCP_LIMITS covers it, limited) writes. The action may depend on the request body. */
export const MCP_ROUTE_ACTIONS: Readonly<
  Record<string, { action: McpAction | ((body: unknown) => McpAction); target: TargetSource }>
> = {
  'POST posts': { action: 'post.create', target: { type: 'post', from: 'result' } },
  'PATCH posts/:id': { action: 'post.edit', target: { type: 'post', from: 'param', name: 'id' } },
  'DELETE posts/:id': { action: 'post.delete', target: { type: 'post', from: 'param', name: 'id' } },
  'POST me/drafts': { action: draftAction, target: { type: 'draft', from: 'result' } },
  'PATCH me/drafts/:id': { action: draftAction, target: { type: 'draft', from: 'param', name: 'id' } },
  // Publishing returns the new post: log the post so the activity links to it.
  'POST me/drafts/:id/publish': { action: 'draft.publish', target: { type: 'post', from: 'result' } },
  'POST posts/:id/comments': { action: 'comment.create', target: { type: 'comment', from: 'result' } },
  'PATCH comments/:id': { action: 'comment.edit', target: { type: 'comment', from: 'param', name: 'id' } },
  'DELETE comments/:id': { action: 'comment.delete', target: { type: 'comment', from: 'param', name: 'id' } },
  'PUT reactions': { action: 'reaction.set', target: { from: 'typedBody' } },
  'DELETE reactions': { action: 'reaction.remove', target: { from: 'typedBody' } },
  'POST connections': { action: 'connection.request', target: { type: 'member', from: 'body', name: 'memberId' } },
  'POST connections/:id/accept': { action: 'connection.accept', target: { type: 'connection', from: 'param', name: 'id' } },
  'POST follows': { action: 'follow', target: { from: 'typedBody' } },
  'DELETE follows': { action: 'unfollow', target: { from: 'typedBody' } },
};

const METHODS: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

const segments = (path: unknown): string[] =>
  (Array.isArray(path) ? String(path[0] ?? '') : typeof path === 'string' ? path : '').split('/').filter(Boolean);

/** "METHOD controller/handler" for the handler serving this request, e.g. "GET posts/:id". */
export function routeKey(context: ExecutionContext): string | null {
  const handler = context.getHandler();
  const method = METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
  if (!method) return null;
  // Every controller here declares a single path; arrays are read by their first entry.
  const path = [
    ...segments(Reflect.getMetadata(PATH_METADATA, context.getClass())),
    ...segments(Reflect.getMetadata(PATH_METADATA, handler)),
  ].join('/');
  return `${method} ${path}`;
}

/** The logged target of a successful write. */
export function actionTarget(
  target: TargetSource,
  req: { params?: Record<string, unknown>; body?: unknown },
  result: unknown,
): { targetType: string | null; targetId: string | null } {
  const field = (obj: unknown, name: string): string | null => {
    const v = obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[name] : undefined;
    return typeof v === 'string' && v.length <= 200 ? v : null;
  };
  switch (target.from) {
    case 'result':
      return { targetType: target.type, targetId: field(result, 'id') };
    case 'param':
      return { targetType: target.type, targetId: field(req.params, target.name) };
    case 'body':
      return { targetType: target.type, targetId: field(req.body, target.name) };
    case 'typedBody':
      return { targetType: field(req.body, 'targetType'), targetId: field(req.body, 'targetId') };
  }
}
