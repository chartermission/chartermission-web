import type { PolicyRef } from "@chartermission/contracts";

/** "guidelines.harassment" → "harassment" (section anchor on /guidelines). */
export function guidelineAnchor(ref: PolicyRef): string {
  return ref.replace(/^guidelines\./, "").replace(/_/g, "-");
}

export function guidelineHref(ref: PolicyRef): string {
  return `/guidelines#${guidelineAnchor(ref)}`;
}

export const POLICY_DOCS = {
  terms: { label: "Terms of Use", href: "/terms" },
  privacy: { label: "Privacy Notice", href: "/privacy" },
  guidelines: { label: "Community Guidelines", href: "/guidelines" },
} as const;
