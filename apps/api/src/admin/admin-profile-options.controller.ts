import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ProfileOptionBulkInput,
  ProfileOptionCreateInput,
  ProfileOptionImportInput,
  ProfileOptionMergeInput,
  ProfileOptionReorderInput,
  ProfileOptionsQuery,
  ProfileOptionUpdateInput,
  type BulkResult,
  type CsvImportResult,
  type Ok,
  type ProfileOptionMergeResult,
  type ProfileOptionRow,
  type ProfileOptionsList,
  type ProfileOptionsSummary,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { AdminProfileOptionsService } from './admin-profile-options.service.js';

/**
 * Profile options: what members pick on their profile (skills, sectors, interests, languages) and
 * hosts pick for events (event categories). `kind` is one of PROFILE_OPTION_KINDS.
 */
@Controller('admin/profile-options')
export class AdminProfileOptionsController {
  constructor(private readonly options: AdminProfileOptionsService) {}

  @Get()
  @Access('admin', 'settings.manage')
  summary(): Promise<ProfileOptionsSummary> {
    return this.options.summary();
  }

  @Get(':kind')
  @Access('admin', 'settings.manage')
  list(@Param('kind') kind: string, @ZQuery(ProfileOptionsQuery) q: ProfileOptionsQuery): Promise<ProfileOptionsList> {
    return this.options.list(kind, q);
  }

  @Post(':kind')
  @HttpCode(201)
  @Access('admin', 'settings.manage')
  create(
    @Auth() ctx: AuthContext,
    @Param('kind') kind: string,
    @ZBody(ProfileOptionCreateInput) input: ProfileOptionCreateInput,
    @Req() req: AppRequest,
  ): Promise<ProfileOptionRow> {
    return this.options.create(ctx, kind, input, clientIp(req));
  }

  @Post(':kind/reorder')
  @HttpCode(200)
  @Access('admin', 'settings.manage')
  reorder(
    @Auth() ctx: AuthContext,
    @Param('kind') kind: string,
    @ZBody(ProfileOptionReorderInput) input: ProfileOptionReorderInput,
    @Req() req: AppRequest,
  ): Promise<Ok> {
    return this.options.reorder(ctx, kind, input, clientIp(req));
  }

  @Post(':kind/sort-alphabetically')
  @HttpCode(200)
  @Access('admin', 'settings.manage')
  sortAlphabetically(@Auth() ctx: AuthContext, @Param('kind') kind: string, @Req() req: AppRequest): Promise<Ok> {
    return this.options.sortAlphabetically(ctx, kind, clientIp(req));
  }

  @Post(':kind/bulk')
  @HttpCode(200)
  @Access('admin', 'settings.manage')
  bulk(
    @Auth() ctx: AuthContext,
    @Param('kind') kind: string,
    @ZBody(ProfileOptionBulkInput) input: ProfileOptionBulkInput,
    @Req() req: AppRequest,
  ): Promise<BulkResult> {
    return this.options.bulk(ctx, kind, input, clientIp(req));
  }

  @Post(':kind/import')
  @HttpCode(200)
  @Access('admin', 'settings.manage')
  import(
    @Auth() ctx: AuthContext,
    @Param('kind') kind: string,
    @ZBody(ProfileOptionImportInput) input: ProfileOptionImportInput,
    @Req() req: AppRequest,
  ): Promise<CsvImportResult> {
    return this.options.import(ctx, kind, input, clientIp(req));
  }

  @Patch(':kind/:id')
  @Access('admin', 'settings.manage')
  update(
    @Auth() ctx: AuthContext,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @ZBody(ProfileOptionUpdateInput) input: ProfileOptionUpdateInput,
    @Req() req: AppRequest,
  ): Promise<ProfileOptionRow> {
    return this.options.update(ctx, kind, id, input, clientIp(req));
  }

  @Delete(':kind/:id')
  @Access('admin', 'settings.manage')
  remove(@Auth() ctx: AuthContext, @Param('kind') kind: string, @Param('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.options.remove(ctx, kind, id, clientIp(req));
  }

  @Post(':kind/:id/merge')
  @HttpCode(200)
  @Access('admin', 'settings.manage')
  merge(
    @Auth() ctx: AuthContext,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @ZBody(ProfileOptionMergeInput) input: ProfileOptionMergeInput,
    @Req() req: AppRequest,
  ): Promise<ProfileOptionMergeResult> {
    return this.options.merge(ctx, kind, id, input, clientIp(req));
  }
}
