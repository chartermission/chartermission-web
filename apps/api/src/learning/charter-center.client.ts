import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { CharterCenterCourseRecord, CharterCenterPathRecord } from '@chartermission/contracts';
import { parseCoursesPage, parsePathsPage } from './charter-center.mapper.js';

/**
 * Source of the Learning catalogue. Course content is managed on Charter Center; we only read it.
 *  - HttpCharterCenterClient: the real API (CHARTER_CENTER_API_URL + CHARTER_CENTER_API_KEY).
 *  - FixtureCharterCenterClient: the JSON fixture in ./fixtures (dev, tests, demo).
 */
export interface CharterCenterClient {
  /** Human label for logs and sync errors, e.g. "Charter Center API" or "fixture". */
  readonly source: string;
  /** Every course (all pages). With updatedSince, only courses changed since then (incremental). */
  listCourses(opts?: { updatedSince?: Date }): Promise<CharterCenterCourseRecord[]>;
  listPaths(): Promise<CharterCenterPathRecord[]>;
}

export const CHARTER_CENTER_CLIENT = Symbol('CHARTER_CENTER_CLIENT');

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
  /** Attempts per request (network errors, 429 and 5xx are retried). */
  attempts?: number;
  /** First backoff delay; doubles each retry. */
  backoffMs?: number;
  /** Safety stop for runaway pagination. */
  maxPages?: number;
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

  constructor(private readonly opts: HttpClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.attempts = Math.max(1, opts.attempts ?? 3);
    this.backoffMs = opts.backoffMs ?? 1_000;
    this.maxPages = opts.maxPages ?? 500;
  }

  async listCourses(opts: { updatedSince?: Date } = {}): Promise<CharterCenterCourseRecord[]> {
    const out: CharterCenterCourseRecord[] = [];
    let page: number | null = 1;
    let fetched = 0;
    while (page !== null) {
      if (++fetched > this.maxPages) throw new CharterCenterError(`Charter Center returned more than ${this.maxPages} pages of courses`);
      const qs = new URLSearchParams({ page: String(page) });
      if (opts.updatedSince) qs.set('updated_since', opts.updatedSince.toISOString());
      const body = parseCoursesPage(await this.getJson(`/courses?${qs.toString()}`));
      out.push(...body.data);
      if (body.next_page !== null && body.next_page <= page) {
        throw new CharterCenterError(`Charter Center pagination did not advance (page ${page} → ${body.next_page})`);
      }
      page = body.next_page;
    }
    return out;
  }

  async listPaths(): Promise<CharterCenterPathRecord[]> {
    return parsePathsPage(await this.getJson('/paths')).data;
  }

  /** GET with Bearer auth, timeout and retries with exponential backoff. */
  private async getJson(pathAndQuery: string): Promise<unknown> {
    const url = `${this.base}${pathAndQuery}`;
    let lastError: CharterCenterError | undefined;
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      if (attempt > 1) await sleep(this.backoffMs * 2 ** (attempt - 2));
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
        continue;
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
      if (res.status !== 429 && res.status < 500) throw lastError;
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

  async listCourses(opts: { updatedSince?: Date } = {}): Promise<CharterCenterCourseRecord[]> {
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
