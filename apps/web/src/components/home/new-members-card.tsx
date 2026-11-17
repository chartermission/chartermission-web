"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { NEW_MEMBER_DAYS, type NewMembersMoment } from "@chartermission/contracts";
import { Icon, RoleBadgeIcon } from "@chartermission/ui";
import { memberHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import type { Viewer } from "@/components/social/viewer";
import { ConnectControl, FollowControl, canConnectWith, useRelationship } from "@/components/network/relationship";
import { MomentCard } from "./moment-card";
import { daysAgo } from "./moment-parts";
import { useT, useIntlTag } from "@/i18n/client";

type NewMember = NewMembersMoment["members"][number];

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

/**
 * Scroll state of a horizontal row, direction-aware (in right-to-left pages scrollLeft runs from 0 to
 * negative values). `left`/`right` say whether there is more to see on that physical side.
 */
function useScrollEdges() {
  // A callback ref: the row can appear after the first render (the card fills in once it knows it
  // isn't dismissed), so listeners attach whenever the element itself changes.
  const [el, setEl] = useState<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = useCallback(() => {
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    const rtl = getComputedStyle(el).direction === "rtl";
    const atStart = pos <= 1;
    const atEnd = pos >= max - 1;
    setEdges(rtl ? { left: !atEnd, right: !atStart } : { left: !atStart, right: !atEnd });
  }, [el]);
  useEffect(() => {
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    // Also measures once straight away (observers report the current size when they start).
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [el, update]);
  const scroll = (side: "left" | "right") => {
    if (!el) return;
    // Move by most of the visible width, keeping one card in view for context.
    const step = Math.max(el.clientWidth - 180, 180);
    el.scrollBy({ left: side === "left" ? -step : step, behavior: "smooth" });
  };
  return { ref: setEl, edges, scroll };
}

function ScrollArrow({ side, onClick, label }: { side: "left" | "right"; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={
        "absolute top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-line bg-card text-ink shadow-md transition hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " +
        (side === "left" ? "-left-2 max-sm:left-0" : "-right-2 max-sm:right-0")
      }
    >
      {/* These arrows point at a physical side, so they mustn't flip like other chevrons in Arabic. */}
      <Icon name={side === "left" ? "chevron-left" : "chevron-right"} size={20} style={{ transform: "none" }} />
    </button>
  );
}

function NewMemberItem({ member }: { member: NewMember }) {
  const intl = useIntlTag();
  const official = member.canConnect === false;
  const controls = useRelationship(
    { id: member.id, name: member.name, official },
    { connection: member.connection ?? "none", connectionId: member.connectionId ?? null, following: member.isFollowing },
  );
  return (
    <li className="flex w-[172px] shrink-0 snap-start flex-col items-center gap-2 rounded-[10px] border border-line bg-surface px-3 pt-4 pb-3 text-center">
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
      <div className="mt-auto flex w-full flex-col gap-1.5">
        {canConnectWith({ id: member.id, name: member.name, official }) && (
          <ConnectControl member={{ id: member.id, name: member.name, official }} controls={controls} size="small" block />
        )}
        <FollowControl member={{ id: member.id, name: member.name, official }} controls={controls} size="small" block />
      </div>
    </li>
  );
}

/** "Say hello to new members in …": up to twelve recent joiners in a scrollable row with arrows, each with Connect and Follow. */
export function NewMembersCard({ moment, viewer }: { moment: NewMembersMoment; viewer: Viewer }) {
  const t = useT();
  const { ref, edges, scroll } = useScrollEdges();
  const { place, href } = scopeOf(moment.scope);
  const members = moment.members.filter((member) => member.id !== viewer.id).slice(0, 12);
  if (!members.length) return null;
  const total = Math.max(moment.total, members.length);
  return (
    <MomentCard id={moment.id} label="New members" icon="users" iconTone="text-success">
      {(headingId) => (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id={headingId} className="text-h3 text-ink">
                {place ? t("Say hello to new members in {place}", { place }) : t("Say hello to new members on Charter Mission")}
              </h2>
              <p className="text-sm text-secondary">
                {t("{count} people joined in the last {days} days. A follow is a warm welcome.", { count: total, days: NEW_MEMBER_DAYS })}
              </p>
            </div>
            <Link href={href} className="flex shrink-0 items-center gap-0.5 rounded-sm pt-1 text-sm font-medium text-primary-light hover:underline">
              See all<span className="sr-only"> new members</span>
              <Icon name="chevron-right" size={14} />
            </Link>
          </div>
          <div className="relative">
            <ul
              ref={ref}
              aria-label={(place ? t("New members in {place}", { place }) : t("New members"))}
              className="-mx-5 flex snap-x scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] max-sm:-mx-4 max-sm:scroll-px-4 max-sm:px-4 [&::-webkit-scrollbar]:hidden"
            >
              {members.map((member) => (
                <NewMemberItem key={member.id} member={member} />
              ))}
            </ul>
            {edges.left && <ScrollArrow side="left" onClick={() => scroll("left")} label={t("Scroll left")} />}
            {edges.right && <ScrollArrow side="right" onClick={() => scroll("right")} label={t("Scroll right")} />}
          </div>
        </>
      )}
    </MomentCard>
  );
}
