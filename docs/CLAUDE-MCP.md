# Claude on Charter Mission (MCP)

Members can connect Claude to their own Charter Mission account. Once connected, they can ask Claude to write and
publish posts, react and comment, read their feed, notifications and analytics, send and accept connection
requests, and follow members, chapters, topics and pages. Claude always acts as that member, under the same rules
as the member app.

## Who can connect

- **Staff accounts** (team members) can always connect.
- **Other members** can connect only after an admin turns on **Claude access** for them: admin console → Members →
  the member → *Claude access*. Turning it off disconnects Claude from their account straight away.

Everyone else who tries sees "Claude access isn't turned on for your account" on the connect screen.

## What Claude can and can't do

| Can | Can't |
|---|---|
| Publish, schedule, edit and delete the member's posts and drafts | Change the profile, password, email or settings |
| React, comment and reply | Read or send messages |
| Read the feed, a post's comments, notifications and analytics | Use admin, moderation or announcement tools |
| Search members, send and accept connection requests | Act as anyone other than the member who connected |
| Follow and unfollow members, chapters, topics and pages | Exceed the hourly and daily limits below |

The API enforces these rules, not Claude. A Claude token only reaches an allow-list of member routes, and it carries
only member permissions, even for staff.

### Limits for each member

| Action | Per hour | Per day |
|---|---|---|
| Posts: publishing, scheduling and publishing drafts, counted together | 5 | 20 |
| Save a draft (no publish time) | 10 | 40 |
| Comment | 20 | 100 |
| React | 60 | 300 |
| Connection request | 15 | 40 |
| Follow | 30 | 100 |

The limits live in `packages/contracts/src/mcp.ts` (`MCP_LIMITS`, `MCP_LIMIT_BUCKETS`). They are reserved
atomically before each action, so parallel requests can't go past them.

### Activity log

Every action Claude takes is logged. Members see it in **Settings → Connected apps**, where they can also disconnect.
Admins see it on the member in the console.

## How members connect

**claude.ai, Claude Desktop or Claude mobile:** Settings → Connectors → *Add custom connector*.

- Name: `Charter Mission`
- URL: `https://mcp.chartermission.com/mcp`

Claude opens chartermission.com. The member signs in if needed, checks the screen and clicks **Allow**.

**Claude Code:**

```bash
claude mcp add --transport http charter-mission https://mcp.chartermission.com/mcp
```

Then run `/mcp` in Claude Code and choose *Authenticate*.

Things to try: "Draft a post for the Kenya chapter about our mentorship programme and show it to me first",
"React to and comment on the three latest posts in my Following feed that are about fintech", or "Accept my pending
connection requests from people in Ghana".

## How it works

```
Claude ──> mcp.chartermission.com (apps/mcp)
             /.well-known/oauth-*      OAuth metadata (the MCP app is the issuer)
             GET  /authorize      ──>  chartermission.com/connect  (consent page, member's normal session)
             POST /register|/token|/revoke ──> API /oauth/*        (clients, codes and tokens live in Postgres)
             POST /mcp            ──>  API /api/v1/...  with  Authorization: Bearer <member token>
```

- OAuth 2.1 authorization code with PKCE (S256), dynamic client registration for public clients. Redirect URIs must
  be one of the exact URLs in `OAUTH_REDIRECT_URIS` (default: Claude's callback on claude.ai and claude.com), or a
  localhost address for Claude Code and Desktop.
- Access tokens last 1 hour and refresh tokens 30 days. Refreshing rotates both. A retry with the previous refresh
  token within 60 seconds is accepted, because networks drop responses. After that, reuse revokes the connection.
  Only SHA-256 hashes are stored.
- The API re-checks access on every request. Each of these stops Claude immediately: disconnecting it, removing
  the account's Claude access, suspending the account, changing or resetting the password, or requesting deletion.
- The consent page can't be shown inside a frame on another site, and it warns members not to continue from a link
  someone else sent them.

## Deploying (Coolify)

### 1. DNS (Namecheap)

Add an **A record** with host `mcp`, pointing to the server IP.

### 2. API

After this release deploys, the migration adds the new tables. The defaults are right for Claude. Set this only if
Claude's callback address changes:

```
OAUTH_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback
```

### 3. New application: mcp

Go to **+ New → Private Repository (GitHub App)**, choose this repo and branch `main`.

| Setting | Value |
|---|---|
| Build Pack | Dockerfile |
| Base Directory | `/` |
| Dockerfile Location | `/apps/mcp/Dockerfile` |
| Ports Exposes | `4100` |
| Domains | `https://mcp.chartermission.com` |
| Health check path | `/health` |
| Watch paths | `apps/mcp/**` `packages/contracts/**` `pnpm-lock.yaml` |

Environment:

```
NODE_ENV=production
PORT=4100
PUBLIC_URL=https://mcp.chartermission.com
API_INTERNAL_URL=http://cm-api:4000/api/v1
WEB_URL=https://chartermission.com
```

Deploy the API first, then web, then admin, then mcp.

### 4. Check it

- `https://mcp.chartermission.com/health` returns `{"status":"ok"}`.
- `https://mcp.chartermission.com/.well-known/oauth-authorization-server` returns JSON.
- `curl -i -X POST https://mcp.chartermission.com/mcp` returns `401` with a `WWW-Authenticate` header.
- In the admin console, turn on Claude access for a test member. Connect Claude as that member, ask it to
  "show my latest notifications", then check **Settings → Connected apps**.
