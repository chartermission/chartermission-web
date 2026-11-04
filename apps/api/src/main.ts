import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { PG_POOL } from './db/db.module.js';
import { configureApp } from './bootstrap.js';
import { checkDatabase } from './db/check.js';

// Local development reads apps/api/.env when present; hosted environments set real variables.
if (existsSync('.env')) process.loadEnvFile('.env');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = configureApp(app);
  await app.listen(config.PORT);
  if (config.NODE_ENV === 'development') await checkDatabase(app.get(PG_POOL));
}
await bootstrap();
