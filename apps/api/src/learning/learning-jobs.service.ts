import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { LEARNING_LINK_CHECK_INTERVAL_DAYS, LEARNING_PERMISSIONS, LEARNING_SYNC_INTERVAL_HOURS, type SyncRunKind } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { courses, learningSyncRuns, rolePermissions, userRoles, users } from '../db/schema.js';
import { env } from '../config/env.js';
import { Errors } from '../common/errors.js';
import { NotifyService } from '../core/notify.service.js';
import { QueueService } from '../infra/queue.service.js';
import { CHARTER_CENTER_CLIENT, type CharterCenterClient } from './charter-center.client.js';
import { LINK_CHECKER, type LinkChecker } from './link-checker.js';
import { executeLinkCheck, executeSync, RunInProgressError, startRun, type CourseRow, type SyncRunRow } from './learning-sync.js';

/** Maintenance-queue job names. */
export const LEARNING_SYNC_JOB = 'learning-sync';
export const LEARNING_LINK_CHECK_JOB = 'learning-link-check';

type JobData = { runId?: string };

/** Members who receive course_link_broken: active accounts holding course.curate through a role. */
export async function curatorIds(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(rolePermissions.permissionKey, LEARNING_PERMISSIONS.curate),
        isNull(userRoles.revokedAt),
        notInArray(users.status, ['deleted', 'deletion_pending', 'deactivated', 'suspended']),
      ),
    );
  return rows.map((r) => r.id);
}

/** Text and link of the course_link_broken notification (shared with the seed). */
export function brokenLinkNotice(course: Pick<CourseRow, 'id' | 'title' | 'slug'>) {
  return {
    segments: [
      { text: 'The Charter Center link for ', strong: false },
      { text: course.title, strong: true },
      { text: ' is not working. “Start learning” is hidden until it passes a check again.', strong: false },
    ],
    href: `/learning/courses/${course.slug}`,
    icon: 'alert' as const,
    dedupeKey: `course_link_broken:${course.id}`,
  };
}

/**
 * Schedules and runs the Charter Center catalogue sync (every 6 h) and the course link check
 * (weekly) on the maintenance queue; admins can start either on demand.
 */
@Injectable()
export class LearningJobsService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger('Learning');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly queue: QueueService,
    private readonly notify: NotifyService,
    @Inject(CHARTER_CENTER_CLIENT) private readonly client: CharterCenterClient,
    @Inject(LINK_CHECKER) private readonly checker: LinkChecker,
  ) {}

  onModuleInit() {
    this.queue.process('maintenance', async (name, data: JobData) => {
      if (name === LEARNING_SYNC_JOB) await this.runJob('sync', data);
      if (name === LEARNING_LINK_CHECK_JOB) await this.runJob('link_check', data);
    });
    const schedule = (job: string, ms: number) =>
      this.queue.every('maintenance', job, ms).catch((err: unknown) => this.logger.warn(`Could not schedule ${job}: ${String(err)}`));
    void schedule(LEARNING_SYNC_JOB, LEARNING_SYNC_INTERVAL_HOURS * 3600_000);
    void schedule(LEARNING_LINK_CHECK_JOB, LEARNING_LINK_CHECK_INTERVAL_DAYS * 24 * 3600_000);
  }

  /** Development convenience: an empty catalogue is filled once at start-up. */
  async onApplicationBootstrap() {
    if (env().NODE_ENV !== 'development' || this.queue.inline) return;
    try {
      const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(courses);
      if ((row?.n ?? 0) === 0) {
        this.logger.log(`Catalogue empty; syncing from ${this.client.source}`);
        await this.queue.add('maintenance', LEARNING_SYNC_JOB, {});
      }
    } catch (err) {
      this.logger.warn(`Start-up catalogue check failed: ${String(err)}`);
    }
  }

  /**
   * Admin trigger: records a running row (CONFLICT when one is already running) and queues the
   * work. Returns the run as started.
   */
  async trigger(kind: SyncRunKind, adminId: string): Promise<SyncRunRow> {
    let run: SyncRunRow;
    try {
      run = await startRun(this.db, kind, 'admin', adminId);
    } catch (err) {
      if (err instanceof RunInProgressError) throw Errors.conflict(err.message);
      throw err;
    }
    try {
      await this.queue.add('maintenance', kind === 'sync' ? LEARNING_SYNC_JOB : LEARNING_LINK_CHECK_JOB, { runId: run.id } satisfies JobData);
    } catch (err) {
      await this.db
        .update(learningSyncRuns)
        .set({ status: 'failed', finishedAt: new Date(), error: 'Could not queue the job' })
        .where(eq(learningSyncRuns.id, run.id));
      throw err;
    }
    return run;
  }

  /** Runs a queued job: an admin-started run by id, or a new scheduled run. */
  async runJob(kind: SyncRunKind, data: JobData = {}): Promise<SyncRunRow | null> {
    let runId = data.runId;
    if (runId) {
      const [run] = await this.db.select().from(learningSyncRuns).where(eq(learningSyncRuns.id, runId)).limit(1);
      if (!run || run.status !== 'running') return null;
    } else {
      try {
        runId = (await startRun(this.db, kind, 'schedule')).id;
      } catch (err) {
        if (err instanceof RunInProgressError) {
          this.logger.log(`Skipped scheduled ${kind}: ${err.message}`);
          return null;
        }
        throw err;
      }
    }
    const result =
      kind === 'sync'
        ? await executeSync(this.db, this.client, runId)
        : await executeLinkCheck(this.db, this.checker, runId, (c) => this.notifyBroken(c));
    if (result.status === 'failed') this.logger.warn(`Learning ${kind} failed: ${result.error}`);
    return result;
  }

  /** course_link_broken to every curator, once per transition to broken (dedupe key per course). */
  async notifyBroken(course: CourseRow): Promise<void> {
    for (const userId of await curatorIds(this.db)) {
      await this.notify.notify({
        userId,
        type: 'course_link_broken',
        objectType: 'course',
        objectId: course.id,
        ...brokenLinkNotice(course),
        windowMinutes: 60,
      });
    }
  }
}
