import { Controller, Get, HttpCode, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CreateUploadInput, type CreateUploadResponse, type FileView, type Ok } from '@chartermission/contracts';
import { Access, Auth, OptionalAuth, SkipCsrf } from '../core/guards.js';
import type { AppRequest, AuthContext } from '../core/auth-context.js';
import { ZBody } from '../common/validation.js';
import { MediaService } from './media.service.js';
import { LocalStorage } from './storage.js';
import { UuidParam } from './uuid-param.js';

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** POST /uploads → a 15-minute signed URL to PUT the bytes to (CM-FED-02). */
  @Post('uploads')
  @Access('verified')
  create(@Auth() ctx: AuthContext, @ZBody(CreateUploadInput) input: CreateUploadInput): Promise<CreateUploadResponse> {
    return this.media.createUpload(ctx.user, input);
  }

  /** Local storage driver only: the signed upload target. Authorised by its HMAC signature, not a session. */
  @Put('uploads/:id/blob')
  @SkipCsrf()
  async blob(
    @UuidParam('id') id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Req() req: AppRequest,
  ): Promise<Ok> {
    await this.media.receiveLocal(id, Number(exp), String(sig ?? ''), req);
    return { ok: true };
  }

  @Post('uploads/:id/complete')
  @HttpCode(200)
  @Access('verified')
  complete(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<FileView> {
    return this.media.complete(ctx.user, id);
  }

  /** Upload status, for clients polling while the scan runs in the worker. */
  @Get('uploads/:id')
  @Access('member')
  get(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<FileView> {
    return this.media.get(ctx.user, id);
  }

  @Get('media/:fileId')
  async serve(
    @UuidParam('fileId') fileId: string,
    @OptionalAuth() auth: AuthContext | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { file, disposition, redirect } = await this.media.resolveForServing(auth?.user, fileId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (redirect) {
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.redirect(302, redirect);
      return;
    }
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', disposition);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.setHeader('Cache-Control', 'private, max-age=900');
    const storage = this.media.storage as LocalStorage;
    const stream = storage.open(file.storageKey);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
