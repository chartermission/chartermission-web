import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';
import { env } from '../config/env.js';

export const QUEUES = ['events', 'email', 'media', 'video', 'trending', 'maintenance'] as const;
export type QueueName = (typeof QUEUES)[number];

type Handler = (name: string, data: any, job?: Job) => Promise<void>;

/**
 * Background jobs on BullMQ (Redis). Feature modules register handlers in
 * onModuleInit with `queue.process('events', handler)`.
 *
 * QUEUE_INLINE=true (tests) runs handlers synchronously inside add(), so tests
 * see side effects such as notifications immediately.
 */
@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly logger = new Logger('Queue');
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];
  private readonly handlers = new Map<QueueName, Handler[]>();
  readonly inline = process.env.QUEUE_INLINE === 'true';

  private connection() {
    const url = new URL(env().REDIS_URL);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }

  private queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(`cm-${name}`, {
        connection: this.connection(),
        defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
      });
      this.queues.set(name, q);
    }
    return q;
  }

  async add(name: QueueName, jobName: string, data: unknown, opts: { delayMs?: number; jobId?: string } = {}) {
    if (this.inline) {
      for (const h of this.handlers.get(name) ?? []) await h(jobName, data);
      return;
    }
    await this.queue(name).add(jobName, data, { delay: opts.delayMs, jobId: opts.jobId });
  }

  /** Repeating job (e.g. trending every 5 minutes). No-op in inline mode. */
  async every(name: QueueName, jobName: string, everyMs: number, data: unknown = {}) {
    if (this.inline) return;
    await this.queue(name).upsertJobScheduler(`${name}:${jobName}`, { every: everyMs }, { name: jobName, data });
  }

  /** `concurrency` applies to the first registration of a queue (video conversion runs one at a time). */
  process(name: QueueName, handler: Handler, opts: { concurrency?: number } = {}) {
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
    if (this.inline || !env().RUN_WORKERS) return;
    if (list.length > 1) return; // one Worker per queue dispatches to every handler
    const worker = new Worker(
      `cm-${name}`,
      async (job) => {
        for (const h of this.handlers.get(name) ?? []) await h(job.name, job.data, job);
      },
      { connection: this.connection(), concurrency: opts.concurrency ?? 5 },
    );
    worker.on('failed', (job, err) => this.logger.warn(`${name}/${job?.name} failed: ${err.message}`));
    this.workers.push(worker);
  }

  async onApplicationShutdown() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
