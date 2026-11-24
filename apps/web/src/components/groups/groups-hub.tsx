"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { GroupSummary, Page } from "@chartermission/contracts";
import { Button, buttonClasses } from "@chartermission/ui";
import { TabList, TabPanel, Tabs } from "@/components/chapters/tabs";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { ErrorNotice } from "@/components/social/errors";
import { EmptyState } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { GroupCard, GroupGrid } from "./group-card";
import { GroupDirectory } from "./group-directory";
import { GroupLogo, VisibilityChip, groupHref } from "./group-parts";
import { leaveGroup } from "./join-group-button";

export type PendingCounts = Record<string, { requests: number; posts: number }>;

/** A list that may have failed to load (the rest of the page still works). */
export type Loaded<T> = { ok: true; data: T } | { ok: false; error: unknown };

/**
 * /groups: Discover (suggestions, then every group with search and filters), Your groups (with
 * your role and what waits for you in the ones you run), Invitations and Requests sent.
 */
export function GroupsHub({
  suggested,
  all,
  mine: initialMine,
  invited: initialInvited,
  requested: initialRequested,
  pending,
  countries,
}: {
  suggested: GroupSummary[];
  all: Loaded<Page<GroupSummary>>;
  mine: Loaded<GroupSummary[]>;
  invited: Loaded<GroupSummary[]>;
  requested: Loaded<GroupSummary[]>;
  pending: PendingCounts;
  countries: { code: string; name: string }[];
}) {
  const t = useT();
  const [mine, setMine] = useState(initialMine.ok ? initialMine.data : []);
  const [invited, setInvited] = useState(initialInvited.ok ? initialInvited.data : []);
  const [requested, setRequested] = useState(initialRequested.ok ? initialRequested.data : []);
  const [leaving, setLeaving] = useState<{ group: GroupSummary; kind: "ignore" | "cancel" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** A card's Join/Ask/Accept moved the group between lists. */
  function moved(group: GroupSummary, status: GroupSummary["membership"]["status"]) {
    const next = { ...group, membership: { ...group.membership, status } };
    setInvited((list) => list.filter((g) => g.id !== group.id));
    setRequested((list) => (status === "pending" ? [next, ...list.filter((g) => g.id !== group.id)] : list.filter((g) => g.id !== group.id)));
    setMine((list) => (status === "active" ? [next, ...list.filter((g) => g.id !== group.id)] : list.filter((g) => g.id !== group.id)));
  }

  async function accept(group: GroupSummary) {
    if (busy) return;
    setBusy(group.id);
    try {
      await api(`/groups/${group.slug}/join`, { method: "POST", body: {} });
      moved(group, "active");
      toast.success(t("You joined {name}", { name: group.name }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  const tabs = [
    { value: "discover", label: t("Discover") },
    { value: "mine", label: mine.length ? t("Your groups ({count})", { count: mine.length }) : t("Your groups") },
    { value: "invitations", label: invited.length ? t("Invitations ({count})", { count: invited.length }) : t("Invitations") },
    { value: "requests", label: requested.length ? t("Requests sent ({count})", { count: requested.length }) : t("Requests sent") },
  ];

  return (
    <Tabs values={tabs.map((tab) => tab.value)} defaultValue="discover">
      <div className="border-b border-line">
        <TabList label={t("Groups")} tabs={tabs} />
      </div>

      <TabPanel value="discover" className="gap-6">
        {suggested.length > 0 && (
          <section aria-labelledby="groups-suggested" className="flex flex-col gap-3">
            <h2 id="groups-suggested" className="text-h3 text-ink">
              {t("Suggested for you")}
            </h2>
            <GroupGrid>
              {suggested.map((group) => (
                <li key={group.id}>
                  <GroupCard group={group} onMembershipChange={moved} />
                </li>
              ))}
            </GroupGrid>
          </section>
        )}
        <section aria-labelledby="groups-all" className="flex flex-col gap-3">
          <h2 id="groups-all" className="text-h3 text-ink">
            {t("All groups")}
          </h2>
          {all.ok ? <GroupDirectory initial={all.data} countries={countries} /> : <ErrorNotice error={all.error} />}
        </section>
      </TabPanel>

      <TabPanel value="mine">
        <h2 className="sr-only">{t("Your groups")}</h2>
        {!initialMine.ok ? (
          <ErrorNotice error={initialMine.error} />
        ) : mine.length ? (
          <GroupGrid>
            {mine.map((group) => {
              const waiting = pending[group.id];
              const total = waiting ? waiting.requests + waiting.posts : 0;
              return (
                <li key={group.id}>
                  <GroupCard
                    group={group}
                    showRole
                    footer={
                      total > 0 && waiting ? (
                        <Link href={`${groupHref(group.slug)}#manage`} className={buttonClasses({ variant: "secondary", size: "small" })}>
                          <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
                          {[
                            waiting.requests ? t("{count} join requests", { count: waiting.requests }) : null,
                            waiting.posts ? t("{count} posts waiting", { count: waiting.posts }) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Link>
                      ) : (
                        <Link href={groupHref(group.slug)} className={buttonClasses({ variant: "secondary", size: "small" })}>
                          {t("Open")}
                        </Link>
                      )
                    }
                  />
                </li>
              );
            })}
          </GroupGrid>
        ) : (
          <EmptyState
            icon="users"
            title={t("You’re not in any groups yet")}
            actions={
              <Link href="/groups/new" className={buttonClasses({ variant: "secondary", size: "small" })}>
                {t("Create a group")}
              </Link>
            }
          >
            {t("Join one from Discover, or start your own around a topic you care about.")}
          </EmptyState>
        )}
      </TabPanel>

      <TabPanel value="invitations">
        <h2 className="sr-only">{t("Invitations")}</h2>
        {!initialInvited.ok ? (
          <ErrorNotice error={initialInvited.error} />
        ) : invited.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
            {invited.map((group) => (
              <GroupRow key={group.id} group={group}>
                <Button size="small" onClick={() => accept(group)} aria-disabled={busy === group.id}>
                  {busy === group.id ? t("Joining…") : t("Accept")}
                  <span className="sr-only"> {group.name}</span>
                </Button>
                <Button size="small" variant="secondary" onClick={() => setLeaving({ group, kind: "ignore" })}>
                  {t("Ignore")}
                  <span className="sr-only"> {group.name}</span>
                </Button>
              </GroupRow>
            ))}
          </ul>
        ) : (
          <EmptyState icon="users" title={t("No invitations")}>
            {t("When someone invites you to a group, it appears here.")}
          </EmptyState>
        )}
      </TabPanel>

      <TabPanel value="requests">
        <h2 className="sr-only">{t("Requests sent")}</h2>
        {!initialRequested.ok ? (
          <ErrorNotice error={initialRequested.error} />
        ) : requested.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
            {requested.map((group) => (
              <GroupRow key={group.id} group={group} note={t("Waiting for the group’s admins")}>
                <Button size="small" variant="secondary" onClick={() => setLeaving({ group, kind: "cancel" })}>
                  {t("Cancel request")}
                  <span className="sr-only"> {group.name}</span>
                </Button>
              </GroupRow>
            ))}
          </ul>
        ) : (
          <EmptyState icon="clock" title={t("No requests waiting")}>
            {t("When you ask to join a private group, your request waits here until its admins decide.")}
          </EmptyState>
        )}
      </TabPanel>

      {leaving && (
        <ConfirmDialog
          title={leaving.kind === "ignore" ? t("Ignore the invitation to {name}?", { name: leaving.group.name }) : t("Cancel your request to join {name}?", { name: leaving.group.name })}
          confirmLabel={leaving.kind === "ignore" ? t("Ignore") : t("Cancel request")}
          onClose={() => setLeaving(null)}
          onConfirm={async () => {
            await leaveGroup(leaving.group.slug);
            moved(leaving.group, "none");
            toast.success(leaving.kind === "ignore" ? t("Invitation ignored") : t("Request cancelled"));
          }}
        >
          {leaving.kind === "ignore" ? t("The group isn’t told. You can still find it and ask to join later.") : t("You can ask again later.")}
        </ConfirmDialog>
      )}
    </Tabs>
  );
}

/** A group in a list (invitations, requests): logo, name, Public/Private, members and actions. */
function GroupRow({ group, note, children }: { group: GroupSummary; note?: string; children: ReactNode }) {
  const t = useT();
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5 max-sm:px-4">
      <GroupLogo name={group.name} src={group.logoUrl} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Link href={groupHref(group.slug)} className="truncate text-sm font-medium text-ink hover:underline">
            {group.name}
          </Link>
          <VisibilityChip visibility={group.visibility} />
        </span>
        <span className="truncate text-xs text-secondary">
          {t("{count} members", { count: group.memberCount })}
          {note ? ` · ${note}` : ""}
        </span>
      </div>
      <div className="flex gap-2 max-sm:w-full max-sm:justify-end">{children}</div>
    </li>
  );
}
