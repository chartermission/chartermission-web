import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { LinkPreviewInfo } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, events, memberProfiles, opportunities, pages, users } from '../db/schema.js';
import { PostsService } from '../posts/posts.service.js';
import { MediaService } from '../media/media.service.js';

/** Where a preview picture comes from: a stored upload (served by /public/preview-image) or an outside address. */
type Picture = { kind: 'file'; route: string; fileId: string } | { kind: 'url'; url: string };

const ACTIVE = ['active', 'unverified'];
const clip = (text: string | null | undefined, max = 200) => {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/**
 * Link previews (WhatsApp, LinkedIn, Slack, X…) for pages whose content needs a sign-in to see.
 * Preview bots are never signed in, so this returns only what a visitor may already know:
 *  - a member: name, headline and photo only when their profile is public; otherwise nothing
 *    personal (a generic "member of Charter Mission" card);
 *  - chapters, published events, live pages and open opportunities: their title, summary and picture;
 *  - posts and articles: what the post page shows a signed-out visitor (the same access rules).
 * Pictures are re-checked against the same rules when the bot fetches them.
 */
@Injectable()
export class PreviewService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posts: PostsService,
    private readonly media: MediaService,
  ) {}

  async forPath(path: string): Promise<LinkPreviewInfo | null> {
    const parts = path.split('?')[0]!.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
    if (parts.length === 1) return this.member(parts[0]!);
    if (parts.length !== 2) return null;
    const [section, key] = parts as [string, string];
    switch (section) {
      case 'chapters':
        return this.chapter(key);
      case 'events':
        return this.event(key);
      case 'pages':
        return this.page(key);
      case 'opportunities':
        return this.opportunity(key);
      case 'posts':
      case 'articles':
        return this.post(key);
      default:
        return null;
    }
  }

  /** The stored file behind a preview picture, if the rules still allow it. */
  async pictureFile(kind: string, key: string): Promise<string | null> {
    const picture = await this.picture(kind, key);
    return picture?.kind === 'file' ? picture.fileId : null;
  }

  private out(title: string, description: string, picture: Picture | null): LinkPreviewInfo {
    return {
      title: clip(title, 120),
      description: clip(description, 220),
      image: picture ? (picture.kind === 'url' ? picture.url : picture.route) : null,
    };
  }

  private async picture(kind: string, key: string): Promise<Picture | null> {
    switch (kind) {
      case 'member':
        return (await this.memberRow(key))?.picture ?? null;
      case 'chapter':
        return (await this.chapterRow(key))?.picture ?? null;
      case 'event':
        return (await this.eventRow(key))?.picture ?? null;
      case 'page':
        return (await this.pageRow(key))?.picture ?? null;
      case 'post':
        return (await this.postRow(key))?.picture ?? null;
      default:
        return null;
    }
  }

  private file(kind: string, key: string, fileId: string | null | undefined): Picture | null {
    return fileId ? { kind: 'file', route: `/public/preview-image/${kind}/${encodeURIComponent(key)}`, fileId } : null;
  }

  private async clean(fileId: string | null | undefined): Promise<string | null> {
    if (!fileId) return null;
    const row = await this.media.find(fileId);
    return row && row.scanStatus === 'clean' && row.mime.startsWith('image/') ? row.id : null;
  }

  /* ---------- members ---------- */

  private async memberRow(handle: string) {
    if (!/^[a-z0-9-]{2,60}$/i.test(handle)) return null;
    const [row] = await this.db
      .select({ name: memberProfiles.displayName, headline: memberProfiles.headline, avatar: memberProfiles.avatarFileId, visibility: memberProfiles.profileVisibility, status: users.status, handle: memberProfiles.handle })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(eq(memberProfiles.handle, handle.toLowerCase()))
      .limit(1);
    if (!row || !ACTIVE.includes(row.status)) return null;
    const open = row.visibility === 'public';
    return { row, open, picture: open ? this.file('member', row.handle, await this.clean(row.avatar)) : null };
  }

  private async member(handle: string) {
    const found = await this.memberRow(handle);
    if (!found) return null;
    if (!found.open) return this.out('A member of Charter Mission', 'Sign in to see this profile on Charter Mission.', null);
    return this.out(`${found.row.name} · Charter Mission`, found.row.headline ?? 'Member of Charter Mission', found.picture);
  }

  /* ---------- chapters ---------- */

  private async chapterRow(slug: string) {
    const [row] = await this.db
      .select({ name: chapters.name, about: chapters.about, cover: chapters.coverFileId, photo: chapters.photoUrl, status: chapters.status, slug: chapters.slug })
      .from(chapters)
      .where(eq(chapters.slug, slug))
      .limit(1);
    if (!row || row.status !== 'active') return null;
    const cover = await this.clean(row.cover);
    const picture: Picture | null = cover
      ? this.file('chapter', row.slug, cover)
      : row.photo
        ? { kind: 'url', url: `${row.photo}${row.photo.includes('?') ? '&' : '?'}w=1200&h=630&fit=crop&q=80&auto=format` }
        : null;
    return { row, picture };
  }

  private async chapter(slug: string) {
    const found = await this.chapterRow(slug);
    if (!found) return null;
    return this.out(`${found.row.name} · Charter Mission`, found.row.about ?? 'A chapter of Charter Mission.', found.picture);
  }

  /* ---------- events ---------- */

  private async eventRow(slug: string) {
    const [row] = await this.db
      .select({ title: events.title, summary: events.summary, cover: events.coverFileId, status: events.status, slug: events.slug })
      .from(events)
      .where(and(eq(events.slug, slug), inArray(events.status, ['published', 'archived'])))
      .limit(1);
    if (!row) return null;
    return { row, picture: this.file('event', row.slug, await this.clean(row.cover)) };
  }

  private async event(slug: string) {
    const found = await this.eventRow(slug);
    return found ? this.out(found.row.title, found.row.summary ?? '', found.picture) : null;
  }

  /* ---------- pages ---------- */

  private async pageRow(slug: string) {
    const [row] = await this.db
      .select({ name: pages.name, tagline: pages.tagline, about: pages.about, logo: pages.logoFileId, cover: pages.coverFileId, status: pages.status, slug: pages.slug })
      .from(pages)
      .where(and(eq(pages.slug, slug), eq(pages.status, 'active')))
      .limit(1);
    if (!row) return null;
    const fileId = (await this.clean(row.cover)) ?? (await this.clean(row.logo));
    return { row, picture: this.file('page', row.slug, fileId) };
  }

  private async page(slug: string) {
    const found = await this.pageRow(slug);
    return found ? this.out(found.row.name, found.row.tagline ?? found.row.about ?? '', found.picture) : null;
  }

  /* ---------- opportunities ---------- */

  private async opportunity(slug: string) {
    const [row] = await this.db
      .select({ title: opportunities.title, organisation: opportunities.organisation, summary: opportunities.summary })
      .from(opportunities)
      .where(and(eq(opportunities.slug, slug), eq(opportunities.moderationState, 'visible'), isNull(opportunities.deletedAt)))
      .limit(1);
    return row ? this.out(`${row.title} · ${row.organisation}`, row.summary, null) : null;
  }

  /* ---------- posts and articles ---------- */

  private async postRow(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const post = await this.posts.get(undefined, id).catch(() => null);
    if (!post) return null;
    const image = post.attachments.find((a) => a.kind === 'image');
    let fileId = image ? await this.clean(image.id) : null;
    // No picture in the post: the author's photo, when their profile is public.
    if (!fileId && post.author.handle) {
      const author = await this.memberRow(post.author.handle);
      if (author?.open && author.picture?.kind === 'file') fileId = author.picture.fileId;
    }
    return { post, picture: this.file('post', post.id, fileId) };
  }

  private async post(id: string) {
    const found = await this.postRow(id);
    if (!found) return null;
    const { post } = found;
    if (post.article) return this.out(post.article.title, post.article.subtitle ?? clip(post.body, 200), found.picture);
    return this.out(`${post.author.name} on Charter Mission`, clip(post.body, 200) || 'A post on Charter Mission', found.picture);
  }
}
