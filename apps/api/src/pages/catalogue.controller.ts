import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  EnquiriesQuery,
  EnquiryInput,
  EnquiryReplyInput,
  ProductInput,
  type EnquiryView,
  type Ok,
  type Page,
  type ProductView,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { PageProductsService } from './products.service.js';
import { PageEnquiriesService } from './enquiries.service.js';

/** A page's products and the enquiries members send it (contracts/services.ts). */
@Controller('pages/:slug')
export class PageCatalogueController {
  constructor(
    private readonly products: PageProductsService,
    private readonly enquiries: PageEnquiriesService,
  ) {}

  /* Products */

  @Get('products')
  @Access('member')
  listProducts(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<ProductView[]> {
    return this.products.list(ctx.user, slug);
  }

  @Post('products')
  @HttpCode(201)
  @Access('verified')
  createProduct(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(ProductInput) input: ProductInput, @Req() req: AppRequest): Promise<ProductView> {
    return this.products.create(ctx.user, slug, input, clientIp(req));
  }

  @Patch('products/:id')
  @Access('verified')
  updateProduct(
    @Auth() ctx: AuthContext,
    @Param('slug') slug: string,
    @UuidParam('id') id: string,
    @ZBody(ProductInput) input: ProductInput,
    @Req() req: AppRequest,
  ): Promise<ProductView> {
    return this.products.update(ctx.user, slug, id, input, clientIp(req));
  }

  @Delete('products/:id')
  @Access('verified')
  removeProduct(@Auth() ctx: AuthContext, @Param('slug') slug: string, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.products.remove(ctx.user, slug, id, clientIp(req));
  }

  /* Enquiries */

  @Post('enquiries')
  @HttpCode(201)
  @Access('verified')
  enquire(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(EnquiryInput) input: EnquiryInput): Promise<EnquiryView> {
    return this.enquiries.create(ctx.user, slug, input);
  }

  @Get('enquiries')
  @Access('member')
  listEnquiries(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZQuery(EnquiriesQuery) q: EnquiriesQuery): Promise<Page<EnquiryView>> {
    return this.enquiries.list(ctx.user, slug, q);
  }

  @Post('enquiries/:id/reply')
  @HttpCode(200)
  @Access('verified')
  reply(
    @Auth() ctx: AuthContext,
    @Param('slug') slug: string,
    @UuidParam('id') id: string,
    @ZBody(EnquiryReplyInput) input: EnquiryReplyInput,
    @Req() req: AppRequest,
  ): Promise<EnquiryView> {
    return this.enquiries.reply(ctx.user, slug, id, input, clientIp(req));
  }

  @Post('enquiries/:id/close')
  @HttpCode(200)
  @Access('verified')
  close(@Auth() ctx: AuthContext, @Param('slug') slug: string, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<EnquiryView> {
    return this.enquiries.close(ctx.user, slug, id, clientIp(req));
  }
}
