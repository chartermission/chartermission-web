import { z } from "zod";
import { CountryCode, MemberRef } from "./common.js";

/*
 * Messages from Charter Mission to members (admin console → Messages; permission members.message).
 *
 * Bulk messages ("announcements") go to every member matching an audience filter, through any of three
 * channels: email (members can turn announcement emails off; `important` service notices ignore that),
 * a message in each member's official conversation with Charter Mission (kind "official" — they can reply,
 * and the team answers from the Charter Mission inbox in the admin), and an in-app notification.
 * They're sent from the official account chosen in the messaging settings.
 */

export const AnnouncementChannels = z
  .object({ email: z.boolean(), message: z.boolean(), notification: z.boolean() })
  .refine((c) => c.email || c.message || c.notification, "Choose at least one way to send it");
export type AnnouncementChannels = z.infer<typeof AnnouncementChannels>;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/**
 * Who gets it. Every filter is optional; an empty filter means every active member (never suspended,
 * deleted or official accounts). Lists match any of their values; different filters must all match.
 */
export const AnnouncementAudience = z
  .object({
    countries: z.array(CountryCode).max(60).optional(),
    chapterIds: z.array(z.string().uuid()).max(60).optional(),
    sectorIds: z.array(z.string()).max(40).optional(),
    verified: z.enum(["any", "verified", "unverified"]).optional(),
    /** Members who joined on or after / on or before these days (UTC). */
    joinedFrom: isoDay.optional(),
    joinedTo: isoDay.optional(),
    /** Members who passed any of these exams. */
    passedExamIds: z.array(z.string().uuid()).max(20).optional(),
    /** Members who use the site in these languages. */
    locales: z.array(z.enum(["en", "fr", "ar"])).max(3).optional(),
    /** Ambassadors only. */
    ambassadorsOnly: z.boolean().optional(),
  })
  .refine((a) => !a.joinedFrom || !a.joinedTo || a.joinedTo >= a.joinedFrom, { message: "The end date can’t be before the start date", path: ["joinedTo"] });
export type AnnouncementAudience = z.infer<typeof AnnouncementAudience>;

