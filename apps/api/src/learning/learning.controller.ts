import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import {
  AdminCoursesQuery,
  AdminLearningMembersQuery,
  CoursesQuery,
  LearningAccessRules,
  LearningOverrideInput,
  type AdminLearningMember,
  type LearningAccess,
  CursorQuery,
  UpdateCourseCurationInput,
  type AdminCourseView,
  type CourseDetail,
  type CourseSummary,
  type LearningHub,
  type LearningPath,
  type Page,
  type SyncRunView,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { CoursesService } from './courses.service.js';
import { AdminCoursesService } from './admin-courses.service.js';
import { LearningJobsService } from './learning-jobs.service.js';
import { LearningAccessService } from './learning-access.service.js';
import { AuditService } from '../infra/audit.service.js';
import { SettingsService } from '../infra/settings.service.js';

/** Learning (spec 4.10): the Charter Center catalogue for signed-in members. */
@Controller()
export class LearningController {
  constructor(
    private readonly courses: CoursesService,
    private readonly access: LearningAccessService,
  ) {}

  /** Whether Learning is unlocked for the member, and their progress on each rule. */
  @Get('learning/access')
  @Access('member')
  accessStatus(@Auth() ctx: AuthContext): Promise<LearningAccess> {
    return this.access.forMember(ctx.user);
  }

  @Get('learning')
  @Access('member')
  async hub(@Auth() ctx: AuthContext): Promise<LearningHub> {
    await this.access.assertUnlocked(ctx.user);
    return this.courses.hub(ctx.user);
  }

  @Get('learning/paths/:slug')
  @Access('member')
  async path(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<LearningPath> {
    await this.access.assertUnlocked(ctx.user);
    return this.courses.path(ctx.user, slug);
  }

  @Get('courses')
  @Access('member')
  async list(@Auth() ctx: AuthContext, @ZQuery(CoursesQuery) q: CoursesQuery, @Query('sort') rawSort?: unknown): Promise<Page<CourseSummary>> {
    await this.access.assertUnlocked(ctx.user);
    return this.courses.list(ctx.user, q, rawSort !== undefined && rawSort !== '');
  }

  @Get('courses/:slug')
  @Access('member')
  async detail(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<CourseDetail> {
    await this.access.assertUnlocked(ctx.user);
    return this.courses.detail(ctx.user, slug);
  }

  /** "Start learning" beacon (CM-LRN-04). */
  @Post('courses/:id/click')
  @HttpCode(204)
  @Access('member')
  async click(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<void> {
    await this.access.assertUnlocked(ctx.user);
    await this.courses.click(ctx.user, id);
  }
}

/** E-learning access: the unlock rules (settings.manage) and per-member overrides (course.curate). */
@Controller('admin')
export class AdminLearningAccessController {
  constructor(
    private readonly access: LearningAccessService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('settings/learning-access')
  @Access('admin', 'settings.manage')
  rules(): Promise<LearningAccessRules> {
    return this.access.rules();
  }

  @Put('settings/learning-access')
  @Access('admin', 'settings.manage')
  async updateRules(
    @Auth() ctx: AuthContext,
    @ZBody(LearningAccessRules) input: LearningAccessRules,
    @Req() req: AppRequest,
  ): Promise<LearningAccessRules> {
    const before = await this.access.rules();
    await this.settings.set('learning_access', input, ctx.user.id);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'settings.learning_access.updated',
      targetType: 'setting',
      targetId: 'learning_access',
      before,
      after: input,
      ip: clientIp(req),
    });
    return this.access.rules();
  }

  @Get('learning/access/members')
  @Access('admin', 'course.curate')
  members(@ZQuery(AdminLearningMembersQuery) q: AdminLearningMembersQuery): Promise<AdminLearningMember[]> {
    return this.access.adminMembers(q.q || undefined);
  }

  @Put('learning/access/overrides/:userId')
  @Access('admin', 'course.curate')
  async grant(
    @Auth() ctx: AuthContext,
    @UuidParam('userId') userId: string,
    @ZBody(LearningOverrideInput) input: LearningOverrideInput,
    @Req() req: AppRequest,
  ): Promise<AdminLearningMember> {
    const before = await this.access.grant(userId, input.note, ctx.user.id);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'learning.access.unlocked',
      targetType: 'member',
      targetId: userId,
      before: before ? { note: before.note } : null,
      after: { note: input.note ?? null },
      ip: clientIp(req),
    });
    return this.access.adminMember(userId);
  }

  @Delete('learning/access/overrides/:userId')
  @Access('admin', 'course.curate')
  async revoke(@Auth() ctx: AuthContext, @UuidParam('userId') userId: string, @Req() req: AppRequest): Promise<AdminLearningMember> {
    const before = await this.access.revoke(userId);
    if (before) {
      await this.audit.record({
        actorId: ctx.user.id,
        action: 'learning.access.override_removed',
        targetType: 'member',
        targetId: userId,
        before: { note: before.note },
        after: null,
        ip: clientIp(req),
      });
    }
    return this.access.adminMember(userId);
  }
}

/** Admin Learning section: local curation only (hide / feature), link status and sync history. */
@Controller('admin')
export class AdminLearningController {
  constructor(
    private readonly admin: AdminCoursesService,
    private readonly jobs: LearningJobsService,
  ) {}

  @Get('courses')
  @Access('admin', 'course.curate')
  list(@ZQuery(AdminCoursesQuery) q: AdminCoursesQuery): Promise<Page<AdminCourseView>> {
    return this.admin.list(q);
  }

  @Patch('courses/:id')
  @Access('admin', 'course.curate')
  curate(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @ZBody(UpdateCourseCurationInput) input: UpdateCourseCurationInput,
    @Req() req: AppRequest,
  ): Promise<AdminCourseView> {
    return this.admin.curate(ctx, id, input, clientIp(req));
  }

  @Get('learning/sync-runs')
  @Access('admin', 'course.curate')
  runs(@ZQuery(CursorQuery) q: CursorQuery): Promise<Page<SyncRunView>> {
    return this.admin.runs(q);
  }

  @Post('learning/sync')
  @HttpCode(202)
  @Access('admin', 'course.curate')
  async sync(@Auth() ctx: AuthContext): Promise<SyncRunView> {
    const run = await this.jobs.trigger('sync', ctx.user.id);
    return (await this.admin.runViews([run]))[0]!;
  }

  @Post('learning/link-check')
  @HttpCode(202)
  @Access('admin', 'course.curate')
  async linkCheck(@Auth() ctx: AuthContext): Promise<SyncRunView> {
    const run = await this.jobs.trigger('link_check', ctx.user.id);
    return (await this.admin.runViews([run]))[0]!;
  }
}
