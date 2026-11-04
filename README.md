# chartermission

Monorepo for the Charter Mission platform.

| Path | What it is | Port | Deploys to |
| --- | --- | --- | --- |
| `apps/web` | Public site and member platform (Next.js 16, App Router) | 3000 | Vercel |
| `apps/admin` | Admin and moderation console (Next.js 16) | 3001 | Vercel |
| `apps/api` | REST API at `/api/v1` (NestJS 12) | 4000 | Railway |
| `packages/ui` | Design system from Figma: tokens, icons, components | — | — |
| `packages/contracts` | Shared zod schemas and types | — | — |
| `packages/config` | Shared TypeScript config | — | — |

Design source: Figma file "Charter Mission" (`TtD0c9JECx7nuMgQIdtaOI`), pages Foundations & Components, Web and Mobile.

## Getting started

Requires Node 22, pnpm 10 (`corepack enable`) and Docker (for PostgreSQL 16 and Redis 7).

```bash
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
pnpm --filter @chartermission/contracts build
pnpm --filter @chartermission/api db:migrate
pnpm --filter @chartermission/api db:seed
pnpm dev
```

Then open http://localhost:3000 (members) and http://localhost:3001 (admin console). The browser only talks to the
Next apps: both proxy `/api/v1/*` to the API (`API_INTERNAL_URL`), so session cookies stay first-party.

Run one app: `pnpm dev:web`, `pnpm dev:admin` or `pnpm dev:api`. Reset demo data with
`pnpm --filter @chartermission/api db:reset`.

The Docker services listen on uncommon ports, PostgreSQL on **55432** and Redis on **56379**, so they don't clash with
other servers on the same machine (Homebrew, Postgres.app or other projects' containers). If one is taken, pick another
port and point the API at it, for example `CM_POSTGRES_PORT=55433 CM_REDIS_PORT=56380 docker compose up -d` with
`DATABASE_URL=postgres://postgres@localhost:55433/chartermission` and `REDIS_URL=redis://localhost:56380` in
`apps/api/.env`. In development the API checks the
database when it starts and logs what to run if it is unreachable, empty or behind on migrations; unexpected errors also
show their real cause on the page.

### Demo accounts

All seeded accounts use the password `charter-mission-demo` and have verified emails and finished onboarding.

| Email | Role |
| --- | --- |
| owais@example.com | Super Admin |
| team@example.com | Platform Admin (official "Charter Mission" account) |
| aisha@example.com | Moderator |
| amara@, kwame@, wanjiru@, leila@, thabo@, fatou@, yohannes@, chinedu@example.com | Members |

The admin console requires two-step verification. The first admin sign-in walks through setting up an
authenticator app (scan the QR code); after that every admin sign-in asks for a code. Members can turn on the
same protection in Settings → Security.

### Emails in development

With `MAIL_DRIVER=log` nothing is sent: emails go to the `email_outbox` table and the API log. The check-email
screen shows the verification link, and `GET http://localhost:4000/api/v1/dev/mailbox?to=<email>` lists recent
emails for an address (development only; disabled in production).

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @chartermission/api test:e2e
```

The API end-to-end suite needs PostgreSQL and Redis (the `docker compose` services; it uses the
`chartermission_test` database and Redis db 1). CI runs all of these on every pull request
(`.github/workflows/ci.yml`).

## Phase 1 scope

Working end to end: registration with email verification, sign-in (lockout, two-step verification), password
reset, sessions, consent records and policy re-acceptance, onboarding, profiles with per-field privacy, the member
directory, connections, follows, blocks and mutes, the feed (For you / Following / Latest), posts with images,
PDFs, polls and link previews, comments and replies, reactions, reposts, bookmarks, hashtags, topic pages,
trending topics, notifications and preferences, reporting, moderation actions, appeals, trending controls and
the audit log.

Opportunities, events, learning, initiatives, chapters and organisations still use placeholder data
(`apps/web/src/lib/mock*`); they are later phases.

## Production notes

- API (Railway): set `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `APP_ENCRYPTION_KEY`, `APP_SECRET`,
  `WEB_ORIGINS`, `WEB_URL`, `ADMIN_URL`, `MAIL_DRIVER=resend` + `RESEND_API_KEY`, `STORAGE_DRIVER=s3` + `S3_*`, and
  `CLAMAV_HOST` (a clamd service). Run `pnpm --filter @chartermission/api db:migrate:prod` as the release step and
  `start:prod` to serve.
- Web and admin (Vercel): set `API_INTERNAL_URL` to the API's `/api/v1` URL, and `NEXT_PUBLIC_WEB_URL` on admin.

## Conventions

- Styling uses Tailwind v4 with the tokens in `packages/ui/src/styles/tokens.css` (colours such as `bg-primary`, `text-ink`, `border-line`; type such as `text-h2`, `text-sm`). Do not hard-code hex values in apps.
- Icons: `<Icon name="calendar" size={20} />` from `@chartermission/ui`. Paths are exported from Figma; colour follows `currentColor`.
- Server components by default; add `"use client"` only to interactive leaves.
- Server components read data with `apiGet()` from `src/lib/api/server.ts` inside `<Suspense>`; client components mutate with `api()` from `src/lib/api/client.ts`. Types come from `@chartermission/contracts`.
- Next.js 16 differs from older versions; read `node_modules/next/dist/docs/` before using unfamiliar APIs.
