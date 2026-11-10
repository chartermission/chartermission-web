"use client";

import { useState } from "react";
import { Button, Icon } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { Menu } from "@/components/social/menu";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";

/** Follow / unfollow (POST/DELETE /follows), mute (POST/DELETE /mutes) and report for a hashtag. */
export function TopicActions({ tag, following: initialFollowing, muted: initialMuted, onFollowersChange }: {
  tag: string;
  following: boolean;
  muted: boolean;
  onFollowersChange?: (delta: number) => void;
}) {
  const t = useT();
  const [following, setFollowing] = useState(initialFollowing);
  const [muted, setMuted] = useState(initialMuted);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const target = { targetType: "hashtag", targetId: tag.toLowerCase() };

  async function toggleFollow() {
    setBusy(true);
    const next = !following;
    setFollowing(next);
    onFollowersChange?.(next ? 1 : -1);
    try {
      await api("/follows", { method: next ? "POST" : "DELETE", body: target });
      toast.success(next ? t("Following #{tag}. Its posts will show up in your feed.", { tag }) : t("Unfollowed #{tag}", { tag }));
    } catch (e) {
      setFollowing(!next);
      onFollowersChange?.(next ? -1 : 1);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function toggleMute() {
    const next = !muted;
    try {
      await api("/mutes", { method: next ? "POST" : "DELETE", body: target });
      setMuted(next);
      toast.success(next ? t("Muted #{tag}. Posts with it won’t appear in your feed.", { tag }) : t("Unmuted #{tag}", { tag }));
    } catch (e) {
      toast.error(e);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button variant={following ? "secondary" : "accent"} aria-pressed={following} disabled={busy} onClick={toggleFollow}>
        <Icon name={following ? "check" : "plus"} size={16} />
        {following ? "Following" : "Follow"}
        <span className="sr-only"> #{tag}</span>
      </Button>
      {muted && (
        <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm text-body">
          <Icon name="eye-off" size={14} />
          Muted in your feed
        </span>
      )}
      <Menu
        label={t("More options for #{tag}", { tag })}
        items={[
          { label: muted ? t("Unmute #{tag}", { tag }) : t("Mute #{tag}", { tag }), icon: "eye-off", onSelect: toggleMute },
          { label: "Report hashtag", icon: "flag", onSelect: () => setReporting(true) },
        ]}
        trigger={
          <span className="flex size-10 items-center justify-center rounded-lg border border-line-strong text-body">
            <Icon name="more" size={20} />
          </span>
        }
      />
      {reporting && <ReportDialog targetType="hashtag" targetId={tag.toLowerCase()} subject={`#${tag}`} onClose={() => setReporting(false)} />}
    </div>
  );
}
