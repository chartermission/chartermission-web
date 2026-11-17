import { Body, Controller, Get, HttpCode, Post, Req, Res, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import {
  OAuthAuthorizeInput,
  OAuthAuthorizeQuery,
  type OAuthAuthorizeCheck,
  type OAuthAuthorizeResult,
} from '@chartermission/contracts';
import { Access, Auth, SkipCsrf } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { Errors } from '../common/errors.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { OAuthErrorFilter } from './oauth-errors.js';
import { OAuthService, type ClientRegistration, type TokenResponse } from './oauth.service.js';

const asObject = (body: unknown): Record<string, unknown> =>
  body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

/**
 * The OAuth server endpoints Claude calls through the MCP app (which forwards them here). No
 * session and no CSRF header from a browser: these are server-to-server, public-client (PKCE) calls.
 * Errors are RFC-shaped (OAuthErrorFilter) and nothing is cached.
 */
@Controller('oauth')
@SkipCsrf()
@UseFilters(OAuthErrorFilter)
export class OAuthServerController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly limits: RateLimitService,
  ) {}

  /** RFC 7591 dynamic client registration (public clients only). */
  @Post('register')
  @HttpCode(201)
  async register(
    @Body() body: unknown,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ClientRegistration> {
    // Behind the MCP app every registration may come from one address: generous, but bounded.
    await this.limits.consume(`oauth:register:ip:${clientIp(req) ?? 'unknown'}`, 100, 3600, 'Too many app registrations. Try again later.');
    res.setHeader('Cache-Control', 'no-store');
    return this.oauth.register(asObject(body));
  }

  /** Authorization code (with PKCE) and refresh token grants; form-encoded or JSON. */
  @Post('token')
  @HttpCode(200)
  token(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<TokenResponse> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    return this.oauth.token(asObject(body));
  }

  /** RFC 7009 token revocation: always 200, whether or not the token was known. */
  @Post('revoke')
  @HttpCode(200)
  async revoke(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<Record<string, never>> {
    res.setHeader('Cache-Control', 'no-store');
    await this.oauth.revoke(asObject(body));
    return {};
  }
}

/** The consent page on the member site (/connect) asks here, with the member's own session. */
@Controller('oauth/authorize')
export class OAuthConsentController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('check')
  @Access('session')
  check(@Auth() ctx: AuthContext, @ZQuery(OAuthAuthorizeQuery) q: OAuthAuthorizeQuery): Promise<OAuthAuthorizeCheck> {
    if (ctx.via) throw Errors.forbidden();
    return this.oauth.check(ctx, q);
  }

  @Post()
  @HttpCode(200)
  @Access('verified')
  authorize(@Auth() ctx: AuthContext, @ZBody(OAuthAuthorizeInput) input: OAuthAuthorizeInput): Promise<OAuthAuthorizeResult> {
    // Claude can't approve its own connection: consent needs the member's cookie session.
    if (ctx.via) throw Errors.forbidden();
    return this.oauth.authorize(ctx, input);
  }
}
