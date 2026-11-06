import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { PG_POOL } from './db/db.module.js';
import { configureApp } from './bootstrap.js';
import { checkDatabase } from './db/check.js';
import { runMigrations } from './db/migrate.js';
import { checkRedis } from './infra/redis-preflight.js';
import { env } from './config/env.js';

// Local development reads apps/api/.env when present; hosted environments set real variables.
if (existsSync('.env')) process.loadEnvFile('.env');

async function bootstrap() {
  if (env().NODE_ENV === 'development') {
    await checkRedis();
    // Local development: apply pending migrations so pulling new code never leaves the database behind.
    try {
      await runMigrations();
    } catch (error) {
      console.error(`\n[Database] Could not apply migrations: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = configureApp(app);
  await app.listen(config.PORT);
  if (config.NODE_ENV === 'development') await checkDatabase(app.get(PG_POOL));
}
await bootstrap();
