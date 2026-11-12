import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import type { MessageStreamEvent } from '@chartermission/contracts';
import { env } from '../config/env.js';
import { InjectRedis } from '../infra/redis.js';

const CHANNEL = 'cm:messages';
/** A stream refreshes this every heartbeat; while it exists the member is "online" (no push needed). */
const PRESENCE_TTL_SECONDS = 60;

type Listener = (event: MessageStreamEvent) => void;

/**
 * Live message events. Every API instance subscribes to one Redis channel and hands each event to
 * the streams (GET /messages/stream) its own process holds for the addressed members. Publishing
 * is fire-and-forget: a missed event is caught up by the app's own refresh.
 */
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger('Realtime');
  private readonly listeners = new Map<string, Set<Listener>>();
  private subscriber: RedisClient | null = null;

  constructor(@InjectRedis() private readonly redis: RedisClient) {}

  /** Sends an event to each of these members' open streams, on any instance. */
  async publish(userIds: Iterable<string>, event: MessageStreamEvent): Promise<void> {
    const users = [...new Set(userIds)];
    if (!users.length) return;
    try {
      await this.redis.publish(CHANNEL, JSON.stringify({ users, event }));
    } catch (err) {
      this.logger.warn(`publish failed: ${String(err)}`);
    }
  }

  /** Called by the stream endpoint; returns the unsubscribe function. */
  listen(userId: string, listener: Listener): () => void {
    this.ensureSubscribed();
    let set = this.listeners.get(userId);
    if (!set) this.listeners.set(userId, (set = new Set()));
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (!set!.size) this.listeners.delete(userId);
    };
  }

  /** Marks the member online (their app is open with a live stream). */
  async touch(userId: string): Promise<void> {
    await this.redis.set(`online:${userId}`, '1', 'EX', PRESENCE_TTL_SECONDS).catch(() => undefined);
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.exists(`online:${userId}`).catch(() => 0)) === 1;
  }

  private ensureSubscribed() {
    if (this.subscriber) return;
    const sub = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null });
    this.subscriber = sub;
    sub.on('error', (err) => this.logger.warn(`subscriber: ${err.message}`));
    sub.subscribe(CHANNEL).catch((err) => this.logger.warn(`subscribe failed: ${String(err)}`));
    sub.on('message', (_channel, raw: string) => {
      let parsed: { users: string[]; event: MessageStreamEvent };
      try {
        parsed = JSON.parse(raw) as { users: string[]; event: MessageStreamEvent };
      } catch {
        return;
      }
      for (const user of parsed.users) {
        for (const listener of this.listeners.get(user) ?? []) {
          try {
            listener(parsed.event);
          } catch {
            // A closed stream; its cleanup removes it.
          }
        }
      }
    });
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }
}
