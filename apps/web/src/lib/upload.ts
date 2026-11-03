"use client";

import { UPLOAD_LIMITS, type CreateUploadResponse, type FileView, type UploadPurpose } from "@chartermission/contracts";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 60_000;

/** Client-side check against the same limits the API enforces; throws an ApiError with a member-facing message. */
export function assertUploadable(file: File, purpose: UploadPurpose): void {
  const limit = UPLOAD_LIMITS[purpose];
  if (!(limit.mimes as readonly string[]).includes(file.type)) {
    const kinds = purpose === "post_document" ? "a PDF" : "a JPEG, PNG or WebP image";
    throw new ApiError(415, "UNSUPPORTED_MEDIA", `Choose ${kinds}.`);
  }
  if (file.size > limit.maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Choose a file under ${Math.round(limit.maxBytes / 1024 / 1024)} MB.`);
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
export async function uploadFile(file: File, purpose: UploadPurpose, onProgress?: (fraction: number) => void): Promise<FileView> {
  assertUploadable(file, purpose);
  const target = await api<CreateUploadResponse>("/uploads", {
    method: "POST",
    body: { purpose, fileName: file.name || "upload", mime: file.type, sizeBytes: file.size },
  });
  await putBytes(target, file, onProgress);
  let view = await api<FileView>(`/uploads/${target.fileId}/complete`, { method: "POST" });
  const started = Date.now();
  while (view.status === "pending") {
    if (Date.now() - started > POLL_TIMEOUT_MS) {
      throw new ApiError(504, "UNKNOWN", "Processing is taking longer than expected. Try again in a minute.");
    }
    await wait(POLL_INTERVAL_MS);
    view = await api<FileView>(`/uploads/${target.fileId}`);
  }
  if (view.status === "rejected") {
    throw new ApiError(422, "UNSUPPORTED_MEDIA", view.rejectionReason ?? "This file couldn’t be accepted. Try a different one.");
  }
  return view;
}
