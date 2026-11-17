import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { catchError, concatMap, from, type Observable, switchMap, throwError } from 'rxjs';
import type { AppRequest } from '../core/auth-context.js';
import { McpActivityService } from './mcp-activity.service.js';
import { MCP_ROUTE_ACTIONS, actionTarget, routeKey } from './mcp-routes.js';

/**
 * For Claude's writes: reserve a slot under the per-action hourly and daily limits before the
 * handler runs (released if it fails), and log the action with its target once it succeeded.
 * Cookie-session requests pass straight through.
 */
@Injectable()
export class McpActionsInterceptor implements NestInterceptor {
  constructor(private readonly activity: McpActivityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AppRequest>();
    const auth = req.auth;
    if (!auth?.via) return next.handle();
    const key = routeKey(context);
    const spec = key ? MCP_ROUTE_ACTIONS[key] : undefined;
    if (!spec) return next.handle();
    const entry = {
      userId: auth.user.id,
      grantId: auth.via.grantId,
      clientName: auth.via.clientName,
      action: typeof spec.action === 'function' ? spec.action(req.body) : spec.action,
    };
    return from(this.activity.reserve(entry)).pipe(
      switchMap((reservedId) =>
        next.handle().pipe(
          concatMap(async (result) => {
            const target = actionTarget(spec.target, req, result);
            if (reservedId) await this.activity.complete(reservedId, target);
            else await this.activity.record({ ...entry, ...target });
            return result;
          }),
          catchError((err: unknown) =>
            from(reservedId ? this.activity.release(reservedId) : Promise.resolve()).pipe(switchMap(() => throwError(() => err))),
          ),
        ),
      ),
    );
  }
}
