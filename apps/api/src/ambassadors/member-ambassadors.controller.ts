import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  AmbassadorApplicationInput,
  AmbassadorNominationInput,
  SignAgreementInput,
  type MyAmbassadorView,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody } from '../common/validation.js';
import { MemberAmbassadorService } from './member-ambassador.service.js';

/** The Ambassador programme for members: status, applying, nominating and onboarding. */
@Controller('ambassadors')
export class MemberAmbassadorsController {
  constructor(private readonly service: MemberAmbassadorService) {}

  @Get('me')
  @Access('member')
  me(@Auth() ctx: AuthContext): Promise<MyAmbassadorView> {
    return this.service.me(ctx);
  }

  @Post('me/agreement')
  @HttpCode(200)
  @Access('member')
  sign(@Auth() ctx: AuthContext, @ZBody(SignAgreementInput) input: SignAgreementInput, @Req() req: AppRequest): Promise<MyAmbassadorView> {
    return this.service.signAgreement(ctx, input, clientIp(req));
  }

  @Post('applications')
  @Access('verified')
  apply(@Auth() ctx: AuthContext, @ZBody(AmbassadorApplicationInput) input: AmbassadorApplicationInput, @Req() req: AppRequest): Promise<MyAmbassadorView> {
    return this.service.apply(ctx, input, clientIp(req));
  }

  @Post('nominations')
  @HttpCode(202)
  @Access('verified')
  nominate(@Auth() ctx: AuthContext, @ZBody(AmbassadorNominationInput) input: AmbassadorNominationInput, @Req() req: AppRequest): Promise<{ ok: true }> {
    return this.service.nominate(ctx, input, clientIp(req));
  }
}
