"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import type { BulkResult, GroupDetail, GroupMemberAction, GroupMemberView, GroupMembersBulkInput, Page, PostView } from "@chartermission/contracts";
import { Button, Icon, Panel, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { inputClasses } from "@/components/auth/fields";
import { NoteDialog } from "@/components/chapters/chapter-moderation";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { Dialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { Menu, type MenuItem } from "@/components/social/menu";
import { PostCard } from "@/components/social/post-card";
import { announcePostCreated } from "@/components/social/post-events";
import { TimeAgo } from "@/components/social/post-parts";
import { EmptyState } from "@/components/social/skeletons";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";
import { ApiError, api } from "@/lib/api/client";
import type { CountryGroup } from "@/lib/taxonomies";
import { GroupForm } from "./group-form";
import { GroupMemberRow, useGroupMembers } from "./group-members";
import { groupPostAction } from "./group-posts";

type Section = "requests" | "posts" | "members" | "invitations" | "settings";

/** POST /groups/{slug}/members/{memberId}. */
function memberAction(slug: string, memberId: string, input: GroupMemberAction) {
  return api(`/groups/${slug}/members/${memberId}`, { method: "POST", body: input });
}

/** POST /groups/{slug}/members/bulk → what was done and what wasn't, per person. */
function bulkAction(slug: string, input: GroupMembersBulkInput) {
  return api<BulkResult>(`/groups/${slug}/members/bulk`, { method: "POST", body: input });
}

/**
 * Manage tab, for the group's moderators and admins: join requests, posts waiting for approval,
 * members (roles, removing, banning, handing over ownership), invitations sent and settings.
 */
export function GroupManage({ group, viewer, countries }: { group: GroupDetail; viewer: Viewer; countries: CountryGroup[] }) {
  const t = useT();
  const { abilities, pending } = group;
  const sections: { value: Section; label: string }[] = [
    ...(abilities.moderate
      ? [
          { value: "requests" as const, label: pending?.requests ? t("Requests ({count})", { count: pending.requests }) : t("Requests") },
          { value: "posts" as const, label: pending?.posts ? t("Posts waiting ({count})", { count: pending.posts }) : t("Posts waiting") },
        ]
      : []),
    ...(abilities.manage ? [{ value: "members" as const, label: t("Members") }] : []),
    ...(abilities.moderate ? [{ value: "invitations" as const, label: t("Invitations sent") }] : []),
    ...(abilities.manage ? [{ value: "settings" as const, label: t("Settings") }] : []),
  ];
  const [section, setSection] = useState<Section>(() => (!pending?.requests && pending?.posts ? "posts" : (sections[0]?.value ?? "settings")));

  return (
    <div className="flex flex-col gap-4">
      <h2 className="sr-only">{t("Manage the group")}</h2>
      <div className="-mx-1 overflow-x-auto px-1">
        <SegmentedControl label={t("Manage the group")} items={sections} value={section} onChange={setSection} />
      </div>
      {section === "requests" && <ManageRequests group={group} />}
      {section === "posts" && <ManagePosts group={group} viewer={viewer} />}
      {section === "members" && <ManageMembers group={group} viewer={viewer} />}
      {section === "invitations" && <ManageInvitations group={group} viewer={viewer} />}
      {section === "settings" && <ManageSettings group={group} countries={countries} />}
    </div>
  );
}

/** Reports a bulk result: how many were done, and who couldn't be, by name. */
function reportBulk(t: ReturnType<typeof useT>, result: BulkResult, names: Map<string, string>, done: string) {
  if (result.done.length) toast.success(t(done, { count: result.done.length }));
  if (result.failed.length) {
    const who = result.failed.map((f) => names.get(f.id) ?? f.id).join(", ");
    toast.error(new ApiError(422, "UNKNOWN", t("Couldn’t change: {names}. {reason}", { names: who, reason: result.failed[0]?.error ?? "" })));
  }
}

/* ------------------------------ Join requests ------------------------------ */

function ManageRequests({ group }: { group: GroupDetail }) {
  const t = useT();
  const router = useRouter();
  const list = useGroupMembers(group.slug, "pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const ids = list.items.map((v) => v.member.id);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));

  const drop = (gone: string[]) => {
    list.setItems((items) => items.filter((v) => !gone.includes(v.member.id)));
    setSelected((current) => new Set([...current].filter((id) => !gone.includes(id))));
  };

  async function decide(view: GroupMemberView, action: "approve" | "decline") {
    if (busy) return;
    setBusy(view.member.id);
    try {
      await memberAction(group.slug, view.member.id, { action });
      drop([view.member.id]);
      toast.success(action === "approve" ? t("{name} is now a member", { name: view.member.name }) : t("Request declined"));
      router.refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  async function decideAll(action: "approve" | "decline") {
    if (busy || !selected.size) return;
    setBusy("bulk");
    try {
      const result = await bulkAction(group.slug, { ids: [...selected], action });
      drop(result.done);
      reportBulk(t, result, new Map(list.items.map((v) => [v.member.id, v.member.name])), action === "approve" ? "{count} people approved" : "{count} requests declined");
      router.refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  if (list.error && !list.items.length) return <ErrorNotice error={list.error} onRetry={list.reload} />;
  if (!list.items.length) {
    return list.loading ? (
      <ListLoading />
    ) : (
      <EmptyState icon="check" title={t("No one is waiting to join")}>
        {group.visibility === "private" ? t("When people ask to join, their requests and answers appear here.") : t("Public groups don’t need requests: people join at once.")}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface px-3 py-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(ids))}
            className="size-4 accent-primary"
          />
          {selected.size ? t("{count} selected", { count: selected.size }) : t("Select all")}
        </label>
        <div className="flex gap-2">
          <Button size="small" onClick={() => decideAll("approve")} aria-disabled={!selected.size || busy !== null}>
            <Icon name="check" size={16} />
            {t("Approve selected")}
          </Button>
          <Button size="small" variant="secondary" onClick={() => decideAll("decline")} aria-disabled={!selected.size || busy !== null}>
            {t("Decline selected")}
          </Button>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
        {list.items.map((view) => (
          <GroupMemberRow
            key={view.member.id}
            view={view}
            below={
              view.requestAnswer ? (
                <blockquote className="ms-20 rounded-lg bg-surface px-3 py-2 text-sm text-body max-sm:ms-0">
                  {group.joinQuestion && (
                    <span className="mb-0.5 block text-xs text-secondary" dir="auto">
                      <NoTranslate>{group.joinQuestion}</NoTranslate>
                    </span>
                  )}
                  <span dir="auto" className="whitespace-pre-line">
                    <NoTranslate>{view.requestAnswer}</NoTranslate>
                  </span>
                </blockquote>
              ) : undefined
            }
            extra={
              <input
                type="checkbox"
                checked={selected.has(view.member.id)}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(view.member.id)) next.delete(view.member.id);
                    else next.add(view.member.id);
                    return next;
                  })
                }
                aria-label={t("Select {name}", { name: view.member.name })}
                className="size-4 shrink-0 accent-primary"
              />
            }
          >
            <span className="text-xs text-secondary">
              {t("Asked")} <TimeAgo iso={view.since} />
            </span>
            <Button size="small" onClick={() => decide(view, "approve")} aria-disabled={busy !== null}>
              {t("Approve")}
              <span className="sr-only"> {view.member.name}</span>
            </Button>
            <Button size="small" variant="secondary" onClick={() => decide(view, "decline")} aria-disabled={busy !== null}>
              {t("Decline")}
              <span className="sr-only"> {view.member.name}</span>
            </Button>
          </GroupMemberRow>
        ))}
      </ul>
      <MoreButton list={list} />
    </div>
  );
}

/* ------------------------------ Posts waiting ------------------------------ */

function ManagePosts({ group, viewer }: { group: GroupDetail; viewer: Viewer }) {
  const t = useT();
  const router = useRouter();
  const [items, setItems] = useState<PostView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<PostView | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    api<Page<PostView>>(`/groups/${group.slug}/posts/pending`).then(
      (page) => {
        if (!live) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setError(null);
      },
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [group.slug, tick]);

  async function more() {
    if (!cursor) return;
    try {
      const page = await api<Page<PostView>>(`/groups/${group.slug}/posts/pending`, { query: { cursor } });
      setItems((current) => [...(current ?? []), ...page.items.filter((p) => !current?.some((c) => c.id === p.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast.error(e);
    }
  }

  async function approve(post: PostView) {
    setBusy(post.id);
    try {
      await groupPostAction(group.slug, post.id, { action: "approve" });
      setItems((current) => current?.filter((p) => p.id !== post.id) ?? null);
      announcePostCreated({ ...post, status: "published", groupReview: null });
      toast.success(t("Approved. The post is now live in {group}.", { group: group.name }));
      router.refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  if (error && !items) return <ErrorNotice error={error} onRetry={() => setTick((n) => n + 1)} />;
  if (!items) return <ListLoading />;
  if (!items.length) {
    return (
      <EmptyState icon="check" title={t("No posts are waiting")}>
        {group.postApproval ? t("Members’ posts wait here until a moderator or admin approves them.") : t("Posts appear in the group straight away. Turn on “Approve posts first” in Settings to check them first.")}
      </EmptyState>
    );
  }
  return (
    <>
      <p className="text-sm text-secondary">{t("Only the group’s admins and moderators see these posts. Approve one to show it in the group, or decline it with a note for the author.")}</p>
      <ul className="flex flex-col gap-4">
        {items.map((post) => (
          <li key={post.id} className="flex flex-col gap-2">
            <PostCard post={post} viewer={viewer} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="small" onClick={() => approve(post)} aria-disabled={busy === post.id}>
                <Icon name="check" size={16} />
                {busy === post.id ? t("Approving…") : t("Approve")}
              </Button>
              <Button size="small" variant="secondary" onClick={() => setDeclining(post)} aria-disabled={busy === post.id}>
                {t("Decline")}
              </Button>
              <span className="text-xs text-secondary">
                {t("Posted")} <TimeAgo iso={post.createdAt} />
              </span>
            </div>
          </li>
        ))}
      </ul>
      {cursor && (
        <Button variant="secondary" className="self-center" onClick={more}>
          {t("Load more")}
        </Button>
      )}
      {declining && (
        <NoteDialog
          title={t("Decline this post?")}
          description={t("It won’t appear in {group}. {name} is told, and can still see the post themselves.", { group: group.name, name: declining.author.name })}
          label={t("Note for the author (optional)")}
          hint={t("Say what would make it right for the group.")}
          confirmLabel={t("Decline post")}
          danger
          maxLength={500}
          onConfirm={async (note) => {
            await groupPostAction(group.slug, declining.id, { action: "decline", note: note || undefined });
            setItems((current) => current?.filter((p) => p.id !== declining.id) ?? null);
            toast.success(t("Declined. The author has been told."));
            router.refresh();
          }}
          onClose={() => setDeclining(null)}
        />
      )}
    </>
  );
}

/* ------------------------------ Members ------------------------------ */

type MemberChange =
  | { kind: "role"; view: GroupMemberView; role: "admin" | "moderator" | "member" }
  | { kind: "remove" | "ban" | "unban" | "transfer"; view: GroupMemberView };

const RANK = { owner: 3, admin: 2, moderator: 1, member: 0 } as const;

function ManageMembers({ group, viewer }: { group: GroupDetail; viewer: Viewer }) {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState<"active" | "banned">("active");
  const list = useGroupMembers(group.slug, status);
  const [change, setChange] = useState<MemberChange | null>(null);
  // Page admins and chapter teams running the group act as its admins; staff likewise.
  const myRank = group.abilities.own ? RANK.owner : group.membership.role ? RANK[group.membership.role] : group.abilities.manage ? RANK.admin : 0;

  function items(view: GroupMemberView): MenuItem[] {
    const { member, role } = view;
    if (member.id === viewer.id) return [];
    if (status === "banned") return [{ label: t("Unban"), icon: "check", onSelect: () => setChange({ kind: "unban", view }) }];
    if (RANK[role] >= myRank) return [];
    const menu: MenuItem[] = [];
    if (group.abilities.own && role !== "admin") menu.push({ label: t("Make admin"), icon: "shield", onSelect: () => setChange({ kind: "role", view, role: "admin" }) });
    if (role !== "moderator") menu.push({ label: t("Make moderator"), icon: "shield", onSelect: () => setChange({ kind: "role", view, role: "moderator" }) });
    if (role !== "member") menu.push({ label: t("Make a regular member"), icon: "user", onSelect: () => setChange({ kind: "role", view, role: "member" }) });
    if (group.abilities.own) menu.push({ label: t("Make owner"), icon: "verified", onSelect: () => setChange({ kind: "transfer", view }) });
    menu.push(
      { label: t("Remove from group"), icon: "log-out", danger: true, onSelect: () => setChange({ kind: "remove", view }) },
      { label: t("Ban from group"), icon: "ban", danger: true, onSelect: () => setChange({ kind: "ban", view }) },
    );
    return menu;
  }

  async function apply(c: MemberChange) {
    const id = c.view.member.id;
    const name = c.view.member.name;
    if (c.kind === "role") {
      await memberAction(group.slug, id, { action: "set_role", role: c.role });
      list.setItems((all) => all.map((v) => (v.member.id === id ? { ...v, role: c.role } : v)));
      toast.success(t("{name} is now {role}", { name, role: t(c.role === "admin" ? "an admin" : c.role === "moderator" ? "a moderator" : "a regular member") }));
    } else if (c.kind === "transfer") {
      await memberAction(group.slug, id, { action: "transfer_ownership" });
      toast.success(t("{name} now owns the group. You’re still an admin.", { name }));
      router.refresh();
      list.reload();
    } else {
      await memberAction(group.slug, id, { action: c.kind });
      list.setItems((all) => all.filter((v) => v.member.id !== id));
      toast.success(c.kind === "remove" ? t("{name} was removed from the group", { name }) : c.kind === "ban" ? t("{name} was banned from the group", { name }) : t("{name} can join again", { name }));
      router.refresh();
    }
  }

  const confirmText = (c: MemberChange) => {
    const name = c.view.member.name;
    switch (c.kind) {
      case "role":
        return {
          title:
            c.role === "admin"
              ? t("Make {name} an admin?", { name })
              : c.role === "moderator"
                ? t("Make {name} a moderator?", { name })
                : t("Make {name} a regular member?", { name }),
          body:
            c.role === "admin"
              ? t("Admins manage members, roles and the group’s settings, as well as approving requests and posts.")
              : c.role === "moderator"
                ? t("Moderators approve join requests and posts, and can remove posts from the group.")
                : t("They lose their admin or moderator tools but stay in the group."),
          label: t("Change role"),
          danger: false,
        };
      case "transfer":
        return {
          title: t("Make {name} the owner?", { name }),
          body: t("They will be able to delete the group and hand it on. You stay on as an admin, and can’t undo this yourself."),
          label: t("Make owner"),
          danger: false,
        };
      case "remove":
        return {
          title: t("Remove {name} from the group?", { name }),
          body:
            group.visibility === "private"
              ? t("They stop seeing the group’s posts. They can ask to join again.")
              : t("They leave the group, and can join again at any time. Ban them to stop that."),
          label: t("Remove"),
          danger: true,
        };
      case "ban":
        return {
          title: t("Ban {name} from the group?", { name }),
          body: t("They are removed and can’t join, ask to join or be invited again until an admin unbans them. They aren’t told who did it."),
          label: t("Ban"),
          danger: true,
        };
      case "unban":
        return {
          title: t("Unban {name}?", { name }),
          body: group.visibility === "private" ? t("They will be able to ask to join again.") : t("They will be able to join again."),
          label: t("Unban"),
          danger: false,
        };
    }
  };

  const confirm = change ? confirmText(change) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          size="small"
          label={t("Which members")}
          items={[
            { value: "active", label: t("Members") },
            { value: "banned", label: t("Banned") },
          ]}
          value={status}
          onChange={setStatus}
        />
        <label className="relative w-full sm:w-72">
          <span className="sr-only">{t("Search members by name")}</span>
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto h-fit text-secondary" />
          <input
            type="search"
            value={list.query}
            onChange={(event) => list.setQuery(event.target.value)}
            placeholder={t("Search members by name")}
            className={inputClasses(false, "h-10 ps-9")}
          />
        </label>
      </div>
      {list.error ? <ErrorNotice error={list.error} onRetry={list.reload} /> : null}
      {!list.items.length ? (
        list.loading ? (
          <ListLoading />
        ) : (
          <EmptyState icon="users" title={status === "banned" ? t("No one is banned") : t("No members match your search")}>
            {status === "banned" ? t("People you ban from the group are listed here, so you can let them back in.") : t("Try another name.")}
          </EmptyState>
        )
      ) : (
        <ul aria-busy={list.loading} className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
          {list.items.map((view) => {
            const menu = items(view);
            return (
              <GroupMemberRow key={view.member.id} view={view}>
                {view.status === "banned" ? (
                  <span className="text-xs text-secondary">
                    {t("Banned")} <TimeAgo iso={view.since} />
                  </span>
                ) : view.joinedAt ? (
                  <span className="text-xs text-secondary">
                    {t("Joined")} <TimeAgo iso={view.joinedAt} />
                  </span>
                ) : null}
                {menu.length > 0 && <Menu label={t("Actions for {name}", { name: view.member.name })} items={menu} />}
              </GroupMemberRow>
            );
          })}
        </ul>
      )}
      <MoreButton list={list} />
      {change && confirm && (
        <ConfirmDialog title={confirm.title} confirmLabel={confirm.label} danger={confirm.danger} onClose={() => setChange(null)} onConfirm={() => apply(change)}>
          {confirm.body}
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ------------------------------ Invitations sent ------------------------------ */

function ManageInvitations({ group, viewer }: { group: GroupDetail; viewer: Viewer }) {
  const t = useT();
  const list = useGroupMembers(group.slug, "invited");
  const [cancelling, setCancelling] = useState<GroupMemberView | null>(null);

  if (list.error && !list.items.length) return <ErrorNotice error={list.error} onRetry={list.reload} />;
  if (!list.items.length) {
    return list.loading ? (
      <ListLoading />
    ) : (
      <EmptyState icon="user-plus" title={t("No invitations waiting")}>
        {t("People invited to the group appear here until they accept or ignore it.")}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
        {list.items.map((view) => (
          <GroupMemberRow key={view.member.id} view={view}>
            <span className="text-xs text-secondary">
              {view.invitedBy ? (view.invitedBy.id === viewer.id ? t("Invited by you") : t("Invited by {name}", { name: view.invitedBy.name })) : t("Invited")}{" "}
              <TimeAgo iso={view.since} />
            </span>
            <Button size="small" variant="secondary" onClick={() => setCancelling(view)}>
              {t("Cancel invitation")}
              <span className="sr-only"> {view.member.name}</span>
            </Button>
          </GroupMemberRow>
        ))}
      </ul>
      <MoreButton list={list} />
      {cancelling && (
        <ConfirmDialog
          title={t("Cancel the invitation to {name}?", { name: cancelling.member.name })}
          confirmLabel={t("Cancel invitation")}
          onClose={() => setCancelling(null)}
          onConfirm={async () => {
            await memberAction(group.slug, cancelling.member.id, { action: "cancel_invite" });
            list.setItems((all) => all.filter((v) => v.member.id !== cancelling.member.id));
            toast.success(t("Invitation cancelled"));
          }}
        >
          {t("The invitation disappears from their list. You can invite them again later.")}
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ------------------------------ Settings ------------------------------ */

function ManageSettings({ group, countries }: { group: GroupDetail; countries: CountryGroup[] }) {
  const t = useT();
  const router = useRouter();
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const archived = group.status === "archived";

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-4 p-5 max-sm:p-4">
        <h3 className="text-h3 text-ink">{t("Group settings")}</h3>
        <GroupForm group={group} countries={countries} />
      </Panel>

      {group.abilities.own && (
        <Panel className="flex flex-col gap-3 p-5 max-sm:p-4">
          <h3 className="text-h3 text-ink">{t("Archive or delete")}</h3>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-ink">
              {archived ? (
                <>
                  <span className="font-medium">{t("This group is archived.")}</span> {t("Bring it back to let members join, post and comment again.")}
                </>
              ) : (
                <>
                  <span className="font-medium">{t("Archive the group.")}</span> {t("It stays listed and readable, but no one can join, post, comment or react.")}
                </>
              )}
            </p>
            <Button variant="secondary" size="small" onClick={() => setArchiving(true)}>
              <Icon name="archive" size={16} />
              {archived ? t("Bring back") : t("Archive")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-light px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-ink">
              <span className="font-medium">{t("Delete the group.")}</span> {t("Its posts disappear everywhere and its members lose access. This can’t be undone.")}
            </p>
            <Button variant="secondary" size="small" onClick={() => setDeleting(true)}>
              <Icon name="trash" size={16} />
              {t("Delete group")}
            </Button>
          </div>
        </Panel>
      )}

      {archiving && (
        <ConfirmDialog
          title={archived ? t("Bring {name} back?", { name: group.name }) : t("Archive {name}?", { name: group.name })}
          confirmLabel={archived ? t("Bring back") : t("Archive")}
          onClose={() => setArchiving(false)}
          onConfirm={async () => {
            await api(`/groups/${group.slug}`, { method: "PATCH", body: { archived: !archived } });
            toast.success(archived ? t("The group is open again") : t("The group is archived"));
            router.refresh();
          }}
        >
          {archived
            ? t("Members can post, comment and react again, and new people can join.")
            : t("Everything stays readable for the people who can see it now. You can bring it back at any time.")}
        </ConfirmDialog>
      )}
      {deleting && <DeleteGroupDialog group={group} onClose={() => setDeleting(false)} />}
    </div>
  );
}

/** Deleting asks for the group's name, typed out, so it can't happen by accident. */
function DeleteGroupDialog({ group, onClose }: { group: GroupDetail; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const matches = typed.trim() === group.name.trim();

  async function remove() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/groups/${group.slug}`, { method: "DELETE" });
      toast.success(t("{name} was deleted", { name: group.name }));
      router.push("/groups");
      router.refresh();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("Delete {name}?", { name: group.name })}
      description={t("The group and all its posts disappear for everyone, and its members lose access. This can’t be undone.")}
      onClose={onClose}
      width={480}
      initialFocus="input"
      footer={
        <>
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={onClose}>
            {t("Cancel")}
          </button>
          <Button onClick={remove} aria-disabled={!matches || busy} className={cn("bg-error hover:bg-error/90", (!matches || busy) && "opacity-60")}>
            {busy ? t("Deleting…") : t("Delete group")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-sm font-medium text-ink">
          {t("Type the group’s name to confirm")}
        </label>
        <p className="text-sm text-secondary" dir="auto">
          <NoTranslate>{group.name}</NoTranslate>
        </p>
        <input id={`${id}-name`} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" dir="auto" className={inputClasses(false)} />
        {error ? <ErrorNotice error={error} /> : null}
      </div>
    </Dialog>
  );
}

/* ------------------------------ Shared bits ------------------------------ */

function ListLoading() {
  const t = useT();
  return (
    <Panel aria-busy="true" className="h-32 animate-pulse">
      <span className="sr-only">{t("Loading…")}</span>
    </Panel>
  );
}

function MoreButton({ list }: { list: ReturnType<typeof useGroupMembers> }) {
  const t = useT();
  if (!list.cursor) return null;
  return (
    <Button variant="secondary" className="self-center" onClick={list.more} aria-disabled={list.loading}>
      {list.loading ? t("Loading…") : t("Show more")}
    </Button>
  );
}
