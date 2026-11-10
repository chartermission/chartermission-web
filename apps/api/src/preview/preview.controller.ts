import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { LinkPreviewInfo } from '@chartermission/contracts';
import { Errors } from '../common/errors.js';
import { MediaService } from '../media/media.service.js';
import type { LocalStorage } from '../media/storage.js';
import { PreviewService } from './preview.service.js';

/** Link previews for preview bots (no sign-in). See PreviewService for what may be shown. */
@Controller('public')
export class PreviewController {
  constructor(
    private readonly previews: PreviewService,
    private readonly media: MediaService,
  ) {}

  @Get('preview')
  async preview(@Query('path') path: string | undefined): Promise<LinkPreviewInfo> {
    if (!path || path.length > 300 || !path.startsWith('/')) throw Errors.notFound('That page');
    const info = await this.previews.forPath(path);
    if (!info) throw Errors.notFound('That page');
    return info;
  }

  /** The picture of a preview: only files the preview rules allow, re-checked on every fetch. */
  @Get('preview-image/:kind/:key')
  async image(@Param('kind') kind: string, @Param('key') key: string, @Res() res: Response): Promise<void> {
    const fileId = await this.previews.pictureFile(kind, key);
    const file = fileId ? await this.media.find(fileId) : undefined;
    if (!file) throw Errors.notFound('That picture');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const redirect = await this.media.storage.presignDownload(file.storageKey, { mime: file.mime, disposition: 'inline' });
    if (redirect) {
      res.redirect(302, redirect);
      return;
    }
    res.setHeader('Content-Type', file.mime);
    const stream = (this.media.storage as LocalStorage).open(file.storageKey);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
