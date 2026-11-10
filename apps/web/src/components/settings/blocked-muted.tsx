"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { BlockView, MemberRef, MuteView } from "@chartermission/contracts";
import { Avatar, Button, Icon, chipClasses } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { formatDate } from "@/components/account/format";
import { SettingsCard } from "./settings-card";
import { useT } from "@/i18n/client";

function MemberRow({ member, meta, action }: { member: MemberRef; meta: string; action: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-3.5">
      <Avatar name={member.name} src={member.avatarUrl ?? undefined} tone={member.tone} size={40} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link href={`/${member.handle}`} className="truncate text-sm font-medium text-ink hover:underline">
          {member.name}
        </Link>
        <span className="truncate text-xs text-secondary">{meta}</span>
      </div>
      {action}
    </li>
  );
}

/** Blocked members (GET /me/blocks, DELETE /blocks/{id}). */
export function BlockedList({ initial }: { initial: BlockView[] }) {
  const t = useT();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function unblock(block: BlockView) {
    setBusy(block.member.id);
    setStatus(null);
    try {
      await api(`/blocks/${block.member.id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((item) => item.member.id !== block.member.id));
      setStatus({
        tone: "success",
        text: t("You unblocked {name}. They can see your profile and contact you again.", { name: block.member.name }),
      });
    } catch (e) {
      setStatus({ tone: "error", text: isApiError(e) ? e.message : "Something went wrong. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsCard
      id="blocked"
      title="Blocked members"
      description="Blocked members can’t see your profile or posts, message you, connect or follow you. They aren’t told."
    >
      {items.length === 0 ? (
        <li className="flex items-center gap-3 py-5 text-sm text-secondary">
          <Icon name="shield" size={18} />
          You haven’t blocked anyone. You can block a member from their profile.
        </li>
      ) : (
        items.map((block) => (
          <MemberRow
            key={block.member.id}
            member={block.member}
            meta={t("Blocked {date}", { date: formatDate(block.createdAt) })}
            action={
              <Button variant="secondary" size="small" disabled={busy !== null} onClick={() => void unblock(block)}>
                {busy === block.member.id ? "Unblocking…" : "Unblock"}
                <span className="sr-only"> {block.member.name}</span>
              </Button>
            }
          />
        ))
      )}
      <li aria-live="polite" className="empty:hidden">
        {status && (
          <p className={status.tone === "error" ? "py-3 text-sm text-error" : "py-3 text-sm text-success"}>{status.text}</p>
        )}
      </li>
    </SettingsCard>
  );
}

/** Muted members and hashtags (GET /me/mutes, DELETE /mutes). */
export function MutedList({ initial }: { initial: MuteView[] }) {
  const t = useT();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const members = items.filter((mute) => mute.targetType === "member");
  const tags = items.filter((mute) => mute.targetType === "hashtag");

  async function unmute(mute: MuteView) {
    const key = `${mute.targetType}:${mute.targetId}`;
    const label = mute.member?.name ?? `#${mute.targetId}`;
    setBusy(key);
    setStatus(null);
    try {
      await api("/mutes", { method: "DELETE", body: { targetType: mute.targetType, targetId: mute.targetId } });
      setItems((prev) => prev.filter((item) => `${item.targetType}:${item.targetId}` !== key));
      setStatus({ tone: "success", text: t("You unmuted {label}.", { label }) });
    } catch (e) {
      setStatus({ tone: "error", text: isApiError(e) ? e.message : "Something went wrong. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsCard id="muted" title="Muted" description="Muted members and hashtags are hidden from your feed. Nobody is told.">
      {items.length === 0 && (
        <li className="flex items-center gap-3 py-5 text-sm text-secondary">
          <Icon name="eye-off" size={18} />
          You haven’t muted anyone or any hashtag. Use the menu on a post to mute.
        </li>
      )}
      {members.map((mute) =>
        mute.member ? (
          <MemberRow
            key={mute.targetId}
            member={mute.member}
            meta={t("Muted {date}", { date: formatDate(mute.createdAt) })}
            action={
              <Button variant="secondary" size="small" disabled={busy !== null} onClick={() => void unmute(mute)}>
                {busy === `member:${mute.targetId}` ? "Unmuting…" : "Unmute"}
                <span className="sr-only"> {mute.member.name}</span>
              </Button>
            }
          />
        ) : null,
      )}
      {tags.length > 0 && (
        <li className="flex flex-col gap-2 py-3.5">
          <span className="text-sm font-medium text-ink">Hashtags</span>
          <ul className="flex flex-wrap gap-2">
            {tags.map((mute) => (
              <li key={mute.targetId} className={chipClasses("neutral", "gap-1 pe-1.5")}>
                #{mute.targetId}
                <button
                  type="button"
                  onClick={() => void unmute(mute)}
                  disabled={busy !== null}
                  aria-label={t("Unmute #{targetId}", { targetId: mute.targetId })}
                  className="rounded-full p-0.5 hover:bg-line focus-visible:outline-2 focus-visible:outline-primary-light"
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </li>
      )}
      <li aria-live="polite" className="empty:hidden">
        {status && (
          <p className={status.tone === "error" ? "py-3 text-sm text-error" : "py-3 text-sm text-success"}>{status.text}</p>
        )}
      </li>
    </SettingsCard>
  );
}
