import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { AppRequest } from './auth-context.js';
import { COOKIE_NAMES, SessionService, audienceOf } from './session.service.js';
import {
  isApiLocale,
  localeFromHeaders,
  withLocale,
  type ApiLocale,
} from '../i18n/translate.js';

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
      if (
        !token &&
        audience === 'member' &&
        req.method === 'GET' &&
        MEDIA_PATH.test(req.originalUrl ?? '')
      ) {
        audience = 'admin';
        token = cookies?.[COOKIE_NAMES.admin];
      }
      if (token && token.length < 200) {
        const ctx = await this.sessions.resolve(token, audience);
        if (ctx) req.auth = ctx;
      }
      // The reader's language for errors and emails sent during this request.
      withLocale(requestLanguage(req), next);
    } catch (err) {
      next(err);
    }
  }
}

/** The language cookie of the app the request came from, else the member's saved choice, else the browser's. */
export function requestLanguage(req: AppRequest): ApiLocale {
  const cookies = req.cookies as Record<string, string> | undefined;
  const fromCookie = cookies?.cm_locale ?? cookies?.cm_admin_locale;
  if (isApiLocale(fromCookie)) return fromCookie;
  const saved = req.auth?.user.locale;
  if (isApiLocale(saved)) return saved;
  return localeFromHeaders(req.headers);
}
