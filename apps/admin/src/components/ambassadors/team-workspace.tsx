"use client";

import { useMemo, useState } from "react";
import type { AdminCourseView, AmbassadorTrainingView, CountryRef, ManagerView } from "@chartermission/contracts";
import { Button, Chip, Icon, buttonClasses, cn } from "@chartermission/ui";
import { FormNotice, TextField, inputClasses } from "@/components/form-field";
import { ReasonDialog } from "@/components/reason-dialog";
import { EmptyState } from "@/components/states";
import { DateTime } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage, isApiError } from "@/lib/api/client";
import { FormModal } from "./modal";

type Editing = { mode: "add" } | { mode: "countries"; manager: ManagerView } | { mode: "revoke"; manager: ManagerView } | null;

/** Ambassador Manager sub-accounts and the training every new Ambassador completes. */
export function TeamWorkspace({
  initialManagers,
  countries,
  training: initialTraining,
  catalogue,
  viewerId,
}: {
  initialManagers: ManagerView[];
  countries: CountryRef[];
  training: AmbassadorTrainingView;
  /** Visible Charter Center courses to choose training from (null: no course.curate access). */
  catalogue: AdminCourseView[] | null;
  viewerId: string;
}) {
  const [managers, setManagers] = useState(initialManagers);
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function upsert(view: ManagerView) {
    setManagers((list) => [...list.filter((m) => m.userId !== view.userId), view].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function resend(m: ManagerView) {
    setBusy(m.userId);
    try {
      upsert(await api<ManagerView>(`/admin/ambassadors/managers/${m.userId}/invite`, { method: "POST" }));
      toast(`A new set-password link was sent to ${m.email}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-card border border-line bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="text-md font-semibold text-ink">Ambassador Managers</h2>
            <p className="text-xs text-secondary">
              Staff sub-accounts that add leads and run onboarding for their countries only. They sign in to this console with two-step verification.
            </p>
          </div>
          <Button size="small" onClick={() => setEditing({ mode: "add" })}>
            <Icon name="plus" size={16} />
            Add manager
          </Button>
        </div>
        {managers.length === 0 ? (
          <EmptyState icon="users" title="No managers yet">
            Add a manager to let someone create ambassador leads and onboard them without full admin access.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line bg-muted/60 text-xs text-secondary">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Manager</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Countries</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-5 py-2.5 font-medium">Open leads</th>
                  <th scope="col" className="px-5 py-2.5 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {managers.map((m) => (
                  <tr key={m.userId}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-ink">{m.name}</div>
                      <div className="text-xs text-secondary">{m.email}</div>
                    </td>
                    <td className="max-w-[280px] px-5 py-3">
                      {m.allCountries ? (
                        <Chip tone="info" className="px-2! py-0.5! text-xs!">All countries</Chip>
                      ) : (
                        <span className="text-body">{m.countries.map((c) => c.name).join(", ")}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Chip tone={m.status === "active" ? "success" : "warning"} className="px-2! py-0.5! text-xs!">
                        {m.status === "active" ? "Active" : "Invited"}
                      </Chip>
                      <div className="mt-1 text-xs text-secondary">
                        {m.mfaEnabled ? "Two-step on" : "Two-step not set up"} · since <DateTime iso={m.grantedAt} dateOnly />
                      </div>
                    </td>
                    <td className="px-5 py-3 tabular-nums">{m.openLeads}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        {m.status === "invited" && (
                          <Button size="small" variant="ghost" disabled={busy === m.userId} onClick={() => void resend(m)}>
                            Resend invite
                          </Button>
                        )}
                        <Button size="small" variant="secondary" onClick={() => setEditing({ mode: "countries", manager: m })}>
                          Countries
                        </Button>
                        {m.userId !== viewerId && (
                          <Button size="small" variant="ghost" onClick={() => setEditing({ mode: "revoke", manager: m })}>
                            Remove
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <TrainingSection initial={initialTraining} catalogue={catalogue} />

      {editing?.mode === "add" && <ManagerModal countries={countries} onClose={() => setEditing(null)} onSaved={(m) => (upsert(m), setEditing(null))} />}
      {editing?.mode === "countries" && (
        <ManagerModal countries={countries} manager={editing.manager} onClose={() => setEditing(null)} onSaved={(m) => (upsert(m), setEditing(null))} />
      )}
      {editing?.mode === "revoke" && (
        <ReasonDialog
          title={`Remove ${editing.manager.name}?`}
          description="They lose access to the Ambassadors section straight away. Their leads keep them as owner until you reassign them. Their member account is not affected."
          confirmLabel="Remove access"
          tone="danger"
          reasonField="none"
          onConfirm={async () => {
            await api(`/admin/ambassadors/managers/${editing.manager.userId}`, { method: "DELETE" });
            setManagers((list) => list.filter((m) => m.userId !== editing.manager.userId));
            toast(`${editing.manager.name} no longer has manager access`);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------- Manager form ----------------------------- */

function ManagerModal({
  countries,
  manager,
  onClose,
  onSaved,
}: {
  countries: CountryRef[];
  manager?: ManagerView;
  onClose: () => void;
  onSaved: (m: ManagerView) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(manager?.countries.map((c) => c.code) ?? []));
  const [all, setAll] = useState(manager?.allCountries ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(data: FormData) {
    if (!all && selected.size === 0) {
      setError("Choose at least one country, or tick “All countries”.");
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    const countryCodes = all ? [] : [...selected];
    try {
      const view = manager
        ? await api<ManagerView>(`/admin/ambassadors/managers/${manager.userId}`, { method: "PATCH", body: { countryCodes } })
        : await api<ManagerView>("/admin/ambassadors/managers", {
            body: { name: String(data.get("name") ?? "").trim(), email: String(data.get("email") ?? "").trim(), countryCodes },
          });
      toast(manager ? "Countries updated" : view.status === "invited" ? `Invitation sent to ${view.email}` : `${view.name} can now manage ambassadors`);
      onSaved(view);
    } catch (e) {
      if (isApiError(e) && e.fields) setFields(e.fields);
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <FormModal
      title={manager ? `Countries for ${manager.name}` : "Add an Ambassador Manager"}
      description={
        manager
          ? "They see and work only the leads in these countries."
          : "New people get an email to choose a password, then set up two-step verification at their first sign-in. Existing members keep their account and get manager access."
      }
      submitLabel={manager ? "Save countries" : "Add manager"}
      busy={busy}
      error={error}
      onSubmit={submit}
      onClose={onClose}
    >
      {!manager && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Name" name="name" required maxLength={80} error={fields.name} autoComplete="off" />
          <TextField label="Email" name="email" type="email" required maxLength={254} error={fields.email} autoComplete="off" />
        </div>
      )}
      <CountryPicker countries={countries} selected={selected} onChange={setSelected} all={all} onAll={setAll} error={fields.countryCodes} />
    </FormModal>
  );
}

function CountryPicker({
  countries,
  selected,
  onChange,
  all,
  onAll,
  error,
}: {
  countries: CountryRef[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  all: boolean;
  onAll: (v: boolean) => void;
  error?: string;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? countries.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q) : countries;
  }, [countries, filter]);

  function toggle(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-label text-ink">Countries they manage</legend>
      <label className="flex items-center gap-2 text-sm text-body">
        <input type="checkbox" checked={all} onChange={(e) => onAll(e.target.checked)} className="size-4 accent-primary" />
        All countries, including future ones
      </label>
      {!all && (
        <>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter countries"
            aria-label="Filter countries"
            className={inputClasses(false)}
          />
          <div className="max-h-56 overflow-y-auto rounded-lg border border-line p-2">
            <div className="grid gap-1 sm:grid-cols-2">
              {shown.map((c) => (
                <label key={c.code} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-body hover:bg-muted">
                  <input type="checkbox" checked={selected.has(c.code)} onChange={() => toggle(c.code)} className="size-4 accent-primary" />
                  {c.name}
                </label>
              ))}
              {shown.length === 0 && <p className="px-2 py-1 text-sm text-secondary">No country matches “{filter}”.</p>}
            </div>
          </div>
          <p className="text-xs text-secondary">{selected.size} selected</p>
        </>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
    </fieldset>
  );
}

/* ----------------------------- Training ----------------------------- */

function TrainingSection({ initial, catalogue }: { initial: AmbassadorTrainingView; catalogue: AdminCourseView[] | null }) {
  const [courses, setCourses] = useState(initial.courses);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(ids: string[], done: string) {
    setBusy(true);
    try {
      const view = await api<AmbassadorTrainingView>("/admin/ambassadors/training", { method: "PUT", body: { courseIds: ids } });
      setCourses(view.courses);
      toast(done);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const chosen = new Set(courses.map((c) => c.id));
  const options = (catalogue ?? []).filter((c) => !chosen.has(c.id)).sort((a, b) => a.title.localeCompare(b.title));

  return (
    <section className="rounded-card border border-line bg-card">
      <div className="border-b border-line px-5 py-3">
        <h2 className="text-md font-semibold text-ink">Required training</h2>
        <p className="text-xs text-secondary">
          Charter Center courses every new Ambassador completes during onboarding. They are listed in the onboarding email, and managers tick each one off.
        </p>
      </div>
      <div className="flex flex-col gap-4 p-5">
        {courses.length === 0 ? (
          <FormNotice tone="info">No courses are required yet. Onboarding started now skips the training step.</FormNotice>
        ) : (
          <ol className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {courses.map((c, i) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="w-5 text-xs text-secondary tabular-nums">{i + 1}.</span>
                <a href={c.startUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-ink hover:text-primary hover:underline">
                  {c.title}
                </a>
                {!c.available && <Chip tone="error" className="px-2! py-0.5! text-xs!">Hidden or removed</Chip>}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(courses.filter((x) => x.id !== c.id).map((x) => x.id), "Course removed from the training")}
                  className="rounded-md p-1 text-secondary hover:bg-muted hover:text-ink"
                >
                  <Icon name="x" size={16} label={`Remove ${c.title}`} />
                </button>
              </li>
            ))}
          </ol>
        )}
        {catalogue === null ? (
          <p className="text-xs text-secondary">You need course curation access to choose from the catalogue.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="relative min-w-[260px] flex-1">
              <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Course to add" className={cn(inputClasses(false), "appearance-none pr-9")}>
                <option value="">{options.length ? "Choose a Charter Center course…" : "Every visible course is already required"}</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-secondary" />
            </span>
            <button
              type="button"
              disabled={!choice || busy}
              onClick={() => void save([...courses.map((c) => c.id), choice], "Course added to the training").then(() => setChoice(""))}
              className={buttonClasses({ variant: "secondary", size: "small" })}
            >
              Add course
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
