import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import sharp from 'sharp';
import type { LinkPreviewInfo } from '@chartermission/contracts';
import { Errors } from '../common/errors.js';
import { MediaService } from '../media/media.service.js';
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

  /**
   * The picture of a preview: only files the preview rules allow, re-checked on every fetch.
   *
   * Served as a small JPEG made for link previews, never as a redirect to storage: WhatsApp,
   * Facebook and LinkedIn skip pictures that redirect to short-lived storage links or that weigh
   * several MB (phone photos). Wide pictures become 1200×630; square-ish ones (avatars, logos) a
   * square up to 800 px. Each is made once and kept in storage next to the original.
   */
  @Get('preview-image/:kind/:key')
  async image(@Param('kind') kind: string, @Param('key') key: string, @Res() res: Response): Promise<void> {
    const fileId = await this.previews.pictureFile(kind, key);
    const file = fileId ? await this.media.find(fileId) : undefined;
    if (!file) throw Errors.notFound('That picture');
    const jpeg = await this.previewJpeg(file.id, file.storageKey);
    if (!jpeg) throw Errors.notFound('That picture');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(jpeg.length));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(jpeg);
  }

  private async previewJpeg(fileId: string, storageKey: string): Promise<Buffer | null> {
    const cacheKey = `previews/${fileId}-v1.jpg`;
    const cached = await this.media.storage.read(cacheKey).catch(() => null);
    if (cached?.length) return cached;
    const size = await this.media.storage.size(storageKey).catch(() => null);
    if (!size || size > PREVIEW_SOURCE_MAX_BYTES) return null;
    const original = await this.media.storage.read(storageKey).catch(() => null);
    if (!original) return null;
    try {
      const jpeg = await previewJpeg(original);
      await this.media.storage.write(cacheKey, jpeg, 'image/jpeg').catch(() => undefined);
      return jpeg;
    } catch {
      return null;
    }
  }
}

/** Originals bigger than this aren't turned into previews (uploads are capped well below it). */
const PREVIEW_SOURCE_MAX_BYTES = 30 * 1024 * 1024;

/** A link-preview picture: 1200×630 for wide pictures, a square for avatars and logos; small JPEG. */
export async function previewJpeg(data: Buffer): Promise<Buffer> {
  const image = sharp(data, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate();
  const meta = await image.metadata();
  const upright = (meta.orientation ?? 1) >= 5;
  const width = (upright ? meta.height : meta.width) ?? 0;
  const height = (upright ? meta.width : meta.height) ?? 0;
  if (!width || !height) throw new Error('not an image');
  const wide = width / height >= 1.25;
  const side = Math.max(200, Math.min(800, width, height));
  return image
    .resize(wide ? { width: 1200, height: 630, fit: 'cover', position: 'attention' } : { width: side, height: side, fit: 'cover', position: 'attention' })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}
