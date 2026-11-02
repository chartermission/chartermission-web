"use client";

import type { AnchorHTMLAttributes } from "react";

/**
 * Records that a member opened Charter Center content. There is no API yet,
 * so this only dispatches a DOM event ("chartermission:charter-center-click")
 * that analytics can pick up; swap in the API call when it exists.
 */
export function recordCharterCenterClick(kind: "course" | "path", slug: string) {
  window.dispatchEvent(new CustomEvent("chartermission:charter-center-click", { detail: { kind, slug } }));
}

/** External link to Charter Center: opens in a new tab and records the click. */
export function CharterCenterLink({
  kind,
  slug,
  children,
  onClick,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel"> & { kind: "course" | "path"; slug: string; href: string }) {
  return (
    <a
      {...rest}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        recordCharterCenterClick(kind, slug);
        onClick?.(event);
      }}
    >
      {children}
      <span className="sr-only"> (opens Charter Center in a new tab)</span>
    </a>
  );
}
