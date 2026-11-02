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

Requires Node 22 and pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Run one app: `pnpm dev:web`, `pnpm dev:admin` or `pnpm dev:api`.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

CI runs the same four steps on every pull request (`.github/workflows/ci.yml`).

## Conventions

- Styling uses Tailwind v4 with the tokens in `packages/ui/src/styles/tokens.css` (colours such as `bg-primary`, `text-ink`, `border-line`; type such as `text-h2`, `text-sm`). Do not hard-code hex values in apps.
- Icons: `<Icon name="calendar" size={20} />` from `@chartermission/ui`. Paths are exported from Figma; colour follows `currentColor`.
- Server components by default; add `"use client"` only to interactive leaves.
- Screens currently read placeholder data from `apps/web/src/lib/mock-data.ts` and `apps/web/src/lib/mock/*`. Replace these with API calls as endpoints land.
- Next.js 16 differs from older versions; read `node_modules/next/dist/docs/` before using unfamiliar APIs.
