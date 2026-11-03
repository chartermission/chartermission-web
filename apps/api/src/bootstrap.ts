import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env.js';
import { allowedOrigins } from './core/guards.js';

/** Shared HTTP setup for the server and e2e tests. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  // Behind Railway's proxy and the Next.js /api rewrites.
  express.set('trust proxy', 1);
  express.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  express.useBodyParser('json', { limit: '256kb' });
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: [...allowedOrigins()],
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CM-CSRF', 'X-CM-Audience', 'Idempotency-Key', 'If-Match'],
  });
  app.enableShutdownHooks();
  return env();
}
