import { describe, expect, it } from 'vitest';
import { HttpCharterCenterExamsClient, MockCharterCenterExamsClient, mockName, parseCertificate, parseStudent } from './charter-center-exams.client.js';

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Charter Center exams API client', () => {
  it('sends the documented requests with the API key and reads the documented answers', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new HttpCharterCenterExamsClient({
      baseUrl: 'https://cc.example/api/partner/',
      apiKey: 'secret',
      fetch: async (url, init) => {
        calls.push({ url, init: init! });
        if (url.endsWith('/students/lookup')) return json(200, { name: '  Amina   Yusuf ', photo_url: 'https://cc.example/p.jpg' });
        return json(200, { certificate_id: 'CC-2026-000123', pdf_url: 'https://cc.example/c.pdf', image_url: 'https://cc.example/c.png' });
      },
    });
    expect(await client.lookupStudent('amina@example.test')).toEqual({ name: 'Amina Yusuf', photoUrl: 'https://cc.example/p.jpg' });
    expect(await client.certificate('amina@example.test', 'capm-101')).toEqual({
      certificateId: 'CC-2026-000123',
      pdfUrl: 'https://cc.example/c.pdf',
      imageUrl: 'https://cc.example/c.png',
    });
    expect(calls.map((c) => c.url)).toEqual(['https://cc.example/api/partner/students/lookup', 'https://cc.example/api/partner/certificates']);
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ email: 'amina@example.test', course_id: 'capm-101' });
  });

  it('treats 404 as "not a student" / "no certificate yet" and refuses a bad key', async () => {
    const notFound = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async () => json(404, { message: 'Not found' }) });
    expect(await notFound.lookupStudent('x@example.test')).toBeNull();
    expect(await notFound.certificate('x@example.test', 'c')).toBeNull();
    const badKey = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async () => json(401, {}) });
    await expect(badKey.lookupStudent('x@example.test')).rejects.toThrow(/API key/);
  });

  it('retries server errors', async () => {
    let n = 0;
    const flaky = new HttpCharterCenterExamsClient({
      baseUrl: 'https://cc.example',
      attempts: 2,
      fetch: async () => (++n === 1 ? json(503, {}) : json(200, { name: 'Kofi Mensah', photo_url: null })),
    });
    expect(await flaky.lookupStudent('k@example.test')).toEqual({ name: 'Kofi Mensah', photoUrl: null });
    expect(n).toBe(2);
  });

  it('accepts camelCase and a { data } wrapper, and rejects incomplete answers', () => {
    expect(parseStudent({ data: { fullName: 'Ngozi Eze', photoUrl: null } })).toEqual({ name: 'Ngozi Eze', photoUrl: null });
    expect(parseCertificate({ data: { certificateId: 42, pdfUrl: 'https://a/b.pdf', imageUrl: 'https://a/b.jpg' } }).certificateId).toBe('42');
    expect(() => parseStudent({ photo_url: 'https://a/b.jpg' })).toThrow();
    expect(() => parseCertificate({ certificate_id: 'x', pdf_url: 'https://a/b.pdf' })).toThrow();
  });

  it('the mock follows its rules', async () => {
    const mock = new MockCharterCenterExamsClient(async () => 'CAPM Preparation');
    expect(mockName('amina.yusuf_2@gmail.com')).toBe('Amina Yusuf');
    expect(await mock.lookupStudent('unknown.someone@example.test')).toBeNull();
    expect((await mock.lookupStudent('nophoto.kofi@example.test'))?.photoUrl).toBeNull();
    expect(await mock.certificate('pending.student@example.test', 'capm-101')).toBeNull();
    const cert = (await mock.certificate('amina@example.test', 'capm-101'))!;
    const pdf = await mock.download(cert.pdfUrl);
    expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-');
    const image = await mock.download(cert.imageUrl);
    expect(image.contentType).toMatch(/^image\//);
  });
});
