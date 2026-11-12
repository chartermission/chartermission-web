import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { assertSafeUrl } from '../posts/ssrf.js';
import { CharterCenterError, type FetchFn } from '../learning/charter-center.client.js';

/*
 * The two Charter Center calls exams need (spec for Charter Center: docs/CHARTER-CENTER-EXAMS-API.md).
 *
 *   POST {CHARTER_CENTER_API_URL}/students/lookup   { "email": "…" }
 *        200 { "name": "…", "photo_url": "https://…" | null }      404: not a Charter Center student
 *   POST {CHARTER_CENTER_API_URL}/certificates       { "email": "…", "course_id": "…" }
 *        200 { "certificate_id": "…", "pdf_url": "https://…", "image_url": "https://…" }
 *        404: no certificate yet (we ask again later)
 *
 * Both are sent with Authorization: Bearer {CHARTER_CENTER_API_KEY}, like the catalogue. Field names
 * are read in snake_case or camelCase, and a Laravel-style { "data": { … } } wrapper is accepted.
 *
 * CHARTER_CENTER_EXAMS_API=mock (the default until Charter Center ships these) answers from
 * MockCharterCenterExamsClient instead, so the whole flow can be tried end to end.
 */

export interface CharterCenterStudent {
  name: string;
  photoUrl: string | null;
}

export interface CharterCenterCertificate {
  certificateId: string;
  pdfUrl: string;
  imageUrl: string;
}

export interface DownloadedFile {
  data: Buffer;
  /** As the server declared it (checked again by the media pipeline). */
  contentType: string | null;
}

export interface CharterCenterExamsClient {
  readonly mode: 'mock' | 'live';
  /** The student with this email on Charter Center, or null when there is none. */
  lookupStudent(email: string): Promise<CharterCenterStudent | null>;
  /** The student's certificate for the course, or null when Charter Center has none (yet). */
  certificate(email: string, courseId: string): Promise<CharterCenterCertificate | null>;
  /** Fetches a photo, certificate image or PDF the API pointed to. */
  download(url: string, maxBytes: number): Promise<DownloadedFile>;
}

