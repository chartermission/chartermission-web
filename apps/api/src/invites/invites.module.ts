import { Module } from '@nestjs/common';
import { PreviewModule } from '../preview/preview.module.js';
import { AdminReferralsController, InvitesController } from './invites.controller.js';
import { InvitesEvents } from './invites.events.js';
import { InvitesService } from './invites.service.js';

@Module({ imports: [PreviewModule], controllers: [InvitesController, AdminReferralsController], providers: [InvitesService, InvitesEvents] })
export class InvitesModule {}
