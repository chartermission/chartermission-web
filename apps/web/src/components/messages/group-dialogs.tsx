"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  GROUP_TITLE_MAX,
  type ConversationView,
  type DirectoryMember,
  type MemberRef,
  type Page,
  type PeoplePage,
} from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { Dialog, closeDialog } from "@/components/social/dialog";
import { ErrorNotice } from "@/components/social/errors";
import { memberHref } from "@/components/social/links";
import { Menu } from "@/components/social/menu";
import { MemberAvatar } from "@/components/social/post-parts";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { announceMessagesChanged } from "./messages-events";

/** The viewer's connections (up to 200), loaded once per dialog. */
function useConnections(viewerHandle: string) {
  const [people, setPeople] = useState<MemberRef[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const all: MemberRef[] = [];
        let cursor: string | null | undefined;
        for (let i = 0; i < 4; i += 1) {
          const page: PeoplePage = await api<PeoplePage>(`/members/${viewerHandle}/connections`, { query: { limit: 50, cursor: cursor ?? undefined } });
          all.push(...page.items.filter((p) => !p.official));
          cursor = page.nextCursor;
          if (!cursor) break;
        }
        if (live) setPeople(all);
      } catch (e) {
        if (live) setError(e);
      }
    })();
    return () => {
      live = false;
    };
  }, [viewerHandle]);
  return { people, error };
}

/** Other members matching a search (2+ characters), for message requests. */
function useMemberSearch(query: string, exclude: Set<string>) {
  const [found, setFound] = useState<DirectoryMember[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = window.setTimeout(() => {
      api<Page<DirectoryMember>>("/members", { query: { q, limit: 10 } })
        .then((page) => live && setFound(page.items.filter((m) => !m.official && !exclude.has(m.id))))
        .catch(() => live && setFound([]));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, exclude]);
  return query.trim().length < 2 ? [] : found;
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-10 items-center gap-2.5 rounded-lg bg-muted px-3.5 text-secondary focus-within:ring-2 focus-within:ring-primary-light">
      <Icon name="search" size={16} />
      <span className="sr-only">{placeholder}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-disabled" />
    </label>
  );
}

function PersonRow({ person, note, onClick, selected, disabled }: { person: MemberRef; note?: string; onClick: () => void; selected?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected === undefined ? undefined : selected}
      className="flex w-full items-center gap-3 px-5 py-2.5 text-start hover:bg-muted disabled:opacity-60"
    >
      <MemberAvatar member={person} size={40} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-ink">{person.name}</span>
        <span className="truncate text-xs text-secondary">{note ?? person.headline ?? `@${person.handle}`}</span>
      </span>
      {selected !== undefined && (
        <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-primary bg-primary text-inverse" : "border-line")}>
          {selected && <Icon name="check" size={12} />}
        </span>
      )}
    </button>
  );
}

/**
 * New message: pick a connection (straight into the chat), any other member (a message request),
 * or switch to "New group" and pick several connections.
 */
