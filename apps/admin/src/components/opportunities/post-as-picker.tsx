"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PageRef } from "@chartermission/contracts";
import { Avatar, Button, Icon, cn } from "@chartermission/ui";
import { useT } from "@/i18n/client";

/*
 * "Post as" for imported opportunities: Charter Mission's official pages (the batch default) and the
 * organisation pages the team runs. Each review row shows a small button with the page it will be
 * posted as; it opens a popup with a search box (when the list is long), the pages in two groups and
 * "Create organisation".
 */

/** Case- and accent-insensitive key for matching an organisation name to a page name. */
export const nameKey = (v: string | null | undefined) =>
  (v ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A page's logo, or its initials. */
export function PageMark({ page, size = 24 }: { page: Pick<PageRef, "name" | "logoUrl">; size?: 24 | 32 }) {
  return <Avatar name={page.name} size={size} tone="tint" src={page.logoUrl ?? undefined} className="rounded-md" />;
}

/** The compact control on a review row: "Post as [logo] Charter Mission ▾". */
export function PostAsButton({ page, isDefault, disabled, onClick }: { page: PageRef | null; isDefault: boolean; disabled?: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={page ? t("Post as {page}. Change", { page: page.name }) : t("Choose the page to post as")}
      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line-strong bg-card py-1 ps-1.5 pe-2 text-sm text-ink hover:bg-muted disabled:opacity-60"
    >
      <span className="text-xs text-secondary">Post as</span>
      {page && <PageMark page={page} />}
      <span className="min-w-0 truncate font-medium" dir="auto">
        {page?.name ?? t("Choose a page")}
      </span>
      {isDefault && <span className="text-xs text-secondary">(default)</span>}
      <Icon name="chevron-down" size={14} className="shrink-0 text-secondary" />
    </button>
  );
}

const SEARCH_FROM = 8;

/**
 * The popup. `value` is the row's own page (null: the batch default, `defaultId`). Choosing the
 * default page clears the row's own choice, so the row follows the batch default.
 */
export function PostAsDialog({
  pages,
  value,
  defaultId,
  organisation,
  onChoose,
  onCreate,
  onClose,
}: {
  pages: PageRef[];
  value: string | null;
  defaultId: string;
  /** The row's organisation, offered as the name of a new page. */
  organisation: string;
  onChoose: (pageId: string | null) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const chosen = value ?? defaultId;
  const searchable = pages.length >= SEARCH_FROM;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    inputRef.current?.focus();
  }, []);

  const q = nameKey(query);
  const filtered = useMemo(() => (q ? pages.filter((p) => nameKey(p.name).includes(q) || p.slug.includes(q.replace(/ /g, "-"))) : pages), [pages, q]);
  const sections = [
    { key: "official", title: t("Charter Mission"), items: filtered.filter((p) => p.official) },
    { key: "organisations", title: t("Organisation pages the team runs"), items: filtered.filter((p) => !p.official) },
  ].filter((section) => section.items.length > 0);
  const flat = sections.flatMap((section) => section.items);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  function choose(page: PageRef | undefined) {
    if (!page) return;
    onChoose(page.id === defaultId ? null : page.id);
    ref.current?.close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") setActive(Math.min(current + 1, flat.length - 1));
    else if (event.key === "ArrowUp") setActive(Math.max(current - 1, 0));
    else if (event.key === "Enter") choose(flat[current]);
    else return;
    event.preventDefault();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={() => onCloseRef.current()}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) ref.current?.close();
      }}
      className="m-auto w-[440px] max-w-[calc(100vw-32px)] rounded-card border border-line bg-card p-0 text-ink shadow-[0_12px_40px_rgba(25,37,80,0.18)] backdrop:bg-primary-dark/40 open:flex open:max-h-[min(600px,calc(100dvh-32px))] open:flex-col"
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
        <div className="flex flex-col gap-1">
          <h2 id={`${id}-title`} className="text-h3 text-ink">
            Post as
          </h2>
          <p className="text-sm text-secondary">The listing shows this page as the poster. Charter Mission is the default.</p>
        </div>
        <button type="button" onClick={() => ref.current?.close()} className="-m-1 rounded-md p-1 text-secondary hover:bg-muted hover:text-ink">
          <Icon name="x" size={18} label={t("Close")} />
        </button>
      </div>
      {searchable && (
        <div className="relative mx-5 mb-2 flex items-center">
          <Icon name="search" size={14} className="pointer-events-none absolute start-2.5 text-secondary" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={t("Search pages")}
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={flat[current] ? `${id}-${flat[current]!.id}` : undefined}
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("Search pages")}
            className="w-full rounded-lg border border-line bg-card py-1.5 ps-8 pe-3 text-sm text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-light/20"
          />
        </div>
      )}
      <div id={`${id}-list`} role="listbox" aria-label={t("Post as")} className="min-h-24 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {sections.map((section) => (
          <div key={section.key} role="group" aria-labelledby={`${id}-${section.key}`}>
            <div id={`${id}-${section.key}`} className="sticky top-0 z-10 bg-card px-2 pt-2.5 pb-1 text-label text-secondary uppercase">
              {section.title}
            </div>
            {section.items.map((page) => {
              const i = flat.indexOf(page);
              const on = page.id === chosen;
              return (
                <div
                  key={page.id}
                  id={`${id}-${page.id}`}
                  role="option"
                  aria-selected={on}
                  onClick={() => choose(page)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm text-body",
                    i === current && searchable ? "bg-primary-tint-2" : "hover:bg-muted",
                    on && "font-medium text-ink",
                  )}
                >
                  <PageMark page={page} />
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {page.name}
                  </span>
                  {page.id === defaultId && <span className="shrink-0 text-xs font-normal text-secondary">Default</span>}
                  <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center text-primary">
                    {on && <Icon name="check" size={16} />}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {flat.length === 0 && <p className="px-2 py-4 text-center text-sm text-secondary">{t("Nothing matches “{q}”.", { q: query.trim() })}</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <Button
          variant="secondary"
          size="small"
          onClick={() => {
            onCreate();
            ref.current?.close();
          }}
        >
          <Icon name="plus" size={14} />
          Create organisation
        </Button>
        {organisation && (
          <span className="min-w-0 truncate text-xs text-secondary" dir="auto">
            {t("A page for {organisation}, with basic details", { organisation })}
          </span>
        )}
      </div>
    </dialog>
  );
}
