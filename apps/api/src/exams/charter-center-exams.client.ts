import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { assertSafeUrl } from '../posts/ssrf.js';
import { CharterCenterError, type FetchFn } from '../learning/charter-center.client.js';

/*
 * The one Charter Center call exams need (spec for Charter Center: docs/CHARTER-CENTER-EXAMS-API.md).
 *
 *   POST {CHARTER_CENTER_API_URL}/certificate
 *        { "student_name", "course_title", "start_from", "start_end", "duration", "instructor_name", "instructor_signature_url" }
 *        (plus "exam_hours", the same hours under the name we used first; Charter Center ignores it)
 *
 * The member's name comes from their profile; the rest from the exam's certificate settings. Sent with
 * Authorization: Bearer {CHARTER_CENTER_API_KEY} when a key is set.
 *
 * What comes back is read generously, so it works with whatever Charter Center settles on:
 *   - the file itself: a PDF (application/pdf) or a picture (image/png, image/jpeg);
 *   - or JSON (optionally wrapped in { "data": … }) with links to the files (pdf_url, image_url,
 *     certificate_url, download_url, file_url, url…) or the PDF in base64 (pdf, pdf_base64, file…),
 *     and a reference (certificate_id, certificate_number, id…).
 * Each file is told apart by its content, not by the field it came in. 404 = not ready yet.
 *
 * CHARTER_CENTER_EXAMS_API=mock (the default until it is switched on) answers from
 * MockCharterCenterExamsClient instead, so the flow can be tried end to end.
 */

/** Exactly what is sent to Charter Center (field names as Charter Center defined them). */
export interface CertificateRequest {
  student_name: string;
  course_title: string;
  /** YYYY-MM-DD */
  start_from: string;
  /** YYYY-MM-DD */
  start_end: string;
  /** Study hours on the certificate, as Charter Center's partner API names them; null when the exam has none set. */
  duration?: number | null;
  /** The same hours under our earlier name (absent in requests sent before hours existed); kept for comparisons. */
  exam_hours?: number | null;
  instructor_name: string;
  instructor_signature_url: string;
}

/** The certificate as received: at least one of the PDF and the picture. */
export interface CharterCenterCertificate {
  certificateId: string | null;
  pdf: Buffer | null;
  image: Buffer | null;
}

export interface CharterCenterExamsClient {
  readonly mode: 'mock' | 'live';
  /** The certificate for someone who passed, or null when Charter Center has none (yet). */
  certificate(request: CertificateRequest): Promise<CharterCenterCertificate | null>;
}

export const CHARTER_CENTER_EXAMS_CLIENT = Symbol('CHARTER_CENTER_EXAMS_CLIENT');
export const DEFAULT_CHARTER_CENTER_API_URL = 'https://charter-center.com/api/partner';

const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const PDF_MAX_BYTES = 10 * 1024 * 1024;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a file is, from its first bytes. */
export function sniff(data: Buffer): 'pdf' | 'image' | null {
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (data[0] === 0x89 && data.subarray(1, 4).toString('latin1') === 'PNG') return 'image';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image';
  return null;
}

/** The objects a field may sit in: the body, its "data", and "data.certificate" / "certificate". */
function layers(body: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const add = (o: unknown) => {
    if (o && typeof o === 'object' && !Array.isArray(o)) out.push(o as Record<string, unknown>);
  };
  add(body);
  const data = (body as { data?: unknown } | null)?.data;
  add(data);
  add((data as { certificate?: unknown } | null)?.certificate);
  add((body as { certificate?: unknown } | null)?.certificate);
  return out;
}

function pick(body: unknown, names: string[]): unknown {
  for (const o of layers(body)) {
    for (const n of names) {
      const v = o[n];
      if (v !== undefined && v !== null && v !== '') return v;
    }
  }
  return undefined;
}

const ID_FIELDS = ['certificate_id', 'certificateId', 'certificate_number', 'certificateNumber', 'certificate_no', 'serial', 'reference', 'uuid', 'id'];
const URL_FIELDS = [
  'pdf_url', 'pdfUrl', 'image_url', 'imageUrl', 'certificate_url', 'certificateUrl', 'download_url', 'downloadUrl',
  'file_url', 'fileUrl', 'preview_url', 'previewUrl', 'thumbnail_url', 'png_url', 'jpg_url', 'url', 'link', 'path', 'file', 'certificate', 'pdf',
];
const BASE64_FIELDS = ['pdf_base64', 'pdfBase64', 'pdf', 'file', 'file_base64', 'certificate', 'certificate_base64', 'content', 'image_base64', 'image'];

