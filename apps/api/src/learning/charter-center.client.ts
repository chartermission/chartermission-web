import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CharterCenterCourseRecord, CharterCenterPathRecord } from '@chartermission/contracts';
import { parseCoursesPage, parsePathsPage } from './charter-center.mapper.js';
import { parsePartnerCourseDetail, parsePartnerCoursesPage } from './charter-center.partner.js';

/**
 * Source of the Learning catalogue. Course content is managed on Charter Center; we only read it.
 *  - HttpCharterCenterClient: the real partner API (CHARTER_CENTER_API_URL, e.g.
 *    https://charter-center.com/api/partner; see charter-center.partner.ts for its shape).
 *  - FixtureCharterCenterClient: the JSON fixture in ./fixtures (dev, tests, demo).
 */
export interface CharterCenterClient {
  /** Human label for logs and sync errors, e.g. "Charter Center API" or "fixture". */
  readonly source: string;
  /**
   * Every course (all pages). With updatedSince, only courses changed since then (incremental).
   * reuseDetails: the details (outcomes, requirements) already stored for an unchanged course, so the
   * client can skip asking for them again; return null to have them fetched.
   */
  listCourses(opts?: ListCoursesOptions): Promise<CharterCenterCourseRecord[]>;
  listPaths(): Promise<CharterCenterPathRecord[]>;
}

export const CHARTER_CENTER_CLIENT = Symbol('CHARTER_CENTER_CLIENT');

export type StoredDetails = { outcomes: string[]; eligibility: string | null };

export interface ListCoursesOptions {
  updatedSince?: Date;
  reuseDetails?: (record: CharterCenterCourseRecord) => StoredDetails | null;
}

/**
 * Fingerprint of what the course list says about a course. When it is unchanged since the details
 * were last fetched, the details are reused instead of asking Charter Center again.
 */
