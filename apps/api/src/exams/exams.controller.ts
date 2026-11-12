import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import {
  AdminExamAttemptsQuery,
  ExamImportInput,
  ExamQuestionInput,
  ExamQuestionOrderInput,
  ExamQuestionsImportInput,
  ExamSectionsInput,
  ExamSettingsInput,
  SaveExamAnswerInput,
  UpdateExamInput,
  type AdminExamAttempt,
  type AdminExamDetail,
  type AdminExamSummary,
  type ExamAnswerSaved,
  type ExamAttemptView,
  type ExamDetail,
  type ExamSummary,
  type Ok,
  type Page,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { ExamsService } from './exams.service.js';
import { ExamAttemptsService } from './exam-attempts.service.js';
import { AdminExamsService } from './admin-exams.service.js';

/** Exams for signed-in members: browse, take and review. Marking happens here, never in the browser. */
@Controller()
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly attempts: ExamAttemptsService,
  ) {}

  @Get('exams')
  @Access('member')
  list(@Auth() ctx: AuthContext): Promise<ExamSummary[]> {
    return this.exams.list(ctx.user);
  }

  @Get('exams/:slug')
  @Access('member')
  detail(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<ExamDetail> {
    return this.exams.detail(ctx.user, slug);
  }

  /** Starts an attempt, or hands back the one in progress. */
  @Post('exams/:id/attempts')
  @HttpCode(201)
  @Access('member')
  start(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<ExamAttemptView> {
    return this.attempts.start(ctx.user, id);
  }

  @Get('exam-attempts/:id')
  @Access('member')
  attempt(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<ExamAttemptView> {
    return this.attempts.view(ctx.user, id);
  }

  @Put('exam-attempts/:id/answers')
  @Access('member')
  save(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(SaveExamAnswerInput) input: SaveExamAnswerInput): Promise<ExamAnswerSaved> {
    return this.attempts.saveAnswer(ctx.user, id, input);
  }

  @Post('exam-attempts/:id/submit')
  @HttpCode(200)
  @Access('member')
  submit(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<ExamAttemptView> {
    return this.attempts.submit(ctx.user, id);
  }
}

/** Admin console Exams section: the exam builder and members' results (exam.manage). */
@Controller('admin/exams')
export class AdminExamsController {
  constructor(private readonly admin: AdminExamsService) {}

  @Get()
  @Access('admin', 'exam.manage')
  list(): Promise<AdminExamSummary[]> {
    return this.admin.list();
  }

  @Post()
  @HttpCode(201)
  @Access('admin', 'exam.manage')
  create(@Auth() ctx: AuthContext, @ZBody(ExamSettingsInput) input: ExamSettingsInput, @Req() req: AppRequest): Promise<AdminExamDetail> {
    return this.admin.create(ctx, input, clientIp(req));
  }

  @Post('import')
  @HttpCode(201)
  @Access('admin', 'exam.manage')
  import(@Auth() ctx: AuthContext, @ZBody(ExamImportInput) input: ExamImportInput, @Req() req: AppRequest): Promise<AdminExamDetail> {
    return this.admin.import(ctx, input, clientIp(req));
  }

  @Get(':id')
  @Access('admin', 'exam.manage')
  detail(@UuidParam('id') id: string): Promise<AdminExamDetail> {
    return this.admin.detail(id);
  }

  @Patch(':id')
  @Access('admin', 'exam.manage')
  update(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(UpdateExamInput) input: UpdateExamInput, @Req() req: AppRequest): Promise<AdminExamDetail> {
    return this.admin.update(ctx, id, input, clientIp(req));
  }

  @Delete(':id')
  @Access('admin', 'exam.manage')
  remove(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.admin.remove(ctx, id, clientIp(req));
  }

  @Put(':id/sections')
  @Access('admin', 'exam.manage')
  sections(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(ExamSectionsInput) input: ExamSectionsInput, @Req() req: AppRequest): Promise<AdminExamDetail> {
    return this.admin.setSections(ctx, id, input, clientIp(req));
  }

  @Post(':id/questions')
  @HttpCode(201)
  @Access('admin', 'exam.manage')
  addQuestion(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(ExamQuestionInput) input: ExamQuestionInput, @Req() req: AppRequest): Promise<AdminExamDetail> {
    return this.admin.addQuestion(ctx, id, input, clientIp(req));
  }

  @Post(':id/questions/import')
  @HttpCode(201)
  @Access('admin', 'exam.manage')
  importQuestions(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @ZBody(ExamQuestionsImportInput) input: ExamQuestionsImportInput,
    @Req() req: AppRequest,
  ): Promise<AdminExamDetail> {
    return this.admin.importQuestions(ctx, id, input, clientIp(req));
  }

  @Put(':id/questions/order')
  @Access('admin', 'exam.manage')
  reorder(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(ExamQuestionOrderInput) input: ExamQuestionOrderInput, @Req() req: AppRequest): Promise<AdminExamDetail> {
    return this.admin.reorder(ctx, id, input, clientIp(req));
  }

  @Patch(':id/questions/:questionId')
  @Access('admin', 'exam.manage')
  updateQuestion(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @UuidParam('questionId') questionId: string,
    @ZBody(ExamQuestionInput) input: ExamQuestionInput,
    @Req() req: AppRequest,
  ): Promise<AdminExamDetail> {
    return this.admin.updateQuestion(ctx, id, questionId, input, clientIp(req));
  }

  @Delete(':id/questions/:questionId')
  @Access('admin', 'exam.manage')
  removeQuestion(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @UuidParam('questionId') questionId: string, @Req() req: AppRequest): Promise<AdminExamDetail> {
    return this.admin.removeQuestion(ctx, id, questionId, clientIp(req));
  }

  @Get(':id/attempts')
  @Access('admin', 'exam.manage')
  attempts(@UuidParam('id') id: string, @ZQuery(AdminExamAttemptsQuery) q: AdminExamAttemptsQuery): Promise<Page<AdminExamAttempt>> {
    return this.admin.attemptList(id, q);
  }
}
