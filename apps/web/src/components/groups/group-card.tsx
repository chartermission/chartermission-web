"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { GroupMembership, GroupSummary } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { MemberAvatar } from "@/components/social/post-parts";
import { useT } from "@/i18n/client";
import { GroupLogo, ROLE_LABEL, RunBy, VisibilityChip, groupHref } from "./group-parts";
import { JoinGroupButton } from "./join-group-button";

/** "3 connections are members", with their faces. */
export function ConnectionsLine({ group }: { group: Pick<GroupSummary, "connections"> }) {
  const t = useT();
  const people = group.connections ?? [];
  if (!people.length) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-secondary">
      <span className="flex -space-x-1.5" aria-hidden="true">
        {people.slice(0, 3).map((member) => (
          <span key={member.id} className="rounded-full ring-2 ring-card">
            <MemberAvatar member={member} size={24} />
          </span>
        ))}
      </span>
      {t("{count} connections are members", { count: people.length })}
    </span>
  );
}

/** The viewer's role, or "Runs it through its page/chapter", for groups they're in. */
export function RoleChip({ membership }: { membership: GroupMembership }) {
  const t = useT();
  if (membership.viaOwner && (!membership.role || membership.role === "member")) {
    return <span className="rounded-full bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary">{t("Runs it")}</span>;
  }
  if (!membership.role || membership.role === "member") return null;
  return <span className="rounded-full bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary">{t(ROLE_LABEL[membership.role])}</span>;
}

/**
 * A group in a grid: cover, logo, name, tagline, Public/Private, members, connections who are
 * members, who runs it, and Join / Ask to join / Accept / Joined / Requested.
 */
export function GroupCard({
  group,
  footer,
  showRole = false,
  onMembershipChange,
}: {
  group: GroupSummary;
  /** Replaces the join button (Your groups shows what waits for the admins). */
  footer?: ReactNode;
  showRole?: boolean;
  onMembershipChange?: (group: GroupSummary, status: GroupMembership["status"]) => void;
}) {
  const t = useT();
  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-card border border-line bg-card transition-shadow hover:shadow-[0_4px_16px_rgb(15_42_42/0.08)]">
      {group.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
        <img src={group.coverUrl} alt="" className="h-20 w-full object-cover" />
      ) : (
        <div aria-hidden="true" className="h-20 w-full bg-gradient-to-r from-primary-dark via-primary to-primary-light" />
      )}
      <div className="flex flex-1 flex-col gap-2.5 px-4 pb-4">
        <div className="-mt-7 flex items-end justify-between gap-2">
          <span className="relative rounded-[14px] border-[3px] border-card bg-card">
            <GroupLogo name={group.name} src={group.logoUrl} size={52} />
          </span>
          <span className="flex flex-wrap items-center justify-end gap-1.5">
            {showRole && <RoleChip membership={group.membership} />}
            {group.status === "archived" && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-secondary">{t("Archived")}</span>}
            {group.status === "suspended" && <span className="rounded-full bg-error-light px-2 py-0.5 text-xs font-medium text-error">{t("Suspended")}</span>}
            <VisibilityChip visibility={group.visibility} />
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-md font-semibold text-ink">
            <Link href={groupHref(group.slug)} className="line-clamp-2 after:absolute after:inset-0 after:rounded-card hover:underline">
              {group.name}
            </Link>
          </h3>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-secondary">
            <span className="flex items-center gap-1">
              <Icon name="users" size={14} />
              {t("{count} members", { count: group.memberCount })}
            </span>
            {group.country && (
              <>
                <span aria-hidden="true">·</span>
                <span>{group.country.name}</span>
              </>
            )}
          </p>
        </div>
        {group.tagline && (
          <p dir="auto" className="line-clamp-2 text-sm text-body">
            {group.tagline}
          </p>
        )}
        <RunBy group={group} className="text-xs text-secondary" />
        <ConnectionsLine group={group} />
        <div className="relative z-10 mt-auto flex items-center justify-end gap-2 pt-1">
          {footer ?? <JoinGroupButton group={group} membership={group.membership} onChange={(status) => onMembershipChange?.(group, status)} />}
        </div>
      </div>
    </article>
  );
}

/** A grid of group cards, one column on phones (two at most in a narrow main column). */
export function GroupGrid({ children, busy = false, narrow = false, className }: { children: ReactNode; busy?: boolean; narrow?: boolean; className?: string }) {
  return (
    <ul
      aria-busy={busy}
      className={cn("grid gap-4 max-sm:grid-cols-1", narrow ? "grid-cols-2" : "grid-cols-3 max-lg:grid-cols-2", busy && "opacity-70", className)}
    >
      {children}
    </ul>
  );
}