/** What a JSON answer points to: links to download, files inline (base64), and the reference. */
export function parseCertificateAnswer(body: unknown): { certificateId: string | null; urls: string[]; inline: Buffer[] } {
  const rawId = pick(body, ID_FIELDS);
  const certificateId = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId).trim().slice(0, 100) || null : null;
  const urls: string[] = [];
  const inline: Buffer[] = [];
  for (const o of layers(body)) {
    for (const n of URL_FIELDS) {
      const v = o[n];
      if (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) && !urls.includes(v.trim())) urls.push(v.trim());
    }
    for (const n of BASE64_FIELDS) {
      const v = o[n];
      if (typeof v !== 'string' || v.length < 100 || /^https?:/i.test(v)) continue;
      const b64 = v.replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/=_-]+$/.test(b64)) continue;
      const data = Buffer.from(b64, 'base64');
      if (sniff(data)) inline.push(data);
    }
  }
  return { certificateId, urls, inline };
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

  async certificate(request: CertificateRequest): Promise<CharterCenterCertificate | null> {
    const res = await this.post('/certificate', request);
    if (!res) return null;
    const out: CharterCenterCertificate = { certificateId: null, pdf: null, image: null };
    const take = (data: Buffer) => {
      const kind = sniff(data);
      if (kind === 'pdf' && !out.pdf) out.pdf = data;
      if (kind === 'image' && !out.image) out.image = data;
    };
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!type.includes('json')) {
      // The file itself.
      const data = await readCapped(res, PDF_MAX_BYTES + IMAGE_MAX_BYTES);
      if (!sniff(data)) throw new CharterCenterError(`Charter Center answered with ${type || 'an unknown type'}, not a PDF, a picture or JSON`);
      take(data);
      return out;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new CharterCenterError('Charter Center sent JSON that could not be read');
    }
    const answer = parseCertificateAnswer(body);
    out.certificateId = answer.certificateId;
    answer.inline.forEach(take);
    for (const url of answer.urls) {
      if (out.pdf && out.image) break;
      try {
        take(await this.download(url, Math.max(PDF_MAX_BYTES, IMAGE_MAX_BYTES)));
      } catch (err) {
        // One bad link (a web page, an expired one) shouldn't lose the other file.
        if (answer.urls.length === 1) throw err;
      }
    }
    if (!out.pdf && !out.image) {
      const keys = layers(body).flatMap((o) => Object.keys(o)).slice(0, 20).join(', ');
      throw new CharterCenterError(`Charter Center’s answer had no PDF or picture of the certificate (fields: ${keys || 'none'})`);
    }
    return out;
  }

  /** POST JSON; 404 → null; network errors, 429 and 5xx are retried. */
  private async post(path: string, payload: object): Promise<Response | null> {
    const attempts = Math.max(1, this.opts.attempts ?? 2);
    const timeoutMs = this.opts.timeoutMs ?? 30_000;
    let lastError: CharterCenterError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) await sleep(500 * 2 ** (attempt - 2));
      let res: Response;
      try {
        res = await this.fetchFn(`${this.base}${path}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json, application/pdf, image/*',
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
      if (res.ok) return res;
      if (res.status === 401 || res.status === 403) {
        throw new CharterCenterError(`Charter Center refused the request (HTTP ${res.status}). Check CHARTER_CENTER_API_KEY.`, res.status);
      }
      const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
      lastError = new CharterCenterError(`Charter Center answered HTTP ${res.status} for ${path}${detail ? `: ${detail}` : ''}`, res.status);
      if (res.status !== 429 && res.status < 500) throw lastError;
    }
    throw lastError ?? new CharterCenterError(`Charter Center request failed (${path})`);
  }

  /** Only public addresses; redirects are followed and checked one by one; the size is capped. */
  private async download(url: string, maxBytes: number): Promise<Buffer> {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      await assertSafeUrl(current);
      const res = await this.fetchFn(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current).toString();
        continue;
      }
      if (!res.ok) throw new CharterCenterError(`Charter Center file answered HTTP ${res.status}`, res.status);
      return readCapped(res, maxBytes);
    }
    throw new CharterCenterError('Charter Center file redirected too many times');
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
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
  return Buffer.concat(chunks);
}

/* ---------------- Mock ---------------- */

/**
 * Stands in for Charter Center until its API is switched on, so the certificate flow can be tried end
 * to end: a sample certificate with what would be sent (the member's name, the title, the period, the
 * issuer) is made on request, except for names containing "pending" (none yet, so the retries and the
 * "on its way" screens can be seen). Made in memory; the signature is not fetched.
 */
export class MockCharterCenterExamsClient implements CharterCenterExamsClient {
  readonly mode = 'mock' as const;

  async certificate(r: CertificateRequest): Promise<CharterCenterCertificate | null> {
    if (r.student_name.toLowerCase().includes('pending')) return null;
    const certificateId = `CC-${new Date().getUTCFullYear()}-${String(parseInt(token(`${r.student_name}|${r.course_title}|${r.start_from}`).slice(0, 8), 16) % 1_000_000).padStart(6, '0')}`;
    const image = await mockCertificateImage({ ...r, id: certificateId });
    const jpeg = await sharp(image).jpeg({ quality: 88 }).toBuffer();
    return { certificateId, image, pdf: jpegToPdf(jpeg, CERT_W, CERT_H) };
  }
}

const token = (s: string) => createHash('sha256').update(s.toLowerCase()).digest('hex');

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const CERT_W = 1600;
const CERT_H = 1131;

async function mockCertificateImage(d: CertificateRequest & { id: string }): Promise<Buffer> {
  const fmt = (iso: string) => {
    const t = Date.parse(`${iso}T00:00:00Z`);
    return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  };
  const course = d.course_title.length > 60 ? `${d.course_title.slice(0, 57)}…` : d.course_title;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CERT_W}" height="${CERT_H}">
    <rect width="${CERT_W}" height="${CERT_H}" fill="#fbf8f1"/>
    <rect x="40" y="40" width="${CERT_W - 80}" height="${CERT_H - 80}" fill="none" stroke="#0b6b3a" stroke-width="6"/>
    <rect x="62" y="62" width="${CERT_W - 124}" height="${CERT_H - 124}" fill="none" stroke="#c8962e" stroke-width="2"/>
    <text x="800" y="190" text-anchor="middle" font-family="serif" font-size="40" letter-spacing="8" fill="#0b6b3a">CHARTER CENTER</text>
    <text x="800" y="300" text-anchor="middle" font-family="serif" font-size="78" font-weight="700" fill="#1d2433">Certificate of Completion</text>
    <text x="800" y="395" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#5b6475">This certifies that</text>
    <text x="800" y="500" text-anchor="middle" font-family="serif" font-size="84" font-style="italic" fill="#1d2433">${esc(d.student_name)}</text>
    <line x1="420" y1="538" x2="1180" y2="538" stroke="#c8962e" stroke-width="2"/>
    <text x="800" y="615" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#5b6475">has successfully completed</text>
    <text x="800" y="695" text-anchor="middle" font-family="sans-serif" font-size="46" font-weight="700" fill="#0b6b3a">${esc(course)}</text>
    <text x="800" y="760" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#5b6475">${esc(fmt(d.start_from))} – ${esc(fmt(d.start_end))}${typeof d.exam_hours === 'number' ? ` · ${esc(String(d.exam_hours))} ${d.exam_hours === 1 ? 'hour' : 'hours'}` : ''}</text>
    <text x="320" y="955" text-anchor="middle" font-family="serif" font-size="34" font-style="italic" fill="#1d2433">${esc(d.instructor_name)}</text>
    <line x1="160" y1="975" x2="480" y2="975" stroke="#5b6475" stroke-width="1.5"/>
    <text x="320" y="1012" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#5b6475">Instructor</text>
    <text x="1280" y="955" text-anchor="middle" font-family="sans-serif" font-size="26" fill="#1d2433">${esc(d.id)}</text>
    <line x1="1120" y1="975" x2="1440" y2="975" stroke="#5b6475" stroke-width="1.5"/>
    <text x="1280" y="1012" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#5b6475">Certificate ID</text>
    <circle cx="800" cy="955" r="62" fill="#c8962e"/>
    <circle cx="800" cy="955" r="50" fill="none" stroke="#fbf8f1" stroke-width="3"/>
    <text x="800" y="967" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="700" fill="#fbf8f1">CC</text>
    <text x="800" y="1085" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#9aa1ad">SAMPLE — generated by the Charter Center mock for testing</text>
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