/** POST /admin/announcements (a draft) and PATCH /admin/announcements/{id} (drafts only). */
export const AnnouncementInput = z.object({
  /** Email subject, notification text and the message's first line. */
  subject: z.string().trim().min(3, "Write a subject").max(150, "At most 150 characters"),
  /** Plain text; blank lines separate paragraphs; links are made clickable. */
  body: z.string().trim().min(1, "Write the message").max(5000, "At most 5,000 characters"),
  /** Optional button (email), link (message) and where the notification goes. */
  linkUrl: z.string().trim().url("Enter a full link, starting with https://").max(500).refine((v) => /^https?:\/\//i.test(v), "Enter a full link, starting with https://").nullable().optional(),
  linkLabel: z.string().trim().max(40, "At most 40 characters").nullable().optional(),
  channels: AnnouncementChannels,
  audience: AnnouncementAudience,
  important: z.boolean().default(false),
});
export type AnnouncementInput = z.infer<typeof AnnouncementInput>;

export const AnnouncementStatus = z.enum(["draft", "sending", "sent", "failed", "cancelled"]);
export type AnnouncementStatus = z.infer<typeof AnnouncementStatus>;

export const AnnouncementView = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  body: z.string(),
  linkUrl: z.string().nullable(),
  linkLabel: z.string().nullable(),
  channels: z.object({ email: z.boolean(), message: z.boolean(), notification: z.boolean() }),
  audience: AnnouncementAudience,
  important: z.boolean(),
  status: AnnouncementStatus,
  counts: z.object({
    recipients: z.number().int(),
    emailed: z.number().int(),
    messaged: z.number().int(),
    notified: z.number().int(),
    /** Not emailed: announcement emails turned off. */
    optedOut: z.number().int(),
    failed: z.number().int(),
    /** Recipients still to process while sending. */
    remaining: z.number().int(),
  }),
  lastError: z.string().nullable(),
  createdBy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  sentBy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  createdAt: z.string(),
  queuedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type AnnouncementView = z.infer<typeof AnnouncementView>;

/** GET /admin/announcements?cursor&limit — newest first. */
export const AnnouncementsQuery = z.object({
  status: z.enum(["all", "draft", "sent"]).default("all"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type AnnouncementsQuery = z.infer<typeof AnnouncementsQuery>;
export const AnnouncementsPage = z.object({ items: z.array(AnnouncementView), nextCursor: z.string().nullable() });
export type AnnouncementsPage = z.infer<typeof AnnouncementsPage>;

/**
 * POST /admin/announcements/audience — how many members a filter reaches (live, while composing).
 * emailable: of those, who would get the email (opted-out members are left out unless important).
 */
export const AnnouncementAudienceInput = z.object({ audience: AnnouncementAudience, important: z.boolean().default(false) });
export type AnnouncementAudienceInput = z.infer<typeof AnnouncementAudienceInput>;
export const AnnouncementAudienceCount = z.object({
  members: z.number().int(),
  emailable: z.number().int(),
  optedOut: z.number().int(),
  /** A few of them, to sanity-check the filter. */
  sample: z.array(MemberRef).max(5),
});
export type AnnouncementAudienceCount = z.infer<typeof AnnouncementAudienceCount>;

/**
 * POST /admin/announcements/{id}/send — resolves the audience now and starts delivery (in batches, in
 * the background). POST /admin/announcements/{id}/test — sends it only to the signed-in admin, through the
 * chosen email and notification channels, marked "Test". POST /admin/announcements/{id}/cancel stops a send
 * in progress (members already reached keep it). DELETE /admin/announcements/{id} deletes a draft.
 */
export const AnnouncementSendResult = z.object({ announcement: AnnouncementView });
export type AnnouncementSendResult = z.infer<typeof AnnouncementSendResult>;

/** GET/PUT /admin/settings/messaging — the official account bulk messages and inbox replies come from. */
export const MessagingSettings = z.object({ senderId: z.string().uuid().nullable() });
export type MessagingSettings = z.infer<typeof MessagingSettings>;
export const MessagingSettingsView = z.object({
  senderId: z.string().uuid().nullable(),
  sender: MemberRef.nullable(),
  /** Official accounts to choose from (Members → mark an account as official to add one). */
  options: z.array(MemberRef),
});
export type MessagingSettingsView = z.infer<typeof MessagingSettingsView>;

/* ---------------------------- Charter Mission inbox ---------------------------- */

/** GET /admin/inbox?filter&q&cursor — members' official conversations, most recent activity first. */
export const AdminInboxQuery = z.object({
  /** unread: the member wrote last and the team hasn't read it. */
  filter: z.enum(["all", "unread"]).default("all"),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type AdminInboxQuery = z.infer<typeof AdminInboxQuery>;

export const AdminInboxItem = z.object({
  conversationId: z.string().uuid(),
  member: MemberRef.extend({ email: z.string() }),
  lastMessage: z.object({ body: z.string(), at: z.string(), fromMember: z.boolean() }).nullable(),
  unread: z.boolean(),
});
export type AdminInboxItem = z.infer<typeof AdminInboxItem>;
export const AdminInboxPage = z.object({ items: z.array(AdminInboxItem), nextCursor: z.string().nullable(), unreadCount: z.number().int() });
export type AdminInboxPage = z.infer<typeof AdminInboxPage>;

export const AdminInboxMessage = z.object({
  id: z.string().uuid(),
  body: z.string(),
  at: z.string(),
  from: z.enum(["member", "team"]),
  /** team: who on the team wrote it (null for bulk messages). */
  staff: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** Part of a bulk message: its subject. */
  announcement: z.object({ id: z.string().uuid(), subject: z.string() }).nullable(),
  attachments: z.array(z.object({ url: z.string(), name: z.string(), kind: z.enum(["image", "document", "voice"]) })),
  deleted: z.boolean(),
});
export type AdminInboxMessage = z.infer<typeof AdminInboxMessage>;

/** GET /admin/inbox/{conversationId}?cursor — oldest first within a page; cursor pages back in time. */
export const AdminInboxThread = z.object({
  conversationId: z.string().uuid(),
  member: MemberRef.extend({ email: z.string() }),
  messages: z.array(AdminInboxMessage),
  /** Older messages exist: pass as cursor. */
  olderCursor: z.string().nullable(),
});
export type AdminInboxThread = z.infer<typeof AdminInboxThread>;

/**
 * POST /admin/inbox/{conversationId}/messages and POST /admin/inbox/start (to one member, from their row
 * in Members) — a message as Charter Mission. Reading a thread marks it read for the whole team.
 */
export const AdminInboxReplyInput = z.object({ body: z.string().trim().min(1, "Write a message").max(4000, "At most 4,000 characters") });
export type AdminInboxReplyInput = z.infer<typeof AdminInboxReplyInput>;
export const AdminInboxStartInput = AdminInboxReplyInput.extend({ memberId: z.string().uuid() });
export type AdminInboxStartInput = z.infer<typeof AdminInboxStartInput>;

/** POST /notifications/unsubscribe (no sign-in) — the one-click link in bulk emails turns announcement emails off. */
export const UnsubscribeInput = z.object({ token: z.string().min(10).max(500) });
export type UnsubscribeInput = z.infer<typeof UnsubscribeInput>;
export const UnsubscribeResult = z.object({ category: z.literal("announcements"), done: z.boolean() });
export type UnsubscribeResult = z.infer<typeof UnsubscribeResult>;
