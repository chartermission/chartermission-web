"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GroupMemberView, GroupMembersQuery, Page, Relationship } from "@chartermission/contracts";
import { Button, Icon, RoleBadgeIcon, buttonClasses } from "@chartermission/ui";
import { SearchField } from "@/components/discover/filter-controls";
import { ConnectControl, FollowControl, canConnectWith, useRelationship } from "@/components/network/relationship";
import { ErrorNotice } from "@/components/social/errors";
import { memberHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import { EmptyState } from "@/components/social/skeletons";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { ROLE_LABEL } from "./group-parts";

const LIMIT = 30;

/** Pages of GET /groups/{slug}/members with a search box (typed searches start a new list). */
export function useGroupMembers(slug: string, status: GroupMembersQuery["status"], initial?: Page<GroupMemberView>) {
  const [items, setItems] = useState<GroupMemberView[]>(initial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const searched = useRef<string | null>(initial ? "" : null);

  useEffect(() => {
    const q = query.trim();
    if (searched.current === q && tick === 0) return;
    let live = true;
    const timer = window.setTimeout(
      () => {
        searched.current = q;
        setLoading(true);
        setError(null);
        api<Page<GroupMemberView>>(`/groups/${slug}/members`, { query: { status, q: q || undefined, limit: LIMIT } })
          .then((page) => {
            if (!live) return;
            setItems(page.items);
            setCursor(page.nextCursor);
          })
          .catch((e: unknown) => live && setError(e))
          .finally(() => live && setLoading(false));
      },
      searched.current === null ? 0 : 300,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, slug, status, tick]);

  async function more() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<GroupMemberView>>(`/groups/${slug}/members`, { query: { status, q: query.trim() || undefined, limit: LIMIT, cursor } });
      setItems((current) => [...current, ...page.items.filter((m) => !current.some((c) => c.member.id === m.member.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  return {
    items,
    setItems,
    cursor,
    query,
    setQuery,
    loading,
    error,
    more,
    reload: () => setTick((n) => n + 1),
  };
}

/** Connect and Follow when the list carries the relationship; otherwise a link to the profile. */
function MemberButtons({ view, viewerId }: { view: GroupMemberView; viewerId: string }) {
  const t = useT();
  if (view.member.id === viewerId) return <span className="text-xs text-secondary">{t("You")}</span>;
  if (!view.relationship) {
    return (
      <Link href={memberHref(view.member.handle)} className={buttonClasses({ variant: "secondary", size: "small" })}>
        {t("View profile")}
        <span className="sr-only"> {view.member.name}</span>
      </Link>
    );
  }
  return <RelationshipButtons member={view.member} relationship={view.relationship} />;
}

function RelationshipButtons({ member, relationship }: { member: GroupMemberView["member"]; relationship: Relationship }) {
  const controls = useRelationship(member, relationship);
  return (
    <div className="flex gap-2">
      {canConnectWith(member, relationship) && <ConnectControl member={member} controls={controls} />}
      <FollowControl member={member} controls={controls} prominent={!canConnectWith(member, relationship)} />
    </div>
  );
}

/**
 * A member in a group list: photo, name, headline, role, the list's actions, and anything that
 * needs the full width underneath (a join request's answer).
 */
export function GroupMemberRow({ view, extra, below, children }: { view: GroupMemberView; extra?: ReactNode; below?: ReactNode; children?: ReactNode }) {
  const t = useT();
  const { member, role } = view;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 max-sm:px-4">
      {extra}
      <MemberAvatar member={member} size={40} link />
      <div className="flex min-w-0 flex-1 basis-40 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <Link href={memberHref(member.handle)} className="truncate text-sm font-medium text-ink hover:underline">
            {member.name}
          </Link>
          {member.verified && <Icon name="verified" size={14} className="shrink-0 text-primary" label={t("Verified")} />}
          <RoleBadgeIcon badge={member.badge} size={14} />
          {role !== "member" && view.status === "active" && (
            <span className="shrink-0 rounded-full bg-primary-tint px-2 py-px text-[11px] font-medium text-primary">{t(ROLE_LABEL[role])}</span>
          )}
        </span>
        {member.headline && <span className="truncate text-xs text-body">{member.headline}</span>}
      </div>
      {children && <div className="flex flex-wrap items-center justify-end gap-2 max-sm:w-full">{children}</div>}
      {below && <div className="w-full">{below}</div>}
    </li>
  );
}

/** Members tab: everyone in the group, admins first, with search and Connect / Follow. */
export function GroupMembers({ slug, name, initial, viewerId }: { slug: string; name: string; initial?: Page<GroupMemberView>; viewerId: string }) {
  const t = useT();
  const list = useGroupMembers(slug, "active", initial);
  return (
    <section aria-labelledby="group-members-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="group-members-heading" className="text-h3 text-ink">
          {t("Members")}
        </h2>
        <SearchField
          label={t("Search members of {name}", { name })}
          placeholder={t("Search members by name")}
          value={list.query}
          onChange={(event) => list.setQuery(event.target.value)}
          className="w-full sm:w-80"
        />
      </div>
      {list.error ? <ErrorNotice error={list.error} onRetry={list.reload} /> : null}
      {list.items.length === 0 && !list.loading && !list.error ? (
        <EmptyState icon="users" title={list.query.trim() ? t("No members match your search") : t("No members yet")}>
          {list.query.trim() ? t("Try another name.") : t("Invite people to get the group started.")}
        </EmptyState>
      ) : (
        <ul aria-busy={list.loading} className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
          {list.items.map((view) => (
            <GroupMemberRow key={view.member.id} view={view}>
              <MemberButtons view={view} viewerId={viewerId} />
            </GroupMemberRow>
          ))}
          {list.loading && list.items.length === 0 && (
            <li className="px-5 py-6 text-center text-sm text-secondary" role="status">
              {t("Loading…")}
            </li>
          )}
        </ul>
      )}
      {list.cursor && (
        <Button variant="secondary" className="self-center" onClick={list.more} aria-disabled={list.loading}>
          {list.loading ? t("Loading…") : t("Show more members")}
        </Button>
      )}
    </section>
  );
}
