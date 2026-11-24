import type {
  ChapterSummary,
  CommentView,
  ConnectionView,
  DraftView,
  GroupDetail,
  GroupSummary,
  MemberRef,
  NotificationView,
  PostView,
  Relationship,
} from '@chartermission/contracts';

/*
 * Compact shapes for tool results. Claude reads every byte of a result, so these keep only what
 * helps it answer or act (ids to act on, links to show the member, text, counts, the member's own
 * reaction) and drop UI-only fields (avatars, tones, permissions flags, breakdowns).
 */

/** Longest post body in a single-post result; articles can be read whole with full_body. */
export const POST_BODY_MAX = 1500;
/** Post bodies in lists are shorter so a page of 20 stays readable. */
export const LIST_BODY_MAX = 500;
const COMMENT_BODY_MAX = 800;

export function clip(text: string, max: number): { text: string; truncated?: true } {
  if (text.length <= max) return { text };
  return { text: text.slice(0, max).trimEnd() + '…', truncated: true };
}

/** Drops null and undefined values so results stay short; "absent" reads the same as "none" here. */
export function prune<T>(value: T): T {
  if (Array.isArray(value)) return value.map(prune) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === null || v === undefined) continue;
      out[key] = prune(v);
    }
    return out as T;
  }
  return value;
}

/** Tool results are compact JSON text. */
export function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(prune(value)) }] };
}

