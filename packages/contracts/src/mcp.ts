import { z } from "zod";
import { MemberRef } from "./common.js";

/*
 * Claude (MCP) access. Members connect Claude to their own account through OAuth 2.1
 * (authorization code + PKCE). Only staff and members an admin has given Claude access can
 * connect. Tokens act as that member, limited to posting, engagement and reading routes, with
 * hourly limits per action and an activity log the member and admins can read.
 */

/** OAuth scope granted to Claude. One scope covers every allowed route. */
export const MCP_SCOPE = "charter";

/** Lifetimes of what the OAuth server issues. */
export const OAUTH_POLICY = {
  codeTtlSeconds: 600,
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 30 * 24 * 3600,
} as const;

/** What Claude did, as logged per successful call. */
export const McpAction = z.enum([
  "post.create",
  "post.edit",
  "post.delete",
  "draft.save",
  /** A draft saved with a publish time (it becomes a post later, so it counts as a post). */
  "post.schedule",
  "draft.publish",
  "comment.create",
  "comment.edit",
  "comment.delete",
  "reaction.set",
  "reaction.remove",
  "connection.request",
  "connection.accept",
  "follow",
  "unfollow",
]);
export type McpAction = z.infer<typeof McpAction>;

/**
 * Most of each action Claude may take for one member in a rolling hour and a rolling day.
 * Actions not listed here are not limited. Every way of making a post (post.create, post.schedule,
 * draft.publish) shares the post.create allowance: see MCP_LIMIT_BUCKETS.
 */
export const MCP_LIMITS: Partial<Record<McpAction, { perHour: number; perDay: number }>> = {
  "post.create": { perHour: 5, perDay: 20 },
  "draft.save": { perHour: 10, perDay: 40 },
  "comment.create": { perHour: 20, perDay: 100 },
  "reaction.set": { perHour: 60, perDay: 300 },
  "connection.request": { perHour: 15, perDay: 40 },
  "follow": { perHour: 30, perDay: 100 },
};

/**
 * Actions that count against another action's allowance. Publishing now, scheduling and publishing a
 * draft all make a post, so together they share post.create's limit.
 */
export const MCP_LIMIT_BUCKETS: Partial<Record<McpAction, McpAction>> = {
  "post.schedule": "post.create",
  "draft.publish": "post.create",
};

/** The actions that share `action`'s allowance (including itself). */
export function mcpBucketMembers(action: McpAction): McpAction[] {
  return McpAction.options.filter((a) => (MCP_LIMIT_BUCKETS[a] ?? a) === action);
}

/* ---------------------------- OAuth (consent page) ---------------------------- */

/** GET /oauth/authorize/check — the consent page asks whether this request can go ahead. */
export const OAuthAuthorizeQuery = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().url().max(500),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(500).optional(),
  scope: z.string().max(200).optional(),
  resource: z.string().max(500).optional(),
});
export type OAuthAuthorizeQuery = z.infer<typeof OAuthAuthorizeQuery>;

export const OAuthAuthorizeCheck = z.object({
  client: z.object({ name: z.string(), redirectHost: z.string() }),
  member: MemberRef,
  /** False when the member hasn't been given Claude access; the page explains and offers no Allow. */
  allowed: z.boolean(),
});
export type OAuthAuthorizeCheck = z.infer<typeof OAuthAuthorizeCheck>;

/** POST /oauth/authorize — the member's answer. */
export const OAuthAuthorizeInput = OAuthAuthorizeQuery.extend({ approve: z.boolean() });
export type OAuthAuthorizeInput = z.infer<typeof OAuthAuthorizeInput>;

/** Where the browser goes next: the client's redirect URI with ?code&state, or ?error=access_denied&state. */
export const OAuthAuthorizeResult = z.object({ redirectTo: z.string() });
export type OAuthAuthorizeResult = z.infer<typeof OAuthAuthorizeResult>;

/* ---------------------------- Member: connected apps ---------------------------- */

export const ConnectedAppView = z.object({
  /** The grant id; DELETE /me/connected-apps/{id} disconnects it. */
  id: z.string().uuid(),
  clientName: z.string(),
  connectedAt: z.string(),
  lastUsedAt: z.string().nullable(),
  /** Actions logged in the last 7 days. */
  actionsLast7Days: z.number().int(),
});
export type ConnectedAppView = z.infer<typeof ConnectedAppView>;

/** GET /me/connected-apps */
export const ConnectedAppsView = z.object({
  /** Whether this account may connect Claude (staff, or given access by an admin). */
  mcpAccess: z.boolean(),
  apps: z.array(ConnectedAppView),
});
export type ConnectedAppsView = z.infer<typeof ConnectedAppsView>;

export const McpActivityView = z.object({
  id: z.string().uuid(),
  action: McpAction,
  clientName: z.string(),
  /** post, comment, member, connection, hashtag, chapter, page or draft. */
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  /** Link in the member app when there is one (a post, a member profile). */
  href: z.string().nullable(),
  createdAt: z.string(),
});
export type McpActivityView = z.infer<typeof McpActivityView>;

/** GET /me/connected-apps/activity and GET /admin/members/{id}/mcp-activity */
export const McpActivityQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type McpActivityQuery = z.infer<typeof McpActivityQuery>;

/* ---------------------------- Admin ---------------------------- */

/** PUT /admin/members/{id}/mcp-access (members.manage). Turning it off disconnects every Claude connection. */
export const AdminSetMcpAccessInput = z.object({ enabled: z.boolean() });
export type AdminSetMcpAccessInput = z.infer<typeof AdminSetMcpAccessInput>;
