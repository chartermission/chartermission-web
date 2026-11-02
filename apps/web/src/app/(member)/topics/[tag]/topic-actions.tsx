"use client";

import { useState } from "react";
import { Button } from "@chartermission/ui";

/** Follow / Share / Mute buttons in the topic header. Local state until the API exists. */
export function TopicActions({ tag }: { tag: string }) {
  const [following, setFollowing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `#${tag} on Charter Mission`, url });
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
    <div className="flex flex-wrap items-center gap-2.5">
      <Button
        variant={following ? "secondary" : "accent"}
        aria-pressed={following}
        onClick={() => setFollowing((value) => !value)}
      >
        {following ? "Following" : "Follow topic"}
      </Button>
      <Button variant="secondary" onClick={share}>
        {copied ? "Link copied" : "Share"}
      </Button>
      <Button variant="ghost" aria-pressed={muted} onClick={() => setMuted((value) => !value)}>
        {muted ? "Unmute" : "Mute"}
      </Button>
      <p className="sr-only" role="status">
        {copied ? "Topic link copied to clipboard" : ""}
      </p>
    </div>
  );
}
