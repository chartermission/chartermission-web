"use client";

import { UPLOAD_LIMITS, type CreateUploadResponse, type FileView, type UploadPurpose } from "@chartermission/contracts";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";

const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 60_000;

/** Client-side check against the limits the API enforces; throws an ApiError with an admin-facing message. */
export function assertUploadable(file: File, purpose: UploadPurpose): void {
  const limit = UPLOAD_LIMITS[purpose];
  if (!(limit.mimes as readonly string[]).includes(file.type)) throw new ApiError(415, "UNSUPPORTED_MEDIA", "Use a JPEG, PNG or WebP image.");
  if (file.size > limit.maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Use an image under ${Math.round(limit.maxBytes / 1024 / 1024)} MB.`);
  }
}

function putBytes(target: CreateUploadResponse, file: File, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.uploadUrl);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError(xhr.status, "UNKNOWN", "The storage service refused the upload. Try again in a moment."));
    xhr.onerror = () =>
      reject(new ApiError(0, "NETWORK_ERROR", "The upload was interrupted. Check the connection and the storage CORS settings, then try again."));
    xhr.send(file);
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** POST /uploads → PUT the bytes → POST /uploads/{id}/complete → poll until the scan finishes. */
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
    if (Date.now() - started > POLL_TIMEOUT_MS) throw new ApiError(504, "UNKNOWN", "Checking the image is taking longer than expected. Try again in a minute.");
    await wait(POLL_INTERVAL_MS);
    view = await api<FileView>(`/uploads/${target.fileId}`);
  }
  if (view.status === "rejected") throw new ApiError(422, "UNSUPPORTED_MEDIA", view.rejectionReason ?? "This image couldn’t be accepted.");
  return view;
}
