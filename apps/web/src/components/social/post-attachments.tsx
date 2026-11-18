import type { AttachmentView, MediaLayout } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { ImageCarousel } from "@/components/gallery/image-carousel";
import { ImageGrid } from "@/components/gallery/image-grid";
import { UploadedVideo } from "@/components/video/video-player";
import { formatBytes } from "./format";
import { T } from "@/i18n/client";

/**
 * A post's images in the layout its author chose (collage, carousel or grid; all open the
 * lightbox), a video, or one PDF tile (CM-FED-01). Images come in the author's order and use the
 * author's alt text (generic fallback). URLs are permission-checked /media links.
 */
export function PostAttachments({
  attachments,
  layout = "collage",
  bleedClassName,
}: {
  attachments: AttachmentView[];
  /** PostView.mediaLayout; a collage when the API didn't send one. */
  layout?: MediaLayout;
  bleedClassName?: string;
}) {
  const images = attachments.filter((a) => a.kind === "image");
  const documents = attachments.filter((a) => a.kind === "document");
  const videos = attachments.filter((a) => a.kind === "video");
  return (
    <>
      {images.length > 1 && layout === "carousel" ? (
        <ImageCarousel images={images} bleedClassName={bleedClassName} />
      ) : (
        images.length > 0 && <ImageGrid images={images} layout={layout === "grid" ? "grid" : "collage"} bleedClassName={bleedClassName} />
      )}
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
