# Deploying Charter Mission on Coolify

One VPS (Contabo, Ubuntu 24.04) running Coolify v4. Everything lives in the Coolify project
**Charter Mission**, environment **production**, on the default `coolify` Docker network.

```
Browser ──https──> chartermission.com        ──> web   (Next.js, :3000) ──┐
Browser ──https──> admin.chartermission.com  ──> admin (Next.js, :3001) ──┤ /api/v1/* rewrites
                                                                          ▼
                                          cm-api (NestJS, :4000, no public domain)
                                             ├── PostgreSQL 16 (internal)
                                             ├── Redis 7 (internal)
                                             ├── ClamAV (internal, :3310)
                                             └── Cloudflare R2 (uploads, video)
```

The browser never calls the API directly: both Next.js apps proxy `/api/v1/*` to it, so session
cookies stay first-party. The API therefore needs no public domain.

## 1. DNS (A records → server IP)

| Host | Resource |
|---|---|
| `chartermission.com`, `www` | web |
| `admin` | admin |
| `coolify` | Coolify dashboard |

## 2. Databases (Coolify → + New → Database)

- **PostgreSQL 16** — not publicly available. Copy the *Postgres URL (internal)*.
- **Redis 7** — not publicly available. Copy the *Redis URL (internal)*.
- Enable scheduled backups for PostgreSQL (S3 / R2 destination).

## 3. ClamAV (malware scanning for uploads)

+ New → Docker Image → `clamav/clamav:stable`. No domain. Ports Exposes `3310`.
Network alias / container name: `cm-clamav`. Give it ~2 GB memory; first start downloads signatures (a few minutes).

## 4. Applications (+ New → Private Repository (GitHub App) → this repo, branch `main`)

All three use **Build Pack: Dockerfile**, **Base Directory: `/`**.

| | api | web | admin |
|---|---|---|---|
| Dockerfile Location | `/apps/api/Dockerfile` | `/apps/web/Dockerfile` | `/apps/admin/Dockerfile` |
| Ports Exposes | `4000` | `3000` | `3001` |
| Domains | *(none)* | `https://chartermission.com,https://www.chartermission.com` | `https://admin.chartermission.com` |
| Network alias | `cm-api` | – | – |
| Health check path | `/api/v1/health` | `/` | `/` (follows redirect) |
| Watch paths | `apps/api/**` `packages/contracts/**` `pnpm-lock.yaml` | `apps/web/**` `packages/**` `pnpm-lock.yaml` | `apps/admin/**` `packages/**` `pnpm-lock.yaml` |
| Persistent storage | only if `STORAGE_DRIVER=local`: volume at `/app/.uploads` | – | – |

Deploy order: databases → ClamAV → **api** → web → admin.

If your Coolify version has no network-alias field, use the api container's internal hostname
shown in its settings instead of `cm-api` in `API_INTERNAL_URL` below.

## 5. Environment variables

### api

```
NODE_ENV=production
PORT=4000
DATABASE_URL=<Postgres internal URL>
REDIS_URL=<Redis internal URL>
WEB_ORIGINS=https://chartermission.com,https://www.chartermission.com,https://admin.chartermission.com
WEB_URL=https://chartermission.com
ADMIN_URL=https://admin.chartermission.com
API_PUBLIC_URL=https://chartermission.com/api/v1
APP_ENCRYPTION_KEY=<openssl rand -base64 32>
APP_SECRET=<openssl rand -hex 32>
MAIL_DRIVER=resend
RESEND_API_KEY=<Resend key; verify chartermission.com in Resend>
MAIL_FROM=Charter Mission <no-reply@chartermission.com>
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<R2 key id>
S3_SECRET_ACCESS_KEY=<R2 secret>
CLAMAV_HOST=cm-clamav
CLAMAV_PORT=3310
HIBP_ENABLED=true
RUN_WORKERS=true
DEV_TOOLS=false
CHARTER_CENTER_API_URL=https://charter-center.com/api/partner
CHARTER_CENTER_API_KEY=<partner key>
CHARTER_CENTER_COURSE_URL=https://charter-center.com/courses/{id}
```

`APP_ENCRYPTION_KEY` encrypts staff two-step secrets: store it in the password manager and never
change it, or every staff member must re-enrol.

R2 bucket CORS: allow `PUT` with `Content-Type` from `https://chartermission.com` and
`https://admin.chartermission.com` (browsers upload straight to the bucket).

### web — tick **Available at Buildtime** on both

```
API_INTERNAL_URL=http://cm-api:4000/api/v1
```

### admin — tick **Available at Buildtime** on both

```
API_INTERNAL_URL=http://cm-api:4000/api/v1
NEXT_PUBLIC_WEB_URL=https://chartermission.com
```

`API_INTERNAL_URL` is baked into the Next.js rewrites at build time; changing it needs a redeploy.

## 6. What happens on each api deploy

The container runs `migrate.js` (pending Drizzle migrations), then `bootstrap.js` (countries,
taxonomies, chapters, roles, permissions, setting defaults — idempotent, no demo data), then the server.
Never run `db:seed` against production.

## 7. First Super Admin

1. Register the account on https://chartermission.com and verify the email.
2. In Coolify → api → Terminal:
   ```
   node dist/db/bootstrap.js --super-admin you@example.com
   ```
3. Sign in at https://admin.chartermission.com; two-step verification enrolment is required.

## 8. Checks after the first deploy

- `https://chartermission.com/api/v1/health` returns `{"status":"ok"}` (web → api proxy works).
- Sign-up email arrives (Resend), image upload works (R2 + CORS), a short video upload converts (ffmpeg).
- Learning → admin "Sync now" pulls the Charter Center catalogue.
