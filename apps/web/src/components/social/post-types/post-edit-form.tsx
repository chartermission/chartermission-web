"use client";

import { useId, useState } from "react";
import {
  ALT_TEXT_MAX_CHARS,
  ARTICLE_MIN_CHARS,
  ArticleDetails,
  CelebrationDetails,
  RequestDetails,
  type MediaLayout,
  type PostView,
  type UpdatePostInput,
} from "@chartermission/contracts";
import { Button, Icon, cn } from "@chartermission/ui";
import { api, ApiError } from "@/lib/api/client";
import { ArticleEditor } from "@/components/compose/article-editor";
import { fieldKey, focusFirstInvalid, maxBodyFor, type CelebrationFields, type FieldErrors, type RequestFields } from "@/components/compose/composition";
import { MediaLayoutPicker, MediaLayoutPreview } from "@/components/compose/media-layout";
import { CelebrationForm, FieldError, RequestForm, TextField } from "@/components/compose/type-fields";
import { ErrorNotice } from "../errors";
import { toast } from "../toast";
import { T, useT } from "@/i18n/client";

const opt = (value: string) => (value.trim() ? value.trim() : undefined);
const sentence = (message: string) => (/[.!?…]$/.test(message) ? message : `${message}.`);

/**
 * Inline editor for an existing post (PATCH /posts/{id}): the text, the type's details
 * (headline, title, skills…), image descriptions and, with several photos, their order and
 * layout. Edited posts are marked "Edited".
 */
