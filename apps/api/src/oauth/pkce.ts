import { createHash } from 'node:crypto';
import { safeEqual } from '../common/crypto.js';

/** RFC 7636 4.1: 43–128 characters of [A-Z a-z 0-9 - . _ ~]. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/** The S256 challenge for a verifier: base64url(sha256(verifier)), no padding. */
export function s256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** PKCE S256 check (the only method we accept), compared in constant time. */
export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !VERIFIER.test(verifier)) return false;
  return safeEqual(s256(verifier), challenge);
}
