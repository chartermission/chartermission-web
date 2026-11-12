import { z } from "zod";

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
