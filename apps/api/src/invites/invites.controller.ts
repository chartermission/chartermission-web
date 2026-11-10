import { Controller, HttpCode, Post } from '@nestjs/common';
import { SendInvitesInput, type SendInvitesResult } from '@chartermission/contracts';
import type { AuthContext } from '../core/auth-context.js';
import { Access, Auth } from '../core/guards.js';
import { ZBody } from '../common/validation.js';
import { InvitesService } from './invites.service.js';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** POST /invites: email an invitation to Charter Mission, or to a chapter. */
  @Post()
  @HttpCode(200)
  @Access('member')
  send(@Auth() ctx: AuthContext, @ZBody(SendInvitesInput) input: SendInvitesInput): Promise<SendInvitesResult> {
    return this.invites.send(ctx.user, input);
  }
}
