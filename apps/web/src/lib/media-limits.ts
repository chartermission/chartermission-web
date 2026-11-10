"use client";

import type { MediaSettings } from "@chartermission/contracts";
import { api } from "@/lib/api/client";

const FALLBACK: MediaSettings = { postVideoMaxSeconds: 600, storyVideoMaxSeconds: 60, introVideoMaxSeconds: 300 };
let cached: Promise<MediaSettings> | null = null;

/** Video length limits set by admins (GET /uploads/limits), fetched once per page load. */
export function getMediaLimits(): Promise<MediaSettings> {
  cached ??= api<MediaSettings>("/uploads/limits").catch(() => {
    cached = null;
    return FALLBACK;
  });
  return cached;
}

/**
 * A video file's length in seconds, read by the browser before uploading. Null when the browser
 * can't read it (some HEVC .mov files): the server checks the length anyway.
 */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => finish(null);
    setTimeout(() => finish(null), 8000);
    video.src = url;
  });
}
