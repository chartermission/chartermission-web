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

All seeded accounts use the password `CharterMission@123` and have verified emails and finished onboarding.

| Email | Role |
| --- | --- |
| admin@chartermission.com | Super Admin |
| platform-admin@chartermission.com | Platform Admin |
| moderator@chartermission.com | Moderator |
| amb-manager@chartermission.com | Ambassador Manager (Nigeria, Ghana, Kenya) |
| amara@example.com | Member, Founding Ambassador for Nigeria |
| kofi@example.com | Member, Ambassador onboarding (Ghana) |
| owais@, team@, aisha@, kwame@, wanjiru@, leila@, thabo@, fatou@, yohannes@, chinedu@example.com | Members |
| promo@example.com | Spam account with reported content (the Moderator's demo queue) |

Two-step verification is mandatory for staff accounts (anyone with an admin-console role or the staff flag), in
the admin console and the member app, and they can't turn it off. Outside production the seed turns it on for
the four staff accounts with fixed keys, listed with QR codes in the demo accounts PDF
(`docs/Charter-Mission-Test-Accounts.pdf`): add them to an authenticator app once and use its codes to sign in.
In production staff set it up on their first sign-in. Members can turn on the same protection in Settings → Security.

### Reference data and demo data

- **Reference data** (countries, taxonomies, chapters, topics, badges, roles) comes from `seedReference`, which
  `db:bootstrap:prod` runs on every API start. It is safe on a live database: catalogues are versioned
  (`REFERENCE_SEED_VERSIONS`), new versions only add what is missing, and nothing an admin or Ambassador changed is
  overwritten. Every chapter gets its own hashtag (`#Nigeria`, `#UKDiaspora`) and an About text for its country; chapter
  logos and covers are drawn from the chapter's name and flag colours until an admin uploads a picture.
- **Demo data** (`db:seed`, `db:reset`) is for empty development databases only. Both refuse to run when the database
  has accounts that are not demo accounts; to reset a local database you registered your own account in, add
  `--confirm-database=chartermission`. The e2e tests only run against a database whose name contains `_test`.

### Pages, verification and post analytics

- **Official accounts are follow-only.** An account with the staff flag (set by `bootstrap --super-admin`, or when someone
  is made an Ambassador Manager) can be followed but not connected with, in both directions. Existing connections become follows.
- **Pages** (`/pages`) are for organisations, companies and initiatives. Members follow them; page admins post as the page
  (the admin's name is never shown). Admin console → Pages creates pages, reviews the ones members create and holds the
  "Who can create pages" setting (review first, open, or team only).
- **Verification**: members apply in Settings → Verification, page admins from Manage page. Admin console → Verification
  approves or declines with a note.
- **Post analytics**: `/posts/{id}/analytics` for a post's author (or the page's admins) and `/analytics` for the overview.
  Views are stored against a keyed hash of the viewer, so reach can be counted but nobody can list who viewed a post.
- **Articles** are written on `/articles/new`; the landing page reads live numbers from `GET /public/overview`.

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

Opportunities, initiatives, chapter pages and organisations still use placeholder data
(`apps/web/src/lib/mock*`); they are later phases.

## Production notes

- API (Railway): set `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `APP_ENCRYPTION_KEY`, `APP_SECRET`,
  `WEB_ORIGINS`, `WEB_URL`, `ADMIN_URL`, `MAIL_DRIVER=smtp` + `SMTP_*` (or `resend` + `RESEND_API_KEY`), `STORAGE_DRIVER=s3` + `S3_*`, and
  `CLAMAV_HOST` (a clamd service). Run `pnpm --filter @chartermission/api db:migrate:prod` as the release step and
  `start:prod` to serve.
- Web and admin (Vercel): set `API_INTERNAL_URL` to the API's `/api/v1` URL, and `NEXT_PUBLIC_WEB_URL` on admin.

## Conventions

- Styling uses Tailwind v4 with the tokens in `packages/ui/src/styles/tokens.css` (colours such as `bg-primary`, `text-ink`, `border-line`; type such as `text-h2`, `text-sm`). Do not hard-code hex values in apps.
- Icons: `<Icon name="calendar" size={20} />` from `@chartermission/ui`. Paths are exported from Figma; colour follows `currentColor`.
- Server components by default; add `"use client"` only to interactive leaves.
- Server components read data with `apiGet()` from `src/lib/api/server.ts` inside `<Suspense>`; client components mutate with `api()` from `src/lib/api/client.ts`. Types come from `@chartermission/contracts`.
- Next.js 16 differs from older versions; read `node_modules/next/dist/docs/` before using unfamiliar APIs.
# chartermission-web
