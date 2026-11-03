import { randomUUID, createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import type { Readable } from 'node:stream';
import { UPLOAD_LIMITS, type CreateUploadInput, type CreateUploadResponse, type FileView, type UploadPurpose } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { files } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { EventsService } from '../infra/events.service.js';
import { QueueService } from '../infra/queue.service.js';
import { AuditService } from '../infra/audit.service.js';
import { mediaUrl } from '../core/members.service.js';
import type { AuthUser } from '../core/auth-context.js';
import { createStorage, LocalStorage, URL_TTL_SECONDS, verifyUploadSignature, type Storage } from './storage.js';
import { scanBuffer } from './scanner.js';

export type FileRow = typeof files.$inferSelect;

/** Allowed file name extensions per verified MIME type (CM-FED-02: extension, MIME and signature). */
const EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

/** Images are re-encoded to at most this many pixels on the longest side. */
export const MAX_IMAGE_EDGE = 2048;
/** Spec 8.2: uploads per member per hour. */
const UPLOADS_PER_HOUR = 50;

type SettledHandler = (file: FileRow) => Promise<void>;

/**
 * Uploads and media (CM-FED-02, spec 6.3, 8.1): signed upload URLs, server-side
 * validation of size, extension, MIME type and file signature, malware scanning,
 * image re-encoding (strips EXIF/GPS), and permission-checked serving.
 */
@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger('Media');
  readonly storage: Storage = createStorage();
  private readonly settledHandlers: SettledHandler[] = [];

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly limits: RateLimitService,
    private readonly events: EventsService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.queue.process('media', async (name, data: { fileId: string }) => {
      if (name === 'process-upload') await this.processUpload(data.fileId);
    });
  }

  /** Called after a file becomes clean or is rejected (posts publish or detach attachments). */
  onSettled(handler: SettledHandler) {
    this.settledHandlers.push(handler);
  }

  async createUpload(user: AuthUser, input: CreateUploadInput): Promise<CreateUploadResponse> {
    const limit = UPLOAD_LIMITS[input.purpose];
    const mime = input.mime.toLowerCase();
    if (!(limit.mimes as readonly string[]).includes(mime)) {
      throw Errors.unsupportedMedia(`This file type isn’t allowed here. Use ${describeMimes(input.purpose)}.`);
    }
    const ext = input.fileName.toLowerCase().split('.').pop() ?? '';
    if (!EXTENSIONS[mime]?.includes(ext)) {
      throw Errors.unsupportedMedia('The file name extension doesn’t match the file type');
    }
    if (input.sizeBytes > limit.maxBytes) {
      throw Errors.tooLarge(`Files can be up to ${Math.round(limit.maxBytes / 1024 / 1024)} MB`);
    }
    await this.limits.consume(`uploads:${user.id}`, UPLOADS_PER_HOUR, 3600);

    const id = randomUUID();
    const expiresAt = new Date(Date.now() + URL_TTL_SECONDS * 1000);
    const key = `uploads/${input.purpose}/${id}`;
    await this.db.insert(files).values({
      id,
      ownerId: user.id,
      purpose: input.purpose,
      storageKey: key,
      originalName: input.fileName.replace(/[\\/\0]/g, '_').slice(0, 200),
      declaredMime: mime,
      mime,
      sizeBytes: input.sizeBytes,
      scanStatus: 'awaiting_upload',
      uploadExpiresAt: expiresAt,
    });
    const presigned = await this.storage.presignUpload({ fileId: id, key, mime, sizeBytes: input.sizeBytes, expiresAt });
    return { fileId: id, uploadUrl: presigned.url, method: 'PUT', headers: presigned.headers, expiresAt: expiresAt.toISOString() };
  }

  /** Local driver: PUT /uploads/{id}/blob. The signature authorises the request; size is enforced while streaming. */
  async receiveLocal(fileId: string, exp: number, sig: string, body: Readable): Promise<void> {
    if (!(this.storage instanceof LocalStorage)) throw Errors.notFound();
    if (!verifyUploadSignature(fileId, exp, sig)) throw Errors.forbidden('This upload link is invalid or has expired');
    const file = await this.find(fileId);
    if (!file || file.scanStatus !== 'awaiting_upload') throw Errors.conflict('This file was already uploaded');
    const max = Math.min(file.sizeBytes, UPLOAD_LIMITS[file.purpose as UploadPurpose].maxBytes);
    const written = await this.storage.receive(file.storageKey, body, max);
    if (written === 0) throw Errors.badRequest('The upload was empty');
    await this.db.update(files).set({ scanStatus: 'pending', sizeBytes: written }).where(eq(files.id, fileId));
  }

  /** POST /uploads/{id}/complete: queue validation and scanning (runs inline in tests). */
  async complete(user: AuthUser, fileId: string): Promise<FileView> {
    let file = await this.find(fileId);
    if (!file || file.ownerId !== user.id) throw Errors.notFound('File');
    if (file.scanStatus === 'awaiting_upload') {
      const size = await this.storage.size(file.storageKey);
      if (size === null) throw Errors.conflict('Upload the file before completing it');
      await this.db.update(files).set({ scanStatus: 'pending', sizeBytes: size }).where(eq(files.id, fileId));
    }
    if (file.scanStatus === 'awaiting_upload' || file.scanStatus === 'pending') {
      await this.queue.add('media', 'process-upload', { fileId }, { jobId: `upload-${fileId}` });
      file = (await this.find(fileId))!;
    }
    return this.view(file);
  }

  async get(user: AuthUser, fileId: string): Promise<FileView> {
    const file = await this.find(fileId);
    if (!file || file.ownerId !== user.id) throw Errors.notFound('File');
    return this.view(file);
  }

  /**
   * Validation and scanning (the "media" worker). Idempotent: only pending files are processed.
   * Order: size → signature (magic bytes) vs declared MIME → PDF header → malware scan → image re-encode.
   */
  async processUpload(fileId: string): Promise<void> {
    const file = await this.find(fileId);
    if (!file || file.scanStatus !== 'pending') return;
    const limit = UPLOAD_LIMITS[file.purpose as UploadPurpose];

    const size = await this.storage.size(file.storageKey);
    if (size === null || size === 0) return this.reject(file, 'rejected', 'The file was not uploaded');
    if (size > limit.maxBytes) return this.reject(file, 'rejected', 'The file is larger than allowed');
    const data = await this.storage.read(file.storageKey);
    if (!data) return this.reject(file, 'rejected', 'The file was not uploaded');

    const detected = await fileTypeFromBuffer(data);
    if (!detected || !(limit.mimes as readonly string[]).includes(detected.mime) || detected.mime !== file.declaredMime) {
      return this.reject(file, 'rejected', 'The file’s contents don’t match its type');
    }
    if (detected.mime === 'application/pdf' && data.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return this.reject(file, 'rejected', 'The file is not a valid PDF');
    }

    const scan = await scanBuffer(data);
    if (!scan.clean) {
      await this.audit.record({
        actorId: null,
        action: 'upload.infected',
        targetType: 'file',
        targetId: file.id,
        after: { ownerId: file.ownerId, signature: scan.signature },
      });
      return this.reject(file, 'infected', 'The file failed the malware scan');
    }

    let output = data;
    let width: number | null = null;
    let height: number | null = null;
    if (detected.mime.startsWith('image/')) {
      try {
        const encoded = await reencodeImage(data, detected.mime);
        output = encoded.data;
        width = encoded.width;
        height = encoded.height;
      } catch {
        return this.reject(file, 'rejected', 'The image could not be read');
      }
      await this.storage.write(file.storageKey, output, detected.mime);
    }

    const [updated] = await this.db
      .update(files)
      .set({
        scanStatus: 'clean',
        rejectionReason: null,
        mime: detected.mime,
        sizeBytes: output.length,
        sha256: createHash('sha256').update(output).digest('hex'),
        width,
        height,
      })
      .where(eq(files.id, file.id))
      .returning();
    await this.settled(updated!);
  }

  private async reject(file: FileRow, status: 'rejected' | 'infected', reason: string) {
    const [updated] = await this.db
      .update(files)
      .set({ scanStatus: status, rejectionReason: reason })
      .where(eq(files.id, file.id))
      .returning();
    // Never serve or keep the bytes of a rejected file.
    await this.storage.remove(file.storageKey).catch(() => undefined);
    await this.settled(updated!);
    await this.events.emit({ type: 'upload.rejected', fileId: file.id, ownerId: file.ownerId });
  }

  private async settled(file: FileRow) {
    for (const h of this.settledHandlers) {
      try {
        await h(file);
      } catch (err) {
        this.logger.warn(`settled handler failed for ${file.id}: ${String(err)}`);
      }
    }
  }

  /**
   * GET /media/{fileId}: clean files only. Avatars and post media are members-only
   * unless the file is public.
   */
  async resolveForServing(viewer: AuthUser | undefined, fileId: string) {
    const file = await this.find(fileId);
    if (!file || file.scanStatus !== 'clean') throw Errors.notFound('File');
    if (!file.isPublic && !viewer) throw Errors.unauthenticated();
    const inline = file.mime.startsWith('image/');
    const name = safeFileName(file.originalName ?? 'file', file.mime);
    const disposition = `${inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
    const redirect = await this.storage.presignDownload(file.storageKey, { mime: file.mime, disposition });
    return { file, disposition, redirect };
  }

  async find(fileId: string): Promise<FileRow | undefined> {
    const [row] = await this.db.select().from(files).where(eq(files.id, fileId)).limit(1);
    return row;
  }

  view(file: FileRow): FileView {
    const status =
      file.scanStatus === 'clean' ? 'clean' : file.scanStatus === 'rejected' || file.scanStatus === 'infected' ? 'rejected' : 'pending';
    return {
      id: file.id,
      purpose: file.purpose as UploadPurpose,
      status,
      rejectionReason: status === 'rejected' ? file.rejectionReason : null,
      url: status === 'clean' ? mediaUrl(file.id) : null,
      mime: file.mime,
      sizeBytes: file.sizeBytes,
      width: file.width,
      height: file.height,
    };
  }
}

/** Re-encode an image: apply EXIF orientation, drop all metadata, cap the longest edge, keep the format. */
export async function reencodeImage(data: Buffer, mime: string) {
  const pipeline = sharp(data, { failOn: 'error', limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: 'inside', withoutEnlargement: true });
  const formatted =
    mime === 'image/png' ? pipeline.png() : mime === 'image/webp' ? pipeline.webp({ quality: 85 }) : pipeline.jpeg({ quality: 85, mozjpeg: true });
  const { data: out, info } = await formatted.toBuffer({ resolveWithObject: true });
  return { data: out, width: info.width, height: info.height };
}

function describeMimes(purpose: UploadPurpose): string {
  return purpose === 'post_document' ? 'a PDF up to 10 MB' : 'JPEG, PNG or WebP up to 5 MB';
}

function safeFileName(name: string, mime: string): string {
  const base = name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
  const ext = EXTENSIONS[mime]?.[0];
  return ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base;
}
