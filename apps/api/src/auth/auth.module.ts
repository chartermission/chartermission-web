import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { AccountController, AuthController, DevController, PoliciesController, TaxonomiesController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokensService } from './tokens.service.js';
import { AuthMailer } from './auth-mail.js';
import { MfaService } from './mfa.service.js';
import { AccountService } from './account.service.js';
import { OnboardingService } from './onboarding.service.js';
import { AuthEvents } from './auth.events.js';

/** Identity and accounts: registration, sign-in, MFA, /me, onboarding, taxonomies (spec 4.2). */
@Module({
  imports: [ProfilesModule],
  controllers: [AuthController, AccountController, TaxonomiesController, PoliciesController, DevController],
  providers: [AuthService, PasswordService, TokensService, AuthMailer, MfaService, AccountService, OnboardingService, AuthEvents],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
