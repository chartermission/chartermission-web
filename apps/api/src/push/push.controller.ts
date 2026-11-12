import { Controller, Delete, HttpCode, Post, Req } from '@nestjs/common';
import { PushSubscriptionInput } from '@chartermission/contracts';
import { z } from 'zod';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZBody } from '../common/validation.js';
import type { AppRequest } from '../core/auth-context.js';
import { PushService } from './push.service.js';

const Unsubscribe = z.object({ endpoint: z.string().url().max(1000) });

/** Browser notifications: the member's app registers each browser they allow. */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('subscriptions')
  @HttpCode(204)
  @Access('member')
  subscribe(@Auth() ctx: AuthContext, @ZBody(PushSubscriptionInput) input: PushSubscriptionInput, @Req() req: AppRequest): Promise<void> {
    return this.push.subscribe(ctx.user.id, input, req.headers['user-agent']);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  @Access('member')
  unsubscribe(@Auth() ctx: AuthContext, @ZBody(Unsubscribe) input: z.infer<typeof Unsubscribe>): Promise<void> {
    return this.push.unsubscribe(ctx.user.id, input.endpoint);
  }
}
