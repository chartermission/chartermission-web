import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

/*
 * Video processing with ffmpeg (the "video" worker). Uploaded videos are probed, checked against the
 * length limit and turned into one web-safe rendition: H.264/AAC MP4, at most 1280 px on the long
 * side (720p) and 30 fps, metadata stripped (no GPS or device tags), "faststart" so playback begins
 * before the whole file has loaded. A still frame becomes the poster.
 *
 * Speed (members wait for this): a file that is already web-ready is only repackaged (no re-encode,
 * about a second); otherwise the encode uses x264 "superfast", caps the frame rate at 30 and, when a
 * large source is shrunk, skips the decoder's deblocking pass (invisible after downscaling).
 *
 * Binaries: FFMPEG_PATH / FFPROBE_PATH, else the bundled @ffmpeg-installer/ffmpeg and
 * @ffprobe-installer/ffprobe packages, else `ffmpeg` / `ffprobe` on the PATH.
 */

/** Longest side of the converted video. */
export const VIDEO_MAX_EDGE = 1280;

let resolved: { ffmpeg: string; ffprobe: string } | null = null;

async function bundled(pkg: string): Promise<string | null> {
  try {
    const mod = (await import(pkg)) as { path?: string; default?: { path?: string } };
    return mod.path ?? mod.default?.path ?? null;
  } catch {
    return null;
  }
}

export async function ffmpegPaths(): Promise<{ ffmpeg: string; ffprobe: string }> {
  if (resolved) return resolved;
  const e = env();
  resolved = {
    ffmpeg: e.FFMPEG_PATH ?? (await bundled('@ffmpeg-installer/ffmpeg')) ?? 'ffmpeg',
    ffprobe: e.FFPROBE_PATH ?? (await bundled('@ffprobe-installer/ffprobe')) ?? 'ffprobe',
  };
  return resolved;
}

/** ffmpeg or ffprobe is not installed: an infrastructure problem, so the job retries instead of rejecting the file. */
export class VideoToolMissingError extends Error {}

/** The file is not a video ffmpeg can read. */
export class VideoUnreadableError extends Error {}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => {
      if (out.length < 1_000_000) out += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      err = (err + c.toString('utf8')).slice(-4000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new VideoToolMissingError(`${bin} is not installed`) : e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new VideoUnreadableError(signal === 'SIGKILL' ? 'Processing timed out' : err.trim().split('\n').slice(-3).join(' ')));
    });
  });
}

export type VideoProbe = {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** Frames per second (0 when unknown). */
  fps: number;
  videoCodec: string;
  pixelFormat: string;
  /** null when there is no audio track. */
  audioCodec: string | null;
  /** Overall bits per second (0 when unknown). */
  bitRate: number;
};

type ProbeJson = {
  format?: { duration?: string; bit_rate?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    pix_fmt?: string;
    width?: number;
    height?: number;
    duration?: string;
    avg_frame_rate?: string;
    r_frame_rate?: string;
  }[];
};

const rate = (value?: string) => {
  const [n, d] = (value ?? '').split('/').map(Number);
  return n && d ? n / d : 0;
};

export async function probeVideo(file: string): Promise<VideoProbe> {
  const { ffprobe } = await ffmpegPaths();
  const json = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], 60_000);
  let data: ProbeJson;
  try {
    data = JSON.parse(json) as ProbeJson;
  } catch {
    throw new VideoUnreadableError('Unreadable probe output');
  }
  const video = data.streams?.find((s) => s.codec_type === 'video' && s.width && s.height);
  if (!video) throw new VideoUnreadableError('No video track');
  const duration = Number(data.format?.duration ?? video.duration ?? NaN);
  if (!Number.isFinite(duration) || duration <= 0) throw new VideoUnreadableError('Unknown duration');
  const audio = data.streams?.find((s) => s.codec_type === 'audio');
  return {
    durationSeconds: duration,
    width: video.width!,
    height: video.height!,
    hasAudio: !!audio,
    fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate),
    videoCodec: video.codec_name ?? '',
    pixelFormat: video.pix_fmt ?? '',
    audioCodec: audio?.codec_name ?? null,
    bitRate: Number(data.format?.bit_rate ?? 0) || 0,
  };
}

/** Highest frame rate kept; 60 fps phone video is halved, which roughly halves the encode. */
export const VIDEO_MAX_FPS = 30;
/** Above this a web-ready file is still re-encoded (to keep playback light on mobile data). */
const REMUX_MAX_BITRATE = 4_500_000;

/**
 * Already web-ready (H.264 8-bit 4:2:0, at most 720p and 30 fps, modest bitrate, AAC or silent) and
 * not trimmed: repackage without re-encoding.
 */
export function canRemux(probe: VideoProbe, trimmed: boolean): boolean {
  return (
    !trimmed &&
    probe.videoCodec === 'h264' &&
    probe.pixelFormat === 'yuv420p' &&
    Math.max(probe.width, probe.height) <= VIDEO_MAX_EDGE &&
    probe.fps > 0 &&
    probe.fps <= VIDEO_MAX_FPS + 1 &&
    probe.bitRate > 0 &&
    probe.bitRate <= REMUX_MAX_BITRATE &&
    (probe.audioCodec === null || probe.audioCodec === 'aac')
  );
}