export const CHARTER_CENTER_EXAMS_CLIENT = Symbol('CHARTER_CENTER_EXAMS_CLIENT');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Picks a field in snake_case or camelCase from the body or its "data" wrapper. */
function field(body: unknown, ...names: string[]): unknown {
  const objects = [body, (body as { data?: unknown } | null)?.data];
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    for (const n of names) {
      const v = (o as Record<string, unknown>)[n];
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

const httpsUrl = (v: unknown): string | null => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null);

export function parseStudent(body: unknown): CharterCenterStudent {
  const name = field(body, 'name', 'full_name', 'fullName');
  if (typeof name !== 'string' || !name.trim()) throw new CharterCenterError('Charter Center returned a student without a name');
  return { name: name.trim().replace(/\s+/g, ' ').slice(0, 80), photoUrl: httpsUrl(field(body, 'photo_url', 'photoUrl', 'photo', 'avatar_url')) };
}

export function parseCertificate(body: unknown): CharterCenterCertificate {
  const certificateId = field(body, 'certificate_id', 'certificateId', 'id');
  const pdfUrl = httpsUrl(field(body, 'pdf_url', 'pdfUrl'));
  const imageUrl = httpsUrl(field(body, 'image_url', 'imageUrl'));
  if ((typeof certificateId !== 'string' && typeof certificateId !== 'number') || !pdfUrl || !imageUrl) {
    throw new CharterCenterError('Charter Center returned a certificate without certificate_id, pdf_url and image_url');
  }
  return { certificateId: String(certificateId).slice(0, 100), pdfUrl, imageUrl };
}

export class HttpCharterCenterExamsClient implements CharterCenterExamsClient {
  readonly mode = 'live' as const;
  private readonly base: string;
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly opts: { baseUrl: string; apiKey?: string; fetch?: FetchFn; timeoutMs?: number; attempts?: number },
  ) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  async lookupStudent(email: string): Promise<CharterCenterStudent | null> {
    const body = await this.post('/students/lookup', { email });
    return body === null ? null : parseStudent(body);
  }

  async certificate(email: string, courseId: string): Promise<CharterCenterCertificate | null> {
    const body = await this.post('/certificates', { email, course_id: courseId });
    return body === null ? null : parseCertificate(body);
  }

  /** POST JSON with Bearer auth; 404 → null; network errors, 429 and 5xx are retried. */
  private async post(path: string, payload: object): Promise<unknown> {
    const attempts = Math.max(1, this.opts.attempts ?? 2);
    const timeoutMs = this.opts.timeoutMs ?? 10_000;
    let lastError: CharterCenterError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(500 * 2 ** (attempt - 2));
      let res: Response;
      try {
        res = await this.fetchFn(`${this.base}${path}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'CharterMission/1.0 (+exams)',
            ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = new CharterCenterError(`Could not reach Charter Center (${path}): ${String(err)}`);
        continue;
      }
      if (res.status === 404) return null;
      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw new CharterCenterError(`Charter Center sent a response that is not JSON (${path})`, res.status);
        }
      }
      if (res.status === 401 || res.status === 403) {
        throw new CharterCenterError(`Charter Center rejected the API key (HTTP ${res.status}). Check CHARTER_CENTER_API_KEY.`, res.status);
      }
      lastError = new CharterCenterError(`Charter Center answered HTTP ${res.status} for ${path}`, res.status);
      if (res.status !== 429 && res.status < 500) throw lastError;
    }
    throw lastError ?? new CharterCenterError(`Charter Center request failed (${path})`);
  }

  /** Only public addresses; redirects are followed and checked one by one; the size is capped. */
  async download(url: string, maxBytes: number): Promise<DownloadedFile> {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      await assertSafeUrl(current);
      const res = await this.fetchFn(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current).toString();
        continue;
      }
      if (!res.ok) throw new CharterCenterError(`Charter Center file answered HTTP ${res.status}`, res.status);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > maxBytes) throw new CharterCenterError('Charter Center file is too large');
      const reader = res.body?.getReader();
      if (!reader) throw new CharterCenterError('Charter Center file is empty');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new CharterCenterError('Charter Center file is too large');
        }
        chunks.push(value);
      }
      return { data: Buffer.concat(chunks), contentType: res.headers.get('content-type') };
    }
    throw new CharterCenterError('Charter Center file redirected too many times');
  }
}

/* ---------------- Mock ---------------- */

/**
 * Stands in for Charter Center until its API is ready, so the join and certificate flow can be
 * tried end to end with any inbox:
 *  - every email is a student, named after the part before the @ ("amina.yusuf@…" → "Amina Yusuf"),
 *    with a generated photo; except emails starting "unknown" (not a student) and "nophoto" (no photo);
 *  - certificates are made on request, except for emails containing "pending" (none yet, so the
 *    retries and the "on its way" screens can be seen).
 * Files are generated in memory (mock:// addresses), never fetched from the internet.
 */
export class MockCharterCenterExamsClient implements CharterCenterExamsClient {
  readonly mode = 'mock' as const;

  constructor(private readonly courseTitle: (courseId: string) => Promise<string | null> = async () => null) {}

  async lookupStudent(email: string): Promise<CharterCenterStudent | null> {
    const local = email.split('@')[0]!.toLowerCase();
    if (local.startsWith('unknown')) return null;
    return { name: mockName(email), photoUrl: local.startsWith('nophoto') ? null : `mock://charter-center/photo/${token(email)}?n=${encodeURIComponent(mockName(email))}` };
  }

  async certificate(email: string, courseId: string): Promise<CharterCenterCertificate | null> {
    if (email.toLowerCase().includes('pending')) return null;
    const certificateId = `CC-${new Date().getUTCFullYear()}-${String(parseInt(token(`${email}|${courseId}`).slice(0, 8), 16) % 1_000_000).padStart(6, '0')}`;
    const title = (await this.courseTitle(courseId)) ?? `Course ${courseId}`;
    const q = new URLSearchParams({ n: mockName(email), c: title, id: certificateId });
    return {
      certificateId,
      imageUrl: `mock://charter-center/certificate.png?${q}`,
      pdfUrl: `mock://charter-center/certificate.pdf?${q}`,
    };
  }

  async download(url: string): Promise<DownloadedFile> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'mock:') throw new CharterCenterError(`The mock only serves mock:// files (${url})`);
    const q = parsed.searchParams;
    if (parsed.pathname.startsWith('/photo/')) return { data: await mockPhoto(q.get('n') ?? '?'), contentType: 'image/png' };
    const details = { name: q.get('n') ?? '', course: q.get('c') ?? '', id: q.get('id') ?? '' };
    if (parsed.pathname === '/certificate.png') return { data: await mockCertificateImage(details), contentType: 'image/png' };
    if (parsed.pathname === '/certificate.pdf') {
      const jpeg = await sharp(await mockCertificateImage(details)).jpeg({ quality: 88 }).toBuffer();
      return { data: jpegToPdf(jpeg, CERT_W, CERT_H), contentType: 'application/pdf' };
    }
    throw new CharterCenterError(`Unknown mock file ${url}`);
  }
}

