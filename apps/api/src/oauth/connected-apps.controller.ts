import { Controller, Delete, Get, HttpCode } from '@nestjs/common';
import { McpActivityQuery, type ConnectedAppsView, type McpActivityView, type Page } from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZQuery } from '../common/validation.js';
import { Errors } from '../common/errors.js';
import { UuidParam } from '../media/uuid-param.js';
import { OAuthService } from './oauth.service.js';
import { McpActivityService } from './mcp-activity.service.js';

/** Settings → Connected apps: the member's Claude connections and what Claude did. Cookie sessions only. */
@Controller('me/connected-apps')
export class ConnectedAppsController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly activity: McpActivityService,
  ) {}

  @Get()
  @Access('session')
  list(@Auth() ctx: AuthContext): Promise<ConnectedAppsView> {
    return this.oauth.connectedApps(cookieSession(ctx));
  }

  @Get('activity')
  @Access('session')
  activityPage(@Auth() ctx: AuthContext, @ZQuery(McpActivityQuery) q: McpActivityQuery): Promise<Page<McpActivityView>> {
    return this.activity.list(cookieSession(ctx).user.id, q);
  }

  @Delete(':id')
  @HttpCode(204)
  @Access('session')
  async disconnect(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<void> {
    await this.oauth.disconnect(cookieSession(ctx), id);
  }
}

/** Claude may not read or manage its own connections. */
function cookieSession(ctx: AuthContext): AuthContext {
  if (ctx.via) throw Errors.forbidden();
  return ctx;
}
