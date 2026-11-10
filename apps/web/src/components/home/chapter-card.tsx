"use client";

import Link from "next/link";
import type { ChapterHighlightMoment } from "@chartermission/contracts";
import { ChapterAvatar, Icon, buttonClasses, RoleBadgeIcon } from "@chartermission/ui";
import { plural } from "@/components/social/format";
import { memberHref, postHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import { FollowChapterButton } from "./follow-buttons";
import { MomentCard } from "./moment-card";
import { countryName } from "./moment-parts";

/** Chapter highlight: the chapter's week in numbers and its top post, Follow chapter / Open chapter. */
export function ChapterCard({ moment }: { moment: ChapterHighlightMoment }) {
  const { chapter, topPost } = moment;
  const chapterHref = `/chapters/${chapter.slug}`;
  return (
    <MomentCard id={moment.id} label="Chapter highlight" icon="map-pin" iconTone="text-primary-light">
      {(headingId) => (
        <>
          <div className="flex items-center gap-4 max-sm:gap-3">
            <ChapterAvatar name={chapter.name} countryCode={chapter.countryCode} size={56} className="rounded-xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2 id={headingId} className="text-h3 text-ink">
                <Link href={chapterHref} className="hover:underline">
                  {chapter.name}
                </Link>
              </h2>
              <p className="text-sm text-secondary">
                {countryName(chapter.countryCode)} · This week in the chapter
              </p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-3">
            {[
              { label: moment.members === 1 ? "member" : "members", value: moment.members, icon: "users" as const },
              { label: moment.postsThisWeek === 1 ? "post this week" : "posts this week", value: moment.postsThisWeek, icon: "message" as const },
            ].map((stat) => (
              <div key={stat.label} className="flex items-center gap-3 rounded-[10px] bg-surface px-4 py-3">
                <Icon name={stat.icon} size={20} className="shrink-0 text-primary-light" />
                <div className="flex flex-col-reverse">
                  <dt className="text-xs text-secondary">{stat.label}</dt>
                  <dd className="text-h3 text-ink">{stat.value.toLocaleString("en-US")}</dd>
                </div>
              </div>
            ))}
          </dl>
          {topPost && (
            <div className="relative flex flex-col gap-2 rounded-[10px] border border-line px-4 py-3 hover:bg-primary-tint-2">
              <p className="flex items-center gap-1.5 text-label text-accent-hover">
                <Icon name="trending" size={14} />
                Top post this week
              </p>
              <div className="flex items-center gap-2">
                <MemberAvatar member={topPost.author} size={24} />
                <Link href={memberHref(topPost.author.handle)} className="relative z-10 truncate text-sm font-medium text-ink hover:underline">
                  {topPost.author.name}
                </Link>
                {topPost.author.verified && <Icon name="verified" size={14} className="shrink-0 text-primary" label="Verified" />}
                <RoleBadgeIcon badge={topPost.author.badge} size={14} />
              </div>
              <Link href={postHref(topPost.id)} className="line-clamp-3 text-sm text-body after:absolute after:inset-0 after:rounded-[10px]">
                {topPost.excerpt}
              </Link>
              <p className="text-xs text-secondary">
                {plural(topPost.reactions, "reaction")} · {plural(topPost.comments, "comment")}
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <FollowChapterButton chapter={chapter} following={moment.isFollowing} primary />
            <Link href={chapterHref} className={buttonClasses({ variant: "secondary", size: "small" })}>
              Open chapter
              <Icon name="chevron-right" size={14} />
            </Link>
          </div>
        </>
      )}
    </MomentCard>
  );
}
