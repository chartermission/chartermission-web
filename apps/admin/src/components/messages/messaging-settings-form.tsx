"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { MessagingSettings, MessagingSettingsView } from "@chartermission/contracts";
import { Avatar, Button, cn, VerifiedBadge } from "@chartermission/ui";
import { FormNotice } from "@/components/form-field";
import { EmptyState } from "@/components/states";
import { toast } from "@/components/toast";
import { api, errorMessage } from "@/lib/api/client";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";

/**
 * The official account bulk messages and inbox replies come from (PUT /admin/settings/messaging,
 * settings.manage). Others with Messages access see the choice without changing it.
 */
export function MessagingSettingsForm({ initial, canEdit }: { initial: MessagingSettingsView; canEdit: boolean }) {
  const t = useT();
  const [view, setView] = useState(initial);
  const [choice, setChoice] = useState<string | null>(initial.senderId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The current sender stays listed even if it is no longer an official account.
  const options = view.sender && !view.options.some((o) => o.id === view.sender!.id) ? [view.sender, ...view.options] : view.options;
  const dirty = choice !== view.senderId;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const body: MessagingSettings = { senderId: choice };
      const next = await api<MessagingSettingsView>("/admin/settings/messaging", { method: "PUT", body });
      setView(next);
      setChoice(next.senderId);
      toast(t("Messaging settings saved."));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sender-title" className="flex flex-col gap-4 rounded-card border border-line bg-card px-5 py-4">
      <div className="flex flex-col gap-1">
        <h2 id="sender-title" className="text-h3 text-ink">
          Sender
        </h2>
        <p className="text-sm text-secondary">Bulk messages and inbox replies come from this official account. Mark an account as official in Members to add it here.</p>
      </div>
      {!view.senderId && (
        <FormNotice tone="warning">No sender is chosen, so bulk messages can’t go to members’ inboxes. Email and notifications still work.</FormNotice>
      )}
      {options.length === 0 ? (
        <EmptyState icon="building" title={t("No official accounts yet")}>
          <span className="flex flex-col items-center gap-2">
            In Members, use “Make official” on the Charter Mission account.
            <Link href="/members" className="font-medium text-primary hover:underline">
              Go to Members
            </Link>
          </span>
        </EmptyState>
      ) : (
        <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2" disabled={!canEdit || busy}>
            <legend className="sr-only">Official account</legend>
            {options.map((o) => {
              const on = choice === o.id;
              return (
                <label
                  key={o.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2.5",
                    on ? "border-primary-light bg-primary-tint-2" : "border-line",
                    canEdit && "cursor-pointer hover:bg-surface",
                  )}
                >
                  <input type="radio" name="sender" value={o.id} checked={on} onChange={() => setChoice(o.id)} className="size-4 accent-primary" />
                  <Avatar name={o.name} src={o.avatarUrl ?? undefined} tone={o.tone} size={40} />
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1 text-sm font-medium text-ink">
                      <NoTranslate>
                        <span className="truncate">{o.name}</span>
                      </NoTranslate>
                      {o.verified && <VerifiedBadge size={14} className="shrink-0" label={t("Verified")} />}
                    </span>
                    <span className="truncate text-xs text-secondary">
                      @{o.handle}
                      {!o.official && <> · {t("No longer an official account")}</>}
                    </span>
                  </span>
                  {view.senderId === o.id && <span className="ms-auto shrink-0 text-xs font-medium text-success">Current</span>}
                </label>
              );
            })}
            {view.senderId && (
              <label className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5", choice === null ? "border-primary-light bg-primary-tint-2" : "border-line", canEdit && "cursor-pointer hover:bg-surface")}>
                <input type="radio" name="sender" value="" checked={choice === null} onChange={() => setChoice(null)} className="size-4 accent-primary" />
                <span className="text-sm text-body">No sender (bulk messages go by email and notification only)</span>
              </label>
            )}
          </fieldset>
          {error && <FormNotice tone="error">{error}</FormNotice>}
          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" size="small" disabled={busy || !dirty} aria-busy={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-secondary">Only Platform Admins can change the sender.</p>
          )}
        </form>
      )}
    </section>
  );
}
