import type { AttachmentView } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { formatBytes } from "./format";

/** Up to 4 images in a grid, or one PDF tile (CM-FED-01). URLs are permission-checked /media links. */
export function PostAttachments({ attachments }: { attachments: AttachmentView[] }) {
  const images = attachments.filter((a) => a.kind === "image");
  const documents = attachments.filter((a) => a.kind === "document");
  return (
    <>
      {images.length > 0 && (
        <div
          className={cn(
            "grid w-full gap-1 overflow-hidden rounded-[10px]",
            images.length === 1 ? "grid-cols-1" : "grid-cols-2",
            images.length === 3 && "grid-rows-2",
          )}
        >
          {images.map((image, index) => (
            <a
              key={image.id}
              href={image.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "block overflow-hidden bg-muted focus-visible:ring-2 focus-visible:ring-primary-light",
                images.length === 3 && index === 0 && "row-span-2",
                images.length === 1 ? "max-h-[420px]" : "aspect-square",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media, not static assets */}
              <img
                src={image.url}
                alt={image.name ? `Image: ${image.name}` : "Attached image"}
                width={image.width ?? undefined}
                height={image.height ?? undefined}
                loading="lazy"
                className={cn("size-full object-cover", images.length === 1 && "h-auto max-h-[420px]")}
              />
            </a>
          ))}
        </div>
      )}
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
            <span className="text-xs text-secondary">PDF · {formatBytes(doc.sizeBytes)}</span>
          </span>
          <Icon name="external" size={18} className="shrink-0 text-secondary" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ))}
    </>
  );
}
