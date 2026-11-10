"use client";

import { useState, type CSSProperties } from "react";
import { VIDEO_PROVIDER_LABELS, formatDuration, type AttachmentView, type LinkPreview, type VideoEmbed } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { useT } from "@/i18n/client";

/** Tallest a video may be in a post; portrait videos narrow instead of growing. */
const MAX_HEIGHT = 520;

function frame(width: number | null, height: number | null): CSSProperties {
  const natural = width && height ? width / height : 16 / 9;
  const ratio = Math.min(2, Math.max(9 / 16, natural));
  return ratio < 1 ? { aspectRatio: String(ratio), width: `min(100%, ${Math.round(MAX_HEIGHT * ratio)}px)` } : { aspectRatio: String(ratio) };
}

/**
 * A video uploaded to Charter Mission (converted to 720p MP4 on the server). Native controls, no
 * autoplay; only the metadata loads until the member presses play, to spare mobile data.
 */
export function UploadedVideo({ video, className }: { video: AttachmentView; className?: string }) {
  const t = useT();
  const label = `${t("Video")}${video.durationSeconds ? `, ${formatDuration(video.durationSeconds)}` : ""}${video.name ? `: ${video.name}` : ""}`;
  return (
    <div dir="ltr" className={cn("flex w-full justify-center overflow-hidden rounded-[10px] bg-ink", className)}>
      <video
        src={video.url}
        poster={video.posterUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        aria-label={label}
        className="block h-auto max-h-[520px] w-full bg-ink object-contain"
        style={frame(video.width, video.height)}
      />
    </div>
  );
}

/**
 * A YouTube, Vimeo, Loom, TikTok or Dailymotion player. Shows a still and a play button first and
 * loads the provider's iframe only when the member presses play (no third-party requests or
 * tracking until then).
 */
export function VideoEmbedPlayer({ preview, embed }: { preview: LinkPreview; embed: VideoEmbed }) {
  const t = useT();
  const [playing, setPlaying] = useState(false);
  const provider = VIDEO_PROVIDER_LABELS[embed.provider];
  const title = preview.title ?? t("{provider} video", { provider });
  const still = preview.imageUrl ?? embed.thumbnailUrl;
  const src = `${embed.embedUrl}${embed.embedUrl.includes("?") ? "&" : "?"}autoplay=1`;
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-[10px] border border-line">
      <div className={cn("relative w-full bg-ink", embed.vertical ? "mx-auto aspect-[9/16] max-h-[560px] max-w-[315px]" : "aspect-video")}>
        {playing ? (
          <iframe
            src={src}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 size-full border-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 flex size-full items-center justify-center focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-primary-light"
          >
            {still && (
              // eslint-disable-next-line @next/next/no-img-element -- provider thumbnail of unknown size
              <img src={still} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-90" />
            )}
            <span className="relative flex size-16 items-center justify-center rounded-full bg-ink/75 text-inverse shadow-lg transition-transform group-hover:scale-105">
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="currentColor">
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            </span>
            <span className="sr-only">
              Play {title} ({provider})
            </span>
          </button>
        )}
      </div>
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        className="flex items-center gap-2 px-3.5 py-2.5 text-xs text-secondary hover:bg-primary-tint-2"
      >
        <Icon name="video" size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-ink">{preview.title ?? preview.url}</span>
          <span> · {provider}</span>
        </span>
        <Icon name="external" size={14} className="shrink-0" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </div>
  );
}
