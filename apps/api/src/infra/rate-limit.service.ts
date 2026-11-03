import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Errors } from '../common/errors.js';
import { InjectRedis } from './redis.js';

/**
 * Fixed-window rate limits in Redis (spec 8.2). Exceeding a limit throws
 * 429 RATE_LIMITED with Retry-After.
 *
 *   await this.limits.consume(`login:ip:${ip}`, 5, 15 * 60);
 */
@Injectable()
export class RateLimitService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<void> {
    const k = `rl:${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, windowSeconds);
    if (count > limit) {
      const ttl = await this.redis.ttl(k);
      throw Errors.rateLimited(ttl > 0 ? ttl : windowSeconds);
    }
  }

  /** Check without consuming (e.g. login failures are only counted on failure). */
  async assertBelow(key: string, limit: number): Promise<void> {
    const k = `rl:${key}`;
    const count = Number((await this.redis.get(k)) ?? 0);
    if (count >= limit) {
      const ttl = await this.redis.ttl(k);
      throw Errors.rateLimited(ttl > 0 ? ttl : 60);
    }
  }

  async hit(key: string, windowSeconds: number): Promise<number> {
    const k = `rl:${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, windowSeconds);
    return count;
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }
}
