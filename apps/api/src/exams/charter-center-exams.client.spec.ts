import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { HttpCharterCenterExamsClient, MockCharterCenterExamsClient, jpegToPdf, parseCertificateAnswer, sniff, type CertificateRequest } from './charter-center-exams.client.js';

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const file = (data: Buffer, type: string) => new Response(new Uint8Array(data), { status: 200, headers: { 'Content-Type': type } });

const REQUEST: CertificateRequest = {
  student_name: 'Rais ur Rehman',
  course_title: 'PMP Exam Prep',
  start_from: '2026-01-01',
  start_end: '2026-01-15',
  instructor_name: 'Eng. Abdalla Yousif',
  instructor_signature_url: 'https://chartermission.com/api/v1/exam-signatures/0b6c1c5e-8a55-4b8e-9d0e-2f1d1f6b0a11.png',
};

const png = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#0b6b3a' } }).png().toBuffer();
const pdf = async () => jpegToPdf(await sharp(await png()).jpeg().toBuffer(), 40, 30);

describe('Charter Center certificate API client', () => {
  it('posts Charter Center’s payload to /certificate, with the key when there is one', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const thePdf = await pdf();
    const client = new HttpCharterCenterExamsClient({
      baseUrl: 'https://charter-center.com/api/partner/',
      apiKey: 'secret',
      fetch: async (url, init) => {
        calls.push({ url, init: init! });
        return file(thePdf, 'application/pdf');
      },
    });
    const cert = await client.certificate(REQUEST);
    expect(cert).toEqual({ certificateId: null, pdf: thePdf, image: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://charter-center.com/api/partner/certificate');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(REQUEST);

    const noKey = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async (_u, init) => ((calls[1] = { url: '', init: init! }), file(thePdf, 'application/pdf')) });
    await noKey.certificate(REQUEST);
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('takes a picture sent as the answer', async () => {
    const image = await png();
    const client = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async () => file(image, 'image/png') });
    expect(await client.certificate(REQUEST)).toEqual({ certificateId: null, pdf: null, image });
  });

  it('follows the links in a JSON answer, telling the files apart by their content', async () => {
    const image = await png();
    const thePdf = await pdf();
    const fetched: string[] = [];
    const client = new HttpCharterCenterExamsClient({
      baseUrl: 'https://cc.example',
      fetch: async (url) => {
        fetched.push(url);
        if (url.endsWith('/certificate')) return json(200, { success: true, data: { certificate_number: 'CC-77', certificate_url: 'https://8.8.8.8/a', preview_url: 'https://8.8.8.8/b' } });
        return url.endsWith('/a') ? file(thePdf, 'application/octet-stream') : file(image, 'image/png');
      },
    });
    expect(await client.certificate(REQUEST)).toEqual({ certificateId: 'CC-77', pdf: thePdf, image });
    expect(fetched).toEqual(['https://cc.example/certificate', 'https://8.8.8.8/a', 'https://8.8.8.8/b']);
  });

  it('reads a PDF sent inline in base64', async () => {
    const thePdf = await pdf();
    expect(parseCertificateAnswer({ id: 12, pdf: `data:application/pdf;base64,${thePdf.toString('base64')}` })).toEqual({ certificateId: '12', urls: [], inline: [thePdf] });
    const client = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async () => json(200, { pdf_base64: thePdf.toString('base64') }) });
    expect((await client.certificate(REQUEST))?.pdf).toEqual(thePdf);
  });

  it('treats 404 as "not ready yet", refuses a bad key, and explains an answer without a certificate', async () => {
    const notFound = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async () => json(404, { message: 'Not found' }) });
    expect(await notFound.certificate(REQUEST)).toBeNull();
    const badKey = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async () => json(401, {}) });
    await expect(badKey.certificate(REQUEST)).rejects.toThrow(/CHARTER_CENTER_API_KEY/);
    const invalid = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async () => json(422, { message: 'The start from field is required.' }) });
    await expect(invalid.certificate(REQUEST)).rejects.toThrow(/422.*start from field/);
    const empty = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', fetch: async () => json(200, { success: true, message: 'Created' }) });
    await expect(empty.certificate(REQUEST)).rejects.toThrow(/no PDF or picture.*success, message/);
  });

  it('retries server errors', async () => {
    let n = 0;
    const image = await png();
    const flaky = new HttpCharterCenterExamsClient({ baseUrl: 'https://cc.example', attempts: 2, fetch: async () => (++n === 1 ? json(503, {}) : file(image, 'image/png')) });
    expect((await flaky.certificate(REQUEST))?.image).toEqual(image);
    expect(n).toBe(2);
  });

  it('the mock makes a sample with what would be sent, and holds back names containing "pending"', async () => {
    const mock = new MockCharterCenterExamsClient();
    expect(await mock.certificate({ ...REQUEST, student_name: 'Pending Student' })).toBeNull();
    const cert = (await mock.certificate(REQUEST))!;
    expect(cert.certificateId).toMatch(/^CC-\d{4}-\d{6}$/);
    expect(sniff(cert.pdf!)).toBe('pdf');
    expect(sniff(cert.image!)).toBe('image');
  });
});
