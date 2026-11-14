"use client";

import { useState } from "react";
import { Icon, buttonClasses, type ButtonSize, type ButtonVariant } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";

/** Follow / Following toggle (PUT / DELETE /initiatives/:id/follow). Updates reach followers' Following feed. */
export function FollowButton({
  initiativeId,
  title,
  following: initial,
  variant = "secondary",
  size = "small",
  className,
  onChange,
}: {
  initiativeId: string;
  title: string;
  following: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  onChange?: (following: boolean) => void;
}) {
  const t = useT();
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      await api(`/initiatives/${initiativeId}/follow`, { method: next ? "PUT" : "DELETE" });
      onChange?.(next);
    } catch (e) {
      setFollowing(!next);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      aria-pressed={following}
      disabled={busy}
      aria-label={following ? t("Following {title}", { title }) : t("Follow {title}", { title })}
      onClick={() => void toggle()}
      className={buttonClasses({ variant, size, className })}
    >
      {following && <Icon name="check" size={size === "small" ? 14 : 16} />}
      {following ? "Following" : "Follow"}
    </button>
  );
}
