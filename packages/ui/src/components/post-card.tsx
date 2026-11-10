import type { ElementType, ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cn } from "../cn";
import { Avatar, type AvatarTone } from "./avatar";

export type PollOption = { label: string; percent: number; chosen?: boolean };

export type PostCardProps = {
  author: { name: string; verified?: boolean; href?: string; tone?: AvatarTone };
  /** e.g. "Founder, Lagos AgriHub · Lagos, Nigeria · 2h" */
  meta: string;
  body: ReactNode;
  tags?: string[];
  stats?: string;
  /** true, or a custom label such as "Pinned announcement · Charter Mission team" */
  pinned?: boolean | string;
  image?: { label?: string };
  poll?: { question: string; options: PollOption[]; footer: string };
  linkPreview?: { domain: string; title: string; description: string; href?: string };
  href?: string;
  linkAs?: ElementType;
  tagHref?: (tag: string) => string;
  className?: string;
};

const actions: { icon: IconName; label: string }[] = [
  { icon: "like", label: "Like" },
  { icon: "message", label: "Comment" },
  { icon: "repeat", label: "Repost" },
  { icon: "bookmark", label: "Save" },
  { icon: "share", label: "Share" },
];

/** Feed post (Figma Post card, node 7:25). */
export function PostCard({
  author,
  meta,
  body,
  tags,
  stats,
  pinned,
  image,
  poll,
  linkPreview,
  linkAs: LinkAs = "a",
  tagHref,
  className,
}: PostCardProps) {
  return (
    <article className={cn("flex w-full flex-col gap-[14px] rounded-card border border-line bg-card p-5", className)}>
      {pinned && (
        <p className="flex items-center gap-1.5 text-label text-accent-hover">
          <Icon name="pin" size={14} />
          {typeof pinned === "string" ? pinned : "Pinned announcement"}
        </p>
      )}

      <header className="flex w-full items-center gap-3">
        <Avatar name={author.name} size={40} tone={author.tone} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex items-center gap-1">
            {author.href ? (
              <LinkAs href={author.href} className="text-md font-medium text-ink hover:underline">
                {author.name}
              </LinkAs>
            ) : (
              <span className="text-md font-medium text-ink">{author.name}</span>
            )}
            {author.verified && <Icon name="verified" size={16} className="text-primary" label="Verified" />}
          </p>
          <p className="truncate text-xs text-secondary">{meta}</p>
        </div>
        <button type="button" className="rounded-md p-0.5 text-secondary hover:bg-muted" aria-label="More options">
          <Icon name="more" size={20} />
        </button>
      </header>

      <div className="w-full text-md text-ink">{body}</div>

      {image && (
        <div
          className="flex h-[300px] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-[10px] text-inverse"
          style={{ backgroundImage: "linear-gradient(151.74deg, #046d35 0%, #ed0918 55%, #ff8a00 100%)" }}
        >
          <Icon name="image" size={32} />
          <span className="text-sm font-medium">{image.label ?? "Photo"}</span>
        </div>
      )}

      {poll && (
        <div className="flex w-full flex-col gap-2">
          <p className="text-md font-medium text-ink">{poll.question}</p>
          {poll.options.map((option) => (
            <div
              key={option.label}
              className={cn(
                "relative flex h-10 w-full items-center justify-between overflow-hidden rounded-lg border px-[11px]",
                option.chosen ? "border-primary" : "border-line",
              )}
            >
              <span
                className={cn("absolute inset-y-0 start-0", option.chosen ? "bg-primary-tint" : "bg-muted")}
                style={{ width: `${option.percent}%` }}
                aria-hidden="true"
              />
              <span className={cn("relative text-sm text-ink", option.chosen && "font-medium")}>{option.label}</span>
              <span className={cn("relative text-sm font-medium", option.chosen ? "text-primary" : "text-secondary")}>
                {option.percent}%
              </span>
            </div>
          ))}
          <p className="text-xs text-secondary">{poll.footer}</p>
        </div>
      )}

      {linkPreview && (
        <LinkAs
          href={linkPreview.href ?? "#"}
          className="flex w-full items-stretch overflow-hidden rounded-[10px] border border-line hover:bg-primary-tint-2"
        >
          <span className="flex h-24 w-[132px] shrink-0 items-center justify-center bg-primary-tint text-primary-light">
            <Icon name="link" size={24} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-[14px] py-3">
            <span className="text-xs text-secondary">{linkPreview.domain}</span>
            <span className="text-sm font-medium text-ink">{linkPreview.title}</span>
            <span className="text-xs text-secondary">{linkPreview.description}</span>
          </span>
        </LinkAs>
      )}

      {tags && tags.length > 0 && (
        <p className="flex w-full flex-wrap gap-x-2 text-sm font-medium text-accent-hover">
          {tags.map((tag) =>
            tagHref ? (
              <LinkAs key={tag} href={tagHref(tag)} className="hover:underline">
                #{tag}
              </LinkAs>
            ) : (
              <span key={tag}>#{tag}</span>
            ),
          )}
        </p>
      )}

      {stats && <p className="w-full text-xs text-secondary">{stats}</p>}

      <div className="h-px w-full bg-line" />

      <footer className="flex w-full items-center justify-between">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-secondary hover:bg-muted hover:text-primary"
          >
            <Icon name={action.icon} size={18} />
            {action.label}
          </button>
        ))}
      </footer>
    </article>
  );
}