export function listFingerprint(r: CharterCenterCourseRecord): string {
  const parts = [r.title, r.description, r.level, r.topics.join('|'), r.duration_minutes, r.lessons_count, r.is_free, r.access_conditions, r.url, r.thumbnail_url, r.status];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

export class CharterCenterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  baseUrl: string;
  apiKey?: string;
  /** Injected for tests; defaults to global fetch. */
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Attempts per request for network errors and 5xx. */
  attempts?: number;
  /** First backoff delay; doubles each retry. */
  backoffMs?: number;
  /**
   * Smallest gap between two requests to Charter Center, so a sync never bursts past its rate limit
   * (Laravel's default is 60 requests a minute). Default 1100 ms (about 55 a minute).
   */
  minGapMs?: number;
  /** Times a request is retried after HTTP 429 (Too Many Requests). Default 5. */
  rateLimitRetries?: number;
  /** Wait after a 429 that sends no Retry-After; doubles each time. Default 5 s. */
  rateLimitWaitMs?: number;
  /** Longest single wait for a rate limit (Retry-After is capped to this). Default 120 s. */
  maxWaitMs?: number;
  /** Safety stop for runaway pagination. */
  maxPages?: number;
  /** Course page link; "{id}" is replaced with the Charter Center course id (when the API sends none). */
  courseUrlTemplate?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpCharterCenterClient implements CharterCenterClient {
  readonly source = 'Charter Center API';
  private readonly base: string;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly maxPages: number;
  private readonly minGapMs: number;
  private readonly rateLimitRetries: number;
  private readonly rateLimitWaitMs: number;
  private readonly maxWaitMs: number;
  /** Requests go out one at a time, each at least minGapMs after the last, or after a rate-limit reset. */
  private gate: Promise<void> = Promise.resolve();
  private notBefore = 0;
  /** Requests made by the last listCourses (logged with the sync, and checked by tests). */
  lastRequestCount = 0;

  constructor(private readonly opts: HttpClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.attempts = Math.max(1, opts.attempts ?? 3);
    this.backoffMs = opts.backoffMs ?? 1_000;
    this.maxPages = opts.maxPages ?? 500;
    this.minGapMs = opts.minGapMs ?? 1_100;
    this.rateLimitRetries = opts.rateLimitRetries ?? 5;
    this.rateLimitWaitMs = opts.rateLimitWaitMs ?? 5_000;
    this.maxWaitMs = opts.maxWaitMs ?? 120_000;
  }

  /**
   * Every course, page by page (current_page / last_page). The partner API has no "changed since"
   * filter, so updatedSince is ignored and each sync reads the whole catalogue (about 100 courses).
   */
  async listCourses(opts: ListCoursesOptions = {}): Promise<CharterCenterCourseRecord[]> {
    this.lastRequestCount = 0;
    const out: CharterCenterCourseRecord[] = [];
    const template = this.opts.courseUrlTemplate ?? 'https://charter-center.com/courses/{id}';
    const courseUrl = (id: string) => template.replace('{id}', encodeURIComponent(id));
    let page: number | null = 1;
    let fetched = 0;
    while (page !== null) {
      if (++fetched > this.maxPages) throw new CharterCenterError(`Charter Center returned more than ${this.maxPages} pages of courses`);
      const body = parsePartnerCoursesPage(await this.getJson(`/courses?page=${page}`), courseUrl);
      out.push(...body.records);
      if (body.page !== page) throw new CharterCenterError(`Charter Center pagination did not advance (asked for page ${page}, got ${body.page})`);
      page = body.page < body.lastPage ? body.page + 1 : null;
    }
    await this.addDetails(out, opts.reuseDetails);
    return out;
  }

  /**
   * Fills outcomes and requirements from GET /courses/{id}, one course at a time (requests are paced
   * by the gate). Unchanged courses reuse the details stored last time (reuseDetails), so after the
   * first sync only new or changed courses cost a request. Each record says whether its details were
   * fetched (details_fetched) and carries its list fingerprint (list_fingerprint) for the sync to
   * store. Any failure (after retries) fails the whole sync, so a half-read catalogue never
   * overwrites good data.
   */
  private async addDetails(records: CharterCenterCourseRecord[], reuse?: ListCoursesOptions['reuseDetails']): Promise<void> {
    for (const r of records) {
      Object.assign(r, { list_fingerprint: listFingerprint(r) });
      const stored = reuse?.(r);
      if (stored) {
        r.outcomes = stored.outcomes;
        r.eligibility = stored.eligibility;
        Object.assign(r, { details_fetched: false });
        continue;
      }
      const detail = parsePartnerCourseDetail(await this.getJson(`/courses/${encodeURIComponent(r.id)}`));
      r.outcomes = detail.outcomes;
      r.eligibility = detail.eligibility;
      Object.assign(r, { details_fetched: true });
    }
  }

  /** Waits for this request's turn: one at a time, minGapMs apart, and not before a rate-limit reset. */
  private async turn(): Promise<void> {
    const mine = this.gate.then(async () => {
      const wait = this.notBefore - Date.now();
      if (wait > 0) await sleep(wait);
      this.notBefore = Date.now() + this.minGapMs;
    });
    this.gate = mine.catch(() => undefined);
    await mine;
  }

  /**
   * How long Charter Center asks us to wait: Retry-After (seconds or a date), else the reset time of
   * an exhausted X-RateLimit window, else null.
   */
  private static askedWaitMs(res: Response): number | null {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
      const at = Date.parse(retryAfter);
      if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
    }
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (res.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset > 0) {
      // Seconds until reset, or an epoch time in seconds.
      return Math.max(0, reset > 1e9 ? reset * 1000 - Date.now() : reset * 1000);
    }
    return null;
  }

  /** The partner API has no learning paths yet. */
  async listPaths(): Promise<CharterCenterPathRecord[]> {
    return [];
  }

  /**
   * GET with Bearer auth and a timeout. Network errors and 5xx are retried with exponential backoff
   * (attempts). HTTP 429 waits as long as Charter Center asks (Retry-After / X-RateLimit-Reset,
   * capped at maxWaitMs) or rateLimitWaitMs doubling, up to rateLimitRetries times, and holds every
   * later request back until then too.
   */
  private async getJson(pathAndQuery: string): Promise<unknown> {
    const url = `${this.base}${pathAndQuery}`;
    let lastError: CharterCenterError | undefined;
    let failures = 0;
    let limited = 0;
    for (;;) {
      if (failures >= this.attempts) break;
      if (failures > 0 && limited === 0) await sleep(this.backoffMs * 2 ** (failures - 1));
      await this.turn();
      this.lastRequestCount++;
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'CharterMission/1.0 (+catalogue sync)',
            ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
          },
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: 'follow',
        });
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        lastError = new CharterCenterError(
          timedOut ? `Charter Center did not respond within ${this.timeoutMs / 1000}s (${pathAndQuery})` : `Could not reach Charter Center (${pathAndQuery}): ${String(err)}`,
        );
        failures++;
        limited = 0;
        continue;
      }
      if (res.status === 429) {
        if (limited >= this.rateLimitRetries) {
          throw new CharterCenterError(
            `Charter Center kept answering HTTP 429 (too many requests) for ${pathAndQuery} after ${limited + 1} tries; the sync will try again later`,
            429,
          );
        }
        const asked = HttpCharterCenterClient.askedWaitMs(res);
        const wait = Math.min(this.maxWaitMs, asked ?? this.rateLimitWaitMs * 2 ** limited);
        limited++;
        // Every request waits, not just this one: the limit is for our key as a whole.
        this.notBefore = Math.max(this.notBefore, Date.now() + wait);
        lastError = new CharterCenterError(`Charter Center answered HTTP 429 for ${pathAndQuery}`, 429);
        continue;
      }
      // Slow down before the window runs out rather than after.
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const asked = HttpCharterCenterClient.askedWaitMs(res);
        if (asked) this.notBefore = Math.max(this.notBefore, Date.now() + Math.min(this.maxWaitMs, asked));
      }
      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw new CharterCenterError(`Charter Center sent a response that is not JSON (${pathAndQuery})`, res.status);
        }
      }
      if (res.status === 401 || res.status === 403) {
        throw new CharterCenterError(`Charter Center rejected the API key (HTTP ${res.status}). Check CHARTER_CENTER_API_KEY.`, res.status);
      }
      lastError = new CharterCenterError(`Charter Center answered HTTP ${res.status} for ${pathAndQuery}`, res.status);
      if (res.status < 500) throw lastError;
      failures++;
      limited = 0;
    }
    throw new CharterCenterError(`${lastError?.message ?? 'Charter Center request failed'} (after ${this.attempts} attempts)`, lastError?.status);
  }
}

