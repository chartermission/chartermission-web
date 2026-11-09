import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

/*
 * Video processing with ffmpeg (the "video" worker). Uploaded videos are probed, checked against the
 * length limit and converted to one web-safe rendition: H.264/AAC MP4, at most 1280 px on the long
 * side (720p), metadata stripped (no GPS or device tags), "faststart" so playback begins before the
 * whole file has loaded. A still frame becomes the poster.
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

export type VideoProbe = { durationSeconds: number; width: number; height: number; hasAudio: boolean };

type ProbeJson = {
  format?: { duration?: string };
  streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[];
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
  return {
    durationSeconds: duration,
    width: video.width!,
    height: video.height!,
    hasAudio: !!data.streams?.some((s) => s.codec_type === 'audio'),
  };
}

/** Converts to the web rendition. Allows about 6× real time (at least 10 minutes) before giving up. */
export async function transcodeVideo(input: string, output: string, durationSeconds: number): Promise<void> {
  const { ffmpeg } = await ffmpegPaths();
  const e = VIDEO_MAX_EDGE;
  const scale = `scale='if(gte(iw,ih),min(${e},iw),-2)':'if(gte(iw,ih),-2,min(${e},ih))'`;
  await run(
    ffmpeg,
    [
      '-hide_banner',
      '-y',
      '-i', input,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', `${scale},format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-profile:v', 'high',
      '-maxrate', '3M',
      '-bufsize', '6M',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      '-map_metadata', '-1',
      '-movflags', '+faststart',
      output,
    ],
    Math.max(10 * 60_000, Math.ceil(durationSeconds * 6_000)),
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
