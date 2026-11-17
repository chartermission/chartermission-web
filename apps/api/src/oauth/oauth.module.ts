import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { OAuthConsentController, OAuthServerController } from './oauth.controller.js';
import { ConnectedAppsController } from './connected-apps.controller.js';
import { OAuthService } from './oauth.service.js';
import { McpActivityService } from './mcp-activity.service.js';
import { McpRouteGuard } from './mcp.guard.js';
import { McpActionsInterceptor } from './mcp-actions.interceptor.js';
import { FormBodyMiddleware } from './form-body.middleware.js';

/**
 * Claude (MCP) access: the OAuth server, bearer-token checks (route allowlist, limits, activity
 * log) and the member's connected apps. SessionMiddleware resolves access tokens through OAuthService.
 */
@Module({
  controllers: [OAuthServerController, OAuthConsentController, ConnectedAppsController],
  providers: [
    OAuthService,
    McpActivityService,
    { provide: APP_GUARD, useClass: McpRouteGuard },
    { provide: APP_INTERCEPTOR, useClass: McpActionsInterceptor },
  ],
  exports: [OAuthService, McpActivityService],
})
export class OAuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(FormBodyMiddleware).forRoutes(
      { path: 'oauth/token', method: RequestMethod.POST },
      { path: 'oauth/revoke', method: RequestMethod.POST },
    );
  }
}
