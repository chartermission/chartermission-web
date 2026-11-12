import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { fileTypeFromBuffer, fileTypeFromFile } from 'file-type';
import type { Readable } from 'node:stream';
import {
  UPLOAD_LIMITS,
  VIDEO_MIMES,
  VOICE_MIMES,
  VOICE_NOTE_MAX_SECONDS,
  isAudioPurpose,
  formatDuration,
  isVideoPurpose,
  type CreateUploadInput,
  type CreateUploadResponse,
  type FileView,
  type MediaSettings,
  type UploadPurpose,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { files } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { EventsService } from '../infra/events.service.js';
import { QueueService } from '../infra/queue.service.js';
import { AuditService } from '../infra/audit.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { mediaUrl, posterUrl } from '../core/members.service.js';
import type { AuthUser } from '../core/auth-context.js';
import { createStorage, LocalStorage, URL_TTL_SECONDS, verifyUploadSignature, type Storage } from './storage.js';
import { scanBuffer } from './scanner.js';
import {
  VideoToolMissingError,
  canRemux,
  extractPoster,
  probeAudio,
  probeVideo,
  remuxVideo,
  sha256File,
  transcodeAudio,
  transcodeVideo,
  type AudioProbe,
  type VideoProbe,
} from './video.js';

export type FileRow = typeof files.$inferSelect;

/** Allowed file name extensions per verified MIME type (CM-FED-02: extension, MIME and signature). */
const EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'video/mp4': ['mp4', 'm4v'],
  'video/quicktime': ['mov', 'qt'],
  'video/webm': ['webm'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'audio/webm': ['webm', 'weba'],
  'audio/ogg': ['ogg', 'oga', 'opus'],
  'audio/mp4': ['m4a', 'mp4'],
  'audio/x-m4a': ['m4a'],
  'audio/aac': ['aac', 'm4a'],
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
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
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.queue.process('media', async (name, data: { fileId: string }) => {
      if (name === 'process-upload') await this.processUpload(data.fileId);
    });
    // Video conversion is CPU-heavy: its own queue, so image checks never wait behind it.
    this.queue.process(
      'video',
      async (name, data: { fileId: string }, job) => {
        if (name !== 'process-video') return;
        try {
          await this.processUpload(data.fileId);
        } catch (err) {
          if (err instanceof VideoToolMissingError) {
            this.logger.error(
              `Video processing needs ffmpeg and ffprobe (${err.message}). Run "pnpm install" for the bundled binaries, or install ffmpeg (brew install ffmpeg / apt install ffmpeg) or set FFMPEG_PATH and FFPROBE_PATH, then restart the API.`,
            );
          } else {
            this.logger.error(`Video ${data.fileId} failed: ${String(err)}`);
          }
          // After the last retry, tell the member instead of leaving the upload "processing" forever.
          const lastAttempt = !job || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
          if (lastAttempt) await this.failPending(data.fileId, 'We couldn’t process this video right now. Try uploading it again in a little while.');
          throw err;
        }
      },
      // Two at a time on machines with 4+ cores, so a short clip isn't stuck behind a long one.
      { concurrency: os.cpus().length >= 4 ? 2 : 1 },
    );
  }

  /** Called after a file becomes clean or is rejected (posts publish or detach attachments). */
  onSettled(handler: SettledHandler) {
    this.settledHandlers.push(handler);
  }

  async createUpload(user: AuthUser, input: CreateUploadInput): Promise<CreateUploadResponse> {
    // Unverified members may add a profile photo during onboarding; post media needs a verified email.
    // Profile photos can be set before the email is verified (onboarding); everything else needs it.
    if (input.purpose !== 'avatar' && input.purpose !== 'profile_cover' && !user.emailVerified) throw Errors.emailNotVerified();
    // Chapter pictures and covers are set from the admin console only.
    if ((input.purpose === 'chapter_image' || input.purpose === 'chapter_cover') && !user.permissions.has('chapters.admin')) {
      throw Errors.forbidden('Only admins can upload chapter pictures.');
    }
    // Page pictures: anyone who may create or manage a page (the page itself checks ownership when the file is used).
    const limit = UPLOAD_LIMITS[input.purpose];
    // Recorders label files "audio/webm;codecs=opus": the parameters don't matter here.
    const mime = input.mime.toLowerCase().split(';')[0]!.trim();
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
      trimStartMs: isVideoPurpose(input.purpose) ? (input.trim?.startMs ?? null) : null,
      trimEndMs: isVideoPurpose(input.purpose) ? (input.trim?.endMs ?? null) : null,
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
      if (isVideoPurpose(file.purpose as UploadPurpose) || isAudioPurpose(file.purpose as UploadPurpose)) {
        await this.queue.add('video', 'process-video', { fileId }, { jobId: `video-${fileId}` });
      } else {
        await this.queue.add('media', 'process-upload', { fileId }, { jobId: `upload-${fileId}` });
      }
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
    if (isVideoPurpose(file.purpose as UploadPurpose)) return this.processVideo(file);
    if (isAudioPurpose(file.purpose as UploadPurpose)) return this.processAudio(file);
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

  /** GET /uploads/limits: the video length limits members upload against. */
  mediaLimits(): Promise<MediaSettings> {
    return this.settings.get('media_limits');
  }

  /**
   * Videos: signature check, length limit (admin setting), conversion to the web rendition and a poster.
   * Re-encoding plays the part the malware scan plays for other files: only frames and audio decoded by
   * ffmpeg reach the stored file, nothing else from the upload survives.
   */
  private async processVideo(file: FileRow): Promise<void> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-video-'));
    try {
      const input = path.join(dir, 'source');
      if (!(await this.storage.downloadTo(file.storageKey, input))) return await this.reject(file, 'rejected', 'The file was not uploaded');
      const detected = await fileTypeFromFile(input);
      if (!detected || !(VIDEO_MIMES as readonly string[]).includes(detected.mime)) {
        return await this.reject(file, 'rejected', 'The file’s contents don’t match its type');
      }
      const limits = await this.settings.get('media_limits');
      const maxSeconds =
        file.purpose === 'story_video' ? limits.storyVideoMaxSeconds : file.purpose === 'profile_video' ? limits.introVideoMaxSeconds : limits.postVideoMaxSeconds;
      let source: VideoProbe;
      try {
        source = await probeVideo(input);
      } catch (err) {
        if (err instanceof VideoToolMissingError) throw err;
        return await this.reject(file, 'rejected', 'We couldn’t read this video. Try exporting it as an MP4.');
      }
      // The member may have chosen a part of the video to keep (the trim window). Only that part
      // is converted and stored, and only that part counts towards the length limit.
      let clip: { startSeconds: number; durationSeconds: number } | undefined;
      if (file.trimStartMs !== null && file.trimEndMs !== null) {
        const start = Math.min(Math.max(0, file.trimStartMs / 1000), Math.max(0, source.durationSeconds - 1));
        const end = Math.min(file.trimEndMs / 1000, source.durationSeconds);
        if (end - start >= 1 && (start > 0.05 || end < source.durationSeconds - 0.05)) clip = { startSeconds: start, durationSeconds: end - start };
      }
      const keptSeconds = clip?.durationSeconds ?? source.durationSeconds;
      if (keptSeconds > maxSeconds + 0.5) {
        return await this.reject(
          file,
          'rejected',
          `Videos can be up to ${formatDuration(maxSeconds)} long. This one is ${formatDuration(keptSeconds)}. Choose a shorter part of it.`,
        );
      }
      const output = path.join(dir, 'web.mp4');
      const poster = path.join(dir, 'poster.jpg');
      let result: VideoProbe;
      try {
        const started = Date.now();
        const remuxed = canRemux(source, !!clip);
        if (remuxed) await remuxVideo(input, output);
        else await transcodeVideo(input, output, keptSeconds, clip, source);
        result = await probeVideo(output);
        this.logger.log(
          `Video ${file.id}: ${remuxed ? 'repackaged' : 'converted'} ${source.width}×${source.height} ${source.videoCodec} ${Math.round(source.fps)} fps, ${keptSeconds.toFixed(1)} s in ${((Date.now() - started) / 1000).toFixed(1)} s`,
        );
        await extractPoster(output, poster, result.durationSeconds);
      } catch (err) {
        if (err instanceof VideoToolMissingError) throw err;
        this.logger.warn(`Video ${file.id} could not be converted: ${String(err)}`);
        return await this.reject(file, 'rejected', 'We couldn’t process this video. Try exporting it as an MP4.');
      }
      const posterKey = `${file.storageKey}-poster`;
      await this.storage.uploadFrom(file.storageKey, output, 'video/mp4');
      await this.storage.uploadFrom(posterKey, poster, 'image/jpeg');
      const { size } = await stat(output);
      const [updated] = await this.db
        .update(files)
        .set({
          scanStatus: 'clean',
          rejectionReason: null,
          mime: 'video/mp4',
          sizeBytes: size,
          sha256: await sha256File(output),
          width: result.width,
          height: result.height,
          durationMs: Math.round(result.durationSeconds * 1000),
          posterKey,
        })
        .where(eq(files.id, file.id))
        .returning();
      await this.settled(updated!);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Voice notes: must hold an audio track and be at most VOICE_NOTE_MAX_SECONDS; converted to
   * AAC (.m4a) with metadata stripped. Only ffmpeg's output is stored.
   */
  private async processAudio(file: FileRow): Promise<void> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cm-voice-'));
    try {
      const input = path.join(dir, 'source');
      if (!(await this.storage.downloadTo(file.storageKey, input))) return await this.reject(file, 'rejected', 'The file was not uploaded');
      const detected = await fileTypeFromFile(input);
      if (!detected || !(VOICE_MIMES as readonly string[]).includes(detected.mime)) {
        return await this.reject(file, 'rejected', 'The file’s contents don’t match its type');
      }
      let source: AudioProbe;
      try {
        source = await probeAudio(input);
      } catch (err) {
        if (err instanceof VideoToolMissingError) throw err;
        return await this.reject(file, 'rejected', 'We couldn’t play this recording. Try recording it again.');
      }
      if (source.durationSeconds > VOICE_NOTE_MAX_SECONDS + 1) {
        return await this.reject(file, 'rejected', `Voice notes can be up to ${formatDuration(VOICE_NOTE_MAX_SECONDS)} long.`);
      }
      const output = path.join(dir, 'voice.m4a');
      let result: AudioProbe;
      try {
        await transcodeAudio(input, output);
        result = await probeAudio(output);
      } catch (err) {
        if (err instanceof VideoToolMissingError) throw err;
        this.logger.warn(`Voice note ${file.id} could not be converted: ${String(err)}`);
        return await this.reject(file, 'rejected', 'We couldn’t process this recording. Try recording it again.');
      }
      await this.storage.uploadFrom(file.storageKey, output, 'audio/mp4');
      const { size } = await stat(output);
      const [updated] = await this.db
        .update(files)
        .set({
          scanStatus: 'clean',
          rejectionReason: null,
          mime: 'audio/mp4',
          sizeBytes: size,
          sha256: await sha256File(output),
          durationMs: Math.round(result.durationSeconds * 1000),
        })
        .where(eq(files.id, file.id))
        .returning();
      await this.settled(updated!);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Rejects a file that is still waiting for processing (used when processing keeps failing). */
  private async failPending(fileId: string, reason: string) {
    const [file] = await this.db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (file?.scanStatus === 'pending') await this.reject(file, 'rejected', reason).catch(() => undefined);
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
    const inline = file.mime.startsWith('image/') || file.mime.startsWith('video/') || file.mime.startsWith('audio/');
    const name = safeFileName(file.originalName ?? 'file', file.mime);
    const disposition = `${inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
    const redirect = await this.storage.presignDownload(file.storageKey, { mime: file.mime, disposition });
    return { file, disposition, redirect };
  }

  /** GET /media/{fileId}/poster: a video's still frame, with the same access rules as the video. */
  async resolvePoster(viewer: AuthUser | undefined, fileId: string) {
    const file = await this.find(fileId);
    if (!file || file.scanStatus !== 'clean' || !file.posterKey) throw Errors.notFound('File');
    if (!file.isPublic && !viewer) throw Errors.unauthenticated();
    const redirect = await this.storage.presignDownload(file.posterKey, { mime: 'image/jpeg', disposition: 'inline; filename="poster.jpg"' });
    return { key: file.posterKey, redirect };
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
      durationSeconds: file.durationMs !== null ? file.durationMs / 1000 : null,
      posterUrl: status === 'clean' ? posterUrl(file) : null,
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
  if (purpose === 'post_document') return 'a PDF up to 10 MB';
  if (purpose === 'profile_resume') return 'a PDF up to 5 MB';
  if (purpose === 'message_file') return 'a PDF, Word, Excel or PowerPoint file up to 20 MB';
  if (purpose === 'voice_note') return 'a voice recording up to 25 MB';
  if (isVideoPurpose(purpose)) return `an MP4, MOV or WebM video up to ${Math.round(UPLOAD_LIMITS[purpose].maxBytes / 1024 / 1024)} MB`;
  return `JPEG, PNG or WebP up to ${Math.round(UPLOAD_LIMITS[purpose].maxBytes / 1024 / 1024)} MB`;
}

function safeFileName(name: string, mime: string): string {
  const base = name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
  const ext = EXTENSIONS[mime]?.[0];
  return ext && !base.toLowerCase().endsWith(`.${ext}`) ? `${base}.${ext}` : base;
}
