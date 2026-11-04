"use client";

import { useRef, useState } from "react";
import type { ChapterRef } from "@chartermission/contracts";
import { Button, Icon, cn, type ButtonProps } from "@chartermission/ui";
import { pop } from "@/components/motion";
import { useRelationship } from "@/components/network/relationship";
import { api } from "@/lib/api/client";
import { toast } from "@/components/social/toast";

type Look = { size?: ButtonProps["size"]; block?: boolean; primary?: boolean; className?: string };

function FollowButtonView({
  following,
  busy,
  name,
  onToggle,
  size = "small",
  block,
  primary,
  className,
}: Look & { following: boolean; busy: boolean; name: string; onToggle: () => Promise<boolean> }) {
  const iconRef = useRef<HTMLSpanElement>(null);
  async function toggle() {
    if (busy) return;
    const followed = !following;
    if ((await onToggle()) && followed) pop(iconRef.current, { scale: 1.45 });
  }
  return (
    <Button
      variant={following ? "secondary" : primary ? "primary" : "secondary"}
      size={size}
      block={block}
      aria-pressed={following}
      aria-disabled={busy}
      onClick={toggle}
      className={cn(busy && "cursor-progress opacity-70", className)}
    >
      <span ref={iconRef} className="inline-flex">
        <Icon name={following ? "check" : "plus"} size={16} className={following ? "text-success" : undefined} />
      </span>
      {following ? "Following" : "Follow"}
      <span className="sr-only"> {name}</span>
    </Button>
  );
}

/** Follow / Following toggle for a member (POST / DELETE /follows via useRelationship), with a small pop on follow. */
export function FollowMemberButton({ member, following, ...look }: Look & { member: { id: string; name: string }; following: boolean }) {
  const controls = useRelationship(member, { connection: "none", connectionId: null, following });
  return (
    <FollowButtonView
      {...look}
      name={member.name}
      following={controls.state.following}
      busy={!!controls.busy}
      onToggle={() => (controls.state.following ? controls.unfollow() : controls.follow())}
    />
  );
}

/** Follow / Following toggle for a chapter. */
export function FollowChapterButton({ chapter, following: initial, ...look }: Look & { chapter: ChapterRef; following: boolean }) {
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const next = !following;
    setBusy(true);
    try {
      await api("/follows", { method: next ? "POST" : "DELETE", body: { targetType: "chapter", targetId: chapter.id } });
      setFollowing(next);
      toast.success(next ? `You’re following ${chapter.name}` : `You unfollowed ${chapter.name}`);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return <FollowButtonView {...look} name={chapter.name} following={following} busy={busy} onToggle={toggle} />;
}
