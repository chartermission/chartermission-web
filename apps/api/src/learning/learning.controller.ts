import { Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  AdminCoursesQuery,
  CoursesQuery,
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

/** Learning (spec 4.10): the Charter Center catalogue for signed-in members. */
@Controller()
export class LearningController {
  constructor(private readonly courses: CoursesService) {}

  @Get('learning')
  @Access('member')
  hub(@Auth() ctx: AuthContext): Promise<LearningHub> {
    return this.courses.hub(ctx.user);
  }

  @Get('learning/paths/:slug')
  @Access('member')
  path(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<LearningPath> {
    return this.courses.path(ctx.user, slug);
  }

  @Get('courses')
  @Access('member')
  list(@Auth() ctx: AuthContext, @ZQuery(CoursesQuery) q: CoursesQuery, @Query('sort') rawSort?: unknown): Promise<Page<CourseSummary>> {
    return this.courses.list(ctx.user, q, rawSort !== undefined && rawSort !== '');
  }

  @Get('courses/:slug')
  @Access('member')
  detail(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<CourseDetail> {
    return this.courses.detail(ctx.user, slug);
  }

  /** "Start learning" beacon (CM-LRN-04). */
  @Post('courses/:id/click')
  @HttpCode(204)
  @Access('member')
  async click(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<void> {
    await this.courses.click(ctx.user, id);
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
