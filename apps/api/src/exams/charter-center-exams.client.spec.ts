import { describe, expect, it } from 'vitest';
import { HttpCharterCenterExamsClient, MockCharterCenterExamsClient, parseCertificate } from './charter-center-exams.client.js';

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const REQUEST = { email: 'amina@example.test', name: 'Amina Yusuf', examTitle: 'CAPM® Practice Exam' };

describe('Charter Center exams API client', () => {
  it('sends the documented certificate request with the API key and reads the documented answer', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new HttpCharterCenterExamsClient({
      baseUrl: 'https://cc.example/api/partner/',
      apiKey: 'secret',
      fetch: async (url, init) => {
        calls.push({ url, init: init! });
        return json(200, { certificate_id: 'CC-2026-000123', pdf_url: 'https://cc.example/c.pdf', image_url: 'https://cc.example/c.png' });
      },
    });
    expect(await client.certificate(REQUEST)).toEqual({
      certificateId: 'CC-2026-000123',
      pdfUrl: 'https://cc.example/c.pdf',
      imageUrl: 'https://cc.example/c.png',
    });
    expect(calls.map((c) => c.url)).toEqual(['https://cc.example/api/partner/certificates']);
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ email: 'amina@example.test', name: 'Amina Yusuf', exam_title: 'CAPM® Practice Exam' });
  });

  it('treats 404 as "no certificate yet" and refuses a bad key', async () => {
    const notFound = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async () => json(404, { message: 'Not found' }) });
    expect(await notFound.certificate(REQUEST)).toBeNull();
    const badKey = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async () => json(401, {}) });
    await expect(badKey.certificate(REQUEST)).rejects.toThrow(/API key/);
  });

  it('retries server errors', async () => {
    let n = 0;
    const flaky = new HttpCharterCenterExamsClient({
      baseUrl: 'https://cc.example',
      attempts: 2,
      fetch: async () => (++n === 1 ? json(503, {}) : json(200, { certificate_id: 'X', pdf_url: 'https://a/b.pdf', image_url: 'https://a/b.png' })),
    });
    expect((await flaky.certificate(REQUEST))?.certificateId).toBe('X');
    expect(n).toBe(2);
  });

  it('accepts camelCase and a { data } wrapper, and rejects incomplete answers', () => {
    expect(parseCertificate({ data: { certificateId: 42, pdfUrl: 'https://a/b.pdf', imageUrl: 'https://a/b.jpg' } }).certificateId).toBe('42');
    expect(() => parseCertificate({ certificate_id: 'x', pdf_url: 'https://a/b.pdf' })).toThrow();
  });

  it('the mock follows its rules', async () => {
    const mock = new MockCharterCenterExamsClient();
    expect(await mock.certificate({ ...REQUEST, email: 'pending.student@example.test' })).toBeNull();
    const cert = (await mock.certificate(REQUEST))!;
    const pdf = await mock.download(cert.pdfUrl);
    expect(pdf.data.subarray(0, 5).toString()).toBe('%PDF-');
    const image = await mock.download(cert.imageUrl);
    expect(image.contentType).toMatch(/^image\//);
  });
});
