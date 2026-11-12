"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ConversationView } from "@chartermission/contracts";
import { Button, Icon, Panel } from "@chartermission/ui";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";

/**
 * The chapter's conversations: its announcements (the team writes, members read and can turn them
 * off) and, for the team, a group chat with each other.
 */
export function ChapterChat({
  chapter,
  canManage,
  member,
  teamIds,
  viewerId,
}: {
  chapter: { slug: string; name: string };
  canManage: boolean;
  /** Following the chapter (a member of it). */
  member: boolean;
  teamIds: string[];
  viewerId: string;
}) {
  const t = useT();
  const router = useRouter();
  const [announcements, setAnnouncements] = useState<ConversationView | null>(null);
  const [busy, setBusy] = useState(false);
  const others = teamIds.filter((id) => id !== viewerId);

  useEffect(() => {
    if (!member && !canManage) return;
    api<ConversationView>(`/messages/announcements/${chapter.slug}`)
      .then(setAnnouncements)
      .catch(() => undefined);
  }, [chapter.slug, member, canManage]);

  if (!member && !canManage) return null;

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      setAnnouncements(await api<ConversationView>(`/messages/announcements/${chapter.slug}/subscription`, { method: "PUT", body: { on } }));
      toast.success(on ? t("You’ll get this chapter’s announcements") : t("Announcements turned off"));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function teamChat() {
    setBusy(true);
    try {
      const group = await api<ConversationView>("/messages/groups", {
        method: "POST",
        body: { title: t("{name} team", { name: chapter.name }).slice(0, 80), chapterSlug: chapter.slug, memberIds: others },
      });
      router.push(`/messages/${group.id}`);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  }

  return (
    <Panel aria-labelledby="chapter-chat-heading" className="flex flex-col gap-3 p-5">
      <h2 id="chapter-chat-heading" className="text-h3 text-ink">
        {t("Chapter messages")}
      </h2>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Icon name="megaphone" size={18} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium text-ink">{t("Announcements")}</p>
          <p className="text-xs text-secondary">
            {canManage
              ? t("Send news to everyone in the chapter. Members get it in their messages.")
              : announcements?.joined === false
                ? t("You’ve turned off this chapter’s announcements.")
                : t("News from the chapter team arrives in your messages.")}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {announcements && (announcements.joined || canManage) && (
              <Button size="small" variant={canManage ? "primary" : "secondary"} onClick={() => router.push(`/messages/${announcements.id}`)}>
                {canManage ? t("Write an announcement") : t("Open")}
              </Button>
            )}
            {announcements && !canManage && (
              <Button size="small" variant="ghost" disabled={busy} onClick={() => void toggle(!announcements.joined)}>
                {announcements.joined ? t("Turn off") : t("Turn on")}
              </Button>
            )}
          </div>
        </div>
      </div>
      {canManage && others.length > 0 && (
        <div className="flex items-start gap-3 border-t border-line pt-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
            <Icon name="users" size={18} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm font-medium text-ink">{t("Team chat")}</p>
            <p className="text-xs text-secondary">{t("A private group for the chapter team.")}</p>
            <Button size="small" variant="secondary" className="mt-1 self-start" disabled={busy} onClick={() => void teamChat()}>
              {t("Open team chat")}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
