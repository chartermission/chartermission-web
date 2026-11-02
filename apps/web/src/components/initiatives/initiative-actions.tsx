"use client";

import { useState } from "react";
import { Icon, buttonClasses, type ButtonSize, type ButtonVariant } from "@chartermission/ui";

/** Follow / Following toggle. */
export function FollowButton({
  title,
  variant = "secondary",
  size = "small",
  className,
}: {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [following, setFollowing] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={following}
      aria-label={following ? `Following ${title}` : `Follow ${title}`}
      onClick={() => setFollowing((value) => !value)}
      className={buttonClasses({ variant, size, className })}
    >
      {following && <Icon name="check" size={size === "small" ? 14 : 16} />}
      {following ? "Following" : "Follow"}
    </button>
  );
}

/** Copies the current page URL (or uses the native share sheet when available). */
export function ShareButton({ title, className }: { title: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Share sheet dismissed or clipboard unavailable — nothing to do.
    }
  }

  return (
    <>
      <button type="button" onClick={share} className={buttonClasses({ variant: "ghost", className })}>
        {copied ? "Link copied" : "Share"}
      </button>
      <span className="sr-only" role="status">
        {copied ? "Link copied to clipboard" : ""}
      </span>
    </>
  );
}
