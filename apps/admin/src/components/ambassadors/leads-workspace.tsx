"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEAD_STAGE_LABELS, type AdminLeadDetail, type AdminLeadsPage, type TeamMember } from "@chartermission/contracts";
import { Button, Chip, FilterSelect, Icon, cn } from "@chartermission/ui";
import { FormNotice, inputClasses } from "@/components/form-field";
import { SkeletonBar, SkeletonTable } from "@/components/skeletons";
import { EmptyState } from "@/components/states";
import { Age } from "@/components/time";
import { toast } from "@/components/toast";
import { api, errorMessage, isApiError } from "@/lib/api/client";
import { STAGE_TABS, STAGE_TONE, leadsSearch, type LeadsView } from "@/lib/ambassadors";
import { LeadFields, leadInputFromForm } from "./lead-fields";
import { FormModal } from "./modal";

/** Ambassador leads board: stage tabs with counts, filters, the list and "Add lead". */
export function LeadsWorkspace({ view, page, team }: { view: LeadsView; page: AdminLeadsPage; team: TeamMember[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState(view.q);

  function go(next: Partial<LeadsView>) {
    startTransition(() => router.push(`/ambassadors${leadsSearch({ ...view, ...next })}`));
  }

  function search(event: FormEvent) {
    event.preventDefault();
    go({ q: q.trim() });
  }

  const openTotal = STAGE_TABS.filter((t) => ["new", "screening", "review", "interview", "references", "decision", "onboarding"].includes(t.value)).reduce(
    (n, t) => n + (page.counts[t.value as keyof typeof page.counts] ?? 0),
    0,
  );
  const countFor = (value: LeadsView["stage"]) =>
    value === "open" ? openTotal : value === "all" ? Object.values(page.counts).reduce((a, b) => a + b, 0) : value === "closed" ? null : page.counts[value];

  return (
    <div className="flex flex-col gap-4">
      {page.countries.length === 0 && (
        <FormNotice tone="warning">You haven’t been given any countries yet. Ask a Platform Admin to add countries to your manager access.</FormNotice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Pipeline stages" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1">
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
                {count !== null && <span className={cn("text-xs", active ? "text-inverse/80" : "text-secondary")}>{count}</span>}
              </button>
            );
          })}
        </nav>
        <Button size="small" onClick={() => setAdding(true)} disabled={page.countries.length === 0}>
          <Icon name="plus" size={16} />
          Add lead
        </Button>
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
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-line bg-muted/60 text-xs text-secondary">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Lead</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Country</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Stage</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Score</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Onboarding</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Owner</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.items.map((lead) => (
                  <tr key={lead.id} className="hover:bg-muted/40">
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
                    <td className="px-4 py-3 tabular-nums">{lead.scoreTotal === null ? <span className="text-secondary">—</span> : `${lead.scoreTotal}/100`}</td>
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

      {adding && <NewLeadModal countries={page.countries} team={team} onClose={() => setAdding(false)} />}
    </div>
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
      toast(`${lead.fullName} added to the pipeline`);
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
