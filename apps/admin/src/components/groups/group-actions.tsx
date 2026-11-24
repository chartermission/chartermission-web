"use client";

import { useEffect, useState } from "react";
import type { AdminGroupAction, AdminGroupMember, AdminGroupRow, GroupStatus, Page } from "@chartermission/contracts";
import { Avatar, cn, type ChipTone } from "@chartermission/ui";
import { FormModal } from "@/components/ambassadors/modal";
import { inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { useT } from "@/i18n/client";

export const GROUP_STATUS: Record<GroupStatus | "deleted", { label: string; tone: ChipTone }> = {
  active: { label: "Active", tone: "success" },
  suspended: { label: "Suspended", tone: "error" },
  archived: { label: "Archived", tone: "neutral" },
  deleted: { label: "Deleted", tone: "error" },
};

/** What staff can do to a group, as the row menus and the group page offer it. */
export type GroupActionKind = AdminGroupAction["action"];

type Target = Pick<AdminGroupRow, "id" | "name" | "status" | "featured" | "ownerType" | "memberCount" | "postCount" | "owner">;

/** The actions that make sense for a group right now (the API checks again). */
export function groupActions(group: Target): GroupActionKind[] {
  if (group.status === "deleted") return ["restore"];
  const kinds: GroupActionKind[] = [];
  if (group.status === "active") kinds.push(group.featured ? "unfeature" : "feature");
  if (group.status === "suspended") kinds.push("restore");
  else kinds.push("suspend");
  if (group.ownerType === "member") kinds.push("set_owner");
  kinds.push("delete");
  return kinds;
}

export const GROUP_ACTION_LABEL: Record<GroupActionKind, string> = {
  feature: "Feature",
  unfeature: "Stop featuring",
  suspend: "Suspend…",
  restore: "Restore",
  delete: "Delete…",
  set_owner: "Change owner…",
};

/**
 * Runs staff actions on one group: feature, unfeature and restore straight away; suspend and delete
 * through a confirmation (suspend needs a note for the group's admins); change owner through a
 * member picker. Render `dialogs` once; call `start(group, kind)` from buttons and menus.
 */
export function useGroupActions(onDone: (row: AdminGroupRow) => void) {
  const t = useT();
  const [pending, setPending] = useState<{ group: Target; kind: "suspend" | "delete" | "set_owner" } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function send(group: Target, body: AdminGroupAction) {
    const row = await api<AdminGroupRow>(`/admin/groups/${group.id}`, { method: "POST", body });
    onDone(row);
    const done: Record<GroupActionKind, string> = {
      feature: "{name} is featured. Members see it first among suggested groups.",
      unfeature: "{name} is no longer featured.",
      suspend: "{name} is suspended. Its admins have been told.",
      restore: "{name} is back.",
      delete: "{name} is deleted. Its admins have been told.",
      set_owner: "{name} has a new owner.",
    };
    toast(t(done[body.action], { name: group.name }));
  }

  async function start(group: Target, kind: GroupActionKind) {
    if (kind === "suspend" || kind === "delete" || kind === "set_owner") {
      setPending({ group, kind });
      return;
    }
    setBusyId(group.id);
    try {
      await send(group, { action: kind });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusyId(null);
    }
  }

  const dialogs = pending ? (
    pending.kind === "set_owner" ? (
      <ChangeOwnerDialog
        group={pending.group}
        onClose={() => setPending(null)}
        onPick={async (memberId) => {
          await send(pending.group, { action: "set_owner", memberId });
          setPending(null);
        }}
      />
    ) : pending.kind === "suspend" ? (
      <ReasonDialog
        title={t("Suspend {name}?", { name: pending.group.name })}
        description="Members can’t open the group or see its posts, in the group or in their feeds. Its admins still can, and they see your note. You can restore it later."
        confirmLabel="Suspend group"
        tone="danger"
        reasonLabel="Note to the group’s admins"
        reasonPlaceholder="Why the group was suspended"
        reasonHint="Shown to the group’s admins and recorded in the audit log."
        requiredMessage="Add a note so the group’s admins know why."
        minReasonLength={3}
        onClose={() => setPending(null)}
        onConfirm={async (note) => {
          await send(pending.group, { action: "suspend", note });
          setPending(null);
        }}
      />
    ) : (
      <ReasonDialog
        title={t("Delete {name}?", { name: pending.group.name })}
        description={t(
          "The group and its {count} posts disappear for everyone, and its admins are told. Staff can still restore it from the Deleted tab. To hide it for a while instead, suspend it.",
          { count: pending.group.postCount },
        )}
        confirmLabel="Delete group"
        tone="danger"
        reasonField="optional"
        reasonLabel="Note to the group’s admins"
        reasonPlaceholder="Why the group was deleted"
        reasonHint="Shown to the group’s admins and recorded in the audit log."
        minReasonLength={3}
        onClose={() => setPending(null)}
        onConfirm={async (note) => {
          await send(pending.group, { action: "delete", note: note || undefined });
          setPending(null);
        }}
      />
    )
  ) : null;

  return { start, dialogs, busyId };
}

/** Pick the new owner among the group's active members (the old owner stays on as an admin). */
function ChangeOwnerDialog({ group, onPick, onClose }: { group: Target; onPick: (memberId: string) => Promise<void>; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<AdminGroupMember[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<Page<AdminGroupMember>>(`/admin/groups/${group.id}/members`, { query: { status: "active", q: q.trim() || undefined, limit: 20 }, signal: controller.signal }).then(
        (page) => setPeople(page.items.filter((m) => m.role !== "owner")),
        (e: unknown) => {
          if (!controller.signal.aborted) setError(errorMessage(e));
        },
      );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [group.id, q]);

  return (
    <FormModal
      title={t("Change the owner of {name}", { name: group.name })}
      description={
        group.owner
          ? t("Pick one of the group’s members. {owner} stays on as an admin. Both are told.", { owner: group.owner.name })
          : "Pick one of the group’s members. They are told."
      }
      submitLabel="Make owner"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        if (!picked) {
          setError(t("Pick a member first."));
          return;
        }
        setBusy(true);
        setError(null);
        try {
          await onPick(picked);
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-ink">Find a member</span>
        <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t("Name, @handle or email")} className={inputClasses()} />
      </label>
      <div role="radiogroup" aria-label={t("Members of the group")} className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-line">
        {people === null ? (
          <p className="px-3 py-4 text-sm text-secondary">Loading…</p>
        ) : people.length === 0 ? (
          <p className="px-3 py-4 text-sm text-secondary">No active members match.</p>
        ) : (
          people.map((m) => (
            <label key={m.member.id} className={cn("flex cursor-pointer items-center gap-3 border-t border-line px-3 py-2 first:border-t-0", picked === m.member.id && "bg-primary-tint-2")}>
              <input type="radio" name="owner" value={m.member.id} checked={picked === m.member.id} onChange={() => setPicked(m.member.id)} className="size-4 accent-[var(--color-primary)]" />
              <Avatar name={m.member.name} size={32} tone={m.member.tone} src={m.member.avatarUrl ?? undefined} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-ink" dir="auto">
                  {m.member.name}
                </span>
                <span className="truncate text-xs text-secondary">
                  @{m.member.handle} · {t(ROLE_LABEL[m.role])}
                </span>
              </span>
            </label>
          ))
        )}
      </div>
    </FormModal>
  );
}

export const ROLE_LABEL: Record<AdminGroupMember["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  moderator: "Moderator",
  member: "Member",
};

export const MEMBER_STATUS_LABEL: Record<AdminGroupMember["status"], string> = {
  active: "Member",
  pending: "Asked to join",
  invited: "Invited",
  banned: "Banned",
};
