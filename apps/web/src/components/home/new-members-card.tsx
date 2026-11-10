"use client";

import Link from "next/link";
import { NEW_MEMBER_DAYS, type NewMembersMoment } from "@chartermission/contracts";
import { Icon, RoleBadgeIcon } from "@chartermission/ui";
import { memberHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import type { Viewer } from "@/components/social/viewer";
import { FollowMemberButton } from "./follow-buttons";
import { MomentCard } from "./moment-card";
import { daysAgo } from "./moment-parts";
import { useT, useIntlTag } from "@/i18n/client";

function scopeOf(scope: NewMembersMoment["scope"]) {
  switch (scope.type) {
    case "chapter":
      return { place: scope.chapter.name, href: `/chapters/${scope.chapter.slug}#members` };
    case "country":
      return { place: scope.countryName, href: `/network?tab=directory&country=${scope.countryCode}&sort=recent` };
    default:
      return { place: null, href: "/network?tab=directory&sort=recent" };
  }
}

/** "Say hello to new members in …": up to six recent joiners in a scrollable row, each with Follow. */
export function NewMembersCard({ moment, viewer }: { moment: NewMembersMoment; viewer: Viewer }) {
  const t = useT();
  const intl = useIntlTag();
  const { place, href } = scopeOf(moment.scope);
  const members = moment.members.filter((member) => member.id !== viewer.id).slice(0, 6);
  if (!members.length) return null;
  const total = Math.max(moment.total, members.length);
  return (
    <MomentCard id={moment.id} label="New members" icon="users" iconTone="text-success">
      {(headingId) => (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id={headingId} className="text-h3 text-ink">
                Say hello to new members{place ? ` in ${place}` : " on Charter Mission"}
              </h2>
              <p className="text-sm text-secondary">
                {total === 1 ? "1 person" : t("{count} people", { count: total })} joined in the last {NEW_MEMBER_DAYS} days. A follow is a warm welcome.
              </p>
            </div>
            <Link href={href} className="flex shrink-0 items-center gap-0.5 rounded-sm pt-1 text-sm font-medium text-primary-light hover:underline">
              See all<span className="sr-only"> new members</span>
              <Icon name="chevron-right" size={14} />
            </Link>
          </div>
          <ul
            aria-label={(place ? t("New members in {place}", { place }) : t("New members"))}
            className="-mx-5 flex snap-x scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 max-sm:-mx-4 max-sm:scroll-px-4 max-sm:px-4"
          >
            {members.map((member) => (
              <li
                key={member.id}
                className="flex w-[172px] shrink-0 snap-start flex-col items-center gap-2 rounded-[10px] border border-line bg-surface px-3 pt-4 pb-3 text-center"
              >
                <Link href={memberHref(member.handle)} tabIndex={-1} aria-hidden="true" className="rounded-full">
                  <MemberAvatar member={member} size={56} />
                </Link>
                <div className="flex w-full min-w-0 flex-col gap-0.5">
                  <Link href={memberHref(member.handle)} className="flex min-w-0 items-center justify-center gap-1 text-sm font-medium text-ink hover:underline">
                    <span className="truncate">{member.name}</span>
                    {member.verified && <Icon name="verified" size={14} className="shrink-0 text-primary" label="Verified" />}
                    <RoleBadgeIcon badge={member.badge} size={14} />
                  </Link>
                  <p className="line-clamp-2 min-h-8 text-xs text-secondary">{member.headline ?? "New member"}</p>
                  <p className="text-xs text-success">
                    Joined <time dateTime={member.joinedAt}>{daysAgo(member.joinedAt, intl)}</time>
                  </p>
                </div>
                <FollowMemberButton member={member} following={member.isFollowing} block className="mt-auto" />
              </li>
            ))}
          </ul>
        </>
      )}
    </MomentCard>
  );
}
