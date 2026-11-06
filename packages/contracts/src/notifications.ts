import { z } from "zod";
import { MemberRef } from "./common.js";

/* Notifications and preferences (spec 4.13 NTF). */

export const NotificationType = z.enum([
  "mention",
  "comment_on_post",
  "reply_to_comment",
  "reaction",
  "repost",
  "follow",
  "connection_request",
  "connection_accepted",
  "trending_followed_topic",
  "report_outcome",
  "moderation_action",
  "appeal_outcome",
  "upload_rejected",
  "answer_accepted",
  "help_offered",
  "scheduled_post_published",
  "scheduled_post_failed",
  "welcome",
  "security",
  /* Events (spec 4.9). Icons: calendar unless noted. Transactional ("always") unless noted. */
  /** You have a seat; email has the .ics link. */
  "event_registration_confirmed",
  /** The event was full; you are number N on the waitlist. Icon clock. */
  "event_waitlisted",
  /** A seat opened and you now hold it (in-app + email). Icon check. */
  "event_waitlist_promoted",
  /** 24 h / 1 h before start (category events, respects preferences). Icon clock. */
  "event_reminder",
  /** Called off by the host or staff, with the reason (in-app + email). Icon alert. */
  "event_cancelled",
  /** Time, venue or online access changed (category events). */
  "event_updated",
  /** Review outcomes for the host. approved: icon check; changes requested: lightbulb; rejected: alert. */
  "event_review_approved",
  "event_review_changes_requested",
  "event_review_rejected",
  /* Learning (spec 4.10) */
  /** To admins with course.curate: a Charter Center course link failed its checks. Icon alert. */
  "course_link_broken",
]);
export type NotificationType = z.infer<typeof NotificationType>;

/** Preference categories. "security", "account" and transactional event messages are always on. */
export const NotificationCategory = z.enum([
  "mentions_replies",
  "comments",
  "reactions",
  "connections",
  "follows",
  "trending",
  "moderation",
  /** Event reminders and changes to events you registered for (confirmations and cancellations are always sent). */
  "events",
  "digest",
]);
export type NotificationCategory = z.infer<typeof NotificationCategory>;

export const NotificationChannel = z.enum(["in_app", "email", "push"]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export const NotificationView = z.object({
  id: z.string().uuid(),
  type: NotificationType,
  /** Most recent actors first; "Amina and 4 others" uses actors[0] + actorCount - 1. */
  actors: z.array(MemberRef),
  actorCount: z.number().int(),
  /**
   * Text split into segments so names and objects can be bold without HTML.
   * e.g. [{text:"Amara Okafor", strong:true},{text:" mentioned you in a post about "},{text:"#AfCFTA", strong:true}]
   */
  segments: z.array(z.object({ text: z.string(), strong: z.boolean().default(false) })),
  /** Web path to open, e.g. /posts/{id}#comment-{id}. */
  href: z.string(),
  icon: z.enum(["avatar", "trending", "briefcase", "calendar", "lightbulb", "shield", "users", "flag", "alert", "check", "clock"]),
  createdAt: z.string(),
  read: z.boolean(),
});
export type NotificationView = z.infer<typeof NotificationView>;

/** GET /notifications?filter=all|mentions|unread&cursor= */
export const NotificationsQuery = z.object({
  filter: z.enum(["all", "mentions", "unread"]).default("all"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type NotificationsQuery = z.infer<typeof NotificationsQuery>;

/** POST /notifications/read — mark some or all as read. */
export const MarkReadInput = z.object({ ids: z.array(z.string().uuid()).max(100).optional(), all: z.boolean().optional() });
export type MarkReadInput = z.infer<typeof MarkReadInput>;

export const UnreadCount = z.object({ unread: z.number().int() });
export type UnreadCount = z.infer<typeof UnreadCount>;

export const NotificationPreference = z.object({
  category: NotificationCategory,
  channel: NotificationChannel,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof NotificationPreference>;

/** GET/PUT /me/notification-preferences */
export const NotificationPreferences = z.object({ preferences: z.array(NotificationPreference) });
export type NotificationPreferences = z.infer<typeof NotificationPreferences>;
