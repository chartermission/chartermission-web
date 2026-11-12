import { z } from "zod";
import { MemberRef } from "./common.js";
import { LinkPreview } from "./social.js";

/*
 * Messages. Three kinds of conversation:
 *  - direct: two members. Connections chat straight away; anyone else starts with a message
 *    request the other member accepts or declines.
 *  - group: up to GROUP_MAX_MEMBERS members (a chapter team, an event's attendees, or anyone's
 *    connections). Admins rename it and add or remove people; anyone can leave.
 *  - broadcast: a chapter's announcements. Its team writes; every member of the chapter receives
 *    them and can turn them off.
 * Official Charter Mission accounts can't be messaged privately.
 */

export const MESSAGE_MAX_CHARS = 4000;
/** A sender can correct a text message for this long after sending it. */
export const MESSAGE_EDIT_WINDOW_MINUTES = 15;
export const GROUP_MAX_MEMBERS = 256;
export const GROUP_TITLE_MAX = 80;
/** Attachments per message. */
export const MESSAGE_MAX_ATTACHMENTS = 10;
/** Voice notes are capped at this length. */
export const VOICE_NOTE_MAX_SECONDS = 300;
/** The quick reactions under a message; any single emoji is accepted. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export const ConversationKind = z.enum(["direct", "group", "broadcast"]);
export type ConversationKind = z.infer<typeof ConversationKind>;
export const ConversationStatus = z.enum(["active", "request", "declined"]);
export type ConversationStatus = z.infer<typeof ConversationStatus>;
export const MessageKind = z.enum(["text", "voice", "share", "meeting", "system"]);
export type MessageKind = z.infer<typeof MessageKind>;

/** What can be sent as a card in a message. `key` is the id or the slug the page uses. */
export const ShareType = z.enum(["post", "article", "event", "opportunity", "member", "page", "chapter"]);
export type ShareType = z.infer<typeof ShareType>;
export const ShareTarget = z.object({ type: ShareType, key: z.string().trim().min(1).max(200) });
export type ShareTarget = z.infer<typeof ShareTarget>;

export const MessageAttachment = z.object({
  id: z.string().uuid(),
  kind: z.enum(["image", "document", "voice"]),
  url: z.string(),
  mime: z.string(),
  name: z.string(),
  sizeBytes: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
});
export type MessageAttachment = z.infer<typeof MessageAttachment>;

/** A shared post, event, profile… as a card. `available` is false once it is gone or hidden. */
export const MessageShare = z.object({
  type: ShareType,
  path: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  available: z.boolean(),
});
export type MessageShare = z.infer<typeof MessageShare>;

export const MeetingStatus = z.enum(["proposed", "accepted", "declined", "cancelled"]);
export const MeetingView = z.object({
  title: z.string(),
  startsAt: z.string(),
  durationMinutes: z.number().int(),
  /** Video call link (a Jitsi room when the sender didn't give one). */
  link: z.string().nullable(),
  note: z.string().nullable(),
  status: MeetingStatus,
  respondedBy: z.string().uuid().nullable(),
  respondedAt: z.string().nullable(),
});
export type MeetingView = z.infer<typeof MeetingView>;

export const ReactionSummary = z.object({
  emoji: z.string(),
  count: z.number().int(),
  mine: z.boolean(),
  /** Up to five names, for the tooltip. */
  names: z.array(z.string()),
  /** Who reacted (up to 50), so live updates can tell each reader whether they did. */
  memberIds: z.array(z.string().uuid()),
});
export type ReactionSummary = z.infer<typeof ReactionSummary>;

/** The message a reply quotes, shortened. */
export const ReplyRef = z.object({
  id: z.string().uuid(),
  senderId: z.string().uuid(),
  senderName: z.string(),
  kind: MessageKind,
  body: z.string(),
  /** Deleted or removed since: the quote says so instead of showing it. */
  gone: z.boolean(),
});
export type ReplyRef = z.infer<typeof ReplyRef>;

export const MessageView = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderId: z.string().uuid(),
  kind: MessageKind,
  /** Empty when the sender deleted the message, or a moderator removed it. */
  body: z.string(),
  deleted: z.boolean(),
  /** Hidden or removed by a moderator after a report. */
  removed: z.boolean(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  /** The sending app's id for this message, so it can match its own pending copy. */
  clientId: z.string().uuid().nullable(),
  replyTo: ReplyRef.nullable(),
  attachments: z.array(MessageAttachment),
  share: MessageShare.nullable(),
  meeting: MeetingView.nullable(),
  linkPreview: LinkPreview.nullable(),
  reactions: z.array(ReactionSummary),
});
export type MessageView = z.infer<typeof MessageView>;

