import type { AttachmentView } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { ImageGrid } from "@/components/gallery/image-grid";
import { UploadedVideo } from "@/components/video/video-player";
import { formatBytes } from "./format";
import { T } from "@/i18n/client";

/**
 * Up to 4 images as a gallery that opens a lightbox, or one PDF tile (CM-FED-01). Images use the
 * author's alt text (generic fallback). URLs are permission-checked /media links.
 */
export function PostAttachments({ attachments, bleedClassName }: { attachments: AttachmentView[]; bleedClassName?: string }) {
  const images = attachments.filter((a) => a.kind === "image");
  const documents = attachments.filter((a) => a.kind === "document");
  const videos = attachments.filter((a) => a.kind === "video");
  return (
    <>
      {images.length > 0 && <ImageGrid images={images} bleedClassName={bleedClassName} />}
      {videos.map((video) => (
        <UploadedVideo key={video.id} video={video} />
      ))}
      {documents.map((doc) => (
        <a
          key={doc.id}
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center gap-3 rounded-[10px] border border-line p-3 hover:bg-primary-tint-2"
        >
          <span className="flex h-12 w-10 shrink-0 items-center justify-center rounded-md bg-error-light text-[11px] font-bold text-error">
            PDF
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-ink">{doc.name ?? "Document"}</span>
            <span className="text-xs text-secondary"><T vars={{ count: formatBytes(doc.sizeBytes) }}>{"PDF · {count}"}</T></span>
          </span>
          <Icon name="external" size={18} className="shrink-0 text-secondary" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ))}
    </>
  );
}