const token = (s: string) => createHash('sha256').update(s.toLowerCase()).digest('hex');

/** "amina.yusuf+cc@x.com" → "Amina Yusuf". */
export function mockName(email: string): string {
  const words = email
    .split('@')[0]!
    .split('+')[0]!
    .replace(/^(nophoto|pending)[._-]?/i, '')
    .split(/[._\-\d]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
  return (words.join(' ') || 'Charter Student').slice(0, 80);
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

async function mockPhoto(name: string): Promise<Buffer> {
  const hue = parseInt(token(name).slice(0, 2), 16) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,38%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},65%,62%)"/></linearGradient></defs>
    <rect width="400" height="400" fill="url(#g)"/>
    <circle cx="200" cy="160" r="78" fill="#ffffff" fill-opacity="0.22"/>
    <path d="M70 400 C 90 290, 310 290, 330 400 Z" fill="#ffffff" fill-opacity="0.22"/>
    <text x="200" y="182" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="64" fill="#ffffff">${esc(initials(name))}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const CERT_W = 1600;
const CERT_H = 1131;

async function mockCertificateImage(d: { name: string; course: string; id: string }): Promise<Buffer> {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const course = d.course.length > 60 ? `${d.course.slice(0, 57)}…` : d.course;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CERT_W}" height="${CERT_H}">
    <rect width="${CERT_W}" height="${CERT_H}" fill="#fbf8f1"/>
    <rect x="40" y="40" width="${CERT_W - 80}" height="${CERT_H - 80}" fill="none" stroke="#0b6b3a" stroke-width="6"/>
    <rect x="62" y="62" width="${CERT_W - 124}" height="${CERT_H - 124}" fill="none" stroke="#c8962e" stroke-width="2"/>
    <text x="800" y="200" text-anchor="middle" font-family="serif" font-size="40" letter-spacing="8" fill="#0b6b3a">CHARTER CENTER</text>
    <text x="800" y="320" text-anchor="middle" font-family="serif" font-size="78" font-weight="700" fill="#1d2433">Certificate of Completion</text>
    <text x="800" y="420" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#5b6475">This certifies that</text>
    <text x="800" y="530" text-anchor="middle" font-family="serif" font-size="84" font-style="italic" fill="#1d2433">${esc(d.name)}</text>
    <line x1="420" y1="568" x2="1180" y2="568" stroke="#c8962e" stroke-width="2"/>
    <text x="800" y="650" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#5b6475">has successfully completed</text>
    <text x="800" y="730" text-anchor="middle" font-family="sans-serif" font-size="46" font-weight="700" fill="#0b6b3a">${esc(course)}</text>
    <text x="800" y="800" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#5b6475">and passed its exam on Charter Mission</text>
    <text x="300" y="960" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#1d2433">${esc(date)}</text>
    <line x1="180" y1="920" x2="420" y2="920" stroke="#5b6475" stroke-width="1.5"/>
    <text x="300" y="1000" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#5b6475">Date</text>
    <text x="1300" y="960" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#1d2433">${esc(d.id)}</text>
    <line x1="1180" y1="920" x2="1420" y2="920" stroke="#5b6475" stroke-width="1.5"/>
    <text x="1300" y="1000" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#5b6475">Certificate ID</text>
    <circle cx="800" cy="955" r="62" fill="#c8962e"/>
    <circle cx="800" cy="955" r="50" fill="none" stroke="#fbf8f1" stroke-width="3"/>
    <text x="800" y="967" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="700" fill="#fbf8f1">CC</text>
    <text x="800" y="1078" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#9aa1ad">SAMPLE — generated by the Charter Center mock for testing</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A one-page PDF (A4 landscape) showing a JPEG full page. */
export function jpegToPdf(jpeg: Buffer, width: number, height: number): Buffer {
  const pageW = 842;
  const pageH = 595;
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    parts.push(buf);
    length += buf.length;
  };
  const obj = (n: number, body: (Buffer | string)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
  obj(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream']);
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  obj(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}