export const ConversationView = z.object({
  id: z.string().uuid(),
  kind: ConversationKind,
  status: ConversationStatus,
  /** What the list shows: the other member's name, the group's name, or "<Chapter> announcements". */
  title: z.string(),
  /** Direct chats: the other member. */
  member: MemberRef.nullable(),
  /** Everyone else in a direct chat or group (empty for announcements, whose readers stay private). */
  members: z.array(MemberRef),
  memberCount: z.number().int(),
  /** Groups: who can rename it and add or remove people. */
  admins: z.array(z.string().uuid()),
  chapter: z.object({ slug: z.string(), name: z.string(), countryCode: z.string(), imageUrl: z.string().nullable() }).nullable(),
  lastMessage: z
    .object({
      kind: MessageKind,
      body: z.string(),
      mine: z.boolean(),
      senderName: z.string(),
      deleted: z.boolean(),
      removed: z.boolean(),
      createdAt: z.string(),
    })
    .nullable(),
  /** Messages from others since the viewer last opened the conversation. */
  unread: z.number().int(),
  /** False when either has blocked the other, the other account is gone, a request is waiting, or (announcements) the viewer isn't on the chapter team. */
  canSend: z.boolean(),
  /** Why canSend is false, in a sentence for the composer; null when the viewer can write. */
  cantSendReason: z.string().nullable(),
  /** Group admin, or chapter team for announcements. */
  canManage: z.boolean(),
  /** Direct chats: when the other member last opened it (the viewer's messages up to then are "Seen"). Groups: null. */
  seenAt: z.string().nullable(),
  /** Groups: when each other member last read it, for "Seen by". */
  readBy: z.array(z.object({ memberId: z.string().uuid(), readAt: z.string() })),
  muted: z.boolean(),
  mutedUntil: z.string().nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  markedUnread: z.boolean(),
  /** Message requests: "incoming" for the member who received it, "outgoing" for its sender. */
  request: z.enum(["incoming", "outgoing"]).nullable(),
  /** Not connected, and the viewer hasn’t written in this chat yet: the app shows a safety note. */
  firstContact: z.boolean(),
  /** Whether the viewer is still in it (false after leaving a group or turning announcements off). */
  joined: z.boolean(),
});
export type ConversationView = z.infer<typeof ConversationView>;

/** GET /messages/conversations?box= */
export const ConversationsQuery = z.object({ box: z.enum(["inbox", "requests", "archived"]).default("inbox") });
export type ConversationsQuery = z.infer<typeof ConversationsQuery>;

/** POST /messages/conversations — the chat with a member: a connection straight away, anyone else as a message request. */
export const StartConversationInput = z.object({ memberId: z.string().uuid() });
export type StartConversationInput = z.infer<typeof StartConversationInput>;

