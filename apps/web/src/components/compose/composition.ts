import {
  ALT_TEXT_MAX_CHARS,
  ARTICLE_MAX_CHARS,
  ArticleDetails,
  CelebrationDetails,
  POST_MAX_CHARS,
  RequestDetails,
  compositionIssues,
  type CelebrationCategory,
  type DraftPayload,
  type DraftView,
  type PostComposition,
  type PostType,
  type RequestCategory,
} from "@chartermission/contracts";
import { todayIso } from "@/components/social/post-types/meta";
import { MIN_POLL_OPTIONS, type PollDraft, type PollDuration } from "./poll-builder";

export type Visibility = PostComposition["visibility"];

export type CelebrationFields = { category: CelebrationCategory | null; headline: string; organisation: string };
export type RequestFields = {
  category: RequestCategory | null;
  title: string;
  skills: string[];
  location: string;
  remote: boolean;
  closesOn: string;
};
export type ArticleFields = { title: string; subtitle: string };

/** Everything the composer holds apart from the uploads. */
export type ComposerFields = {
  type: PostType;
  text: string;
  visibility: Visibility;
  announcement: boolean;
  poll: PollDraft | null;
  link: string | null;
  celebration: CelebrationFields;
  request: RequestFields;
  article: ArticleFields;
  /** Kept from a draft so publishing it doesn't lose them. */
  chapterId?: string;
  repostOfId?: string;
};

/** Ready uploads with their descriptions, in order. */
export type ReadyFile = { fileId: string; kind: "image" | "document" | "video"; alt: string };

export const MAX_SKILLS = 8;
export const MAX_SKILL_LENGTH = 40;

export const emptyCelebration = (): CelebrationFields => ({ category: null, headline: "", organisation: "" });
export const emptyRequest = (): RequestFields => ({ category: null, title: "", skills: [], location: "", remote: false, closesOn: "" });
export const emptyArticle = (): ArticleFields => ({ title: "", subtitle: "" });

export function initialFields(type: PostType = "standard"): ComposerFields {
  return {
    type,
    text: "",
    visibility: "members",
    announcement: false,
    poll: null,
    link: null,
    celebration: emptyCelebration(),
    request: emptyRequest(),
    article: emptyArticle(),
  };
}

export function fieldsFromDraft(payload: DraftPayload): ComposerFields {
  const poll = payload.poll
    ? {
        question: payload.poll.question ?? "",
        options: [...(payload.poll.options ?? []), "", ""].slice(0, Math.max(MIN_POLL_OPTIONS, payload.poll.options?.length ?? 0)),
        duration: (payload.poll.durationHours ?? 72) as PollDuration,
      }
    : null;
  return {
    type: payload.type ?? "standard",
    text: payload.body ?? "",
    visibility: payload.visibility ?? "members",
    announcement: payload.kind === "announcement",
    poll,
    link: payload.linkUrl ?? null,
    celebration: {
      category: payload.celebration?.category ?? null,
      headline: payload.celebration?.headline ?? "",
      organisation: payload.celebration?.organisation ?? "",
    },
    request: {
      category: payload.request?.category ?? null,
      title: payload.request?.title ?? "",
      skills: payload.request?.skills ?? [],
      location: payload.request?.location ?? "",
      remote: payload.request?.remote ?? false,
      closesOn: payload.request?.closesOn ?? "",
    },
    article: { title: payload.article?.title ?? "", subtitle: payload.article?.subtitle ?? "" },
    chapterId: payload.chapterId,
    repostOfId: payload.repostOfId,
  };
}

export const maxBodyFor = (type: PostType) => (type === "article" ? ARTICLE_MAX_CHARS : POST_MAX_CHARS);

const opt = (value: string) => (value.trim() ? value.trim() : undefined);

