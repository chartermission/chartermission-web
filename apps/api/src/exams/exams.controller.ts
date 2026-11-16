import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AdminExamAttemptsQuery,
  AdminExamCertificatesQuery,
  ExamImportInput,
  ExamQuestionInput,
  ExamQuestionOrderInput,
  ExamQuestionsImportInput,
  ExamSectionsInput,
  ExamSettingsInput,
  SaveExamAnswerInput,
  ReissueExamCertificatesInput,
  SendExamInvitesInput,
  UpdateExamInput,
  UpdateExamsSettingsInput,
  type AdminExamAttempt,
  type AdminExamCertificate,
  type AdminExamCertificatesPage,
  type ReissueExamCertificatesResult,
  type AdminExamDetail,
  type AdminExamSummary,
  type ExamAnswerSaved,
  type ExamAttemptView,
  type ExamCertificateView,
  type ExamInviteRow,
  type ExamJoinInfo,
  type ExamsAdminSettings,
  type SendExamInvitesResult,
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
import { AdminExamCertificatesService } from './admin-exam-certificates.service.js';
import { ExamCertificatesService } from './exam-certificates.service.js';

/** Exams for signed-in members: their invited exams, take and review. Marking happens here, never in the browser. */
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

  /** The invitation link: gives the viewer this exam for good. */
  @Post('exams/:slug/access')
  @HttpCode(200)
  @Access('member')
  claim(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<ExamSummary> {
    return this.exams.claim(ctx.user, slug);
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

  /** The member's Charter Center certificate for this exam (null until they pass an exam that awards one). */
  @Get('exams/:id/certificate')
  @Access('member')
  certificate(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<ExamCertificateView | null> {
    return this.exams.certificate(ctx.user, id);
  }

  /**
   * Shares the member's issued certificate on their feed as a public post, again if they deleted
   * the first one. Returns the certificate with the post's id (the live post if there already is one).
   */
  @Post('exams/:id/certificate/post')
  @Access('member')
  @HttpCode(200)
  shareCertificate(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<ExamCertificateView> {
    return this.exams.shareCertificate(ctx.user, id);
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

/** The exam's invitation page before signing in (public: the person may not have an account yet). */
@Controller('exam-join')
export class ExamJoinController {
  constructor(private readonly exams: ExamsService) {}

  @Get(':slug')
  info(@Param('slug') slug: string): Promise<ExamJoinInfo> {
    return this.exams.joinInfo(slug);
  }
}

/**
 * Certificate signatures, served without signing in: Charter Center fetches them from the
 * instructor_signature_url it is sent when a member passes.
 */
@Controller('exam-signatures')
export class ExamSignaturesController {
  constructor(private readonly certificates: ExamCertificatesService) {}

  @Get(':file')
  async signature(@Param('file') file: string, @Res() res: Response): Promise<void> {
    const { data, mime } = await this.certificates.signatureFile(file);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(data);
  }
}

/** Admin console: Charter Center connection for exams, certificate retries and replacements. */
@Controller('admin')
export class AdminExamsSettingsController {
  constructor(
    private readonly admin: AdminExamsService,
    private readonly certificates: AdminExamCertificatesService,
  ) {}

  @Get('exams-settings')
  @Access('admin', 'exam.manage')
  settings(): Promise<ExamsAdminSettings> {
    return this.admin.examsSettings();
  }

  @Put('exams-settings')
  @Access('admin', 'exam.manage')
  updateSettings(@Auth() ctx: AuthContext, @ZBody(UpdateExamsSettingsInput) input: UpdateExamsSettingsInput, @Req() req: AppRequest): Promise<ExamsAdminSettings> {
    return this.admin.updateExamsSettings(ctx, input, clientIp(req));
  }

  @Post('exam-certificates/:id/retry')
  @HttpCode(200)
  @Access('admin', 'exam.manage')
  retryCertificate(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.admin.retryCertificate(ctx, id, clientIp(req));
  }

  /** Replace an issued certificate with a new one from Charter Center (the exam's current settings). */
  @Post('exam-certificates/:id/reissue')
  @HttpCode(200)
  @Access('admin', 'exam.manage')
  reissueCertificate(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<AdminExamCertificate> {
    return this.certificates.reissueOne(ctx, id, clientIp(req));
  }
}

/** Admin console Exams section: the exam builder and members' results (exam.manage). */
@Controller('admin/exams')
export class AdminExamsController {
  constructor(
    private readonly admin: AdminExamsService,
    private readonly certificates: AdminExamCertificatesService,
  ) {}

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

  @Get(':id/invites')
  @Access('admin', 'exam.manage')
  invites(@UuidParam('id') id: string): Promise<ExamInviteRow[]> {
    return this.admin.inviteList(id);
  }

  @Post(':id/invites')
  @HttpCode(200)
  @Access('admin', 'exam.manage')
  sendInvites(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(SendExamInvitesInput) input: SendExamInvitesInput, @Req() req: AppRequest): Promise<SendExamInvitesResult> {
    return this.admin.sendInvites(ctx, id, input, clientIp(req));
  }

  @Get(':id/attempts')
  @Access('admin', 'exam.manage')
  attempts(@UuidParam('id') id: string, @ZQuery(AdminExamAttemptsQuery) q: AdminExamAttemptsQuery): Promise<Page<AdminExamAttempt>> {
    return this.admin.attemptList(id, q);
  }

  /** The exam's certificates, newest first, with how each differs from the current settings. */
  @Get(':id/certificates')
  @Access('admin', 'exam.manage')
  certificateList(@UuidParam('id') id: string, @ZQuery(AdminExamCertificatesQuery) q: AdminExamCertificatesQuery): Promise<AdminExamCertificatesPage> {
    return this.certificates.list(id, q);
  }

  /** Replace the outdated (or all) issued certificates: queued, a few a second. */
  @Post(':id/certificates/reissue')
  @HttpCode(200)
  @Access('admin', 'exam.manage')
  reissueCertificates(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @ZBody(ReissueExamCertificatesInput) input: ReissueExamCertificatesInput,
    @Req() req: AppRequest,
  ): Promise<ReissueExamCertificatesResult> {
    return this.certificates.reissueMany(ctx, id, input, clientIp(req));
  }
}
