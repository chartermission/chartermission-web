import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { LookupAddress } from 'node:dns';
import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'node-html-parser';
import type { LinkPreview } from '@chartermission/contracts';
import { assertSafeUrl, SsrfError, type LookupFn } from './ssrf.js';

export const PREVIEW_TIMEOUT_MS = 5000;
export const PREVIEW_MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;

type Page = { status: number; location?: string; contentType: string; body: string };

/**
 * Link previews for posts (Open Graph title, description, image), fetched in the
 * "media" worker with SSRF protection: https only, public addresses only (checked
 * on every hop and pinned for the connection), 5 s timeout, 1 MB cap, redirects
 * only within the same host.
 */
@Injectable()
export class LinkPreviewService {
  private readonly logger = new Logger('LinkPreview');

  async fetchPreview(raw: string, lookup?: LookupFn): Promise<LinkPreview | null> {
    let current = raw;
    const originalHost = new URL(raw).hostname.toLowerCase();
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const { url, address, family } = await assertSafeUrl(current, lookup);
      if (url.hostname.toLowerCase() !== originalHost) throw new SsrfError('Redirects to another host are not followed');
      const page = await this.fetchPage(url, address, family);
      if (page.status >= 300 && page.status < 400 && page.location) {
        current = new URL(page.location, url).toString();
        continue;
      }
      if (page.status !== 200 || !/text\/html|application\/xhtml/i.test(page.contentType)) return null;
      return parsePreview(page.body, url);
    }
    return null;
  }

  /** One GET to a vetted address (no automatic redirects). Separate so tests can stub it. */
  fetchPage(url: URL, address: string, family: number): Promise<Page> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          protocol: 'https:',
          hostname: url.hostname,
          servername: url.hostname,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { 'User-Agent': 'CharterMissionBot/1.0 (+link preview)', Accept: 'text/html' },
          // Connect only to the address that passed the SSRF check.
          lookup: ((_h: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
            if (opts?.all) cb(null, [{ address, family } satisfies LookupAddress]);
            else cb(null, address, family);
          }) as never,
          signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
          timeout: PREVIEW_TIMEOUT_MS,
        },
        (res: IncomingMessage) => {
          const status = res.statusCode ?? 0;
          const contentType = String(res.headers['content-type'] ?? '');
          if (status >= 300 && status < 400) {
            res.resume();
            return resolve({ status, location: res.headers.location, contentType, body: '' });
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > PREVIEW_MAX_BYTES) {
              res.destroy();
              resolve({ status, contentType, body: Buffer.concat(chunks).toString('utf8') });
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => resolve({ status, contentType, body: Buffer.concat(chunks).toString('utf8') }));
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('Link preview timed out')));
      req.on('error', reject);
      req.end();
    });
  }

  /** Never throws: a failed preview just leaves the post without one. */
  async safePreview(raw: string): Promise<LinkPreview | null> {
    try {
      return await this.fetchPreview(raw);
    } catch (err) {
      this.logger.debug(`No preview for ${raw}: ${String(err)}`);
      return null;
    }
  }
}

export function parsePreview(html: string, url: URL): LinkPreview {
  const root = parse(html);
  const meta = (selector: string) => root.querySelector(selector)?.getAttribute('content')?.trim() || null;
  const clip = (v: string | null | undefined, n: number) => (v ? v.replace(/\s+/g, ' ').trim().slice(0, n) || null : null);
  const title = clip(meta('meta[property="og:title"]') ?? root.querySelector('title')?.text, 200);
  const description = clip(meta('meta[property="og:description"]') ?? meta('meta[name="description"]'), 300);
  let imageUrl: string | null = null;
  const image = meta('meta[property="og:image"]');
  if (image) {
    try {
      const resolved = new URL(image, url);
      if (resolved.protocol === 'https:') imageUrl = resolved.toString().slice(0, 500);
    } catch {
      imageUrl = null;
    }
  }
  return { url: url.toString(), domain: url.hostname.replace(/^www\./, ''), title, description, imageUrl };
}
