import { Controller, Get } from '@nestjs/common';
import type { MomentsResponse, WelcomeSummary } from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { HomeService } from './home.service.js';
import { MomentsService } from './moments.service.js';

@Controller('home')
export class HomeController {
  constructor(
    private readonly home: HomeService,
    private readonly momentsService: MomentsService,
  ) {}

  /** The welcome strip. Also records the visit, so it is a GET with a side effect on the viewer's own row only. */
  @Get('welcome')
  @Access('member')
  welcome(@Auth() ctx: AuthContext): Promise<WelcomeSummary> {
    return this.home.welcome(ctx.user);
  }

  @Get('moments')
  @Access('member')
  moments(@Auth() ctx: AuthContext): Promise<MomentsResponse> {
    return this.momentsService.moments(ctx.user);
  }
}
