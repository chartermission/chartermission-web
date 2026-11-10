"use client";

import { UPLOAD_LIMITS, formatDuration, isVideoPurpose, type CreateUploadResponse, type FileView, type UploadPurpose } from "@chartermission/contracts";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 60_000;
/** Videos are converted on the server, which can take a few minutes for long ones. */
const VIDEO_POLL_INTERVAL_MS = 2_000;
const VIDEO_POLL_TIMEOUT_MS = 30 * 60_000;

/** Client-side check against the same limits the API enforces; throws an ApiError with a member-facing message. */
export function assertUploadable(file: File, purpose: UploadPurpose): void {
  const limit = UPLOAD_LIMITS[purpose];
  if (!(limit.mimes as readonly string[]).includes(file.type)) {
    const kinds = purpose === "post_document" ? "a PDF" : isVideoPurpose(purpose) ? "an MP4, MOV or WebM video" : "a JPEG, PNG or WebP image";
    throw new ApiError(415, "UNSUPPORTED_MEDIA", `Choose ${kinds}.`);
  }
  if (file.size > limit.maxBytes) {
    const mb = Math.round(limit.maxBytes / 1024 / 1024);
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Choose a file under ${mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`}.`);
  }
}

/** Client-side length check for a video before it is uploaded (the server checks again). */
export function assertVideoLength(seconds: number | null, maxSeconds: number): void {
  if (seconds !== null && seconds > maxSeconds + 0.5) {
    throw new ApiError(
      422,
      "VALIDATION_FAILED",
      `Videos can be up to ${formatDuration(maxSeconds)} long. This one is ${formatDuration(seconds)}. Choose a shorter part of it.`,
    );
  }
}

/** PUT the bytes to the signed URL with upload progress (fetch has no upload progress events). */
function putBytes(target: CreateUploadResponse, file: File, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.uploadUrl);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      // Object storage (R2/S3) answers in XML, the local driver in JSON.
      const storageCode = /<Code>([^<]+)<\/Code>/.exec(xhr.responseText)?.[1];
      if (storageCode) {
        console.error(`Upload refused by storage: ${storageCode}`, /<Message>([^<]+)<\/Message>/.exec(xhr.responseText)?.[1] ?? "");
        reject(
          new ApiError(
            xhr.status,
            "UNKNOWN",
            storageCode === "AccessDenied" || storageCode === "RequestTimeTooSkewed" || storageCode === "ExpiredRequest"
              ? "The upload link expired before the file finished sending. Try again."
              : "The upload couldn’t be saved. Try again in a moment.",
          ),
        );
        return;
      }
      ApiError.from(new Response(xhr.responseText || null, { status: xhr.status })).then(reject, reject);
    };
    xhr.onerror = () =>
      reject(new ApiError(0, "NETWORK_ERROR", "The upload was interrupted. Check your connection and try again."));
    xhr.send(file);
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Upload a file end to end: POST /uploads → PUT bytes to the signed URL → POST /uploads/{id}/complete
 * → poll GET /uploads/{id} until the scan finishes. Resolves with the clean FileView; rejects with an
 * ApiError (including when the file is rejected by validation or the malware scan).
 * `onProgress` receives 0–1 for the byte transfer.
 */
export async function uploadFile(
  file: File,
  purpose: UploadPurpose,
  onProgress?: (fraction: number) => void,
  /** Videos: the part to keep, chosen in the trim window. */
  trim?: { startMs: number; endMs: number } | null,
): Promise<FileView> {
  assertUploadable(file, purpose);
  const target = await api<CreateUploadResponse>("/uploads", {
    method: "POST",
    body: { purpose, fileName: file.name || "upload", mime: file.type, sizeBytes: file.size, trim: trim ?? undefined },
  });
  await putBytes(target, file, onProgress);
  let view = await api<FileView>(`/uploads/${target.fileId}/complete`, { method: "POST" });
  const started = Date.now();
  const video = isVideoPurpose(purpose);
  while (view.status === "pending") {
    if (Date.now() - started > (video ? VIDEO_POLL_TIMEOUT_MS : POLL_TIMEOUT_MS)) {
      throw new ApiError(504, "UNKNOWN", "Processing is taking longer than expected. Try again in a minute.");
    }
    await wait(video ? VIDEO_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
    view = await api<FileView>(`/uploads/${target.fileId}`);
  }
  if (view.status === "rejected") {
    throw new ApiError(422, "UNSUPPORTED_MEDIA", view.rejectionReason ?? "This file couldn’t be accepted. Try a different one.");
  }
  return view;
}

/** Thrown when the member closes the trim window without choosing: the file is quietly dropped. */
export class UploadCancelled extends Error {}

/**
 * Before a video uploads: open the trim window so the member picks the part to post (the whole
 * video when it fits the limit and they leave it alone). Resolves with the trim to send, or null
 * for the whole file. When the browser can't read the video (some HEVC .mov files) there is
 * nothing to show, so the whole file goes up and the server checks the length.
 */
export async function chooseVideoPart(file: File, maxSeconds: number): Promise<{ startMs: number; endMs: number } | null> {
  const [{ readVideoDuration }, { requestVideoTrim }] = await Promise.all([import("@/lib/media-limits"), import("@/components/video/video-trim")]);
  const seconds = await readVideoDuration(file);
  if (seconds === null) return null;
  const result = await requestVideoTrim(file, seconds, maxSeconds);
  if (result.cancelled) throw new UploadCancelled();
  const kept = result.trim ? (result.trim.endMs - result.trim.startMs) / 1000 : seconds;
  assertVideoLength(kept, maxSeconds);
  return result.trim;
}
