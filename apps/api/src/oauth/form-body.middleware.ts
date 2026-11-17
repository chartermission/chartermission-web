import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Errors } from '../common/errors.js';

const LIMIT = 16 * 1024;

/**
 * OAuth clients post application/x-www-form-urlencoded to the token and revoke endpoints
 * (RFC 6749, 7009). The app only parses JSON, so these routes read the form themselves.
 */
@Injectable()
export class FormBodyMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const type = String(req.headers['content-type'] ?? '');
    if (req.body !== undefined || !/^application\/x-www-form-urlencoded\b/i.test(type)) return next();
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      next(err);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > LIMIT) {
        req.removeAllListeners('data');
        req.resume();
        finish(Errors.tooLarge('Request too large'));
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      req.body = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
      finish();
    });
    req.on('error', finish);
  }
}
