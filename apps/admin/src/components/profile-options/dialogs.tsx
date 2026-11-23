"use client";

import { useId, useMemo, useState } from "react";
import type { BulkResult, CsvImportResult, ProfileOptionKind, ProfileOptionMergeResult, ProfileOptionRow } from "@chartermission/contracts";
import { Chip, Icon, cn } from "@chartermission/ui";
import { FormModal } from "@/components/ambassadors/modal";
import { FormNotice, TextField, inputClasses } from "@/components/form-field";
import { runBulk } from "@/components/bulk/run-bulk";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { optionsPath } from "./kinds";

const numberFormat = new Intl.NumberFormat("en-US");

/** "Add options": one name per line, sent to the import route (mode add) so many can be added at once. */
export function AddOptionsDialog({ kind, onAdded, onClose }: { kind: ProfileOptionKind; onAdded: () => void; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<CsvImportResult["problems"]>([]);
  const id = useId();

  return (
    <FormModal
      title="Add options"
      description="Type one name per line. Names already in the list are left as they are."
      submitLabel="Add"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        const lines = text.split(/\r?\n/).map((name, i) => ({ row: i + 1, name: name.trim() }));
        const rows = lines.filter((l) => l.name);
        if (rows.length === 0) return setError(t("Type at least one name."));
        setBusy(true);
        setError(null);
        try {
          const result = await api<CsvImportResult>(`${optionsPath(kind)}/import`, { method: "POST", body: { rows, mode: "add", dryRun: false } });
          if (result.created) onAdded();
          if (result.problems.length === 0) {
            toast(t("{count} options added.", { count: result.created }));
            onClose();
            return;
          }
          // Keep only the lines that need fixing.
          const bad = new Set(result.problems.map((p) => p.row));
          const left = rows.filter((r) => bad.has(r.row));
          setText(left.map((r) => r.name).join("\n"));
          setProblems(result.problems.map((p) => ({ ...p, row: left.findIndex((r) => r.row === p.row) + 1 })));
          if (result.created) toast(t("{count} options added.", { count: result.created }));
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-label text-ink">
          Names
        </label>
        <textarea
          id={id}
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Public speaking\nData analysis"}
          className={inputClasses(false, "resize-y font-normal")}
        />
        <p className="text-xs text-secondary">{t("Up to {max} characters each.", { max: 80 })}</p>
      </div>
      {problems.length > 0 && (
        <FormNotice tone="warning">
          <span className="flex flex-col gap-1">
            <span>These lines weren’t added. Fix them and add again:</span>
            <ul className="list-disc ps-5 text-xs">
              {problems.slice(0, 20).map((p) => (
                <li key={`${p.row}-${p.message}`}>{t("Line {row}: {message}", { row: p.row, message: p.message })}</li>
              ))}
            </ul>
          </span>
        </FormNotice>
      )}
    </FormModal>
  );
}

/** Rename an option, or change its slug (the short name used in links and filters). */
export function RenameDialog({
  kind,
  row,
  onSaved,
  onClose,
}: {
  kind: ProfileOptionKind;
  row: ProfileOptionRow;
  onSaved: (row: ProfileOptionRow) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormModal
      title={t("Rename {name}", { name: row.name })}
      submitLabel="Save"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        const name = String(data.get("name") ?? "").trim();
        const slug = String(data.get("slug") ?? "").trim();
        if (!name) return setError(t("Enter a name."));
        setBusy(true);
        setError(null);
        try {
          onSaved(
            await api<ProfileOptionRow>(`${optionsPath(kind)}/${row.id}`, {
              method: "PATCH",
              body: { name, ...(slug && slug !== row.slug ? { slug } : {}) },
            }),
          );
        } catch (e) {
          setError(errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <TextField label="Name" name="name" defaultValue={row.name} maxLength={80} required />
      <TextField
        label="Slug"
        name="slug"
        defaultValue={row.slug}
        maxLength={80}
        hint="Used in links and search filters. Changing it breaks links that use the old one."
      />
    </FormModal>
  );
}

/**
 * Merge one or more options into another of the same list. Members (or events) keep the option
 * chosen here; the merged options are deleted.
 */
export function MergeDialog({
  kind,
  sources,
  candidates,
  onMerged,
  onClose,
}: {
  kind: ProfileOptionKind;
  sources: ProfileOptionRow[];
  /** Every option of this list; the sources are left out of the choices. */
  candidates: ProfileOptionRow[];
  onMerged: (result: BulkResult | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchId = useId();
  const sourceIds = useMemo(() => new Set(sources.map((s) => s.id)), [sources]);
  const choices = useMemo(() => {
    const q = query.trim().toLowerCase();
    return candidates.filter((c) => !sourceIds.has(c.id) && (!q || c.name.toLowerCase().includes(q) || c.slug.includes(q)));
  }, [candidates, sourceIds, query]);
  const single = sources.length === 1 ? sources[0]! : null;
  const events = kind === "event-categories";

  return (
    <FormModal
      title={single ? t("Merge {name} into…", { name: single.name }) : t("Merge {count} options into…", { count: sources.length })}
      description={
        single
          ? events
            ? t("Events in “{name}” move to the category you choose, and “{name}” is deleted.", { name: single.name })
            : t("Members who have “{name}” get the option you choose instead, and “{name}” is deleted. Members who already have both keep just the one you choose.", { name: single.name })
          : events
            ? t("Events in these {count} categories move to the category you choose, and the {count} categories are deleted.", { count: sources.length })
            : t("Members who have any of these {count} options get the option you choose instead, and the {count} options are deleted. Nobody ends up with it twice.", { count: sources.length })
      }
      submitLabel="Merge"
      busy={busy}
      error={error}
      wide
      onClose={onClose}
      onSubmit={async () => {
        if (!target) return setError(t("Choose the option to keep."));
        setBusy(true);
        setError(null);
        const into = candidates.find((c) => c.id === target)!;
        if (single) {
          try {
            await api<ProfileOptionMergeResult>(`${optionsPath(kind)}/${single.id}/merge`, { method: "POST", body: { intoId: target } });
            toast(t("{name} merged into {target}.", { name: single.name, target: into.name }));
            onMerged({ done: [single.id], failed: [] });
          } catch (e) {
            setError(errorMessage(e));
            setBusy(false);
          }
          return;
        }
        const result = await runBulk(`${optionsPath(kind)}/bulk`, { ids: [...sourceIds], action: "merge", intoId: target }, t, "{count} options merged.");
        if (result) onMerged(result);
        else setBusy(false);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={searchId} className="text-label text-ink">
          Keep this option
        </label>
        <span className="relative">
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 start-3 my-auto h-fit text-secondary" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search options"
            className={inputClasses(false, "ps-9")}
          />
        </span>
      </div>
      <div role="radiogroup" aria-label="Keep this option" className="max-h-72 overflow-y-auto rounded-lg border border-line">
        {choices.length === 0 ? (
          <p className="px-3 py-4 text-sm text-secondary">No options match.</p>
        ) : (
          choices.slice(0, 300).map((c) => (
            <label
              key={c.id}
              className={cn(
                "flex cursor-pointer items-center gap-3 border-t border-line px-3 py-2 text-sm first:border-t-0 hover:bg-muted",
                target === c.id && "bg-primary-tint-2",
              )}
            >
              <input type="radio" name="intoId" value={c.id} checked={target === c.id} onChange={() => setTarget(c.id)} className="size-4 accent-primary" />
              <span className="flex-1 text-ink">{c.name}</span>
              {c.status === "hidden" && <Chip tone="neutral">Hidden</Chip>}
              <span className="text-xs text-secondary tabular-nums">{numberFormat.format(c.usage)}</span>
            </label>
          ))
        )}
      </div>
    </FormModal>
  );
}

/** First step of "Import CSV": add new options only, or also update the ones already in the list. */
export function ImportModeDialog({ onChoose, onClose }: { onChoose: (mode: "add" | "upsert") => void; onClose: () => void }) {
  const [mode, setMode] = useState<"add" | "upsert">("add");
  return (
    <FormModal title="Import CSV" description="What should the file do?" submitLabel="Continue" busy={false} onClose={onClose} onSubmit={() => onChoose(mode)}>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">What should the file do?</legend>
        {(
          [
            ["add", "Add new options only", "Options already in the list are left as they are."],
            ["upsert", "Add new options and update existing ones", "Options already in the list get the name, position and status from the file."],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className={cn("flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5", mode === value ? "border-primary bg-primary-tint-2" : "border-line")}>
            <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-0.5 size-4 accent-primary" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-ink">{label}</span>
              <span className="text-xs text-secondary">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </FormModal>
  );
}
