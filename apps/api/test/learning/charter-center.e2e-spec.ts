import { CharterCenterCourseRecord } from '@chartermission/contracts';
import { CharterCenterError, FixtureCharterCenterClient, HttpCharterCenterClient, loadFixture, type FetchFn } from '../../src/learning/charter-center.client.js';
import { mapCourse, mapPath, MappingError, normaliseLanguage, resolveTopic, slugify } from '../../src/learning/charter-center.mapper.js';
import { durationLabel, languageName } from '../../src/learning/course-views.js';
import { parseDurationMinutes, partnerLevel } from '../../src/learning/charter-center.partner.js';
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

describe('Learning: HttpCharterCenterClient (partner API)', () => {
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

  /** A course as GET https://charter-center.com/api/partner/courses sends it (shape of 9 Nov 2026). */
  const partnerCourse = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'course',
    category_id: 1,
    title: `Course ${id}`,
    title_ar: `دورة ${id}`,
    overview: `Overview ${id}`,
    overview_ar: '',
    price: 699,
    price_after_discount: 699,
    has_discount: false,
    discount_type: null,
    discount_value: null,
    currency: 'SAR',
    level: 'Professional',
    duration: '31 Hr , 2 Min and 36 sec',
    lessons_count: 86,
    featured_image_url: `https://charter-center.com/storage/${id}/cover.jpg`,
    url: `https://charter-center.com/courses/details/${id}/course-${id}`,
    instructor: { name: 'Montser Mohamed', photo_url: 'https://charter-center.com/storage/1/me.jpg' },
    ...extra,
  });
  const page = (data: unknown[], current: number, last: number) => ({
    status_code: 200,
    message: 'Record Found',
    data: {
      categories: [
        { id: 1, name: 'Management', name_ar: 'الإدارة', icon_url: 'https://charter-center.com/i/1.svg' },
        { id: 3, name: 'Engineering', name_ar: 'الهندسة', icon_url: 'https://charter-center.com/i/3.svg' },
      ],
      courses: { data, current_page: current, last_page: last, per_page: 15, total: 3 },
    },
  });
  /** GET /courses/{id}. */
  const detail = (id: number, extra: Record<string, unknown> = {}) => ({
    status_code: 200,
    message: 'Record Found',
    data: {
      ...partnerCourse(id),
      description: 'Run-together text',
      outcomes: [`Outcome ${id}a`, ` Outcome ${id}b `, ''],
      requirements: ['Basic computer literacy', 'No prior AutoCAD experience required'],
      syllabus: { sections: [{ title: 'Module 01', lectures: [{ title: 'Intro', duration_minutes: 24 }] }], practice_tests: [], exams: [] },
      ...extra,
    },
  });
  /** Serves list pages by ?page= and details by /courses/{id}. */
  const api =
    (pages: Record<number, unknown>, details: (id: number) => unknown = (id) => detail(id)) =>
    (url: URL) => {
      const m = url.pathname.match(/\/courses\/(\d+)$/);
      if (m) return { status: 200, body: details(Number(m[1])) };
      return { status: 200, body: pages[Number(url.searchParams.get('page'))] };
    };

  it('reads every page, then each course’s details, and maps them to course records', async () => {
    const { calls, fetchFn } = stubFetch(
      api(
        {
          1: page(
            [
              partnerCourse(1),
              partnerCourse(2, { type: 'live-course', category_id: 3, price: 1249, price_after_discount: 0, level: 'Intermediate', duration: '45 min', url: null }),
            ],
            1,
            2,
          ),
          2: page([partnerCourse(3, { type: 'exam', category_id: 99, overview: null, price: 999, price_after_discount: 499, level: null, duration: 'N/A', lessons_count: 0 })], 2, 2),
        },
        (id) => detail(id, id === 3 ? { outcomes: null, requirements: [] } : {}),
      ),
    );
    const client = new HttpCharterCenterClient({
      baseUrl: 'https://charter-center.test/api/partner/',
      fetch: fetchFn,
      courseUrlTemplate: 'https://charter-center.test/en/courses/{id}',
    });
    const courses = await client.listCourses({ updatedSince: new Date('2026-10-01T00:00:00Z') });
    expect(calls.map((c) => c.url).slice(0, 2)).toEqual(['https://charter-center.test/api/partner/courses?page=1', 'https://charter-center.test/api/partner/courses?page=2']);
    expect(calls.map((c) => c.url).slice(2).sort()).toEqual([1, 2, 3].map((id) => `https://charter-center.test/api/partner/courses/${id}`));
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect(courses.map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(courses[0]).toMatchObject({
      slug: 'course-1',
      title: 'Course 1',
      provider: 'Charter Center',
      description: 'Overview 1',
      topics: ['Management'],
      level: 'advanced',
      duration_minutes: 1863,
      lessons_count: 86,
      is_free: false,
      access_conditions: 'Recorded course · SAR 699 on Charter Center',
      url: 'https://charter-center.com/courses/details/1/course-1',
      thumbnail_url: 'https://charter-center.com/storage/1/cover.jpg',
      outcomes: ['Outcome 1a', 'Outcome 1b'],
      eligibility: '• Basic computer literacy\n• No prior AutoCAD experience required',
      status: 'published',
    });
    expect(courses[1]).toMatchObject({
      topics: ['Engineering'],
      level: 'intermediate',
      duration_minutes: 45,
      is_free: true,
      access_conditions: 'Live course · Free on Charter Center',
      url: 'https://charter-center.test/en/courses/2',
    });
    expect(courses[2]).toMatchObject({
      topics: [],
      description: '',
      level: 'beginner',
      duration_minutes: null,
      lessons_count: null,
      outcomes: [],
      eligibility: null,
      access_conditions: 'Exam preparation · SAR 499 on Charter Center (was SAR 999)',
    });
    // Every record maps cleanly into our columns.
    for (const c of courses) expect(() => mapCourse(c)).not.toThrow();
    expect(await client.listPaths()).toEqual([]);
    expect(calls).toHaveLength(5);
  });

  it('parses Charter Center durations and levels', () => {
    expect(parseDurationMinutes('31 Hr , 2 Min and 36 sec')).toBe(1863);
    expect(parseDurationMinutes('1 Hr , 0 Min and 40 sec')).toBe(61);
    expect(parseDurationMinutes('2 hours')).toBe(120);
    expect(parseDurationMinutes('N/A')).toBeNull();
    expect(parseDurationMinutes(null)).toBeNull();
    expect(parseDurationMinutes(90)).toBe(90);
    expect(['Beginner', 'intermediate', 'Advanced', 'Professional', 'Expert', 'All levels', null].map(partnerLevel)).toEqual([
      'beginner',
      'intermediate',
      'advanced',
      'advanced',
      'advanced',
      'beginner',
      'beginner',
    ]);
  });

  it('sends Bearer auth when a key is set, on list and detail calls', async () => {
    const { calls, fetchFn } = stubFetch(api({ 1: page([partnerCourse(1)], 1, 1) }));
    await new HttpCharterCenterClient({ baseUrl: 'https://charter-center.test/api/partner', apiKey: 'secret-key', fetch: fetchFn }).listCourses();
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.headers.Authorization === 'Bearer secret-key')).toBe(true);
  });

  it('retries 5xx, 429 and network errors with backoff, then succeeds', async () => {
    const ok = api({ 1: page([partnerCourse(1)], 1, 1) });
    const { calls, fetchFn } = stubFetch((url, n) => (n === 1 ? new Error('ECONNRESET') : n === 2 ? { status: 503 } : n === 3 ? { status: 429 } : ok(url)));
    const client = new HttpCharterCenterClient({ baseUrl: 'https://charter-center.test', fetch: fetchFn, attempts: 4, backoffMs: 1 });
    expect(await client.listCourses()).toHaveLength(1);
    expect(calls).toHaveLength(5);
  });

  it('fails the whole read when a course’s details can’t be fetched', async () => {
    const list = api({ 1: page([partnerCourse(1), partnerCourse(2)], 1, 1) });
    const { fetchFn } = stubFetch((url) => (url.pathname.endsWith('/courses/2') ? { status: 500 } : list(url)));
    const client = new HttpCharterCenterClient({ baseUrl: 'https://charter-center.test', fetch: fetchFn, attempts: 2, backoffMs: 1 });
    await expect(client.listCourses()).rejects.toThrow(/HTTP 500 for \/courses\/2/);
    const bad = stubFetch((url) => (url.pathname.endsWith('/courses/1') ? { status: 200, body: { data: null } } : list(url)));
    await expect(new HttpCharterCenterClient({ baseUrl: 'https://charter-center.test', fetch: bad.fetchFn }).listCourses()).rejects.toThrow(
      /Unexpected partner \/courses\/\{id\} response/,
    );
  });

  it('gives clear errors', async () => {
    const make = (handler: Parameters<typeof stubFetch>[0], attempts = 2) =>
      new HttpCharterCenterClient({ baseUrl: 'https://charter-center.test', fetch: stubFetch(handler).fetchFn, attempts, backoffMs: 1 });
    await expect(make(() => ({ status: 401 })).listCourses()).rejects.toThrow(/rejected the API key.*CHARTER_CENTER_API_KEY/);
    await expect(make(() => ({ status: 500 })).listCourses()).rejects.toThrow(/HTTP 500.*after 2 attempts/);
    await expect(make(() => ({ status: 404 })).listCourses()).rejects.toBeInstanceOf(CharterCenterError);
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    await expect(make(() => timeout).listCourses()).rejects.toThrow(/did not respond within 15s/);
    await expect(make(() => ({ status: 200, body: 'not json{' })).listCourses()).rejects.toThrow(/not JSON/);
    await expect(make(() => ({ status: 200, body: { data: [] } })).listCourses()).rejects.toThrow(/Unexpected partner \/courses response: data/);
    await expect(make(() => ({ status: 200, body: page([], 3, 5) })).listCourses()).rejects.toThrow(/did not advance/);
  });

  it('times out slow responses', async () => {
    const fetchFn: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
      });
    const client = new HttpCharterCenterClient({ baseUrl: 'https://charter-center.test', fetch: fetchFn, timeoutMs: 20, attempts: 1 });
    await expect(client.listCourses()).rejects.toThrow(/did not respond within 0.02s/);
  });
});
