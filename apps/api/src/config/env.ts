import { z } from 'zod';

/** Environment, validated once at start-up. See .env.example at the repo root. */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().default('postgres://postgres@localhost:5432/chartermission'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
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
  /** "log" writes emails to the outbox and the console; "resend" sends through Resend. */
  MAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Charter Mission <no-reply@chartermission.org>'),
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
  /** Check new passwords against Have I Been Pwned (k-anonymity range API). */
  HIBP_ENABLED: z.coerce.boolean().default(false),
  /** Run BullMQ workers in this process (true for dev and a single Railway service). */
  RUN_WORKERS: z.coerce.boolean().default(true),
  /** Expose /api/v1/dev/* helpers (mailbox) outside production. */
  DEV_TOOLS: z.coerce.boolean().default(true),
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
    cached = parsed.data;
  }
  return cached;
}

export const isProd = () => env().NODE_ENV === 'production';
