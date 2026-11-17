import { s256, verifyPkce } from './pkce.js';

describe('PKCE S256', () => {
  // RFC 7636 appendix B.
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  it('matches the RFC example', () => {
    expect(s256(verifier)).toBe(challenge);
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it('rejects a wrong, short, malformed or missing verifier', () => {
    expect(verifyPkce(`${verifier.slice(0, -1)}Y`, challenge)).toBe(false);
    expect(verifyPkce('short', s256('short'))).toBe(false);
    expect(verifyPkce(`${verifier}!`, s256(`${verifier}!`))).toBe(false);
    expect(verifyPkce(undefined, challenge)).toBe(false);
    expect(verifyPkce(verifier, challenge.toLowerCase())).toBe(false);
  });
});
