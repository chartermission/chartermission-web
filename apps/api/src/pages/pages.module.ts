import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module.js';
import { AdminPagesController, PagesController } from './pages.controller.js';
import { PageCatalogueController } from './catalogue.controller.js';
import { PagesService } from './pages.service.js';
import { AdminPagesService } from './admin-pages.service.js';
import { PagesEvents } from './pages.events.js';
import { PageProductsService } from './products.service.js';
import { PageEnquiriesService } from './enquiries.service.js';
import { VerificationService } from './verification.service.js';
import { VerificationEvents } from './verification.events.js';

/**
 * Pages (organisations on Charter Mission): details, products, enquiries (answered in Messages) and
 * applications for the verified tick.
 */
@Module({
  imports: [MessagesModule],
  controllers: [PagesController, PageCatalogueController, AdminPagesController],
  providers: [PagesService, AdminPagesService, PagesEvents, PageProductsService, PageEnquiriesService, VerificationService, VerificationEvents],
  exports: [PagesService],
})
export class PagesModule {}
