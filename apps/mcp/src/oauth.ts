import express, { type Request, type Response, type Router } from 'express';
import { MCP_SCOPE } from '@chartermission/contracts';
import type { Config } from './env.js';

/*
 * OAuth for Claude. This server is the protected resource and, to clients, the authorization
 * server (issuer = PUBLIC_URL). The real work happens elsewhere: consent on the member app's
 * /connect page, codes and tokens in the API (/oauth/*). This keeps the API off the public MCP
 * host and lets the consent page use the member's normal cookie session.
 */

export function protectedResourceMetadata(config: Config) {
  return {
    resource: `${config.PUBLIC_URL}/mcp`,
    authorization_servers: [config.PUBLIC_URL],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Charter Mission',
  };
}

export function authorizationServerMetadata(config: Config) {
  const base = config.PUBLIC_URL;
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    revocation_endpoint: `${base}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [MCP_SCOPE],
  };
}

/** Generous: a slow token exchange is better than a failed one, which sends the member through consent again. */
const PROXY_TIMEOUT_MS = 30_000;

export function oauthRouter(config: Config): Router {
  const router = express.Router();

  const resource = (_req: Request, res: Response) => {
    res.json(protectedResourceMetadata(config));
  };
  router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], resource);

  // Clients try RFC 8414 and OpenID discovery, with and without the resource path appended.
  const server = (_req: Request, res: Response) => {
    res.json(authorizationServerMetadata(config));
  };
  router.get(
    [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/mcp',
      '/.well-known/openid-configuration',
      '/.well-known/openid-configuration/mcp',
    ],
    server,
  );

  /** The consent page lives in the member app, where the member is signed in. Query passed on untouched. */
  router.get('/authorize', (req, res) => {
    const q = req.query;
    if (!q.response_type || !q.client_id || !q.redirect_uri) {
      res.status(400).type('text/plain').send('Invalid authorization request: response_type, client_id and redirect_uri are required.');
      return;
    }
    const at = req.originalUrl.indexOf('?');
    const search = at >= 0 ? req.originalUrl.slice(at + 1) : '';
    res.redirect(302, `${config.WEB_URL}/connect?${search}`);
  });

  // Raw bodies: the token endpoint takes form-encoded and JSON bodies, and the API parses them.
  const raw = express.raw({ type: () => true, limit: '64kb' });
  for (const name of ['register', 'token', 'revoke'] as const) {
    router.post(`/${name}`, raw, (req, res) => forward(config, name, req, res));
  }

  return router;
}

/** Relays one OAuth call to the API (internal network) and its answer back as it is. */
async function forward(config: Config, name: string, req: Request, res: Response) {
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${config.API_INTERNAL_URL}/oauth/${name}`, {
      method: 'POST',
      headers: {
        'content-type': req.get('content-type') ?? 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'x-cm-csrf': '1',
        // The API trusts one proxy hop: its per-IP limits then see the client, not this server.
        ...(req.ip ? { 'x-forwarded-for': req.ip } : {}),
        ...(req.get('user-agent') ? { 'user-agent': req.get('user-agent')! } : {}),
      },
      body: body.length ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch {
    res
      .status(502)
      .set('Cache-Control', 'no-store')
      .json({ error: 'temporarily_unavailable', error_description: 'Charter Mission could not be reached. Try again shortly.' });
    return;
  }
  const text = await upstream.text();
  res.status(upstream.status);
  for (const header of ['cache-control', 'pragma', 'www-authenticate']) {
    const value = upstream.headers.get(header);
    if (value) res.set(header, value);
  }
  res.type(upstream.headers.get('content-type') ?? 'application/json').send(text);
}
