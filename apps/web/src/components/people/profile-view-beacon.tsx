"use client";

import { useEffect } from "react";

/**
 * Tells the API that the signed-in member opened this profile, for the owner's "Who viewed your profile". The API
 * ignores self-views and blocked pairs and keeps one view per person per day. Nothing here is essential: failures are
 * dropped silently.
 */
export function ProfileViewBeacon({ handle }: { handle: string }) {
  useEffect(() => {
    void fetch(`/api/v1/members/${encodeURIComponent(handle)}/views`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-cm-csrf": "1" },
      body: "{}",
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => {});
  }, [handle]);
  return null;
}
