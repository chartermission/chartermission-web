/** Loopback hosts Claude Code and Claude Desktop listen on; plain http and any port or path are fine there (RFC 8252). */
const LOOPBACK = new Set(['localhost', '127.0.0.1']);

/** The exact https redirect URIs in OAUTH_REDIRECT_URIS. */
export function allowedRedirectUris(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
  );
}

/**
 * Whether a client may register this redirect URI: one of the pinned https URIs, character for
 * character, or http on a loopback host (any port and path). No credentials, no fragment
 * (RFC 6749 3.1.2).
 */
export function isAllowedRedirectUri(uri: string, allowed: Set<string>): boolean {
  if (uri.length > 500) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash || uri.includes('#')) return false;
  if (url.protocol === 'https:') return allowed.has(uri);
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname.toLowerCase());
  return false;
}