/** Shape of fixtures/charter-center.json. */
export interface CharterCenterFixture {
  courses: unknown[];
  paths: unknown[];
  link_check?: { broken_urls?: string[] };
}

export function fixturePath(): string {
  const candidates = [
    fileURLToPath(new URL('./fixtures/charter-center.json', import.meta.url)),
    path.resolve(process.cwd(), 'src/learning/fixtures/charter-center.json'),
    path.resolve(process.cwd(), 'apps/api/src/learning/fixtures/charter-center.json'),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new CharterCenterError('Learning fixture not found (src/learning/fixtures/charter-center.json)');
  return hit;
}

export function loadFixture(file = fixturePath()): CharterCenterFixture {
  return JSON.parse(readFileSync(file, 'utf8')) as CharterCenterFixture;
}

/**
 * Serves the fixture through the same page parsing as the HTTP client (pages of `pageSize`), so
 * dev and tests exercise the real code path. Pass `data` to serve an in-memory catalogue instead.
 */
export class FixtureCharterCenterClient implements CharterCenterClient {
  readonly source = 'fixture';
  constructor(
    private data: CharterCenterFixture = loadFixture(),
    private readonly pageSize = 10,
  ) {}

  /** Tests: swap the catalogue between syncs. */
  setData(data: CharterCenterFixture) {
    this.data = data;
  }

  get fixture(): CharterCenterFixture {
    return this.data;
  }

  async listCourses(opts: ListCoursesOptions = {}): Promise<CharterCenterCourseRecord[]> {
    const out: CharterCenterCourseRecord[] = [];
    for (let page = 1; ; page++) {
      const slice = this.data.courses.slice((page - 1) * this.pageSize, page * this.pageSize);
      const next = page * this.pageSize < this.data.courses.length ? page + 1 : null;
      const body = parseCoursesPage({ data: slice, next_page: next });
      out.push(...body.data);
      if (next === null) break;
    }
    if (!opts.updatedSince) return out;
    const since = opts.updatedSince.getTime();
    return out.filter((c) => !c.updated_at || new Date(c.updated_at).getTime() > since);
  }

  async listPaths(): Promise<CharterCenterPathRecord[]> {
    return parsePathsPage({ data: this.data.paths }).data;
  }
}
