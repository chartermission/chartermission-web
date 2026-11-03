import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { AppRequest } from './auth-context.js';
import { COOKIE_NAMES, SessionService, audienceOf } from './session.service.js';

/** Attaches req.auth when a valid session cookie is present. Never rejects; guards decide. */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly sessions: SessionService) {}

  async use(req: AppRequest, _res: Response, next: NextFunction) {
    try {
      const audience = audienceOf(req);
      const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAMES[audience]];
      if (token && token.length < 200) {
        const ctx = await this.sessions.resolve(token, audience);
        if (ctx) req.auth = ctx;
      }
      next();
    } catch (err) {
      next(err);
    }
  }
}
