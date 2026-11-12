"use client";

import { useState, type FormEvent } from "react";
import type { ExamsAdminSettings } from "@chartermission/contracts";
import { Button, Chip, Icon } from "@chartermission/ui";
import { TextField } from "@/components/form-field";
import { toast } from "@/components/toast";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { webHref } from "@/lib/navigation";

/**
 * Exams page: the Charter Center connection (mock or live API) and the page certificate posts name
 * (GET/PUT /admin/exams-settings).
 */
export function CharterCenterPanel({ initial }: { initial: ExamsAdminSettings }) {
  const [settings, setSettings] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState(initial.certificatePage?.slug ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const mock = settings.charterCenterMode === "mock";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const next = await api<ExamsAdminSettings>("/admin/exams-settings", { method: "PUT", body: { certificatePageSlug: slug.trim() || null } });
      setSettings(next);
      setSlug(next.certificatePage?.slug ?? "");
      setEditing(false);
      toast("Saved.");
    } catch (e) {
      setError(e instanceof ApiError && e.fields?.certificatePageSlug ? e.fields.certificatePageSlug : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="charter-center-heading" className="flex flex-col gap-3 rounded-card border border-line bg-card px-5 py-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <Icon name="link" size={18} className="text-secondary" />
        <h2 id="charter-center-heading" className="text-h3 text-ink">
          Charter Center
        </h2>
        <Chip tone={mock ? "warning" : "success"} className="px-2! py-0.5! text-xs!">
          {mock ? "Test mode (sample data)" : "Connected"}
        </Chip>
      </div>
      <p className="text-sm text-body">
        {mock
          ? "Students and certificates are samples, so the whole flow can be tried: any email joins (one starting with “unknown” is turned away), and an email containing “pending” waits for its certificate. Set CHARTER_CENTER_EXAMS_API=live on the API once Charter Center’s student lookup and certificate APIs are ready."
          : "Students joining from an exam invitation are checked with Charter Center, and members who pass an exam with a course ID get their certificate from Charter Center."}
      </p>
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <TextField
            label="Charter Center’s page"
            value={slug}
            dir="ltr"
            placeholder="charter-center"
            hint="The page’s link name, or its address. Leave empty to use the page named Charter Center."
            error={error}
            onChange={(e) => setSlug(e.target.value)}
            className="min-w-[280px] flex-1"
          />
          <Button type="submit" size="small" disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" size="small" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-secondary">
          Certificate posts name and appear on:
          {settings.certificatePage ? (
            <a href={webHref(`/pages/${settings.certificatePage.slug}`)} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
              {settings.certificatePage.name}
            </a>
          ) : (
            <span className="font-medium text-warning">no page yet (create a page named Charter Center, or choose one)</span>
          )}
          <button type="button" onClick={() => setEditing(true)} className="font-medium text-primary hover:underline">
            Change
          </button>
        </p>
      )}
    </section>
  );
}