export class Links {
  constructor(private readonly webUrl: string) {}
  post = (id: string) => `${this.webUrl}/posts/${id}`;
  member = (handle: string) => `${this.webUrl}/${handle}`;
  chapter = (slug: string) => `${this.webUrl}/chapters/${slug}`;
  page = (slug: string) => `${this.webUrl}/pages/${slug}`;
  group = (slug: string) => `${this.webUrl}/groups/${slug}`;
  topic = (tag: string) => `${this.webUrl}/topics/${encodeURIComponent(tag)}`;
  /** Notification hrefs are web paths ("/posts/…"); external links are kept. */
  path = (href: string) => (/^https?:\/\//.test(href) ? href : `${this.webUrl}${href.startsWith('/') ? '' : '/'}${href}`);
}

export function memberRef(m: MemberRef) {
  return { id: m.id, handle: m.handle, name: m.name, headline: m.headline, ...(m.staff ? { staff: true } : {}), ...(m.official ? { official: true } : {}) };
}

export function relationship(r: Relationship | undefined) {
  if (!r) return undefined;
  if (r.self) return 'you';
  const parts: string[] = [];
  if (r.connection === 'connected') parts.push('connected');
  else if (r.connection === 'pending_outgoing') parts.push('request sent');
  else if (r.connection === 'pending_incoming') parts.push('request received');
  if (r.following) parts.push('you follow them');
  if (r.followsYou) parts.push('follows you');
  if (r.blocked) parts.push('blocked');
  if (r.canConnect === false) parts.push('follow only');
  return parts.length ? parts.join(', ') : 'none';
}

export function post(p: PostView, links: Links, bodyMax = POST_BODY_MAX) {
  const body = clip(p.body, bodyMax);
  return {
    id: p.id,
    url: links.post(p.id),
    author: p.page ? { page: p.page.name, slug: p.page.slug } : { name: p.author.name, handle: p.author.handle },
    type: p.type,
    ...(p.kind === 'announcement' ? { announcement: true } : {}),
    ...(p.article ? { title: p.article.title, subtitle: p.article.subtitle } : {}),
    ...(p.celebration ? { celebration: p.celebration.headline } : {}),
    ...(p.request ? { lookingFor: p.request.title, closed: p.request.closed } : {}),
    ...(p.question ? { answered: p.question.answered } : {}),
    body: body.text,
    ...(body.truncated ? { bodyTruncated: true } : {}),
    ...(p.poll ? { poll: p.poll.question } : {}),
    ...(p.linkPreview ? { link: p.linkPreview.url } : {}),
    ...(p.attachments.length ? { attachments: p.attachments.length } : {}),
    ...(p.repostOf ? { repostOf: { id: p.repostOf.id, author: p.repostOf.author.name, body: clip(p.repostOf.body, 200).text } } : {}),
    chapter: p.chapter?.slug,
    ...(p.group ? { group: { slug: p.group.slug, name: p.group.name, private: p.group.visibility === 'private' } } : {}),
    ...(p.groupReview && p.groupReview.state !== 'approved' ? { groupReview: p.groupReview.state, ...(p.groupReview.note ? { groupNote: p.groupReview.note } : {}) } : {}),
    hashtags: p.hashtags.length ? p.hashtags : undefined,
    ...(p.status !== 'published' ? { status: p.status } : {}),
    ...(p.chapterReview && p.chapterReview.state !== 'approved' ? { chapterReview: p.chapterReview.state } : {}),
    // Written with Claude while the Charter Mission team approves such posts first.
    ...(p.contentReview ? { teamReview: p.contentReview.state === 'pending' ? 'waiting for the Charter Mission team\'s approval' : 'not approved by the Charter Mission team', ...(p.contentReview.note ? { teamNote: p.contentReview.note } : {}) } : {}),
    ...(p.moderationState && p.moderationState !== 'visible' ? { moderation: p.moderationState } : {}),
    createdAt: p.createdAt,
    ...(p.editedAt ? { edited: true } : {}),
    counts: p.counts,
    yourReaction: p.viewer.reaction,
    ...(p.viewer.canEdit ? { yours: true } : {}),
  };
}

/** A group as Claude needs it: what it is, the member's place in it and whether they can post there. */
export function group(g: GroupSummary | GroupDetail, links: Links) {
  const detail = 'abilities' in g ? g : null;
  return {
    id: g.id,
    slug: g.slug,
    name: g.name,
    url: links.group(g.slug),
    tagline: g.tagline,
    visibility: g.visibility,
    runBy: g.ownerType === 'page' ? { page: g.page?.slug } : g.ownerType === 'chapter' ? { chapter: g.chapter?.slug } : 'a member',
    members: g.memberCount,
    ...(g.status !== 'active' ? { status: g.status } : {}),
    yourRole: g.membership.role,
    ...(g.membership.status !== 'active' && g.membership.status !== 'none' ? { yourStatus: g.membership.status } : {}),
    ...(detail
      ? {
          canPost: detail.abilities.post,
          ...(detail.postApproval ? { postsNeedApproval: true } : {}),
          ...(detail.postPermission === 'admins' ? { onlyAdminsPost: true } : {}),
          about: detail.about ? clip(detail.about, 600).text : null,
          ...(detail.postCount !== null ? { postCount: detail.postCount } : {}),
        }
      : {}),
  };
}

export function comment(c: CommentView): Record<string, unknown> {
  const body = clip(c.body, COMMENT_BODY_MAX);
  return {
    id: c.id,
    author: c.author ? { name: c.author.name, handle: c.author.handle } : null,
    ...(c.state !== 'visible' ? { state: c.state } : {}),
    body: body.text,
    ...(body.truncated ? { bodyTruncated: true } : {}),
    ...(c.isPostAuthor ? { byPostAuthor: true } : {}),
    ...(c.isAcceptedAnswer ? { acceptedAnswer: true } : {}),
    createdAt: c.createdAt,
    reactions: c.counts.reactions,
    yourReaction: c.viewer.reaction,
    ...(c.viewer.canEdit ? { yours: true } : {}),
    ...(c.counts.replies ? { replyCount: c.counts.replies } : {}),
    ...(c.replies.length ? { replies: c.replies.map(comment) } : {}),
  };
}

export function draft(d: DraftView) {
  return {
    id: d.id,
    status: d.status,
    scheduledFor: d.scheduledFor,
    preview: d.preview,
    type: d.payload.type,
    lastError: d.lastError,
    ...(d.status === 'held' ? { teamReview: 'paused by the Charter Mission team' } : {}),
    ...(d.review?.state === 'pending' ? { teamReview: 'waiting for the Charter Mission team\'s approval' } : {}),
    ...(d.review?.state === 'declined' ? { teamReview: 'not approved by the Charter Mission team', ...(d.review.note ? { teamNote: d.review.note } : {}) } : {}),
    updatedAt: d.updatedAt,
  };
}

export function notification(n: NotificationView, links: Links) {
  return {
    id: n.id,
    text: n.segments.map((s) => s.text).join(''),
    url: links.path(n.href),
    ...(n.read ? {} : { unread: true }),
    createdAt: n.createdAt,
  };
}

export function connection(c: ConnectionView, links: Links) {
  return {
    requestId: c.id,
    status: c.status,
    direction: c.direction,
    member: { ...memberRef(c.member), url: links.member(c.member.handle) },
    note: c.note,
    createdAt: c.createdAt,
  };
}

export function chapterSummary(c: ChapterSummary, links: Links) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    country: c.countryName,
    region: c.region,
    followers: c.followers,
    ...(c.viewer.following ? { joined: true } : {}),
    url: links.chapter(c.slug),
  };
}
