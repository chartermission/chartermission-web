import { CharterCenterCourseRecord } from '@chartermission/contracts';
import { CharterCenterError, FixtureCharterCenterClient, HttpCharterCenterClient, loadFixture, type FetchFn } from '../../src/learning/charter-center.client.js';
import { mapCourse, mapPath, MappingError, normaliseLanguage, resolveTopic, slugify } from '../../src/learning/charter-center.mapper.js';
import { durationLabel, languageName } from '../../src/learning/course-views.js';
import { courseRecord } from './learning-helpers.js';

/** No database or app needed: mapper and HTTP client against stubbed responses. */
describe('Learning: Charter Center mapper', () => {
  it('maps the assumed payload to our columns', () => {
    const record = CharterCenterCourseRecord.parse({
      id: 42,
      slug: 'Export-Readiness',
      title: '  Export Readiness  ',
      provider: 'Pan-African Trade Institute',
      description: 'Learn **exporting**.',
      level: 'ADVANCED',
      topics: ['Business & trade', 'tech', 'Business & trade'],
      duration_minutes: 240,
      lessons_count: 12,
      language: 'PT-br',
      is_free: false,
      eligibility: ' SMEs only ',
      access_conditions: '',
      outcomes: ['One', ' ', 'Two'],
      url: 'https://chartercenter.org/courses/export-readiness',
      thumbnail_url: 'http://insecure.example.org/a.png',
      updated_at: '2026-10-01T10:00:00Z',
      unknown_field: 'ignored',
    });
    expect(mapCourse(record)).toEqual({
      externalId: '42',
      slug: 'export-readiness',
      title: 'Export Readiness',
      provider: 'Pan-African Trade Institute',
      description: 'Learn **exporting**.',
      level: 'advanced',
      durationMinutes: 240,
      lessons: 12,
      language: 'pt-BR',
      free: false,
      eligibility: 'SMEs only',
      accessConditions: null,
      outcomes: ['One', 'Two'],
      startUrl: 'https://chartercenter.org/courses/export-readiness',
      thumbnailUrl: null,
      sourceUpdatedAt: new Date('2026-10-01T10:00:00Z'),
      topics: ['Business & trade', 'tech'],
      archived: false,
    });
  });

  it('applies defaults for missing optional fields', () => {
    const m = mapCourse(CharterCenterCourseRecord.parse({ id: 'x1', slug: 'x', title: 'X', url: 'https://chartercenter.org/courses/x' }));
    expect(m).toMatchObject({ provider: 'Charter Center', level: 'beginner', language: 'en', free: true, durationMinutes: null, lessons: null, topics: [], outcomes: [], archived: false, sourceUpdatedAt: null });
    expect(mapCourse(CharterCenterCourseRecord.parse({ ...courseRecord(1), status: 'Archived', level: 'expert' }))).toMatchObject({ archived: true, level: 'beginner' });
  });

  it('rejects records without a usable https URL or slug', () => {
    expect(() => mapCourse(CharterCenterCourseRecord.parse(courseRecord(1, { url: 'http://chartercenter.org/x' })))).toThrow(MappingError);
    expect(() => mapCourse(CharterCenterCourseRecord.parse(courseRecord(1, { url: 'https://user:pw@chartercenter.org/x' })))).toThrow(MappingError);
    expect(() => mapCourse(CharterCenterCourseRecord.parse(courseRecord(1, { slug: '!!!', title: '???' })))).toThrow(/slug/);
  });

  it('maps paths and helpers', () => {
    expect(mapPath({ id: 'p1', slug: 'Path One', title: 'Path', description: '', level: 'Intermediate', course_ids: ['1', '2', '1'], url: 'ftp://x', updated_at: null })).toEqual({
      externalId: 'p1',
      slug: 'path-one',
      title: 'Path',
      description: '',
      level: 'intermediate',
      sourceUrl: null,
      sourceUpdatedAt: null,
      courseExternalIds: ['1', '2'],
    });
    expect(slugify('Exporter en Afrique de l’Ouest : douanes & logistique')).toBe('exporter-en-afrique-de-l-ouest-douanes-and-logistique');
    expect(normaliseLanguage('sw')).toBe('sw');
    expect(normaliseLanguage('zh-hant-tw')).toBe('zh-Hant-TW');
    expect(normaliseLanguage('not a language')).toBe('en');
    const topics = [{ id: 't1', slug: 'business', name: 'Business & trade' }];
    expect(resolveTopic('business & TRADE', topics)).toEqual({ id: 't1' });
    expect(resolveTopic('Business', topics)).toEqual({ id: 't1' });
    expect(resolveTopic('Creative industries', topics)).toEqual({ create: { slug: 'creative-industries', name: 'Creative industries' } });
    expect(durationLabel(240, 12)).toBe('4 hours · 12 lessons');
    expect(durationLabel(45, null)).toBe('45 min');
    expect(durationLabel(60, 1)).toBe('1 hour · 1 lesson');
    expect(durationLabel(90, null)).toBe('1.5 hours');
    expect(durationLabel(135, null)).toBe('2 h 15 min');
    expect(durationLabel(null, 6)).toBe('6 lessons');
    expect(durationLabel(null, null)).toBe('');
    expect(languageName('fr')).toBe('French');
    expect(languageName('ar')).toBe('Arabic');
  });

  it('the shipped fixture parses and maps completely', async () => {
    const client = new FixtureCharterCenterClient();
    const courses = await client.listCourses();
    expect(courses).toHaveLength(18);
    for (const c of courses) expect(() => mapCourse(c)).not.toThrow();
    const paths = await client.listPaths();
    expect(paths).toHaveLength(3);
    const ids = new Set(courses.map((c) => c.id));
    for (const p of paths) for (const id of p.course_ids) expect(ids.has(id)).toBe(true);
    const fixture = loadFixture();
    expect(fixture.link_check?.broken_urls).toHaveLength(1);
    expect(courses.map((c) => c.url)).toContain(fixture.link_check!.broken_urls![0]);
    const minutes = courses.map((c) => c.duration_minutes).filter((m): m is number => m !== null);
    expect(Math.min(...minutes)).toBe(30);
    expect(Math.max(...minutes)).toBe(720);
  });
});

