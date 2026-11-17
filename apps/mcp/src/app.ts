import express, { type NextFunction, type Request, type Response } from 'express';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Config } from './env.js';
import { oauthRouter } from './oauth.js';
import { TokenVerifier } from './auth.js';
import { createMcpServer } from './server.js';

/** Claude connects from its own origins (and Claude Code / Desktop from none): these paths are open to all. */
const CORS_PATHS = /^\/(\.well-known\/|register$|token$|revoke$|mcp$)/;

function cors(req: Request, res: Response, next: NextFunction) {
  if (!CORS_PATHS.test(req.path)) return next();
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Max-Age': '86400',
  });
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

function jsonRpcError(res: Response, status: number, message: string) {
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

/** The transport works on web Requests; the body is already parsed, so only method, URL and headers matter. */
function toWebRequest(req: Request, config: Config): globalThis.Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  return new globalThis.Request(`${config.PUBLIC_URL}${req.originalUrl}`, { method: req.method, headers });
}

export function createApp(config: Config, verifier = new TokenVerifier(config.API_INTERNAL_URL)) {
  const app = express();
  app.disable('x-powered-by');
  // Behind the platform's reverse proxy (Coolify / Traefik): req.ip is the client.
  app.set('trust proxy', 1);
  app.use(cors);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(oauthRouter(config));

  const resourceMetadata = `${config.PUBLIC_URL}/.well-known/oauth-protected-resource`;

  /** No token → ask for one; a rejected token → say so, so Claude refreshes or reconnects. */
  function unauthorized(res: Response, sentToken: boolean) {
    const challenge = sentToken
      ? `Bearer error="invalid_token", error_description="The access token is invalid or expired", resource_metadata="${resourceMetadata}"`
      : `Bearer resource_metadata="${resourceMetadata}"`;
    res
      .status(401)
      .set('WWW-Authenticate', challenge)
      .json(
        sentToken
          ? { error: 'invalid_token', error_description: 'The access token is invalid or expired.' }
          : { error: 'invalid_request', error_description: 'Sign in to Charter Mission to use this server.' },
      );
  }

  app.post('/mcp', express.json({ limit: '1mb' }), async (req, res) => {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (!match) return unauthorized(res, header.length > 0);
    const token = match[1]!;

    const check = await verifier.verify(token);
    if (!check.ok) {
      if (check.reason === 'invalid') return unauthorized(res, true);
      return jsonRpcError(res, 503, 'Charter Mission is unavailable right now. Try again shortly.');
    }

    // Stateless: a new server and transport per request. The web-standard transport hands back the whole
    // JSON response before anything is written, so a token the API refused during a tool call can still
    // turn the answer into a 401 challenge; the client then refreshes its token and retries at once.
    let tokenRefused = false;
    const server = createMcpServer(config, token, () => {
      tokenRefused = true;
      verifier.forget(token);
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(toWebRequest(req, config), { parsedBody: req.body });
      if (tokenRefused) return unauthorized(res, true);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error('[mcp] request failed', error);
      if (!res.headersSent) jsonRpcError(res, 500, 'Internal server error');
    } finally {
      void transport.close();
      void server.close();
    }
  });

  // Stateless server: no SSE stream to open and no session to end.
  app.all('/mcp', (_req, res) => {
    res.set('Allow', 'POST');
    jsonRpcError(res, 405, 'Method not allowed.');
  });

  return app;
}
