import { allowedRedirectUris, isAllowedRedirectUri } from './redirect-uris.js';

describe('OAuth redirect URIs', () => {
  const allowed = allowedRedirectUris(' https://claude.ai/api/mcp/auth_callback, https://claude.com/api/mcp/auth_callback ,');

  it('reads the comma list', () => {
    expect([...allowed]).toEqual(['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback']);
  });

  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'http://localhost:6274/oauth/callback',
    'http://127.0.0.1:33418/callback',
    'http://localhost/callback',
  ])('allows %s', (uri) => {
    expect(isAllowedRedirectUri(uri, allowed)).toBe(true);
  });

  it.each([
    'https://claude.ai/api/mcp/auth_callback/',
    'https://claude.ai/api/mcp/auth_callback?x=1',
    'https://claude.ai/other/callback',
    'https://CLAUDE.ai/api/mcp/auth_callback',
    'http://claude.ai/api/mcp/auth_callback',
    'https://evil.claude.ai/api/mcp/auth_callback',
    'https://claude.ai.evil.com/api/mcp/auth_callback',
    'https://claude.ai:8443/api/mcp/auth_callback',
    'https://user:pw@claude.ai/api/mcp/auth_callback',
    'https://claude.ai/api/mcp/auth_callback#frag',
    'http://localhost.evil.com/callback',
    'http://user@localhost:3000/callback',
    'http://192.168.1.10/callback',
    'javascript:alert(1)',
    'custom-scheme://callback',
    'not a url',
    `https://claude.ai/${'a'.repeat(500)}`,
  ])('rejects %s', (uri) => {
    expect(isAllowedRedirectUri(uri, allowed)).toBe(false);
  });
});
