"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { AdminGroupDetail, AdminGroupMember, AdminGroupMembersQuery, AdminGroupRow, Page } from "@chartermission/contracts";
import { Avatar, Button, Chip, FilterSelect, Icon, cn } from "@chartermission/ui";
import { inputClasses } from "@/components/form-field";
import { RowMenu } from "@/components/row-menu";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { formatCount } from "@/lib/format";
import { REPORT_REASON_LABELS } from "@/lib/labels";
import { webHref } from "@/lib/navigation";
import { T, useT } from "@/i18n/client";
import { GROUP_ACTION_LABEL, GROUP_STATUS, MEMBER_STATUS_LABEL, ROLE_LABEL, groupActions, useGroupActions } from "./group-actions";
import { GroupLogo, RunBy, VisibilityChip } from "./groups-console";

type Tab = "members" | "posts" | "reports" | "history";

const MEMBER_STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "active", label: "Members" },
  { value: "pending", label: "Asked to join" },
  { value: "invited", label: "Invited" },
  { value: "banned", label: "Banned" },
];
const ROLE_OPTIONS = [
  { value: "", label: "Any role" },
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admins" },
  { value: "moderator", label: "Moderators" },
  { value: "member", label: "Members" },
];

/** One group in the console (GET /admin/groups/{id}). Staff actions need groups.manage. */
export function GroupDetailView({ initial, canManage, canExport }: { initial: AdminGroupDetail; canManage: boolean; canExport: boolean }) {
  const t = useT();
  const [group, setGroup] = useState(initial);
  const [tab, setTab] = useState<Tab>("members");
  const actions = useGroupActions((row: AdminGroupRow) => {
    setGroup((g) => ({ ...g, ...row }));
    // Reload the history (and admins after an owner change).
    api<AdminGroupDetail>(`/admin/groups/${row.id}`).then(setGroup, () => undefined);
  });
  const kinds = canManage ? groupActions(group) : [];
  const status = GROUP_STATUS[group.status];
  const busy = actions.busyId === group.id;

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "members", label: t("Members"), count: group.memberCount },
    { value: "posts", label: t("Recent posts"), count: group.recentPosts.length },
    { value: "reports", label: t("Reports"), count: group.reports.length },
    { value: "history", label: t("History") },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Link href="/groups" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline">
        <Icon name="chevron-left" size={16} className="rtl:rotate-180" />
        All groups
      </Link>

      <header className="flex flex-wrap items-start gap-4">
        <GroupLogo group={group} size={64} />
        <div className="flex min-w-[260px] flex-1 flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-h1 text-ink">
            <span dir="auto">{group.name}</span>
            <VisibilityChip visibility={group.visibility} />
            <Chip tone={status.tone} className="px-2! py-0.5! text-xs!">
              {status.label}
            </Chip>
            {group.featured && (
              <Chip tone="warning" className="px-2! py-0.5! text-xs!">
                Featured
              </Chip>
            )}
          </h1>
          {group.tagline && (
            <p className="text-sm text-body" dir="auto">
              {group.tagline}
            </p>
          )}
          <p className="text-xs text-secondary">
            <span dir="ltr">/groups/{group.slug}</span> · created <DateTime iso={group.createdAt} dateOnly />
            {group.createdBy && <> · {t("by {name}", { name: group.createdBy.name })}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {group.status !== "deleted" && (
            <a href={webHref(`/groups/${group.slug}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-primary hover:bg-primary-tint-2">
              View on site
              <Icon name="external" size={14} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          {kinds.length > 0 && (
            <>
              <Button
                variant={kinds[0] === "restore" ? "primary" : "secondary"}
                size="small"
                disabled={busy}
                className={cn((kinds[0] === "suspend" || kinds[0] === "delete") && "text-error!")}
                onClick={() => void actions.start(group, kinds[0]!)}
              >
                {t(GROUP_ACTION_LABEL[kinds[0]!])}
              </Button>
              {kinds.length > 1 && (
                <RowMenu
                  label={t("More actions for group {name}", { name: group.name })}
                  items={kinds.slice(1).map((k) => ({ label: t(GROUP_ACTION_LABEL[k]), danger: k === "suspend" || k === "delete", disabled: busy, onSelect: () => void actions.start(group, k) }))}
                />
              )}
            </>
          )}
        </div>
      </header>

      {(group.status === "suspended" || group.status === "deleted") && (
        <p className="flex items-start gap-2 rounded-lg bg-error-light p-3 text-sm text-body">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-error" />
          <span>
            {group.status === "suspended" ? "Suspended: members can’t open this group or see its posts. Its admins still can." : "Deleted: nobody sees this group or its posts on the member site."}
            {group.statusNote && (
              <>
                {" "}
                <T vars={{ note: group.statusNote }}>{"Note to its admins: “{note}”"}</T>
              </>
            )}
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Members" value={group.memberCount} />
        <Stat label="Asked to join" value={group.pendingRequests} />
        <Stat label="Posts" value={group.postCount} />
        <Stat label="Posts (30 days)" value={group.postsLast30Days} />
        <Stat label="Open reports" value={group.openReports} alert={group.openReports > 0} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
          <Block title="About">{group.about ? <Text>{group.about}</Text> : <Muted>No description.</Muted>}</Block>
          <Block title="Rules">{group.rules ? <Text>{group.rules}</Text> : <Muted>No rules written.</Muted>}</Block>
          {group.joinQuestion && (
            <Block title="Join question">
              <Text>{group.joinQuestion}</Text>
            </Block>
          )}
        </section>
        <section className="flex flex-col gap-4 rounded-card border border-line bg-card p-5">
          <Block title="Settings">
            <dl className="grid grid-cols-[minmax(0,140px)_1fr] gap-x-4 gap-y-2 text-sm">
              <Fact label="Run by">
                <RunBy group={group} />
              </Fact>
              <Fact label="Who can post">{group.postPermission === "admins" ? "Admins and moderators" : "Any member"}</Fact>
              <Fact label="Post approval">{group.postApproval ? "Posts wait for an admin" : "Posts go up straight away"}</Fact>
              <Fact label="Country">{group.country?.name ?? <Muted>Any</Muted>}</Fact>
              <Fact label="Hashtags">{group.hashtags.length ? group.hashtags.map((h) => `#${h}`).join(" ") : <Muted>None</Muted>}</Fact>
              <Fact label="Last post">{group.lastPostAt ? <DateTime iso={group.lastPostAt} /> : <Muted>No posts yet</Muted>}</Fact>
            </dl>
          </Block>
          <Block title="Admins and moderators">
            {group.admins.length ? (
              <ul className="flex flex-col gap-2">
                {group.admins.map((a) => (
                  <li key={a.member.id} className="flex items-center gap-2 text-sm">
                    <Avatar name={a.member.name} size={32} tone={a.member.tone} src={a.member.avatarUrl ?? undefined} />
                    <a href={webHref(`/${a.member.handle}`)} target="_blank" rel="noreferrer" className="min-w-0 truncate font-medium text-ink hover:underline" dir="auto">
                      {a.member.name}
                    </a>
                    <span className="text-xs text-secondary">{t(ROLE_LABEL[a.role])}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>{group.ownerType === "member" ? "Nobody runs this group." : "Run by the page’s admins or the chapter team."}</Muted>
            )}
          </Block>
        </section>
      </div>

      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label={t("Group details")} className="flex flex-wrap gap-1.5">
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => setTab(item.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium",
                tab === item.value ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:bg-muted",
              )}
            >
              {item.label}
              {item.count !== undefined && <span className={cn("tabular-nums", tab === item.value ? "text-inverse/80" : "text-secondary")}>{formatCount(item.count)}</span>}
            </button>
          ))}
        </div>
        {tab === "members" && <MembersTab groupId={group.id} canExport={canExport} />}
        {tab === "posts" && <PostsTab group={group} />}
        {tab === "reports" && <ReportsTab group={group} />}
        {tab === "history" && <HistoryTab group={group} />}
      </div>
      {actions.dialogs}
    </div>
  );
}

function MembersTab({ groupId, canExport }: { groupId: string; canExport: boolean }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | NonNullable<AdminGroupMembersQuery["status"]>>("");
  const [role, setRole] = useState<"" | NonNullable<AdminGroupMembersQuery["role"]>>("");
  const [page, setPage] = useState<Page<AdminGroupMember> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef(true);
  const query = { q: q.trim() || undefined, status: status || undefined, role: role || undefined };

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        api<Page<AdminGroupMember>>(`/admin/groups/${groupId}/members`, { query: { q: q.trim() || undefined, status: status || undefined, role: role || undefined, limit: 50 }, signal: controller.signal })
          .then((next) => {
            setPage(next);
            setError(null);
          })
          .catch((e: unknown) => {
            if (!controller.signal.aborted) setError(errorMessage(e));
          })
          .finally(() => !controller.signal.aborted && setLoading(false));
      },
      first.current ? 0 : 250,
    );
    first.current = false;
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [groupId, q, status, role]);

  async function more() {
    if (!page?.nextCursor) return;
    setLoading(true);
    try {
      const next = await api<Page<AdminGroupMember>>(`/admin/groups/${groupId}/members`, { query: { ...query, limit: 50, cursor: page.nextCursor } });
      setPage((p) => ({ items: [...(p?.items ?? []), ...next.items], nextCursor: next.nextCursor }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }

  const exportQs = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => !!e[1])).toString();

  return (
    <section className="flex flex-col gap-3">
      <div role="group" aria-label={t("Filter members")} className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <span className="sr-only">Search members</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto h-fit text-secondary" />
          <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t("Name, @handle or email")} className={inputClasses(false, "ps-9")} />
        </label>
        <FilterSelect label={t("Status")} options={MEMBER_STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} />
        <FilterSelect label={t("Role")} options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value as typeof role)} />
        {canExport && (
          <a href={`/groups/${groupId}/members/export${exportQs ? `?${exportQs}` : ""}`} className="ms-auto inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-3 py-1.5 text-sm font-medium text-ink hover:bg-muted">
            <Icon name="download" size={16} />
            Export CSV
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-error-light p-3 text-sm text-error">
          {error}
        </p>
      )}
      <div className={cn("overflow-x-auto rounded-card border border-line bg-card", loading && "opacity-70")} aria-busy={loading}>
        {page && page.items.length === 0 ? (
          <EmptyState icon="users" title="No members match" />
        ) : (
          <table className="w-full min-w-[760px] border-collapse text-start text-sm">
            <caption className="sr-only">Members of the group</caption>
            <thead className="border-b border-line bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="py-2.5 ps-4 pe-3 text-start font-semibold">
                  Member
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Role
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Status
                </th>
                <th scope="col" className="py-2.5 pe-3 text-start font-semibold">
                  Since
                </th>
                <th scope="col" className="py-2.5 pe-4 text-start font-semibold">
                  Answer to the join question
                </th>
              </tr>
            </thead>
            <tbody>
              {(page?.items ?? []).map((m) => (
                <tr key={m.member.id} className="border-t border-line align-top first:border-t-0">
                  <td className="py-2.5 ps-4 pe-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.member.name} size={32} tone={m.member.tone} src={m.member.avatarUrl ?? undefined} />
                      <div className="flex min-w-0 flex-col">
                        <a href={webHref(`/${m.member.handle}`)} target="_blank" rel="noreferrer" className="truncate font-medium text-ink hover:underline" dir="auto">
                          {m.member.name}
                        </a>
                        <span className="truncate text-xs text-secondary">
                          @{m.member.handle} · {m.email}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pe-3">{t(ROLE_LABEL[m.role])}</td>
                  <td className="py-2.5 pe-3">
                    <Chip tone={m.status === "active" ? "success" : m.status === "banned" ? "error" : m.status === "pending" ? "warning" : "neutral"} className="px-2! py-0.5! text-xs!">
                      {MEMBER_STATUS_LABEL[m.status]}
                    </Chip>
                  </td>
                  <td className="py-2.5 pe-3 text-secondary">
                    <DateTime iso={m.since} dateOnly />
                  </td>
                  <td className="max-w-[320px] py-2.5 pe-4 text-body">
                    {m.requestAnswer ? (
                      <span className="line-clamp-3 whitespace-pre-wrap" dir="auto">
                        {m.requestAnswer}
                      </span>
                    ) : (
                      <span className="text-disabled">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {page?.nextCursor && (
        <Button variant="secondary" size="small" className="self-center" disabled={loading} onClick={() => void more()}>
          Load more
        </Button>
      )}
    </section>
  );
}

function PostsTab({ group }: { group: AdminGroupDetail }) {
  if (!group.recentPosts.length) {
    return (
      <div className="rounded-card border border-line bg-card">
        <EmptyState icon="message" title="No posts in this group yet" />
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
      {group.recentPosts.map((p) => (
        <li key={p.id} className="flex flex-col gap-1.5 px-5 py-3">
          <p className="flex flex-wrap items-center gap-2 text-xs text-secondary">
            {p.author && <span className="font-medium text-ink">{p.author.name}</span>}
            <DateTime iso={p.createdAt} />
            {p.private && (
              <Chip tone="info" className="gap-1 px-2! py-0! text-xs!">
                <Icon name="eye-off" size={12} />
                Private: members only
              </Chip>
            )}
            {p.deleted && (
              <Chip tone="neutral" className="px-2! py-0! text-xs!">
                Deleted by author
              </Chip>
            )}
            {p.moderationState !== "visible" && (
              <Chip tone="error" className="px-2! py-0! text-xs!">
                {p.moderationState === "hidden" ? "Hidden" : "Removed"}
              </Chip>
            )}
            {p.status === "in_review" && (
              <Chip tone="warning" className="px-2! py-0! text-xs!">
                Waiting for approval
              </Chip>
            )}
          </p>
          <p className="text-sm whitespace-pre-wrap text-ink" dir="auto">
            {p.preview}
          </p>
          {!p.deleted && (
            <a href={webHref(p.href)} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-xs font-medium text-primary hover:underline">
              View on site
              <Icon name="external" size={12} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function ReportsTab({ group }: { group: AdminGroupDetail }) {
  const t = useT();
  if (!group.reports.length) {
    return (
      <div className="rounded-card border border-line bg-card">
        <EmptyState icon="flag" title="No open reports" />
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
      {group.reports.map((r) => (
        <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm">
              <span className="font-medium text-ink">{REPORT_REASON_LABELS[r.reason]}</span>
              <span className="text-secondary"> · {r.target.type === "group" ? t("About the group") : t("About a post")}</span>
            </p>
            {r.target.type === "post" && (
              <p className="line-clamp-2 text-sm text-body" dir="auto">
                {r.target.preview}
              </p>
            )}
            {r.detail && (
              <p className="text-sm text-secondary" dir="auto">
                “{r.detail}”
              </p>
            )}
            <p className="text-xs text-secondary">
              {r.reporter ? t("Reported by {name}", { name: r.reporter.name }) : t("Reported")} · <DateTime iso={r.createdAt} />
            </p>
          </div>
          <Link href={`/moderation?report=${r.id}`} className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-primary-tint-2">
            Open in the queue
          </Link>
        </li>
      ))}
    </ul>
  );
}

function HistoryTab({ group }: { group: AdminGroupDetail }) {
  const t = useT();
  if (!group.history.length) {
    return (
      <div className="rounded-card border border-line bg-card">
        <EmptyState icon="clock" title="Nothing in the audit log yet" />
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2 rounded-card border border-line bg-card p-5">
      {group.history.map((a) => (
        <li key={a.id} className="flex flex-col text-sm">
          <span className="text-ink">{a.summary}</span>
          <span className="text-xs text-secondary">
            {a.actor ? a.actor.name : t("System")} · <DateTime iso={a.createdAt} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="flex flex-col rounded-lg border border-line bg-card px-3 py-2">
      <span className={cn("text-h3 tabular-nums", alert ? "text-error" : "text-ink")}>{formatCount(value)}</span>
      <span className="text-xs text-secondary">{label}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-label font-semibold text-ink uppercase">{title}</h2>
      {children}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-secondary">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </>
  );
}

const Text = ({ children }: { children: string }) => (
  <p className="text-sm whitespace-pre-wrap text-body" dir="auto">
    {children}
  </p>
);

const Muted = ({ children }: { children: ReactNode }) => <span className="text-sm text-secondary">{children}</span>;
