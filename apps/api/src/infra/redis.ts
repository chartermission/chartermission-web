import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const REDIS = Symbol('REDIS');
export const InjectRedis = () => Inject(REDIS);

@Global()
@Module({
  providers: [{ provide: REDIS, useFactory: () => new Redis(env().REDIS_URL, { maxRetriesPerRequest: null }) }],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}
