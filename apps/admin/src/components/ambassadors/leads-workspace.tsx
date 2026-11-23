"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS, type AdminLeadDetail, type AdminLeadsPage, type AdminLeadSummary, type TeamMember } from "@chartermission/contracts";
import { Button, Chip, FilterSelect, Icon, cn } from "@chartermission/ui";
import { BulkBar } from "@/components/bulk/bulk-bar";
import { runBulk } from "@/components/bulk/run-bulk";
import { SelectAllBox, SelectBox as PickBox } from "@/components/bulk/select-box";
import { useSelection } from "@/components/bulk/use-selection";
import { FormNotice, inputClasses } from "@/components/form-field";
import { SkeletonBar, SkeletonTable } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { Age } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage, isApiError } from "@/lib/api/client";
import { STAGE_TABS, STAGE_TONE, leadsSearch, type LeadsView } from "@/lib/ambassadors";
import { csvRows, datedFileName, downloadText } from "@/lib/csv";
import { LeadFields, leadInputFromForm } from "./lead-fields";
import { Field, FormModal, SelectBox } from "./modal";
import { useT } from "@/i18n/client";

/** Ambassador leads board: stage tabs with counts, filters, the list and "Add lead". */
export function LeadsWorkspace({ view, page, team }: { view: LeadsView; page: AdminLeadsPage; team: TeamMember[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [q, setQ] = useState(view.q);
  const selection = useSelection();
  const visibleIds = page.items.map((l) => l.id);
  const visibleKey = visibleIds.join(",");

  // Leads no longer listed (another stage or filter) drop out of the selection.
  useEffect(() => {
    selection.retain(visibleIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleKey stands for visibleIds
  }, [visibleKey, selection.retain]);

  function go(next: Partial<LeadsView>) {
    startTransition(() => router.push(`/ambassadors${leadsSearch({ ...view, ...next })}`));
  }

  function search(event: FormEvent) {
    event.preventDefault();
    go({ q: q.trim() });
  }

  function exportCsv() {
    const header = ["Name", "Email", "Country", "City", "Organisation", "Job title", "Source", "Stage", "Score", "Onboarding", "Owner", "Has account", "Added", "Updated"];
    const rows = page.items.map((l) => [
      l.fullName,
      l.email,
      l.country.name,
      l.city,
      l.organisation,
      l.jobTitle,
      LEAD_SOURCE_LABELS[l.source],
      LEAD_STAGE_LABELS[l.stage],
      l.scoreTotal,
      l.onboarding ? `${l.onboarding.done}/${l.onboarding.total}` : "",
      l.owner?.name ?? "",
      l.hasAccount ? "Yes" : "No",
      l.createdAt.slice(0, 10),
      l.updatedAt.slice(0, 10),
    ]);
    downloadText(datedFileName("ambassador-leads"), csvRows([header, ...rows]));
    toast(t("{count} leads exported.", { count: rows.length }));
  }

  const openTotal = STAGE_TABS.filter((tab) => ["new", "screening", "review", "interview", "references", "decision", "onboarding"].includes(tab.value)).reduce(
    (n, tab) => n + (page.counts[tab.value as keyof typeof page.counts] ?? 0),
    0,
  );
  const countFor = (value: LeadsView["stage"]) =>
    value === "open" ? openTotal : value === "all" ? Object.values(page.counts).reduce((a, b) => a + b, 0) : value === "closed" ? null : page.counts[value];

  return (
    <div className="flex flex-col gap-4">
      {page.countries.length === 0 && (
        <FormNotice tone="warning">You haven’t been given any countries yet. Ask a Platform Admin to add countries to your manager access.</FormNotice>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <nav aria-label="Pipeline stages" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {STAGE_TABS.map((tab) => {
            const active = view.stage === tab.value;
            const count = countFor(tab.value);
            return (
              <button
                key={tab.value}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => go({ stage: tab.value })}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                  active ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:border-line-strong",
                )}
              >
                {tab.label}
                {count !== null && <span className={cn("text-xs tabular-nums", active ? "text-inverse/80" : "text-secondary")}>{count}</span>}
              </button>
            );
          })}
        </nav>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="secondary" size="small" onClick={exportCsv} disabled={page.items.length === 0}>
            <Icon name="download" size={16} />
            Export CSV
          </Button>
          <Button size="small" onClick={() => setAdding(true)} disabled={page.countries.length === 0}>
            <Icon name="plus" size={16} />
            Add lead
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={search} className="relative min-w-[220px] flex-1 sm:max-w-sm" role="search">
          <Icon name="search" size={16} className="pointer-events-none absolute inset-y-0 left-3 my-auto h-fit text-secondary" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, email, organisation or city"
            aria-label="Search leads"
            className={inputClasses(false, "pl-9")}
          />
        </form>
        <FilterSelect
          label="Country"
          value={view.country}
          onChange={(e) => go({ country: e.target.value })}
          options={[{ value: "", label: "All my countries" }, ...page.countries.map((c) => ({ value: c.code, label: c.name }))]}
        />
        <FilterSelect
          label="Owner"
          value={view.owner}
          onChange={(e) => go({ owner: e.target.value as LeadsView["owner"] })}
          options={[
            { value: "", label: "Anyone’s leads" },
            { value: "me", label: "My leads" },
          ]}
        />
        {pending && <span className="text-xs text-secondary">Loading…</span>}
      </div>

      <div className={cn("overflow-hidden rounded-card border border-line bg-card", pending && "opacity-60")}>
        {page.items.length === 0 ? (
          <EmptyState icon="users" title={view.q || view.country || view.owner ? "No leads match these filters" : "No leads here yet"}>
            {view.stage === "open" && !view.q ? "Add the first ambassador lead to start the pipeline." : "Try another stage or clear the filters."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-start text-sm">
              <thead className="bg-muted text-label text-secondary uppercase">
                <tr>
                  <th scope="col" className="w-10 py-2.5 ps-4 pe-1 font-semibold">
                    <SelectAllBox state={selection.state(visibleIds)} onToggle={() => selection.toggleAll(visibleIds)} />
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">Lead</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">Country</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">Stage</th>
                  <th scope="col" className="px-4 py-2.5 text-end font-semibold">Score</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">Onboarding</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">Owner</th>
                  <th scope="col" className="px-4 py-2.5 text-start font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.items.map((lead) => (
                  <tr key={lead.id} className={cn("hover:bg-muted/40", selection.has(lead.id) && "bg-primary-tint-2/40")}>
                    <td className="py-3 ps-4 pe-1 align-top">
                      <PickBox className="mt-0.5" checked={selection.has(lead.id)} label={t("Select lead {name}", { name: lead.fullName })} onChange={(on) => selection.toggle(lead.id, on)} />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/ambassadors/leads/${lead.id}`} className="font-medium text-ink hover:text-primary hover:underline">
                        {lead.fullName}
                      </Link>
                      <div className="text-xs text-secondary">
                        {[lead.jobTitle, lead.organisation].filter(Boolean).join(", ") || lead.email}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-ink">{lead.country.name}</div>
                      {lead.city && <div className="text-xs text-secondary">{lead.city}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <Chip tone={STAGE_TONE[lead.stage]} className="px-2! py-0.5! text-xs!">
                        {LEAD_STAGE_LABELS[lead.stage]}
                      </Chip>
                      <div className="mt-1 text-xs text-secondary">
                        <Age iso={lead.stageChangedAt} /> in stage
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end tabular-nums">{lead.scoreTotal === null ? <span className="text-secondary">—</span> : `${lead.scoreTotal}/100`}</td>
                    <td className="px-4 py-3">
                      {lead.onboarding ? (
                        <Progress done={lead.onboarding.done} total={lead.onboarding.total} />
                      ) : (
                        <span className="text-xs text-secondary">Not started</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-body">{lead.owner?.name ?? <span className="text-secondary">Unassigned</span>}</td>
                    <td className="px-4 py-3 text-xs text-secondary">
                      <Age iso={lead.updatedAt} /> ago
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {page.truncated && <p className="text-xs text-secondary">Showing the 500 most recently updated leads. Narrow the filters to see the rest.</p>}

      <BulkBar count={selection.count} onClear={selection.clear}>
        <Button variant="secondary" size="small" onClick={() => setAssigning(true)}>
          Assign owner…
        </Button>
      </BulkBar>

      {adding && <NewLeadModal countries={page.countries} team={team} onClose={() => setAdding(false)} />}
      {assigning && (
        <AssignModal
          leads={page.items.filter((l) => selection.has(l.id))}
          team={team}
          onClose={() => setAssigning(false)}
          onDone={(done) => {
            selection.remove(done);
            setAssigning(false);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

/** Picks a new owner for the selected leads (POST /admin/ambassadors/leads/bulk). */
function AssignModal({ leads, team, onDone, onClose }: { leads: AdminLeadSummary[]; team: TeamMember[]; onDone: (done: string[]) => void; onClose: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countries = [...new Map(leads.map((l) => [l.country.code, l.country.name])).entries()];
  const missing = (m: TeamMember) => (m.allCountries ? [] : countries.filter(([code]) => !m.countryCodes.includes(code)).map(([, name]) => name));
  // Those who cover every picked lead first, then the rest with what they don't cover.
  const options = [...team]
    .sort((a, b) => missing(a).length - missing(b).length || a.name.localeCompare(b.name))
    .map((m) => {
      const gaps = missing(m);
      return { value: m.id, label: gaps.length === 0 ? m.name : t("{name} (doesn’t cover {countries})", { name: m.name, countries: gaps.join(", ") }) };
    });

  return (
    <FormModal
      title={t("Assign {count} leads", { count: leads.length })}
      description="Leads in a country the new owner doesn’t cover keep their current owner."
      submitLabel="Assign leads"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async (data) => {
        const ownerId = String(data.get("ownerId") ?? "");
        if (!ownerId) {
          setError("Choose who will own these leads.");
          return;
        }
        setBusy(true);
        setError(null);
        const result = await runBulk("/admin/ambassadors/leads/bulk", { ids: leads.map((l) => l.id), action: "assign", ownerId }, t, "{count} leads assigned.");
        setBusy(false);
        if (result) onDone(result.done);
      }}
    >
      <Field label="Owner for these leads" hint="Only managers who cover a lead’s country can own it.">
        {(id, describedBy) => <SelectBox id={id} name="ownerId" describedBy={describedBy} defaultValue={options[0]?.value} options={options} />}
      </Field>
    </FormModal>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={cn("block h-full rounded-full", done === total ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs text-secondary tabular-nums">
        {done}/{total}
      </span>
    </div>
  );
}

function NewLeadModal({ countries, team, onClose }: { countries: AdminLeadsPage["countries"]; team: TeamMember[]; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(data: FormData) {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const lead = await api<AdminLeadDetail>("/admin/ambassadors/leads", { body: leadInputFromForm(data, "create") });
      toast(t("{fullName} added to the pipeline", { fullName: lead.fullName }));
      router.push(`/ambassadors/leads/${lead.id}`);
    } catch (e) {
      if (isApiError(e) && e.fields) setFields(e.fields);
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <FormModal
      wide
      title="Add an ambassador lead"
      description="Capture who they are and how we found them. You can score and move them through the pipeline from their page."
      submitLabel="Add lead"
      busy={busy}
      error={error}
      onSubmit={submit}
      onClose={onClose}
    >
      <LeadFields countries={countries} team={team} errors={fields} />
    </FormModal>
  );
}

export function LeadsWorkspaceSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonBar key={i} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <SkeletonBar className="h-9 w-80" />
      <SkeletonTable label="Loading ambassador leads" rows={8} />
    </div>
  );
}
