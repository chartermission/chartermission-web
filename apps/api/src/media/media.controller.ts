import { Controller, Get, HttpCode, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CreateUploadInput, type CreateUploadResponse, type FileView, type MediaSettings, type Ok } from '@chartermission/contracts';
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
  @Access('member')
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

  /** Video length limits (admin settings), so the composer can check a video before uploading it. */
  @Get('uploads/limits')
  @Access('member')
  limits(): Promise<MediaSettings> {
    return this.media.mediaLimits();
  }

  /** Upload status, for clients polling while the scan runs in the worker. */
  @Get('uploads/:id')
  @Access('member')
  get(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<FileView> {
    return this.media.get(ctx.user, id);
  }

  @Get('media/:fileId/poster')
  async poster(
    @UuidParam('fileId') fileId: string,
    @OptionalAuth() auth: AuthContext | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { key, redirect } = await this.media.resolvePoster(auth?.user, fileId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (redirect) {
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.redirect(302, redirect);
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=900');
    const stream = (this.media.storage as LocalStorage).open(key);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  @Get('media/:fileId')
  async serve(
    @UuidParam('fileId') fileId: string,
    @OptionalAuth() auth: AuthContext | undefined,
    @Req() req: AppRequest,
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
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('Accept-Ranges', 'bytes');
    const storage = this.media.storage as LocalStorage;
    // Local driver (development): byte ranges, which browsers need to seek in a video.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    let bounds: { start: number; end: number } | undefined;
    if (range && (range[1] || range[2])) {
      const size = file.sizeBytes;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      bounds = { start, end };
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
    } else {
      res.setHeader('Content-Length', String(file.sizeBytes));
    }
    const stream = storage.open(file.storageKey, bounds);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
