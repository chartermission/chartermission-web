import { z } from 'zod';

/** Environment, validated once at start-up. See .env.example at the repo root. */

/** Boolean env flag: "true"/"1"/"on"/"yes" or "false"/"0"/"off"/"no" (z.coerce.boolean treats "false" as true). */
const flag = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v.trim() === '') return fallback;
      const x = v.trim().toLowerCase();
      if (['true', '1', 'on', 'yes'].includes(x)) return true;
      if (['false', '0', 'off', 'no'].includes(x)) return false;
      ctx.addIssue({ code: 'custom', message: 'Expected a boolean flag' });
      return z.NEVER;
    });

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().default('postgres://postgres@localhost:55432/chartermission'),
  REDIS_URL: z.string().default('redis://localhost:56379'),
  /** Comma-separated browser origins allowed to call the API (web and admin apps). */
  WEB_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  /** Public URL of the member web app, used in email links. */
  WEB_URL: z.string().default('http://localhost:3000'),
  ADMIN_URL: z.string().default('http://localhost:3001'),
  /** Public URL of the API as seen by browsers (through the web app's /api proxy in production). */
  API_PUBLIC_URL: z.string().default('http://localhost:3000/api/v1'),
  /** 32-byte key, base64, for AES-256-GCM encryption of MFA secrets. */
  APP_ENCRYPTION_KEY: z.string().default('ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzItYnl0ZXM='),
  /** Secret for hashing IPs and signing upload URLs. */
  APP_SECRET: z.string().default('dev-only-secret-change-me'),
  COOKIE_DOMAIN: z.string().optional(),
  /** "log" writes emails to the outbox and the console; "resend" sends through Resend; "smtp" through any SMTP server. */
  MAIL_DRIVER: z.enum(['log', 'resend', 'smtp']).default('log'),
  RESEND_API_KEY: z.string().optional(),
  /** SMTP server for MAIL_DRIVER=smtp (self-hosted mailcow: mail.chartermission.com, 587, STARTTLS). */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  /** true = implicit TLS (port 465); false = STARTTLS upgrade, required (port 587). */
  SMTP_SECURE: flag(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Charter Mission <no-reply@chartermission.com>'),
  /** "local" stores uploads on disk (dev); "s3" uses any S3-compatible bucket (R2, Railway, AWS). */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.uploads'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** clamd host for malware scanning; when unset a built-in signature check runs (dev only). */
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  /** ffmpeg / ffprobe binaries for video; default to the bundled @ffmpeg-installer packages, then the PATH. */
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
  /** Check new passwords against Have I Been Pwned (k-anonymity range API). */
  HIBP_ENABLED: flag(false),
  /** Run BullMQ workers in this process (true for dev and a single Railway service). */
  RUN_WORKERS: flag(true),
  /** Expose /api/v1/dev/* helpers (mailbox) outside production. */
  DEV_TOOLS: flag(true),
  /**
   * Charter Center partner API (Learning, spec 4.10): https://charter-center.com/api/partner
   * (we read GET {url}/courses?page=n). Unset: the catalogue comes from the JSON fixture in
   * src/learning/fixtures (dev, tests, demo).
   */
  CHARTER_CENTER_API_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  /** Charter Center partner API key, sent as Authorization: Bearer <key>. Set it in the environment, never in code. */
  CHARTER_CENTER_API_KEY: z.string().optional().or(z.literal('').transform(() => undefined)),
  /**
   * Course page members are sent to ("Start learning"); {id} is the Charter Center course id. The
   * partner API doesn't return a link, so confirm this pattern with Charter Center.
   */
  CHARTER_CENTER_COURSE_URL: z.string().default('https://charter-center.com/courses/{id}'),
  /**
   * Web Push (browser notifications for messages). Generate a pair once with
   * `npx web-push generate-vapid-keys`; unset turns push off.
   */
  VAPID_PUBLIC_KEY: z.string().optional().or(z.literal('').transform(() => undefined)),
  VAPID_PRIVATE_KEY: z.string().optional().or(z.literal('').transform(() => undefined)),
  VAPID_SUBJECT: z.string().default('mailto:support@chartermission.com'),
  /**
   * "Translate" on messages: deepl (DEEPL_API_KEY), libretranslate (LIBRETRANSLATE_URL, optional
   * LIBRETRANSLATE_API_KEY) or anthropic (ANTHROPIC_API_KEY). Unset hides the button. "fake" is for tests.
   */
  TRANSLATE_PROVIDER: z.enum(['deepl', 'libretranslate', 'anthropic', 'fake']).optional().or(z.literal('').transform(() => undefined)),
  DEEPL_API_KEY: z.string().optional().or(z.literal('').transform(() => undefined)),
  LIBRETRANSLATE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  LIBRETRANSLATE_API_KEY: z.string().optional().or(z.literal('').transform(() => undefined)),
  ANTHROPIC_API_KEY: z.string().optional().or(z.literal('').transform(() => undefined)),
  TRANSLATE_MODEL: z.string().default('claude-haiku-4-5'),
});

export type Env = z.infer<typeof Env>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = Env.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment: ${parsed.error.message}`);
    }
    if (parsed.data.NODE_ENV === 'production') {
      for (const key of ['APP_ENCRYPTION_KEY', 'APP_SECRET'] as const) {
        if (!process.env[key]) throw new Error(`${key} must be set in production`);
      }
      parsed.data.DEV_TOOLS = false;
    }
    if (parsed.data.MAIL_DRIVER === 'smtp') {
      for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const) {
        if (!parsed.data[key]) throw new Error(`${key} must be set when MAIL_DRIVER=smtp`);
      }
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProd = () => env().NODE_ENV === 'production';