describe('Learning: HttpCharterCenterClient', () => {
  type Call = { url: string; headers: Record<string, string> };
  function stubFetch(handler: (url: URL, n: number) => { status: number; body?: unknown } | Error) {
    const calls: Call[] = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({ url, headers: init.headers as Record<string, string> });
      const out = handler(new URL(url), calls.length);
      if (out instanceof Error) throw out;
      return new Response(out.body === undefined ? '' : typeof out.body === 'string' ? out.body : JSON.stringify(out.body), {
        status: out.status,
        headers: { 'content-type': 'application/json' },
      });
    };
    return { calls, fetchFn };
  }

  it('follows next_page with Bearer auth and passes updated_since', async () => {
    const { calls, fetchFn } = stubFetch((url) => {
      if (url.pathname === '/v1/paths') return { status: 200, body: { data: [{ id: 9, slug: 'p', title: 'P', course_ids: [1, 2] }] } };
      const page = Number(url.searchParams.get('page'));
      const data = page === 1 ? [courseRecord(1), courseRecord(2)] : page === 2 ? [courseRecord(3)] : [];
      return { status: 200, body: { data, next_page: page < 3 ? page + 1 : null } };
    });
    const client = new HttpCharterCenterClient({ baseUrl: 'https://api.chartercenter.test/v1/', apiKey: 'secret-key', fetch: fetchFn });
    const courses = await client.listCourses({ updatedSince: new Date('2026-10-01T00:00:00Z') });
    expect(courses.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.chartercenter.test/v1/courses?page=1&updated_since=2026-10-01T00%3A00%3A00.000Z',
      'https://api.chartercenter.test/v1/courses?page=2&updated_since=2026-10-01T00%3A00%3A00.000Z',
      'https://api.chartercenter.test/v1/courses?page=3&updated_since=2026-10-01T00%3A00%3A00.000Z',
    ]);
    expect(calls[0]!.headers.Authorization).toBe('Bearer secret-key');
    const paths = await client.listPaths();
    expect(paths[0]).toMatchObject({ id: '9', course_ids: ['1', '2'], description: '', url: null });
  });

  it('retries 5xx, 429 and network errors with backoff, then succeeds', async () => {
    const { calls, fetchFn } = stubFetch((_url, n) => (n === 1 ? new Error('ECONNRESET') : n === 2 ? { status: 503 } : n === 3 ? { status: 429 } : { status: 200, body: { data: [courseRecord(1)] } }));
    const client = new HttpCharterCenterClient({ baseUrl: 'https://api.chartercenter.test', fetch: fetchFn, attempts: 4, backoffMs: 1 });
    expect(await client.listCourses()).toHaveLength(1);
    expect(calls).toHaveLength(4);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it('gives clear errors', async () => {
    const make = (handler: Parameters<typeof stubFetch>[0], attempts = 2) =>
      new HttpCharterCenterClient({ baseUrl: 'https://api.chartercenter.test', fetch: stubFetch(handler).fetchFn, attempts, backoffMs: 1 });
    await expect(make(() => ({ status: 401 })).listCourses()).rejects.toThrow(/rejected the API key.*CHARTER_CENTER_API_KEY/);
    await expect(make(() => ({ status: 500 })).listCourses()).rejects.toThrow(/HTTP 500.*after 2 attempts/);
    await expect(make(() => ({ status: 404 })).listCourses()).rejects.toBeInstanceOf(CharterCenterError);
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    await expect(make(() => timeout).listPaths()).rejects.toThrow(/did not respond within 15s/);
    await expect(make(() => ({ status: 200, body: 'not json{' })).listPaths()).rejects.toThrow(/not JSON/);
    await expect(make(() => ({ status: 200, body: { items: [] } })).listCourses()).rejects.toThrow(/Unexpected \/courses response: data/);
    await expect(make(() => ({ status: 200, body: { data: [], next_page: 1 } })).listCourses()).rejects.toThrow(/did not advance/);
  });

  it('times out slow responses', async () => {
    const fetchFn: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
      });
    const client = new HttpCharterCenterClient({ baseUrl: 'https://api.chartercenter.test', fetch: fetchFn, timeoutMs: 20, attempts: 1 });
    await expect(client.listPaths()).rejects.toThrow(/did not respond within 0.02s/);
  });
});
