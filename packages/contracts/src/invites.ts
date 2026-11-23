import { z } from "zod";
import type { MemberRef } from "./common.js";

/*
 * Invitations: a member invites people to Charter Mission, to a chapter or to an event. They can share a link
 * (copy it, or send it through WhatsApp, Telegram or the phone's share sheet) or ask Charter
 * Mission to email it. The link is /invite?chapter={slug}&from={handle} (or event={slug}): a
 * signed-in person goes straight there; someone new signs up first (with the chapter already
 * picked, or landing on the event when onboarding is done). Members already on Charter Mission are
 * invited inside the app, as a message with the chapter's or event's card.
 */

export const INVITE_EMAILS_MAX = 10;
export const INVITE_MESSAGE_MAX = 500;
/** Invitation emails one member can send per day. */
export const INVITE_EMAILS_PER_DAY = 50;

/** POST /invites */
export const SendInvitesInput = z.object({
  emails: z.array(z.string().trim().toLowerCase().email("Enter valid email addresses")).min(1, "Add at least one email address").max(INVITE_EMAILS_MAX, `Up to ${INVITE_EMAILS_MAX} addresses at a time`),
  chapterSlug: z.string().trim().max(80).optional(),
  eventSlug: z.string().trim().max(200).optional(),
  message: z.string().trim().max(INVITE_MESSAGE_MAX).optional(),
});
export type SendInvitesInput = z.infer<typeof SendInvitesInput>;

export type SendInvitesResult = { sent: number };

/** What an invitation is for: joining the inviter on Charter Mission, a chapter, or an event. */
export const InviteKind = z.enum(["member", "chapter", "event"]);
export type InviteKind = z.infer<typeof InviteKind>;

/**
 * The invitation a new member signed up through (from the /invite link). Sent with sign-up so the
 * referral is counted: who invited whom, and to what.
 */
export const InviteRef = z.object({
  /** The inviter's handle. */
  from: z.string().trim().min(1).max(60),
  kind: InviteKind.default("member"),
  /** The chapter's or event's slug. */
  slug: z.string().trim().max(200).optional(),
});
export type InviteRef = z.infer<typeof InviteRef>;

/** GET /invites/preview?from=&kind=&slug= — what the invitation page shows (no sign-in needed). */
export const InvitePreviewQuery = InviteRef;
export type InvitePreview = {
  kind: InviteKind;
  /** Null when the handle is unknown: the page still invites them to Charter Mission. */
  inviter: { handle: string; name: string; headline: string | null; avatarUrl: string | null; tone: MemberRef["tone"]; verified: boolean } | null;
  /** The chapter or event, or null for a personal invitation (or when it no longer exists). */
  target: {
    path: string;
    title: string;
    description: string;
    imageUrl: string | null;
    /** Chapters: members. */
    memberCount?: number;
    /** Events. */
    startsAt?: string;
    endsAt?: string;
    timezone?: string;
    format?: string;
    place?: string | null;
    registeredCount?: number;
  } | null;
  /** Members on Charter Mission, for the "join N professionals" line. */
  memberCount: number;
};

/** GET /invites/mine — the people who joined through the viewer's invitations. */
export type MyReferrals = {
  total: number;
  people: { member: MemberRef; kind: InviteKind; joinedAt: string }[];
};

/** One sign-up through an invitation, as the admin console lists it. */
export type AdminReferralSignup = {
  /** The referral's id (stable for paging and React keys). */
  id: string;
  inviter: MemberRef;
  invitee: MemberRef;
  kind: InviteKind;
  /** The chapter's or event's slug from the link, as it was. */
  slug: string | null;
  /** The chapter or event the link was for, when it still exists: its name and its path on the member site. */
  target: { name: string; path: string } | null;
  joinedAt: string;
  /** The new member has confirmed their email. */
  verified: boolean;
};

/**
 * GET /admin/referrals?q=&kind=&inviter=&from=&to=&confirmed=&period=&cursor=&limit= — who invited whom.
 * `stats` are for all time and ignore the filters; `leaders` count the chosen period; `recent` is one
 * page of the filtered sign-ups, newest first (continue with nextCursor).
 */
export type AdminReferrals = {
  /** Everyone who joined through an invitation, all time. */
  total: number;
  stats: {
    total: number;
    last7Days: number;
    last30Days: number;
    /** Share of them who confirmed their email, 0–100 (null when nobody has joined yet). */
    confirmedPercent: number | null;
    byKind: Record<InviteKind, number>;
  };
  period: "30d" | "90d" | "all";
  leaders: { inviter: MemberRef; joined: number; verified: number }[];
  /** The inviter the sign-ups are filtered by, when `inviter` is set. */
  inviter: MemberRef | null;
  recent: AdminReferralSignup[];
  nextCursor: string | null;
};