export function NewMessageDialog({ viewerHandle, onClose }: { viewerHandle: string; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const { people, error } = useConnections(viewerHandle);
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<MemberRef[]>([]);
  const [title, setTitle] = useState("");
  const [groupError, setGroupError] = useState<unknown>(null);
  const connected = useMemo(() => new Set((people ?? []).map((p) => p.id)), [people]);
  const others = useMemberSearch(mode === "direct" ? query : "", connected);

  const q = query.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.handle.includes(q));

  async function open(memberId: string, from: HTMLElement) {
    setBusy(true);
    try {
      const conversation = await api<ConversationView>("/messages/conversations", { method: "POST", body: { memberId } });
      announceMessagesChanged();
      closeDialog(from);
      router.push(`/messages/${conversation.id}`);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  }

  async function createGroup(from: HTMLElement) {
    setBusy(true);
    setGroupError(null);
    try {
      const conversation = await api<ConversationView>("/messages/groups", { method: "POST", body: { title: title.trim(), memberIds: picked.map((p) => p.id) } });
      announceMessagesChanged();
      closeDialog(from);
      router.push(`/messages/${conversation.id}`);
    } catch (e) {
      setGroupError(e);
      setBusy(false);
    }
  }

  const toggle = (person: MemberRef) => setPicked((current) => (current.some((p) => p.id === person.id) ? current.filter((p) => p.id !== person.id) : [...current, person]));

  return (
    <Dialog
      title={mode === "group" ? t("New group") : t("New message")}
      description={mode === "group" ? t("Pick the connections to add. You can add more later.") : t("Message a connection, or send a request to any member.")}
      onClose={onClose}
      width={480}
      flush
      footer={
        mode === "group" ? (
          <div className="flex w-full flex-col gap-3">
            {groupError ? <ErrorNotice error={groupError} /> : null}
            <div className="flex items-center justify-between gap-3">
              <Button variant="ghost" onClick={() => setMode("direct")}>
                {t("Back")}
              </Button>
              <Button disabled={busy || !title.trim() || !picked.length} onClick={(e) => void createGroup(e.currentTarget)}>
                {t("Create group ({count})", { count: picked.length })}
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 border-b border-line px-5 py-3">
        {mode === "group" && (
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t("Group name")}
            <input
              value={title}
              maxLength={GROUP_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("e.g. Lagos founders")}
              className="h-10 rounded-lg border border-line bg-card px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-primary-light"
            />
          </label>
        )}
        <SearchField value={query} onChange={setQuery} placeholder={mode === "group" ? t("Search your connections") : t("Search members")} />
        {mode === "group" && picked.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("Selected")}>
            {picked.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => toggle(p)} className="flex items-center gap-1 rounded-full bg-primary-tint px-2.5 py-1 text-xs font-medium text-primary">
                  {p.name}
                  <Icon name="x" size={12} />
                  <span className="sr-only">{t("Remove")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="max-h-[360px] min-h-[160px] overflow-y-auto">
        {mode === "direct" && (
          <button type="button" onClick={() => setMode("group")} className="flex w-full items-center gap-3 border-b border-line px-5 py-3 text-start hover:bg-muted">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary-tint text-primary">
              <Icon name="users" size={18} />
            </span>
            <span className="text-sm font-medium text-ink">{t("New group")}</span>
          </button>
        )}
        {error ? (
          <div className="p-5">
            <ErrorNotice error={error} />
          </div>
        ) : !people ? (
          <p className="p-6 text-center text-sm text-secondary">{t("Loading…")}</p>
        ) : (
          <>
            {shown.length > 0 && (
              <>
                <h3 className="px-5 pt-3 pb-1 text-xs font-semibold text-secondary uppercase">{t("Connections")}</h3>
                <ul>
                  {shown.map((person) => (
                    <li key={person.id}>
                      {mode === "group" ? (
                        <PersonRow person={person} selected={picked.some((p) => p.id === person.id)} onClick={() => toggle(person)} />
                      ) : (
                        <PersonRow person={person} disabled={busy} onClick={() => void open(person.id, document.activeElement as HTMLElement)} />
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {mode === "direct" && others.length > 0 && (
              <>
                <h3 className="px-5 pt-3 pb-1 text-xs font-semibold text-secondary uppercase">{t("Other members")}</h3>
                <ul>
                  {others.map((person) => (
                    <li key={person.id}>
                      <PersonRow person={person} note={t("Sends a message request")} disabled={busy} onClick={() => void open(person.id, document.activeElement as HTMLElement)} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!shown.length && !(mode === "direct" && others.length) && (
              <p className="p-6 text-center text-sm text-secondary">
                {people.length || q
                  ? mode === "direct" && q.length < 2
                    ? t("Type a name to search all members.")
                    : t("No one matches that name.")
                  : t("You have no connections yet.")}{" "}
                {!people.length && !q && (
                  <Link href="/network" className="font-medium text-primary-light hover:underline">
                    {t("Find members")}
                  </Link>
                )}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** A group's name and members: admins rename it, add and remove people and make others admins. */
export function GroupInfoDialog({
  conversation,
  viewerId,
  viewerHandle,
  onClose,
  onChanged,
  onLeave,
}: {
  conversation: ConversationView;
  viewerId: string;
  viewerHandle?: string;
  onClose: () => void;
  onChanged: (next: ConversationView) => void;
  onLeave: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(conversation.title);
  const [adding, setAdding] = useState(false);
  const admin = conversation.canManage;
  const base = `/messages/groups/${conversation.id}`;

  async function run(action: () => Promise<ConversationView | void>) {
    try {
      const next = await action();
      onChanged(next ?? (await api<ConversationView>(`/messages/conversations/${conversation.id}`)));
      announceMessagesChanged();
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <Dialog title={t("Group info")} description={t("{count} members", { count: conversation.memberCount })} onClose={onClose} width={480} flush>
      {admin && (
        <form
          className="flex items-end gap-2 border-b border-line px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && title.trim() !== conversation.title) void run(() => api<ConversationView>(base, { method: "PATCH", body: { title: title.trim() } }));
          }}
        >
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-ink">
            {t("Group name")}
            <input value={title} maxLength={GROUP_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} className="h-10 rounded-lg border border-line bg-card px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-primary-light" />
          </label>
          <Button type="submit" variant="secondary" disabled={!title.trim() || title.trim() === conversation.title}>
            {t("Save")}
          </Button>
        </form>
      )}
      {admin && (
        <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center gap-3 border-b border-line px-5 py-3 text-start hover:bg-muted">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary-tint text-primary">
            <Icon name="user-plus" size={18} />
          </span>
          <span className="text-sm font-medium text-ink">{t("Add people")}</span>
        </button>
      )}
      <ul className="max-h-[360px] overflow-y-auto">
        {conversation.members.map((m) => {
          const isAdmin = conversation.admins.includes(m.id);
          return (
            <li key={m.id} className="flex items-center gap-3 px-5 py-2.5">
              <MemberAvatar member={m} size={40} link />
              <Link href={memberHref(m.handle)} className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-ink hover:underline">{m.name}</span>
                <span className="truncate text-xs text-secondary">{isAdmin ? t("Admin") : (m.headline ?? `@${m.handle}`)}</span>
              </Link>
              {admin && (
                <Menu
                  label={t("Options for {name}", { name: m.name })}
                  items={[
                    {
                      label: isAdmin ? t("Remove as admin") : t("Make admin"),
                      icon: "shield",
                      onSelect: () => void run(() => api<ConversationView>(`${base}/members/${m.id}/role`, { method: "PUT", body: { role: isAdmin ? "member" : "admin" } })),
                    },
                    {
                      label: t("Remove from group"),
                      icon: "x",
                      danger: true,
                      onSelect: () => void run(() => api(`${base}/members/${m.id}`, { method: "DELETE" }).then(() => undefined)),
                    },
                  ]}
                />
              )}
            </li>
          );
        })}
        {conversation.admins.includes(viewerId) && <li className="px-5 py-2 text-xs text-secondary">{t("You’re an admin of this group.")}</li>}
      </ul>
      {conversation.joined && (
        <div className="border-t border-line px-5 py-3">
          <Button variant="ghost" className="text-error" onClick={onLeave}>
            <Icon name="log-out" size={16} />
            {t("Leave group")}
          </Button>
        </div>
      )}
      {adding && viewerHandle && (
        <AddPeopleDialog
          viewerHandle={viewerHandle}
          exclude={new Set([viewerId, ...conversation.members.map((m) => m.id)])}
          onClose={() => setAdding(false)}
          onAdd={(ids) => run(() => api<ConversationView>(`${base}/members`, { method: "POST", body: { memberIds: ids } }))}
        />
      )}
    </Dialog>
  );
}

function AddPeopleDialog({ viewerHandle, exclude, onClose, onAdd }: { viewerHandle: string; exclude: Set<string>; onClose: () => void; onAdd: (ids: string[]) => Promise<void> }) {
  const t = useT();
  const { people, error } = useConnections(viewerHandle);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const q = query.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !exclude.has(p.id) && (!q || p.name.toLowerCase().includes(q)));
  return (
    <Dialog
      title={t("Add people")}
      onClose={onClose}
      width={440}
      flush
      footer={
        <Button
          disabled={!picked.length}
          onClick={(e) => {
            const from = e.currentTarget;
            void onAdd(picked).then(() => closeDialog(from));
          }}
        >
          {t("Add ({count})", { count: picked.length })}
        </Button>
      }
    >
      <div className="border-b border-line px-5 py-3">
        <SearchField value={query} onChange={setQuery} placeholder={t("Search your connections")} />
      </div>
      <div className="max-h-[320px] min-h-[140px] overflow-y-auto">
        {error ? (
          <div className="p-5">
            <ErrorNotice error={error} />
          </div>
        ) : !people ? (
          <p className="p-6 text-center text-sm text-secondary">{t("Loading…")}</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-sm text-secondary">{t("No one else to add.")}</p>
        ) : (
          <ul>
            {shown.map((p) => (
              <li key={p.id}>
                <PersonRow person={p} selected={picked.includes(p.id)} onClick={() => setPicked((c) => (c.includes(p.id) ? c.filter((x) => x !== p.id) : [...c, p.id]))} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
