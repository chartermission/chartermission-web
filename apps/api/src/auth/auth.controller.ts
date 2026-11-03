import { Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import {
  AcceptPoliciesInput,
  ChangePasswordInput,
  ConfirmPasswordInput,
  DeletionRequestInput,
  DevMailboxQuery,
  ForgotPasswordInput,
  MfaCodeInput,
  OnboardingUpdateInput,
  ResendVerificationInput,
  ResetPasswordInput,
  SignInInput,
  SignUpInput,
  VerifyEmailInput,
  type AccountExport,
  type ConsentRecordView,
  type DevMailbox,
  type MfaSetupResponse,
  type Ok,
  type OnboardingState,
  type SessionUser,
  type SessionView,
  type SignInResult,
  type Taxonomies,
} from '@chartermission/contracts';
import { Access, Auth, OptionalAuth } from '../core/guards.js';
import { type AppRequest, type AuthContext, clientIp } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { Errors } from '../common/errors.js';
import { env } from '../config/env.js';
import { flag } from './flags.js';
import { InjectDb, type Db } from '../db/db.module.js';
import { emailOutbox } from '../db/schema.js';
import { TaxonomyService, isUuid } from '../profiles/taxonomy.service.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { AccountService } from './account.service.js';
import { OnboardingService } from './onboarding.service.js';

const OK: Ok = { ok: true };

/** Public auth endpoints (spec 6.2 Auth), rate-limited. Enumeration-safe responses use 202. */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Post('register')
  @HttpCode(202)
  async register(@ZBody(SignUpInput) input: SignUpInput, @Req() req: AppRequest): Promise<Ok> {
    await this.auth.register(input, req);
    return OK;
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@ZBody(VerifyEmailInput) input: VerifyEmailInput, @Req() req: AppRequest): Promise<Ok> {
    await this.auth.verifyEmail(input.token, clientIp(req));
    return OK;
  }

  @Post('resend')
  @HttpCode(202)
  async resend(
    @ZBody(ResendVerificationInput) input: ResendVerificationInput,
    @OptionalAuth() ctx: AuthContext | undefined,
  ): Promise<Ok> {
    await this.auth.resend(input, ctx);
    return OK;
  }

  @Post('login')
  @HttpCode(200)
  login(
    @ZBody(SignInInput) input: SignInInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SignInResult> {
    return this.auth.login(input, req, res);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<Ok> {
    await this.auth.logout(req, res);
    return OK;
  }

  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@ZBody(ForgotPasswordInput) input: ForgotPasswordInput): Promise<Ok> {
    await this.auth.forgot(input);
    return OK;
  }

  @Post('password/reset')
  @HttpCode(200)
  async reset(@ZBody(ResetPasswordInput) input: ResetPasswordInput, @Req() req: AppRequest): Promise<Ok> {
    await this.auth.reset(input, clientIp(req));
    return OK;
  }

  @Post('mfa/setup')
  @HttpCode(200)
  @Access('session')
  setupMfa(@Auth() ctx: AuthContext, @Req() req: AppRequest): Promise<MfaSetupResponse> {
    return this.mfa.setup(ctx, clientIp(req));
  }

  @Post('mfa/enable')
  @HttpCode(200)
  @Access('session')
  async enableMfa(@Auth() ctx: AuthContext, @ZBody(MfaCodeInput) input: MfaCodeInput, @Req() req: AppRequest): Promise<Ok> {
    await this.mfa.enable(ctx, input.code, clientIp(req));
    return OK;
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @Access('session')
  async verifyMfa(@Auth() ctx: AuthContext, @ZBody(MfaCodeInput) input: MfaCodeInput, @Req() req: AppRequest): Promise<Ok> {
    await this.mfa.verify(ctx, input.code, clientIp(req));
    return OK;
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @Access('session')
  async disableMfa(
    @Auth() ctx: AuthContext,
    @ZBody(ConfirmPasswordInput) input: ConfirmPasswordInput,
    @Req() req: AppRequest,
  ): Promise<Ok> {
    await this.mfa.disable(ctx, input.password, clientIp(req));
    return OK;
  }
}

/** The signed-in account (spec 6.2 Account). Suspended and deactivated accounts can still read /me. */
@Controller('me')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly onboarding: OnboardingService,
  ) {}

  @Get()
  @Access('session')
  me(@Auth() ctx: AuthContext): Promise<SessionUser> {
    return this.account.me(ctx);
  }

  @Post('consents')
  @HttpCode(200)
  @Access('session')
  acceptPolicies(
    @Auth() ctx: AuthContext,
    @ZBody(AcceptPoliciesInput) _input: AcceptPoliciesInput,
    @Req() req: AppRequest,
  ): Promise<ConsentRecordView[]> {
    return this.account.acceptPolicies(ctx, clientIp(req));
  }

  @Get('consents')
  @Access('session')
  consents(@Auth() ctx: AuthContext): Promise<ConsentRecordView[]> {
    return this.account.consents(ctx.user.id);
  }

  @Post('password')
  @HttpCode(200)
  @Access('session')
  async changePassword(
    @Auth() ctx: AuthContext,
    @ZBody(ChangePasswordInput) input: ChangePasswordInput,
    @Req() req: AppRequest,
  ): Promise<Ok> {
    await this.account.changePassword(ctx, input, clientIp(req));
    return OK;
  }

  @Get('sessions')
  @Access('session')
  sessions(@Auth() ctx: AuthContext): Promise<SessionView[]> {
    return this.account.listSessions(ctx);
  }

  @Delete('sessions/:id')
  @Access('session')
  async revokeSession(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Ok> {
    if (!isUuid(id)) throw Errors.notFound('Session');
    await this.account.revokeSession(ctx, id, res, clientIp(req));
    return OK;
  }

  @Post('deactivate')
  @HttpCode(200)
  @Access('member')
  async deactivate(
    @Auth() ctx: AuthContext,
    @ZBody(ConfirmPasswordInput) input: ConfirmPasswordInput,
    @Req() req: AppRequest,
  ): Promise<Ok> {
    await this.account.deactivate(ctx, input.password, clientIp(req));
    return OK;
  }

  @Post('reactivate')
  @HttpCode(200)
  @Access('session')
  async reactivate(
    @Auth() ctx: AuthContext,
    @ZBody(ConfirmPasswordInput) input: ConfirmPasswordInput,
    @Req() req: AppRequest,
  ): Promise<Ok> {
    await this.account.reactivate(ctx, input.password, clientIp(req));
    return OK;
  }

  @Post('deletion-request')
  @HttpCode(202)
  @Access('session')
  async deletionRequest(
    @Auth() ctx: AuthContext,
    @ZBody(DeletionRequestInput) input: DeletionRequestInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Ok> {
    await this.account.requestDeletion(ctx, input, res, clientIp(req));
    return OK;
  }

  @Get('export')
  @Access('session')
  @Header('Content-Disposition', 'attachment; filename="charter-mission-export.json"')
  @Header('Cache-Control', 'no-store')
  export(@Auth() ctx: AuthContext): Promise<AccountExport> {
    return this.account.export(ctx.user.id);
  }

  @Get('onboarding')
  @Access('member')
  onboardingState(@Auth() ctx: AuthContext): Promise<OnboardingState> {
    return this.onboarding.state(ctx.user.id);
  }

  @Put('onboarding')
  @Access('member')
  saveOnboarding(@Auth() ctx: AuthContext, @ZBody(OnboardingUpdateInput) input: OnboardingUpdateInput): Promise<OnboardingState> {
    return this.onboarding.update(ctx, input);
  }
}

/** GET /taxonomies — public reference data for forms and filters. */
@Controller('taxonomies')
export class TaxonomiesController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
  taxonomies(): Promise<Taxonomies> {
    return this.taxonomy.all();
  }
}

/** Development helpers; every route 404s unless DEV_TOOLS is on outside production. */
@Controller('dev')
export class DevController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Get('mailbox')
  async mailbox(@ZQuery(DevMailboxQuery) query: DevMailboxQuery): Promise<DevMailbox> {
    if (!flag('DEV_TOOLS') || env().NODE_ENV === 'production') throw Errors.notFound('Page');
    const rows = await this.db
      .select({ subject: emailOutbox.subject, text: emailOutbox.textBody, createdAt: emailOutbox.createdAt })
      .from(emailOutbox)
      .where(eq(emailOutbox.toAddress, query.to))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(20);
    return { items: rows.map((r) => ({ subject: r.subject, text: r.text, createdAt: r.createdAt.toISOString() })) };
  }
}
