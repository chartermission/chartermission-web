import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiClient } from './api-client.js';
import { Links } from './format.js';
import type { Config } from './env.js';
import { registerPostTools } from './tools/posts.js';
import { registerPeopleTools } from './tools/people.js';
import { registerExploreTools } from './tools/explore.js';

export const SERVER_NAME = 'charter-mission';
export const SERVER_VERSION = '0.1.0';

export const INSTRUCTIONS = `Charter Mission is a professional network for Africa and its diaspora. These tools act as ONE signed-in member (call whoami if unsure who), with that member's own permissions and nothing more.

Rules:
- Act only for this member, on their request. Write posts, comments and notes in their voice, language and tone; never invent facts about them.
- Before publishing a post, publishing a draft, sending a connection request or deleting anything, show the member the exact content (or name exactly what will be deleted) and get their confirmation, unless they already asked for exactly that.
- No generic or spammy engagement: no mass reactions, no "Great post!" comments, no bulk connection requests or follows. Every comment must be specific to the post.
- Claude's actions are limited per hour and per day for each member (for example at most 5 posts an hour, publishing, scheduling and publishing drafts together). When a tool reports a limit, tell the member and stop; do not retry.
- Everything Claude does is shown to the member in Settings → Connected apps.
- Results are compact JSON; share links (url) with the member when helpful. Use nextCursor to read further pages.`;

/** A fresh server for one request: stateless, bound to the caller's token. */
export function createMcpServer(config: Config, token: string, onUnauthorized?: () => void): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION, title: 'Charter Mission' }, { instructions: INSTRUCTIONS });
  const ctx = { api: new ApiClient(config.API_INTERNAL_URL, token, onUnauthorized), links: new Links(config.WEB_URL) };
  registerPeopleTools(server, ctx);
  registerPostTools(server, ctx);
  registerExploreTools(server, ctx);
  return server;
}
