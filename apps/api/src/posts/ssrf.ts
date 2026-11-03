import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF protection for server-side fetches of member-supplied URLs (spec 6.3 link
 * checker, section 8): https only, default port, no credentials, and every DNS
 * answer must be a public address (no private, loopback, link-local, metadata,
 * CGNAT, multicast or reserved ranges, for IPv4 and IPv6).
 */
export class SsrfError extends Error {}

export type LookupFn = (host: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true, verbatim: true });

/** IPv4 ranges that must never be fetched: [network, prefix length]. */
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. 169.254.169.254 cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([net4, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(net4) & mask);
  });
}

/** Expand an IPv6 address (with optional embedded IPv4 tail) to 16 bytes. */
export function ipv6Bytes(ip: string): number[] | null {
  let addr = ip.split('%')[0]!.toLowerCase();
  const bytesTail: number[] = [];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    if (net.isIPv4(v4[1]!) === false) return null;
    bytesTail.push(...v4[1]!.split('.').map(Number));
    addr = addr.slice(0, -v4[1]!.length) + '0:0';
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push(v >> 8, v & 0xff);
  }
  if (bytesTail.length) bytes.splice(12, 4, ...bytesTail);
  return bytes.length === 16 ? bytes : null;
}

function isBlockedV6(ip: string): boolean {
  const b = ipv6Bytes(ip);
  if (!b) return true;
  const allZero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  // :: and ::1
  if (allZero(0, 15) && (b[15] === 0 || b[15] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d → check the IPv4 part
  if (allZero(0, 10) && b[10] === 0xff && b[11] === 0xff) return isBlockedV4(b.slice(12).join('.'));
  if (allZero(0, 12)) return isBlockedV4(b.slice(12).join('.'));
  // NAT64 64:ff9b::/96 → embedded IPv4
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && allZero(4, 12)) {
    return isBlockedV4(b.slice(12).join('.'));
  }
  if ((b[0]! & 0xfe) === 0xfc) return true; // fc00::/7 unique local (incl. fd00:ec2::254 metadata)
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return true; // fec0::/10 site-local (deprecated)
  if (b[0] === 0xff) return true; // multicast
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 documentation
  if (b[0] === 0x01 && b[1] === 0x00 && allZero(2, 8)) return true; // 100::/64 discard
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedV4(b.slice(2, 6).join('.')); // 6to4 2002::/16
  return false;
}

/** True for any address a server-side fetch must not reach. Unparseable input counts as blocked. */
export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip.split('%')[0]!);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true;
}

/**
 * Validates a URL and resolves its host. Returns the vetted address to connect to,
 * so the fetch cannot be re-pointed by a second DNS answer (rebinding).
 */
export async function assertSafeUrl(raw: string, lookup: LookupFn = defaultLookup) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('Invalid URL');
  }
  if (url.protocol !== 'https:') throw new SsrfError('Only https links are fetched');
  if (url.username || url.password) throw new SsrfError('Links with credentials are not fetched');
  if (url.port && url.port !== '443') throw new SsrfError('Only the default https port is allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new SsrfError('Invalid host');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new SsrfError('This address is not allowed');
    return { url, address: host, family: net.isIP(host) };
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') || !host.includes('.')) {
    throw new SsrfError('This host is not allowed');
  }
  let answers: { address: string; family: number }[];
  try {
    answers = await lookup(host);
  } catch {
    throw new SsrfError('The host could not be resolved');
  }
  if (answers.length === 0) throw new SsrfError('The host could not be resolved');
  if (answers.some((a) => isPrivateAddress(a.address))) throw new SsrfError('This address is not allowed');
  return { url, address: answers[0]!.address, family: answers[0]!.family };
}