function altTexts(files: ReadyFile[]): Record<string, string> | undefined {
  const entries = files.filter((f) => f.kind === "image" && f.alt.trim()).map((f) => [f.fileId, f.alt.trim().slice(0, ALT_TEXT_MAX_CHARS)] as const);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** The post as POST /posts takes it (type details only for the chosen type). */
export function toComposition(fields: ComposerFields, files: ReadyFile[]): PostComposition {
  const { type } = fields;
  const input: PostComposition = {
    type,
    body: fields.text.trim(),
    attachmentIds: files.map((f) => f.fileId),
    visibility: fields.visibility,
    kind: fields.announcement ? "announcement" : "standard",
  };
  const alts = altTexts(files);
  if (alts) input.altTexts = alts;
  if (fields.chapterId) input.chapterId = fields.chapterId;
  if (type === "standard") {
    if (fields.repostOfId) input.repostOfId = fields.repostOfId;
    if (fields.poll) {
      input.poll = {
        question: fields.poll.question.trim(),
        options: fields.poll.options.map((o) => o.trim()).filter(Boolean),
        durationHours: fields.poll.duration,
      };
    }
  }
  if (type !== "article" && fields.link?.trim()) input.linkUrl = fields.link.trim();
  if (type === "celebration" && fields.celebration.category) {
    input.celebration = {
      category: fields.celebration.category,
      headline: fields.celebration.headline.trim(),
      organisation: opt(fields.celebration.organisation),
    };
  }
  if (type === "request" && fields.request.category) {
    input.request = {
      category: fields.request.category,
      title: fields.request.title.trim(),
      skills: fields.request.skills,
      location: opt(fields.request.location),
      remote: fields.request.remote,
      closesOn: opt(fields.request.closesOn),
    };
  }
  if (type === "article") input.article = { title: fields.article.title.trim(), subtitle: opt(fields.article.subtitle) };
  return input;
}

/** Composer state as a draft: nothing is required yet. */
export function toDraftPayload(fields: ComposerFields, files: ReadyFile[]): DraftPayload {
  const { type } = fields;
  const payload: DraftPayload = {
    type,
    body: fields.text,
    attachmentIds: files.map((f) => f.fileId),
    visibility: fields.visibility,
    kind: fields.announcement ? "announcement" : "standard",
  };
  const alts = altTexts(files);
  if (alts) payload.altTexts = alts;
  if (fields.chapterId) payload.chapterId = fields.chapterId;
  if (type === "standard") {
    if (fields.repostOfId) payload.repostOfId = fields.repostOfId;
    if (fields.poll) payload.poll = { question: fields.poll.question, options: fields.poll.options.slice(0, 4), durationHours: fields.poll.duration };
  }
  const link = fields.link?.trim();
  if (type !== "article" && link && /^https?:\/\/\S+\.\S+/i.test(link)) payload.linkUrl = link;
  if (type === "celebration") {
    payload.celebration = {
      category: fields.celebration.category ?? undefined,
      headline: opt(fields.celebration.headline),
      organisation: opt(fields.celebration.organisation),
    };
  }
  if (type === "request") {
    payload.request = {
      category: fields.request.category ?? undefined,
      title: opt(fields.request.title),
      skills: fields.request.skills.length ? fields.request.skills : undefined,
      location: opt(fields.request.location),
      remote: fields.request.remote || undefined,
      closesOn: /^\d{4}-\d{2}-\d{2}$/.test(fields.request.closesOn) ? fields.request.closesOn : undefined,
    };
  }
  if (type === "article") payload.article = { title: opt(fields.article.title), subtitle: opt(fields.article.subtitle) };
  return payload;
}

/** Is there anything worth keeping as a draft? */
export function hasContent(fields: ComposerFields, fileCount: number): boolean {
  if (fields.text.trim() || fileCount > 0) return true;
  if (fields.type === "standard" && fields.poll && (fields.poll.question.trim() || fields.poll.options.some((o) => o.trim()))) return true;
  if (fields.link?.trim()) return true;
  if (fields.type === "celebration" && (fields.celebration.headline.trim() || fields.celebration.organisation.trim())) return true;
  if (fields.type === "request" && (fields.request.title.trim() || fields.request.skills.length || fields.request.location.trim())) return true;
  if (fields.type === "article" && (fields.article.title.trim() || fields.article.subtitle.trim())) return true;
  return false;
}

/**
 * Field errors, keyed by field: text, poll, link, files, celebration.category,
 * celebration.headline, request.title, article.title …
 */
export type FieldErrors = Record<string, string>;

export type FileState = { busy: boolean; rejected: boolean; hasDocument: boolean };

const sentence = (message: string) => (/[.!?…]$/.test(message) ? message : `${message}.`);

/** Maps an API or contracts issue path to the composer field that shows it. */
export function fieldKey(path: string): string {
  if (path === "body" || path === "_") return "text";
  if (path.startsWith("poll")) return "poll";
  if (path.startsWith("linkUrl") || path.startsWith("link")) return "link";
  if (path.startsWith("attachment") || path.startsWith("altTexts")) return "files";
  if (path === "celebration") return "celebration.category";
  if (path === "request") return "request.category";
  if (path === "article") return "article.title";
  if (path.startsWith("request.skills")) return "request.skills";
  if (path.startsWith("scheduledFor")) return "schedule";
  return path;
}

/** Same rules as the API: compositionIssues() plus the detail schemas and composer-only checks. */
export function validate(fields: ComposerFields, files: ReadyFile[], fileState: FileState): FieldErrors {
  const errors: FieldErrors = {};
  const set = (key: string, message: string) => {
    errors[key] ??= sentence(message);
  };
  const { type } = fields;

  if (type === "celebration") {
    const c = fields.celebration;
    if (!c.category) set("celebration.category", "Choose what you are celebrating");
    const parsed = CelebrationDetails.safeParse({ category: c.category ?? "milestone", headline: c.headline, organisation: opt(c.organisation) });
    if (!parsed.success) for (const issue of parsed.error.issues) set(`celebration.${issue.path.join(".")}`, issue.message);
  }
  if (type === "request") {
    const r = fields.request;
    if (!r.category) set("request.category", "Choose what you are looking for");
    const parsed = RequestDetails.safeParse({
      category: r.category ?? "advice",
      title: r.title,
      skills: r.skills,
      location: opt(r.location),
      remote: r.remote,
      closesOn: opt(r.closesOn),
    });
    if (!parsed.success) for (const issue of parsed.error.issues) set(fieldKey(`request.${issue.path.join(".")}`), issue.message);
    if (r.closesOn && r.closesOn < todayIso()) set("request.closesOn", "Pick today or a later date");
  }
  if (type === "article") {
    const parsed = ArticleDetails.safeParse({ title: fields.article.title, subtitle: opt(fields.article.subtitle) });
    if (!parsed.success) for (const issue of parsed.error.issues) set(`article.${issue.path.join(".")}`, issue.message);
    if (fileState.hasDocument) set("files", "An article’s cover must be an image, not a PDF");
  }

  for (const issue of compositionIssues(toComposition(fields, files))) set(fieldKey(issue.path.join(".")), issue.message);

  if (type === "standard" && fields.poll) {
    const options = fields.poll.options.map((option) => option.trim()).filter(Boolean);
    if (!fields.poll.question.trim()) set("poll", "Add a question for your poll");
    else if (options.length < MIN_POLL_OPTIONS) set("poll", `Add at least ${MIN_POLL_OPTIONS} options`);
    else if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) set("poll", "Each option must be different");
  }
  if (type !== "article" && fields.link !== null && fields.link.trim()) {
    try {
      const url = new URL(fields.link.trim());
      if (!/^https?:$/.test(url.protocol)) throw new Error("protocol");
    } catch {
      set("link", "Enter a full web address starting with https://");
    }
  }
  if (fileState.busy) set("files", "Wait for your files to finish uploading");
  else if (fileState.rejected) set("files", "Remove the files that couldn’t be accepted");
  return errors;
}

/** Map an ApiError's field errors onto composer fields. */
export function mapServerFields(fields: Record<string, string>): FieldErrors {
  const out: FieldErrors = {};
  for (const [path, message] of Object.entries(fields)) out[fieldKey(path)] ??= sentence(message);
  return out;
}

export function draftAltTexts(draft: DraftView | undefined): Record<string, string> {
  return draft?.payload.altTexts ?? {};
}

/** Focus the first field marked invalid inside `root` (radio groups focus their current option). */
export function focusFirstInvalid(root: Element | null | undefined) {
  const el = root?.querySelector<HTMLElement>("[aria-invalid='true']");
  if (!el) return;
  const target = el.getAttribute("role") === "radiogroup" ? el.querySelector<HTMLElement>("[role='radio'][tabindex='0']") : el;
  target?.focus();
  target?.scrollIntoView({ block: "center", behavior: "smooth" });
}
