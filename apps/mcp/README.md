# Charter Mission MCP server

Lets a member connect Claude (claude.ai custom connector, Claude Desktop, Claude Code) to their own
Charter Mission account. Claude acts strictly as that member through the API's normal rules, limited
to posting, engagement and reading routes, with hourly limits and an activity log
(Settings → Connected apps). Only staff and members an admin has given Claude access can connect.

Connector URL: `https://mcp.chartermission.com/mcp`

## How it works

- **OAuth** (2.1, authorization code + PKCE, dynamic client registration). This server publishes the
  discovery metadata (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`)
  with itself as issuer. `GET /authorize` redirects to the member app's consent page (`/connect`);
  `POST /register`, `/token`, `/revoke` are relayed to the API (`/oauth/*`), which issues and stores tokens.
- **MCP** at `POST /mcp` (Streamable HTTP, stateless: a new server per request, JSON responses).
  The bearer token is checked with the API (`GET /me`, cached 30 s and dropped on any 401); every tool call then goes to the
  API with that token. No token or a rejected one → `401` with `WWW-Authenticate`, which starts the
  OAuth flow in Claude.
- **Tools** (33) cover the feed, posts, drafts and scheduled posts, comments, reactions, notifications,
  analytics, members, connection requests, follows, chapters, topics, trending and the member's pages.
  Results are compact JSON with links into the member app.

## Run

```sh
cp .env.example .env      # PUBLIC_URL, API_INTERNAL_URL, WEB_URL
pnpm --filter @chartermission/mcp dev
```

`pnpm --filter @chartermission/mcp test` runs the tests against a fake API. To try it with a real
client, run the API and web app locally and add `http://localhost:4100/mcp` as a connector in Claude
Code (`claude mcp add --transport http charter http://localhost:4100/mcp`).

## Deploy

`apps/mcp/Dockerfile` (build context: repository root), port 4100, health check `GET /health`.
Environment: `PUBLIC_URL=https://mcp.chartermission.com`, `API_INTERNAL_URL=http://cm-api:4000/api/v1`,
`WEB_URL=https://chartermission.com`. The API needs `OAUTH_REDIRECT_URIS` if Claude's callback hosts change.
