import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { AdminAmbassadorsController } from './ambassadors.controller.js';
import { AmbassadorMailer } from './ambassador-mail.js';
import { LeadsService } from './leads.service.js';
import { ManagersService } from './managers.service.js';
import { MemberAmbassadorsController } from './member-ambassadors.controller.js';
import { MemberAmbassadorService } from './member-ambassador.service.js';

/** Ambassador programme: member applications, nominations and onboarding; leads, qualification pipeline, onboarding, certification and manager sub-accounts. */
@Module({
  imports: [AuthModule, ProfilesModule],
  controllers: [AdminAmbassadorsController, MemberAmbassadorsController],
  providers: [LeadsService, ManagersService, MemberAmbassadorService, AmbassadorMailer],
})
export class AmbassadorsModule {}
