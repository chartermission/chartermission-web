import { Module } from '@nestjs/common';
import { AdminPagesController, PagesController } from './pages.controller.js';
import { PagesService } from './pages.service.js';
import { AdminPagesService } from './admin-pages.service.js';
import { PagesEvents } from './pages.events.js';
import { VerificationService } from './verification.service.js';
import { VerificationEvents } from './verification.events.js';

/** Pages (organisations on Charter Mission) and applications for the verified tick. */
@Module({
  controllers: [PagesController, AdminPagesController],
  providers: [PagesService, AdminPagesService, PagesEvents, VerificationService, VerificationEvents],
  exports: [PagesService],
})
export class PagesModule {}