export const MeetingInput = z.object({
  title: z.string().trim().min(1, "Give the meeting a title").max(120, "Keep the title under 120 characters"),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(480),
  /** Leave empty for a free video room. */
  link: z
    .string()
    .trim()
    .max(500)
    .refine((v) => !v || /^https:\/\//i.test(v), "Use a link that starts with https://")
    .optional(),
  note: z.string().trim().max(500).optional(),
});
export type MeetingInput = z.infer<typeof MeetingInput>;

/** POST /messages/conversations/{id}/messages — text and/or attachments, a voice note, a shared card or a meeting. */
export const SendMessageInput = z
  .object({
    body: z.string().trim().max(MESSAGE_MAX_CHARS, `Keep it under ${MESSAGE_MAX_CHARS} characters`).default(""),
    /** Random id from the sending app; sending again with the same id returns the first copy. */
    clientId: z.string().uuid().optional(),
    replyToId: z.string().uuid().optional(),
    /** Uploaded with purpose message_image or message_file. */
    attachmentIds: z.array(z.string().uuid()).max(MESSAGE_MAX_ATTACHMENTS).default([]),
    /** Uploaded with purpose voice_note. */
    voiceNoteId: z.string().uuid().optional(),
    share: ShareTarget.optional(),
    meeting: MeetingInput.optional(),
  })
  .refine((v) => v.body.length > 0 || v.attachmentIds.length > 0 || v.voiceNoteId || v.share || v.meeting, {
    message: "Write a message first",
    path: ["body"],
  });
export type SendMessageInput = z.input<typeof SendMessageInput>;

/** PATCH /messages/{id} — correct a text message within MESSAGE_EDIT_WINDOW_MINUTES. */
export const EditMessageInput = z.object({
  body: z.string().trim().min(1, "Write a message first").max(MESSAGE_MAX_CHARS, `Keep it under ${MESSAGE_MAX_CHARS} characters`),
});
export type EditMessageInput = z.infer<typeof EditMessageInput>;

/** PUT /messages/{id}/reaction */
export const ReactInput = z.object({
  emoji: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .refine((v) => /\p{Extended_Pictographic}/u.test(v), "Pick an emoji"),
});
export type ReactInput = z.infer<typeof ReactInput>;

/** POST /messages/{id}/meeting */
export const MeetingResponseInput = z.object({ response: z.enum(["accept", "decline", "cancel"]) });
export type MeetingResponseInput = z.infer<typeof MeetingResponseInput>;

/** POST /messages/{id}/translate → the text in the viewer's language. */
export type TranslationView = { text: string; lang: string };

/** PATCH /messages/conversations/{id} — the viewer's own organisation of a conversation. */
export const UpdateConversationInput = z.object({
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  /** "8h", "1w" or "always" mutes; "off" unmutes. */
  mute: z.enum(["8h", "1w", "always", "off"]).optional(),
  /** true: show as unread until opened again. */
  unread: z.boolean().optional(),
});
export type UpdateConversationInput = z.infer<typeof UpdateConversationInput>;

/** POST /messages/groups */
export const CreateGroupInput = z
  .object({
    title: z.string().trim().min(1, "Give the group a name").max(GROUP_TITLE_MAX, `Keep the name under ${GROUP_TITLE_MAX} characters`),
    /** Connections to add, or (with chapterSlug / eventSlug) members of that chapter or attendees of that event. */
    memberIds: z.array(z.string().uuid()).max(GROUP_MAX_MEMBERS - 1).default([]),
    /** A group for a chapter: only its team can create it, and anyone in the chapter can be added. */
    chapterSlug: z.string().trim().max(120).optional(),
    /** A group for an event: only its host or the event's organisers, with every registered attendee added. */
    eventSlug: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.memberIds.length > 0 || v.eventSlug, { message: "Add at least one member", path: ["memberIds"] });
export type CreateGroupInput = z.input<typeof CreateGroupInput>;

/** PATCH /messages/groups/{id} */
export const UpdateGroupInput = z.object({
  title: z.string().trim().min(1, "Give the group a name").max(GROUP_TITLE_MAX, `Keep the name under ${GROUP_TITLE_MAX} characters`),
});
export type UpdateGroupInput = z.infer<typeof UpdateGroupInput>;

/** POST /messages/groups/{id}/members */
export const AddGroupMembersInput = z.object({ memberIds: z.array(z.string().uuid()).min(1).max(GROUP_MAX_MEMBERS) });
export type AddGroupMembersInput = z.infer<typeof AddGroupMembersInput>;

/** PUT /messages/groups/{id}/members/{memberId}/role */
export const GroupRoleInput = z.object({ role: z.enum(["admin", "member"]) });
export type GroupRoleInput = z.infer<typeof GroupRoleInput>;

/** POST /messages/share — send one card to several people or conversations at once. */
export const ShareToMessagesInput = z.object({
  share: ShareTarget,
  body: z.string().trim().max(MESSAGE_MAX_CHARS).default(""),
  conversationIds: z.array(z.string().uuid()).max(20).default([]),
  memberIds: z.array(z.string().uuid()).max(20).default([]),
});
export type ShareToMessagesInput = z.input<typeof ShareToMessagesInput>;

/** GET /messages/recipients?q= — who a card can be sent to: recent conversations, then connections. */
export type MessageRecipient =
  | { type: "conversation"; conversationId: string; title: string; member: MemberRef | null; kind: ConversationKind }
  | { type: "member"; member: MemberRef };

/** GET /messages/search?q= */
export const MessageSearchQuery = z.object({ q: z.string().trim().min(2, "Type at least 2 characters").max(100) });
export type MessageSearchQuery = z.infer<typeof MessageSearchQuery>;
export type MessageSearchHit = { conversation: Pick<ConversationView, "id" | "kind" | "title" | "member" | "chapter">; message: MessageView };

/**
 * GET /messages/conversations/{id}/messages — newest page first; `before` pages back through
 * older messages, `after` (a message's createdAt) returns only what arrived since.
 */
export const MessagesQuery = z.object({
  before: z.string().max(200).optional(),
  after: z.string().datetime({ offset: true }).optional(),
  /** Load the page around this message (a search result). */
  around: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type MessagesQuery = z.infer<typeof MessagesQuery>;

/** Oldest first within the page. `olderCursor` is null when there is nothing earlier. */
export type MessagesPage = { conversation: ConversationView; items: MessageView[]; olderCursor: string | null };

/** GET /messages/unread — conversations with something unread (muted ones aside), and waiting requests, for the badge. */
export const MessagesUnread = z.object({ unread: z.number().int(), requests: z.number().int() });
export type MessagesUnread = z.infer<typeof MessagesUnread>;

/** GET /messages/config — what this server offers. */
export type MessagesConfig = {
  /** A translation service is configured. */
  translation: boolean;
  /** Web Push public key, when push notifications are configured. */
  pushPublicKey: string | null;
};

/** POST /push/subscriptions — a browser's Web Push subscription. */
export const PushSubscriptionInput = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInput>;

/**
 * Live events on GET /messages/stream (Server-Sent Events, event name "message"). The stream is
 * per signed-in member; each event says which conversation it concerns.
 */
export type MessageStreamEvent =
  | { type: "message"; conversationId: string; message: MessageView }
  | { type: "message_updated"; conversationId: string; message: MessageView }
  | { type: "typing"; conversationId: string; memberId: string; name: string }
  | { type: "read"; conversationId: string; memberId: string; readAt: string }
  | { type: "conversation"; conversationId: string }
  | { type: "unread"; unread: number; requests: number };
