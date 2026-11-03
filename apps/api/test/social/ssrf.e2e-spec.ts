import { assertSafeUrl, ipv6Bytes, isPrivateAddress, SsrfError } from '../../src/posts/ssrf.js';
import { LinkPreviewService, parsePreview } from '../../src/posts/link-preview.js';
import { firstHttpsUrl, parseHashtags, parseMentions } from '../../src/posts/text-parse.js';

/* Unit tests: no app, no network. */

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

describe('SSRF guard', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.9',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd00:ec2::254',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows public %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it('parses IPv6 forms', () => {
    expect(ipv6Bytes('::1')).toEqual([...Array(15).fill(0), 1]);
    expect(ipv6Bytes('::ffff:1.2.3.4')!.slice(10)).toEqual([0xff, 0xff, 1, 2, 3, 4]);
    expect(ipv6Bytes('1:2:3')).toBeNull();
  });

  it('rejects http://, credentials, odd ports and local names', async () => {
    await expect(assertSafeUrl('http://example.com/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('ftp://example.com/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('https://user:pw@example.com/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('https://example.com:8443/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('https://localhost/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('https://metadata.google.internal/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects literal private addresses, including the metadata endpoint', async () => {
    await expect(assertSafeUrl('https://127.0.0.1/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('https://169.254.169.254/latest/meta-data/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('https://[::1]/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('https://10.0.0.8/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects hosts that resolve to private ranges (any answer)', async () => {
    await expect(assertSafeUrl('https://evil.example/', async () => [{ address: '192.168.0.5', family: 4 }])).rejects.toBeInstanceOf(
      SsrfError,
    );
    await expect(
      assertSafeUrl('https://mixed.example/', async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(assertSafeUrl('https://v6.example/', async () => [{ address: 'fd12::1', family: 6 }])).rejects.toBeInstanceOf(SsrfError);
  });

  it('returns the vetted address for public hosts', async () => {
    const r = await assertSafeUrl('https://example.com/page?x=1', publicLookup);
    expect(r.address).toBe('93.184.216.34');
    expect(r.url.hostname).toBe('example.com');
  });

  it('does not follow redirects to another host or to http', async () => {
    const svc = new LinkPreviewService();
    const spy = vi.spyOn(svc, 'fetchPage').mockResolvedValue({ status: 302, location: 'https://other.example/', contentType: '', body: '' });
    await expect(svc.fetchPreview('https://example.com/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
    spy.mockResolvedValue({ status: 301, location: 'http://example.com/x', contentType: '', body: '' });
    await expect(svc.fetchPreview('https://example.com/', publicLookup)).rejects.toBeInstanceOf(SsrfError);
  });

  it('parses Open Graph tags', async () => {
    const svc = new LinkPreviewService();
    vi.spyOn(svc, 'fetchPage').mockResolvedValue({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><head><title>Fallback</title><meta property="og:title" content="Rules of origin"><meta property="og:description" content="What changes"><meta property="og:image" content="/img.png"></head></html>',
    });
    const preview = await svc.fetchPreview('https://www.au-afcfta.org/news', publicLookup);
    expect(preview).toEqual({
      url: 'https://www.au-afcfta.org/news',
      domain: 'au-afcfta.org',
      title: 'Rules of origin',
      description: 'What changes',
      imageUrl: 'https://www.au-afcfta.org/img.png',
    });
    expect(parsePreview('<title> T </title>', new URL('https://a.example/')).title).toBe('T');
  });
});

describe('text parsing', () => {
  it('extracts hashtags (de-duplicated, max 10) and mentions', () => {
    expect(parseHashtags('Hi #AfCFTA and #afcfta, #AgriTech! #a not#this https://x.example/#frag')).toEqual([
      { tag: 'afcfta', display: 'AfCFTA' },
      { tag: 'agritech', display: 'AgriTech' },
    ]);
    const many = Array.from({ length: 12 }, (_, i) => `#tag${i}`).join(' ');
    expect(parseHashtags(many)).toHaveLength(10);
    expect(parseMentions('cc @Amara-Okafor and @kwame-mensah, mail me@example.com @x')).toEqual(['amara-okafor', 'kwame-mensah']);
    expect(firstHttpsUrl('see http://a.example and https://b.example/path).')).toBe('https://b.example/path');
  });
});
