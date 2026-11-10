import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { AppRequest } from './auth-context.js';
import { COOKIE_NAMES, SessionService, audienceOf } from './session.service.js';

const MEDIA_PATH = /^\/api\/v1\/media\/[^/?]+(\/poster)?(\?|$)/;

/** Attaches req.auth when a valid session cookie is present. Never rejects; guards decide. */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly sessions: SessionService) {}

  async use(req: AppRequest, _res: Response, next: NextFunction) {
    try {
      const cookies = req.cookies as Record<string, string> | undefined;
      let audience = audienceOf(req);
      let token = cookies?.[COOKIE_NAMES[audience]];
      // <img> and <video> can't send the audience header, so media reads in the admin console
      // (which has only the admin cookie) fall back to it. Read-only GETs of /media only.
      if (!token && audience === 'member' && req.method === 'GET' && MEDIA_PATH.test(req.originalUrl ?? '')) {
        audience = 'admin';
        token = cookies?.[COOKIE_NAMES.admin];
      }
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
