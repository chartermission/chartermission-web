import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { Errors } from '../common/errors.js';
import type { AppRequest } from '../core/auth-context.js';
import { MCP_ROUTES, routeKey } from './mcp-routes.js';

/**
 * Global guard for Claude's OAuth requests (no effect on cookie sessions): a token that doesn't
 * resolve answers 401 with a WWW-Authenticate challenge so the client refreshes, and a valid one
 * may only reach the routes in MCP_ROUTES.
 */
@Injectable()
export class McpRouteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.oauthBearer) return true;
    if (!req.auth?.via) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('WWW-Authenticate', 'Bearer error="invalid_token", error_description="The access token is invalid or has expired"');
      throw Errors.unauthenticated();
    }
    const key = routeKey(context);
    if (!key || !MCP_ROUTES.has(key)) throw Errors.forbidden('Claude can’t use this part of Charter Mission.');
    return true;
  }
}
