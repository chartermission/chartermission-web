import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@chartermission/contracts';

@Controller()
export class AppController {
  @Get('health')
  health(): HealthResponse {
    return { status: 'ok', service: 'chartermission-api', time: new Date().toISOString() };
  }
}
