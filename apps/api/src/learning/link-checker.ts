import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { LookupAddress } from 'node:dns';
import { assertSafeUrl, type LookupFn } from '../posts/ssrf.js';
import type { CharterCenterFixture } from './charter-center.client.js';

/** Result of checking one course URL. ok = the page answered 2xx/3xx. */
export interface LinkCheckResult {
  ok: boolean;
  /** Final HTTP status, or null for network/SSRF errors and timeouts. */
  status: number | null;
  error?: string;
}

/** Checks a course's "Start learning" URL (CM-LRN-05). */
export interface LinkChecker {
  check(url: string): Promise<LinkCheckResult>;
}

export const LINK_CHECKER = Symbol('LINK_CHECKER');

export const LINK_CHECK_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export type RawResponse = { status: number; location?: string };
/** One request to a vetted address with no automatic redirects. Injected in tests. */
export type RequestFn = (url: URL, method: 'HEAD' | 'GET', address: string, family: number) => Promise<RawResponse>;

const defaultRequest: RequestFn = (url, method, address, family) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: 'https:',
        hostname: url.hostname,
        servername: url.hostname,
        path: `${url.pathname}${url.search}`,
        method,
        headers: { 'User-Agent': 'CharterMissionBot/1.0 (+course link check)', Accept: 'text/html,*/*' },
        // Connect only to the address that passed the SSRF check.
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          if (opts?.all) cb(null, [{ address, family } satisfies LookupAddress]);
          else cb(null, address, family);
        }) as never,
        signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
        timeout: LINK_CHECK_TIMEOUT_MS,
      },
      (res: IncomingMessage) => {
        const location = res.headers.location;
        // Headers are all we need; never read the body.
        res.destroy();
        resolve({ status: res.statusCode ?? 0, location });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end();
  });

/**
 * HEAD (falling back to GET when HEAD is refused) with a timeout, following up to five redirects.
 * Every hop goes through the SSRF check (https only, public addresses only).
 */
export class HttpLinkChecker implements LinkChecker {
  constructor(
    private readonly request: RequestFn = defaultRequest,
    private readonly lookup?: LookupFn,
  ) {}

  async check(raw: string): Promise<LinkCheckResult> {
    let current = raw;
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const { url, address, family } = await assertSafeUrl(current, this.lookup);
        let res = await this.request(url, 'HEAD', address, family);
        // Some servers refuse or mishandle HEAD; ask again with GET before calling it broken.
        if (res.status >= 400 && res.status !== 404 && res.status !== 410) res = await this.request(url, 'GET', address, family);
        if (res.status >= 300 && res.status < 400 && res.location) {
          current = new URL(res.location, url).toString();
          continue;
        }
        return { ok: res.status >= 200 && res.status < 400, status: res.status };
      }
      return { ok: false, status: null, error: 'Too many redirects' };
    } catch (err) {
      return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * Deterministic checker for fixture mode (no outbound network): URLs listed in the fixture's
 * link_check.broken_urls answer 404, everything else 200.
 */
export class FixtureLinkChecker implements LinkChecker {
  private readonly broken: Set<string>;
  constructor(fixture: Pick<CharterCenterFixture, 'link_check'> | string[]) {
    this.broken = new Set(Array.isArray(fixture) ? fixture : (fixture.link_check?.broken_urls ?? []));
  }

  setBroken(urls: string[]) {
    this.broken.clear();
    for (const u of urls) this.broken.add(u);
  }

  async check(url: string): Promise<LinkCheckResult> {
    return this.broken.has(url) ? { ok: false, status: 404 } : { ok: true, status: 200 };
  }
}
