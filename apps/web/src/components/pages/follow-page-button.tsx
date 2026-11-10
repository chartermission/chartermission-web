"use client";

import { useState } from "react";
import { Button, Icon, type ButtonProps } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";

/** Follow / Following for a page (POST / DELETE /follows with targetType "page"). */
export function FollowPageButton({
  page,
  following: initial,
  size = "small",
  block = false,
  onChange,
}: {
  page: { id: string; name: string };
  following: boolean;
  size?: ButtonProps["size"];
  block?: boolean;
  onChange?: (following: boolean) => void;
}) {
  const t = useT();
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !following;
    setBusy(true);
    setFollowing(next);
    try {
      await api("/follows", { method: next ? "POST" : "DELETE", body: { targetType: "page", targetId: page.id } });
      onChange?.(next);
      if (next) toast.success(t("You’re following {name}. Its posts will appear in your feed.", { name: page.name }));
    } catch (e) {
      setFollowing(!next);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={following ? "secondary" : "primary"} size={size} block={block} aria-pressed={following} aria-disabled={busy} onClick={toggle}>
      <Icon name={following ? "check" : "plus"} size={16} className={following ? "text-success" : undefined} />
      {following ? "Following" : "Follow"}
      <span className="sr-only"> {page.name}</span>
    </Button>
  );
}
