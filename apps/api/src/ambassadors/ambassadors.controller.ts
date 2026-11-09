import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import {
  AdminLeadsQuery,
  AmbassadorTrainingInput,
  CertifyLeadInput,
  CreateLeadInput,
  CreateManagerInput,
  EndTermInput,
  LeadNoteInput,
  MoveLeadStageInput,
  AmbassadorStepKey,
  TrainingProgressInput,
  UpdateLeadInput,
  UpdateManagerInput,
  UpdateOnboardingStepInput,
  type AdminLeadDetail,
  type AdminLeadsPage,
  type AmbassadorTrainingView,
  type ManagerView,
  type TeamMember,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { Errors } from '../common/errors.js';
import { UuidParam } from '../media/uuid-param.js';
import { LeadsService } from './leads.service.js';
import { ManagersService } from './managers.service.js';

/**
 * Ambassador programme in the admin console. ambassador.manage (managers and Platform Admins):
 * leads, pipeline, onboarding, certification. ambassador.managers (Platform Admin and above):
 * manager sub-accounts and the required training courses.
 */
@Controller('admin/ambassadors')
export class AdminAmbassadorsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly managers: ManagersService,
  ) {}

  @Get('leads')
  @Access('admin', 'ambassador.manage')
  list(@Auth() ctx: AuthContext, @ZQuery(AdminLeadsQuery) q: AdminLeadsQuery): Promise<AdminLeadsPage> {
    return this.leads.list(ctx, q);
  }

  @Post('leads')
  @Access('admin', 'ambassador.manage')
  create(@Auth() ctx: AuthContext, @ZBody(CreateLeadInput) input: CreateLeadInput, @Req() req: AppRequest): Promise<AdminLeadDetail> {
    return this.leads.create(ctx, input, clientIp(req));
  }

  @Get('leads/:id')
  @Access('admin', 'ambassador.manage')
  detail(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<AdminLeadDetail> {
    return this.leads.detail(ctx, id);
  }

  @Patch('leads/:id')
  @Access('admin', 'ambassador.manage')
  update(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(UpdateLeadInput) input: UpdateLeadInput, @Req() req: AppRequest): Promise<AdminLeadDetail> {
    return this.leads.update(ctx, id, input, clientIp(req));
  }

  @Post('leads/:id/stage')
  @HttpCode(200)
  @Access('admin', 'ambassador.manage')
  stage(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(MoveLeadStageInput) input: MoveLeadStageInput, @Req() req: AppRequest): Promise<AdminLeadDetail> {
    return this.leads.moveStage(ctx, id, input, clientIp(req));
  }

  @Post('leads/:id/notes')
  @HttpCode(200)
  @Access('admin', 'ambassador.manage')
  note(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(LeadNoteInput) input: LeadNoteInput): Promise<AdminLeadDetail> {
    return this.leads.addNote(ctx, id, input);
  }

  @Patch('leads/:id/onboarding/:step')
  @Access('admin', 'ambassador.manage')
  step(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @Param('step') rawStep: string,
    @ZBody(UpdateOnboardingStepInput) input: UpdateOnboardingStepInput,
    @Req() req: AppRequest,
  ): Promise<AdminLeadDetail> {
    const step = AmbassadorStepKey.safeParse(rawStep);
    if (!step.success) throw Errors.notFound('That onboarding step');
    return this.leads.updateStep(ctx, id, step.data, input, clientIp(req));
  }

  @Put('leads/:id/training/:courseId')
  @Access('admin', 'ambassador.manage')
  training(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @UuidParam('courseId') courseId: string,
    @ZBody(TrainingProgressInput) input: TrainingProgressInput,
  ): Promise<AdminLeadDetail> {
    return this.leads.setTraining(ctx, id, courseId, input);
  }

  @Post('leads/:id/invite')
  @HttpCode(200)
  @Access('admin', 'ambassador.manage')
  invite(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<AdminLeadDetail> {
    return this.leads.resendInvite(ctx, id);
  }

  @Post('leads/:id/certify')
  @HttpCode(200)
  @Access('admin', 'ambassador.manage')
  certify(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(CertifyLeadInput) input: CertifyLeadInput, @Req() req: AppRequest): Promise<AdminLeadDetail> {
    return this.leads.certify(ctx, id, input, clientIp(req));
  }

  @Post('leads/:id/end-term')
  @HttpCode(200)
  @Access('admin', 'ambassador.manage')
  endTerm(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(EndTermInput) input: EndTermInput, @Req() req: AppRequest): Promise<AdminLeadDetail> {
    return this.leads.endTerm(ctx, id, input, clientIp(req));
  }

  @Get('team')
  @Access('admin', 'ambassador.manage')
  team(): Promise<TeamMember[]> {
    return this.managers.team();
  }

  @Get('managers')
  @Access('admin', 'ambassador.managers')
  listManagers(): Promise<ManagerView[]> {
    return this.managers.list();
  }

  @Post('managers')
  @Access('admin', 'ambassador.managers')
  createManager(@Auth() ctx: AuthContext, @ZBody(CreateManagerInput) input: CreateManagerInput, @Req() req: AppRequest): Promise<ManagerView> {
    return this.managers.create(ctx, input, clientIp(req));
  }

  @Patch('managers/:userId')
  @Access('admin', 'ambassador.managers')
  updateManager(
    @Auth() ctx: AuthContext,
    @UuidParam('userId') userId: string,
    @ZBody(UpdateManagerInput) input: UpdateManagerInput,
    @Req() req: AppRequest,
  ): Promise<ManagerView> {
    return this.managers.update(ctx, userId, input, clientIp(req));
  }

  @Delete('managers/:userId')
  @HttpCode(204)
  @Access('admin', 'ambassador.managers')
  async revokeManager(@Auth() ctx: AuthContext, @UuidParam('userId') userId: string, @Req() req: AppRequest): Promise<void> {
    await this.managers.revoke(ctx, userId, clientIp(req));
  }

  @Post('managers/:userId/invite')
  @HttpCode(200)
  @Access('admin', 'ambassador.managers')
  reinviteManager(@Auth() ctx: AuthContext, @UuidParam('userId') userId: string): Promise<ManagerView> {
    return this.managers.resendInvite(ctx, userId);
  }

  @Get('training')
  @Access('admin', 'ambassador.manage')
  trainingCourses(): Promise<AmbassadorTrainingView> {
    return this.managers.training();
  }

  @Put('training')
  @Access('admin', 'ambassador.managers')
  setTrainingCourses(@Auth() ctx: AuthContext, @ZBody(AmbassadorTrainingInput) input: AmbassadorTrainingInput, @Req() req: AppRequest): Promise<AmbassadorTrainingView> {
    return this.managers.setTraining(ctx, input, clientIp(req));
  }
}
