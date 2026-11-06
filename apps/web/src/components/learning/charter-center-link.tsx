"use client";

import type { AnchorHTMLAttributes, MouseEvent } from "react";

/**
 * Records the disclosed first-party click (POST /courses/:id/click → charter_center_click,
 * CM-LRN-04). Fire-and-forget with keepalive so it survives the tab switch; it never blocks
 * or changes the link, and the URL gets no tracking parameters.
 */
export function recordCharterCenterClick(courseId: string) {
  try {
    void fetch(`/api/v1/courses/${encodeURIComponent(courseId)}/click`, {
      method: "POST",
      headers: { "x-cm-csrf": "1" },
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* analytics must never break the link */
  }
}

/**
 * The exact Charter Center course page, in a new tab. Records the click on primary click,
 * keyboard activation (Enter fires click) and middle-click (auxclick).
 */
export function CharterCenterLink({
  courseId,
  href,
  children,
  onClick,
  onAuxClick,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel" | "href"> & { courseId: string; href: string }) {
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noopener"
      referrerPolicy="strict-origin-when-cross-origin"
      onClick={(event) => {
        recordCharterCenterClick(courseId);
        onClick?.(event);
      }}
      onAuxClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button === 1) recordCharterCenterClick(courseId);
        onAuxClick?.(event);
      }}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
