"use client";

import Link from "next/link";
import type { SpotlightMoment } from "@chartermission/contracts";
import { Icon, buttonClasses, chipClasses, RoleBadgeIcon } from "@chartermission/ui";
import { plural } from "@/components/social/format";
import { memberHref, postHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import type { Viewer } from "@/components/social/viewer";
import { FollowMemberButton } from "./follow-buttons";
import { MomentCard } from "./moment-card";
import { countryName } from "./moment-parts";

/** Member spotlight: who they are, what they work on, their latest post, Follow / View profile. */
export function SpotlightCard({ moment, viewer }: { moment: SpotlightMoment; viewer: Viewer }) {
  const { member, recentPost } = moment;
  const country = countryName(member.countryCode);
  const self = member.id === viewer.id;
  return (
    <MomentCard id={moment.id} label="Member spotlight" icon="user" iconTone="text-accent">
      {(headingId) => (
        <>
          <div className="flex items-start gap-4 max-sm:gap-3">
            <Link href={memberHref(member.handle)} tabIndex={-1} aria-hidden="true" className="shrink-0 rounded-full ring-4 ring-accent-light">
              <MemberAvatar member={member} size={56} />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h2 id={headingId} className="flex min-w-0 items-center gap-1 text-h3 text-ink">
                <Link href={memberHref(member.handle)} className="truncate hover:underline">
                  {member.name}
                </Link>
                {member.verified && <Icon name="verified" size={18} className="shrink-0 text-primary" label="Verified" />}
                <RoleBadgeIcon badge={member.badge} size={18} />
              </h2>
              {member.headline && <p className="line-clamp-2 text-sm text-body">{member.headline}</p>}
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-secondary">
                {country && (
                  <span className="flex items-center gap-1">
                    <Icon name="map-pin" size={14} />
                    {country}
                  </span>
                )}
                {country && <span aria-hidden="true">·</span>}
                <span>{plural(member.followers, "follower")}</span>
                <span aria-hidden="true">·</span>
                <span>{plural(member.posts, "post")}</span>
              </p>
            </div>
          </div>
          {member.bio && <p className="line-clamp-3 text-md text-body">{member.bio}</p>}
          {member.sectors.length > 0 && (
            <ul aria-label="Sectors" className="flex flex-wrap gap-2">
              {member.sectors.map((sector) => (
                <li key={sector} className={chipClasses("neutral", "px-2.5 py-1 text-xs")}>
                  {sector}
                </li>
              ))}
            </ul>
          )}
          {recentPost && (
            <Link
              href={postHref(recentPost.id)}
              className="group flex flex-col gap-1 rounded-[10px] border border-line bg-surface px-4 py-3 hover:bg-primary-tint-2"
            >
              <span className="text-label text-secondary">Recent post</span>
              <span className="line-clamp-2 text-sm text-ink">{recentPost.excerpt}</span>
              <span className="flex items-center gap-1 text-sm font-medium text-primary-light group-hover:underline">
                Read the post
                <Icon name="chevron-right" size={14} />
              </span>
            </Link>
          )}
          <div className="flex flex-wrap gap-3">
            {!self && <FollowMemberButton member={member} following={member.isFollowing} primary />}
            <Link href={memberHref(member.handle)} className={buttonClasses({ variant: "secondary", size: "small" })}>
              View profile<span className="sr-only"> of {member.name}</span>
            </Link>
          </div>
        </>
      )}
    </MomentCard>
  );
}
