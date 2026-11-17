import { z } from 'zod';
import { MCP_LIMIT_BUCKETS, MCP_LIMITS, type McpAction } from '@chartermission/contracts';
import type { ApiClient } from '../api-client.js';
import type { Links } from '../format.js';

/** What every tool needs: the API as this member, and links into the member app. */
export interface ToolContext {
  api: ApiClient;
  links: Links;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

/** A UUID; the short pattern keeps tool schemas small (the API checks ids strictly). */
export const uuidString = () => z.string().regex(UUID, 'Use an id from an earlier result');
export const uuid = (what: string) => uuidString().describe(`The ${what} id (a UUID from an earlier result).`);
export const cursor = z.string().max(200).optional().describe('nextCursor from the previous page, to read more.');

/** Annotation presets: every tool acts inside Charter Mission only (openWorldHint false). */
export const READ = { readOnlyHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
export const IDEMPOTENT_WRITE = { ...WRITE, idempotentHint: true } as const;
/** Replaces existing content (an edit): repeatable, but what was there before is gone. */
export const OVERWRITE = { ...WRITE, destructiveHint: true, idempotentHint: true } as const;
export const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

const LIMIT_NOUNS: Partial<Record<McpAction, string>> = {
  'post.create': 'posts (publishing, scheduling and publishing drafts together)',
  'draft.save': 'draft saves',
  'comment.create': 'comments',
  'reaction.set': 'reactions',
  'connection.request': 'connection requests',
  follow: 'follows',
};

/**
 * "Limit: … at most 5 posts (publishing, scheduling and publishing drafts together) an hour …", read from
 * the shared contract. Actions in a bucket (post.schedule, draft.publish) report the bucket's allowance.
 */
export function limitNote(action: McpAction): string {
  const bucket = MCP_LIMIT_BUCKETS[action] ?? action;
  const limit = MCP_LIMITS[bucket];
  if (!limit) return '';
  return ` Limit: Claude can make at most ${limit.perHour} ${LIMIT_NOUNS[bucket] ?? bucket} an hour and ${limit.perDay} a day for this member; when the limit is reached, tell the member and do not retry.`;
}

/** Handles may be typed with "@", tags with "#". */
export const stripPrefix = (value: string, prefix: '@' | '#') => value.trim().replace(new RegExp(`^\\${prefix}+`), '');

/*
 * Path segments. encodeURIComponent leaves "." and ".." as they are and URL resolution then walks
 * up the path ("topics/../posts"), so every non-UUID value that goes into an API path is checked
 * against what that kind of value can look like before it is used.
 */
const SEGMENT_PATTERNS = {
  /** Member handles (current and older ones), chapter and page slugs. */
  handle: /^[A-Za-z0-9_.-]{1,60}$/,
  slug: /^[A-Za-z0-9_.-]{1,120}$/,
  /** Hashtags without "#": letters (any script), digits and underscores. */
  tag: /^[\p{L}\p{N}_]{1,51}$/u,
} as const;

export type SegmentKind = keyof typeof SEGMENT_PATTERNS;

const SEGMENT_LABELS: Record<SegmentKind, string> = { handle: 'handle', slug: 'slug', tag: 'hashtag' };

/** A UUID, or a handle / slug / tag safe to use as one URL path segment; anything else is refused. */
export function pathSegment(value: string, kind: SegmentKind): string {
  const v = value.trim();
  const unsafe = v === '' || /^\.+$/.test(v) || /[\/\\]/.test(v) || /\p{Cc}/u.test(v);
  if (unsafe || !(isUuid(v) || SEGMENT_PATTERNS[kind].test(v))) {
    throw new Error(`${JSON.stringify(value.slice(0, 80))} is not a valid ${SEGMENT_LABELS[kind]}.`);
  }
  return encodeURIComponent(v);
}