/** Copies the streams into a clean MP4: metadata and chapters stripped, faststart. */
export async function remuxVideo(input: string, output: string): Promise<void> {
  const { ffmpeg } = await ffmpegPaths();
  await run(
    ffmpeg,
    ['-hide_banner', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', output],
    5 * 60_000,
  );
}

/** Converts to the web rendition. Allows about 6× real time (at least 10 minutes) before giving up. */
export async function transcodeVideo(
  input: string,
  output: string,
  durationSeconds: number,
  /** Keep only this part of the source (the member's trim). Seeking before the input is frame-accurate when re-encoding. */
  clip?: { startSeconds: number; durationSeconds: number },
  /** The source's probe, to tune the work (frame-rate cap, decoder shortcuts). */
  source?: Pick<VideoProbe, 'width' | 'height' | 'fps'>,
): Promise<void> {
  const { ffmpeg } = await ffmpegPaths();
  const e = VIDEO_MAX_EDGE;
  const scale = `scale='if(gte(iw,ih),min(${e},iw),-2)':'if(gte(iw,ih),-2,min(${e},ih))':flags=bilinear`;
  // Halve 60 fps sources; leave 24/25/29.97/30 untouched (resampling those would drop or repeat frames).
  const fps = !source || source.fps > VIDEO_MAX_FPS + 1 ? `,fps=${VIDEO_MAX_FPS}` : '';
  // 1080p and larger shrink by at least 1.5×: skipping the deblocking pass while decoding saves time
  // without visible effect at 720p. Smaller sources keep it.
  const shrinking = !source || Math.max(source.width, source.height) >= VIDEO_MAX_EDGE * 1.5;
  await run(
    ffmpeg,
    [
      '-hide_banner',
      '-y',
      ...(shrinking ? ['-skip_loop_filter', 'all'] : []),
      ...(clip ? ['-ss', clip.startSeconds.toFixed(3)] : []),
      '-i', input,
      ...(clip ? ['-t', clip.durationSeconds.toFixed(3)] : []),
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', `${scale}${fps},format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'superfast',
      '-crf', '23',
      '-profile:v', 'high',
      '-maxrate', '3M',
      '-bufsize', '6M',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-map_metadata', '-1',
      '-map_chapters', '-1',
      '-movflags', '+faststart',
      output,
    ],
    Math.max(10 * 60_000, Math.ceil(durationSeconds * 6_000)),
  );
}

export type AudioProbe = { durationSeconds: number; codec: string };

/** Voice notes: the file must hold an audio track; returns its length. */
export async function probeAudio(file: string): Promise<AudioProbe> {
  const { ffprobe } = await ffmpegPaths();
  const json = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], 60_000);
  let data: ProbeJson;
  try {
    data = JSON.parse(json) as ProbeJson;
  } catch {
    throw new VideoUnreadableError('Unreadable probe output');
  }
  const audio = data.streams?.find((s) => s.codec_type === 'audio');
  if (!audio) throw new VideoUnreadableError('No audio track');
  let duration = Number(data.format?.duration ?? audio.duration ?? NaN);
  // Browser recordings (WebM from MediaRecorder) often carry no duration: decode to measure it.
  if (!Number.isFinite(duration) || duration <= 0) {
    duration = await measureDecoded(file);
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new VideoUnreadableError('Unknown duration');
  return { durationSeconds: duration, codec: audio.codec_name ?? '' };
}

/** Length by decoding the whole stream (ffmpeg prints the final time on stderr). */
async function measureDecoded(file: string): Promise<number> {
  const { ffmpeg } = await ffmpegPaths();
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-i', file, '-map', '0:a:0', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c: Buffer) => {
      err = (err + c.toString('utf8')).slice(-4000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('error', () => resolve(NaN));
    child.on('close', () => {
      clearTimeout(timer);
      const times = [...err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
      const last = times.at(-1);
      resolve(last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : NaN);
    });
  });
}

/** Voice note → AAC in an MP4 (.m4a) container, mono 64 kbps, metadata stripped, faststart. Plays everywhere. */
export async function transcodeAudio(input: string, output: string): Promise<void> {
  const { ffmpeg } = await ffmpegPaths();
  await run(
    ffmpeg,
    ['-hide_banner', '-y', '-i', input, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-map_metadata', '-1', '-movflags', '+faststart', '-f', 'mp4', output],
    5 * 60_000,
  );
}

/** A JPEG still from about a second in (or the middle of very short clips). */
export async function extractPoster(input: string, output: string, durationSeconds: number): Promise<void> {
  const { ffmpeg } = await ffmpegPaths();
  const at = Math.min(1, durationSeconds / 2).toFixed(2);
  await run(ffmpeg, ['-hide_banner', '-y', '-ss', at, '-i', input, '-frames:v', '1', '-q:v', '3', output], 60_000);
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}
