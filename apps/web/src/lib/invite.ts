/** The chapter someone was invited to, until they finish signing up (set by the proxy on /invite, read by onboarding). */
export const INVITE_COOKIE = "cm_invite_chapter";
/** The event someone was invited to: they land on it when onboarding is done (set by the proxy on /invite?event=…). */
export const INVITE_EVENT_COOKIE = "cm_invite_event";
/** The exam whose invitation link someone opened: given to them as soon as they are signed in (components/exams/exam-invite.tsx). */
export const INVITE_EXAM_COOKIE = "cm_invite_exam";
/** The invitation someone opened (inviter, kind, slug), until they sign up: sent with sign-up so the inviter is credited. */
export const INVITE_REF_COOKIE = "cm_invite_ref";

export type InviteRefCookie = { from: string; kind: "member" | "chapter" | "event"; slug?: string };

/** Reads the referral cookie's value; anything malformed is ignored. */
export function parseInviteRef(raw: string | undefined | null): InviteRefCookie | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<InviteRefCookie>;
    if (typeof v.from !== "string" || !/^[a-z0-9-]{1,60}$/i.test(v.from)) return null;
    const kind = v.kind === "chapter" || v.kind === "event" ? v.kind : "member";
    const slug = typeof v.slug === "string" && /^[a-z0-9-]{1,200}$/.test(v.slug) ? v.slug : undefined;
    return kind === "member" ? { from: v.from, kind } : slug ? { from: v.from, kind, slug } : { from: v.from, kind: "member" };
  } catch {
    return null;
  }
}
