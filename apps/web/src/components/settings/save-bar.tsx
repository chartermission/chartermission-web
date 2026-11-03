"use client";

import { Button, Icon, cn } from "@chartermission/ui";

/** Sticky save bar for settings forms: status on the left, Discard and Save on the right. */
export function SaveBar({
  dirty,
  saving,
  justSaved,
  error,
  onDiscard,
  saveLabel = "Save changes",
}: {
  dirty: boolean;
  saving: boolean;
  justSaved: boolean;
  error: string | null;
  onDiscard: () => void;
  saveLabel?: string;
}) {
  return (
    <div
      className={cn(
        "z-10 flex items-center justify-between gap-4 rounded-card border border-line bg-card px-5 py-3 max-sm:flex-col max-sm:items-stretch",
        dirty && "sticky bottom-4 shadow-[0px_4px_16px_0px_rgba(26,32,44,0.08)]",
      )}
    >
      <p
        role="status"
        aria-live="polite"
        className={cn("flex items-center gap-2 text-sm", error ? "text-error" : "text-secondary")}
      >
        {error ? (
          error
        ) : saving ? (
          "Saving…"
        ) : justSaved && !dirty ? (
          <>
            <span className="flex size-5 items-center justify-center rounded-full bg-success text-inverse">
              <Icon name="check" size={12} />
            </span>
            <span className="text-ink">Your changes have been saved.</span>
          </>
        ) : dirty ? (
          "You have unsaved changes."
        ) : (
          "All changes saved."
        )}
      </p>
      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <Button variant="ghost" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
        )}
        <Button type="submit" disabled={!dirty || saving} aria-busy={saving || undefined}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
