"use client";

import { useId, useState } from "react";
import { Chip, Icon } from "@chartermission/ui";
import { SearchField } from "@/components/discover/filter-controls";
import { foldText } from "@/components/onboarding/chip-picker";
import { Dialog } from "@/components/social/dialog";
import { useT } from "@/i18n/client";

type Item = { id: string; name: string };

/** How many chips a profile shows per list before "Show all". */
const VISIBLE_TAGS = 8;

/**
 * One of a profile's skills / sectors / interests / languages lists: the first few as chips,
 * and "Show all (n)" opening the full list with a search box.
 */
export function ProfileTagList({ label, items, visible = VISIBLE_TAGS }: { label: string; items?: Item[]; visible?: number }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  const hidden = items.length - visible;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-label uppercase text-secondary">{label}</h3>
      <ul className="flex flex-wrap items-center gap-2">
        {items.slice(0, hidden > 0 ? visible : items.length).map((item) => (
          <li key={item.id}>
            <Chip>{item.name}</Chip>
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-[5px] text-sm font-medium text-primary-light hover:bg-muted hover:underline"
            >
              {t("Show all ({count})", { count: items.length })}
              <span className="sr-only"> {label}</span>
              <Icon name="chevron-right" size={14} />
            </button>
          </li>
        )}
      </ul>
      {open && <TagListDialog label={label} items={items} onClose={() => setOpen(false)} />}
    </div>
  );
}

function TagListDialog({ label, items, onClose }: { label: string; items: Item[]; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState("");
  const q = foldText(query.trim());
  const found = q ? items.filter((item) => foldText(item.name).includes(q) || foldText(t(item.name)).includes(q)) : items;
  return (
    <Dialog title={label} description={t("{count} in total", { count: items.length })} onClose={onClose} width={520} initialFocus="input[type=search]">
      <SearchField
        label="Search this list"
        placeholder="Search"
        value={query}
        autoComplete="off"
        aria-controls={`${id}-items`}
        onChange={(event) => setQuery(event.target.value)}
      />
      <p aria-live="polite" className="sr-only">
        {q ? t("{count} matches", { count: found.length }) : ""}
      </p>
      <div className="h-[min(320px,50dvh)] overflow-y-auto">
        {found.length ? (
          <ul id={`${id}-items`} aria-label={label} className="flex flex-wrap gap-2">
            {found.map((item) => (
              <li key={item.id}>
                <Chip>{item.name}</Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p id={`${id}-items`} className="text-sm text-secondary">
            No matches. Try another word.
          </p>
        )}
      </div>
    </Dialog>
  );
}