export function PostEditForm({ post, onSaved, onCancel }: { post: PostView; onSaved: (post: PostView) => void; onCancel: () => void }) {
  const t = useT();
  const id = useId();
  const [body, setBody] = useState(post.body);
  const [celebration, setCelebration] = useState<CelebrationFields>({
    category: post.celebration?.category ?? null,
    headline: post.celebration?.headline ?? "",
    organisation: post.celebration?.organisation ?? "",
  });
  const [request, setRequest] = useState<RequestFields>({
    category: post.request?.category ?? null,
    title: post.request?.title ?? "",
    skills: post.request?.skills ?? [],
    location: post.request?.location ?? "",
    remote: post.request?.remote ?? false,
    closesOn: post.request?.closesOn ?? "",
  });
  const [article, setArticle] = useState({ title: post.article?.title ?? "", subtitle: post.article?.subtitle ?? "" });
  const attached = post.attachments.filter((a) => a.kind === "image");
  const [order, setOrder] = useState(() => attached.map((image) => image.id));
  const images = order.flatMap((imageId) => attached.find((image) => image.id === imageId) ?? []);
  const [layout, setLayout] = useState<MediaLayout>(post.mediaLayout ?? "collage");
  /** Several photos (not an article's cover): they can be reordered and laid out. */
  const arrangeable = images.length > 1 && !post.article;
  const [alts, setAlts] = useState<Record<string, string>>(() => Object.fromEntries(images.map((image) => [image.id, image.alt ?? ""])));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const max = maxBodyFor(post.type);

  function build(): { input: UpdatePostInput; problems: FieldErrors } {
    const problems: FieldErrors = {};
    const set = (key: string, message: string) => {
      problems[key] ??= sentence(message);
    };
    const text = body.trim();
    // A post can stand on its media, a repost or a shared event alone; anything else needs words.
    if (!text && post.attachments.length === 0 && !post.isRepost && !post.isEventShare && !post.isOpportunityShare) set("text", "Write something before saving");
    else if (text.length > max) set("text", t("Posts can be up to {count} characters", { count: max.toLocaleString("en") }));
    if (post.type === "question" && text && text.length < 10) set("text", "Write your question (at least 10 characters)");
    if (post.type === "article" && text && text.length < ARTICLE_MIN_CHARS) set("text", t("Articles need at least {ARTICLEMINCHARS} characters", { ARTICLEMINCHARS: ARTICLE_MIN_CHARS }));
    const input: UpdatePostInput = { body: text };
    if (images.length) input.altTexts = Object.fromEntries(images.map((image) => [image.id, (alts[image.id] ?? "").trim()]));
    if (arrangeable) {
      if (layout !== (post.mediaLayout ?? "collage")) input.mediaLayout = layout;
      if (order.some((imageId, index) => imageId !== attached[index]?.id)) input.imageOrder = order;
    }
    if (post.type === "celebration") {
      const parsed = CelebrationDetails.safeParse({ ...celebration, organisation: opt(celebration.organisation) });
      if (parsed.success) input.celebration = parsed.data;
      else for (const issue of parsed.error.issues) set(`celebration.${issue.path.join(".")}`, issue.message);
    }
    if (post.type === "request") {
      const parsed = RequestDetails.safeParse({ ...request, location: opt(request.location), closesOn: opt(request.closesOn) });
      if (parsed.success) input.request = parsed.data;
      else for (const issue of parsed.error.issues) set(fieldKey(`request.${issue.path.join(".")}`), issue.message);
    }
    if (post.type === "article") {
      const parsed = ArticleDetails.safeParse({ title: article.title, subtitle: opt(article.subtitle) });
      if (parsed.success) input.article = parsed.data;
      else for (const issue of parsed.error.issues) set(`article.${issue.path.join(".")}`, issue.message);
    }
    return { input, problems };
  }

  /** Move a photo one place earlier (-1) or later (+1), keeping keyboard focus on it. */
  function shift(imageId: string, delta: -1 | 1) {
    const from = order.indexOf(imageId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    [next[from], next[to]] = [next[to]!, next[from]!];
    setOrder(next);
    requestAnimationFrame(() => {
      const same = document.getElementById(`${id}-${imageId}-${delta < 0 ? "earlier" : "later"}`) as HTMLButtonElement | null;
      const other = document.getElementById(`${id}-${imageId}-${delta < 0 ? "later" : "earlier"}`) as HTMLButtonElement | null;
      (same && !same.disabled ? same : other)?.focus();
    });
  }

  async function save() {
    const { input, problems } = build();
    setErrors(problems);
    setError(null);
    if (Object.keys(problems).length) {
      requestAnimationFrame(() => focusFirstInvalid(document.getElementById(`${id}-form`)));
      return;
    }
    setSaving(true);
    try {
      onSaved(await api<PostView>(`/posts/${post.id}`, { method: "PATCH", body: input }));
      toast.success("Post updated");
    } catch (e) {
      if (e instanceof ApiError && e.fields) {
        const mapped: FieldErrors = {};
        for (const [path, message] of Object.entries(e.fields)) mapped[fieldKey(path)] ??= sentence(message);
        setErrors(mapped);
      } else setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div id={`${id}-form`} className="flex flex-col gap-3">
      {post.type === "celebration" && <CelebrationForm value={celebration} onChange={setCelebration} errors={errors} />}
      {post.type === "request" && <RequestForm value={request} onChange={setRequest} errors={errors} />}
      {post.type === "article" && (
        <div className="flex flex-col gap-3">
          <TextField label="Title" required value={article.title} max={150} onChange={(title) => setArticle({ ...article, title })} error={errors["article.title"]} />
          <TextField
            label="Subtitle"
            optional
            value={article.subtitle}
            max={200}
            onChange={(subtitle) => setArticle({ ...article, subtitle })}
            error={errors["article.subtitle"]}
          />
        </div>
      )}

      {post.type === "article" ? (
        <ArticleEditor value={body} onChange={setBody} error={errors.text} mentions={post.mentions} compact label="Edit article text" />
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-edit`} className={post.type === "standard" ? "sr-only" : "text-label text-body"}>
            {post.type === "question" ? "Your question" : post.type === "celebration" ? "The story" : post.type === "request" ? "Details" : "Edit your post"}
          </label>
          <textarea
            id={`${id}-edit`}
            value={body}
            autoFocus={post.type === "standard" || post.type === "question"}
            onChange={(event) => setBody(event.target.value)}
            maxLength={max}
            rows={Math.min(12, Math.max(3, body.split("\n").length + 1))}
            aria-invalid={errors.text ? true : undefined}
            aria-describedby={errors.text ? `${id}-text-error` : undefined}
            className={cn(
              "w-full resize-y rounded-lg border bg-card px-3 py-2 text-md text-ink outline-none focus:ring-2 focus:ring-primary-tint",
              errors.text ? "border-error" : "border-line focus:border-primary-light",
            )}
          />
          <FieldError id={`${id}-text-error`} message={errors.text} />
        </div>
      )}

      {images.length > 0 && (
        <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <legend className="px-1 text-label text-body">{arrangeable ? "Photos" : "Image descriptions"}</legend>
          {images.map((image, index) => (
            <div key={image.id} className="flex items-center gap-3">
              <span className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- permission-checked API media */}
                <img src={image.url} alt="" className="size-11 rounded-md object-cover" />
                {arrangeable && (
                  <span aria-hidden="true" className="absolute -start-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold tabular-nums text-inverse ring-2 ring-card">
                    {index + 1}
                  </span>
                )}
              </span>
              <label htmlFor={`${id}-alt-${image.id}`} className="sr-only">
                <T vars={{ count: index + 1 }}>{"Description for image {count}"}</T>
              </label>
              <input
                id={`${id}-alt-${image.id}`}
                value={alts[image.id] ?? ""}
                maxLength={ALT_TEXT_MAX_CHARS}
                onChange={(event) => setAlts({ ...alts, [image.id]: event.target.value })}
                placeholder="Describe this image for people using screen readers"
                className="h-9 min-w-0 flex-1 rounded-md border border-line bg-card px-2.5 text-sm text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
              />
              {arrangeable && (
                <span className="flex shrink-0">
                  <button
                    id={`${id}-${image.id}-earlier`}
                    type="button"
                    onClick={() => shift(image.id, -1)}
                    disabled={index === 0}
                    className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                    aria-label={t("Move photo {place} earlier", { place: index + 1 })}
                  >
                    <Icon name="chevron-down" size={16} className="rotate-180" />
                  </button>
                  <button
                    id={`${id}-${image.id}-later`}
                    type="button"
                    onClick={() => shift(image.id, 1)}
                    disabled={index === images.length - 1}
                    className="rounded-md p-1.5 text-secondary hover:bg-muted hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                    aria-label={t("Move photo {place} later", { place: index + 1 })}
                  >
                    <Icon name="chevron-down" size={16} />
                  </button>
                </span>
              )}
            </div>
          ))}
          {arrangeable && (
            <>
              <MediaLayoutPicker id={`${id}-layout`} value={layout} onChange={setLayout} />
              <MediaLayoutPreview images={images} layout={layout} />
            </>
          )}
        </fieldset>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-secondary">
          {post.type !== "article" && `${body.length.toLocaleString("en-US")} / ${max.toLocaleString("en-US")} · `}Edited posts are marked “Edited”.
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="small" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="small" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      <div aria-live="polite">{error ? <ErrorNotice error={error} /> : null}</div>
    </div>
  );
}
