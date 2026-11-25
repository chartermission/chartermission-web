"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PostView } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { postHref } from "@/components/social/links";
import { TimeAgo } from "@/components/social/post-parts";
import { postTypeMeta } from "@/components/social/post-types/meta";
import { useT } from "@/i18n/client";

/** The picture a card shows: the article cover, the first photo, a video poster or the link preview's image. */
function pictureOf(post: PostView): { url: string; alt: string } | null {
  const shown = post.isRepost && post.repostOf ? post.repostOf : post;
  if (shown.article?.coverUrl) return { url: shown.article.coverUrl, alt: shown.article.coverAlt ?? "" };
  const image = shown.attachments.find((a) => a.kind === "image");
  if (image) return { url: image.url, alt: image.alt ?? "" };
  const video = shown.attachments.find((a) => a.kind === "video" && a.posterUrl);
  if (video?.posterUrl) return { url: video.posterUrl, alt: "" };
  if (shown.linkPreview?.imageUrl) return { url: shown.linkPreview.imageUrl, alt: "" };
  return null;
}

/** One post as a small card: what kind of post, when, the first lines, a picture and the counts. */
function ActivityCard({ post }: { post: PostView }) {
  const t = useT();
  const shown = post.isRepost && post.repostOf ? post.repostOf : post;
  const picture = pictureOf(post);
  const text = shown.article ? shown.article.title : shown.body;
  const photos = shown.attachments.filter((a) => a.kind === "image").length;
  return (
    <li className="w-[264px] shrink-0 snap-start max-sm:w-[78vw]">
      <Link
        href={postHref(post)}
        className="group flex h-full flex-col overflow-hidden rounded-[10px] border border-line bg-card transition-colors hover:border-line-strong hover:bg-primary-tint-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <p className="flex items-center gap-1.5 px-3 pt-3 text-xs text-secondary">
          {post.isRepost ? (
            <>
              <Icon name="repeat" size={13} />
              {t("Reposted")}
            </>
          ) : shown.type !== "standard" ? (
            <>
              <Icon name={postTypeMeta[shown.type].icon} size={13} />
              {postTypeMeta[shown.type].badge}
            </>
          ) : (
            t("Posted")
          )}
          <span aria-hidden="true">·</span>
          <TimeAgo iso={post.createdAt} />
        </p>
        {text ? (
          <p dir="auto" className={cn("px-3 pt-1.5 text-sm text-ink", picture ? "line-clamp-3" : "line-clamp-6", shown.article && "font-semibold")}>
            {text}
          </p>
        ) : null}
        {picture && (
          <span className="relative mx-3 mt-2.5 block aspect-[16/9] overflow-hidden rounded-md bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media, not static assets */}
            <img src={picture.url} alt={picture.alt} className="size-full object-cover" loading="lazy" />
            {photos > 1 && (
              <span className="absolute end-1.5 bottom-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] font-medium text-inverse">
                {t("{count} photos", { count: photos })}
              </span>
            )}
          </span>
        )}
        <p className="mt-auto flex items-center gap-3 px-3 pt-2.5 pb-3 text-xs text-secondary">
          <span className="flex items-center gap-1">
            <Icon name="like" size={13} />
            {post.counts.reactions.toLocaleString()}
            <span className="sr-only"> {t("reactions")}</span>
          </span>
          <span className="flex items-center gap-1">
            <Icon name="message" size={13} />
            {post.counts.comments.toLocaleString()}
            <span className="sr-only"> {t("comments")}</span>
          </span>
          {post.counts.impressions !== undefined && (
            <span className="flex items-center gap-1">
              <Icon name="chart" size={13} />
              {post.counts.impressions.toLocaleString()}
              <span className="sr-only"> {t("impressions")}</span>
            </span>
          )}
        </p>
      </Link>
    </li>
  );
}

/**
 * A profile's recent posts in a row of small cards that scrolls sideways (swipe on phones, arrow
 * buttons on wider screens), like LinkedIn's Activity. The full feed of their posts is one click
 * away ("Show all posts").
 */
export function ActivityCarousel({ posts, label }: { posts: PostView[]; label: string }) {
  const t = useT();
  const list = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: posts.length <= 1 });

  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const update = () => {
      // scrollLeft is negative in RTL; compare magnitudes.
      const left = Math.abs(el.scrollLeft);
      setEdges({ start: left < 8, end: left + el.clientWidth >= el.scrollWidth - 8 });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [posts.length]);

  function move(direction: 1 | -1) {
    const el = list.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: direction * (rtl ? -1 : 1) * Math.max(280, el.clientWidth * 0.8), behavior: "smooth" });
  }

  const arrow = "absolute top-1/2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-card text-ink shadow-[0_2px_8px_rgba(25,37,80,0.16)] hover:bg-muted max-sm:hidden";
  return (
    <div className="relative">
      <ul ref={list} aria-label={label} className="relative -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pb-1 [scrollbar-width:none]">
        {posts.map((post) => (
          <ActivityCard key={post.id} post={post} />
        ))}
      </ul>
      {!edges.start && (
        <button type="button" onClick={() => move(-1)} aria-label={t("Previous posts")} className={cn(arrow, "-start-3")}>
          <Icon name="chevron-left" size={18} />
        </button>
      )}
      {!edges.end && (
        <button type="button" onClick={() => move(1)} aria-label={t("More posts")} className={cn(arrow, "-end-3")}>
          <Icon name="chevron-right" size={18} />
        </button>
      )}
    </div>
  );
}
