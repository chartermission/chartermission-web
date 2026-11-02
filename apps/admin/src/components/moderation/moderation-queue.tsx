"use client";

import { useId, useState } from "react";
import { Chip, cn } from "@chartermission/ui";
import { DialogSelect, ReasonDialog } from "@/components/reason-dialog";
import { moderationActions, type ModerationAction } from "./moderation-actions";
import { ReportDetail, type Resolution } from "./report-detail";
import { priorityChip, queueTabs, type QueueItem, type QueueTab } from "@/lib/mock/moderation";

type Pending = { item: QueueItem; action: ModerationAction };

function firstIn(items: QueueItem[], tab: QueueTab) {
  return items.find((item) => item.tab === tab)?.id ?? "";
}

/**
 * Moderation queue: tabs, case table and detail panel (Figma nodes 12:1665 – 12:1731).
 * Every action goes through a confirmation that requires a reason for the audit log.
 */
export function ModerationQueue({ initialItems }: { initialItems: QueueItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<QueueTab>("reports");
  const [selected, setSelected] = useState<Record<QueueTab, string>>(() => ({
    reports: firstIn(initialItems, "reports"),
    hidden: firstIn(initialItems, "hidden"),
    appeals: firstIn(initialItems, "appeals"),
    uploads: firstIn(initialItems, "uploads"),
  }));
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const ids = useId();

  const rows = items.filter((item) => item.tab === tab);
  const current = rows.find((item) => item.id === selected[tab]) ?? rows[0];

  function openCount(value: QueueTab) {
    const total = queueTabs.find((t) => t.value === value)?.total ?? 0;
    const resolved = items.filter((item) => item.tab === value && resolutions[item.id]).length;
    return Math.max(total - resolved, 0);
  }

  function confirm(reason: string, data: FormData) {
    if (!pending) return;
    const { item, action } = pending;
    const duration = action.durations?.find((d) => d.value === data.get("duration"))?.label;
    const at = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, status: action.result } : row)));
    setResolutions((prev) => ({ ...prev, [item.id]: { action, reason, duration, at } }));
    setAnnouncement(`${item.id}: ${action.outcome.toLowerCase()}${duration ? ` for ${duration}` : ""}. Reason recorded in the audit log.`);
    setPending(null);
  }

  const caseLabel = queueTabs.find((t) => t.value === tab)?.caseLabel ?? "Case";

  return (
    <>
      <div role="tablist" aria-label="Moderation queues" className="flex flex-wrap gap-6">
        {queueTabs.map((t) => {
          const active = t.value === tab;
          return (
            <button
              key={t.value}
              id={`${ids}-tab-${t.value}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${ids}-panel`}
              onClick={() => setTab(t.value)}
              className={cn(
                "flex flex-col gap-2.5 rounded-sm text-md transition-colors",
                active ? "font-medium text-primary" : "text-secondary hover:text-ink",
              )}
            >
              {t.label} ({openCount(t.value)})
              <span aria-hidden="true" className={cn("h-[3px] w-full", active && "bg-accent")} />
            </button>
          );
        })}
      </div>

      <div
        id={`${ids}-panel`}
        role="tabpanel"
        aria-labelledby={`${ids}-tab-${tab}`}
        className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]"
      >
        <div className="overflow-x-auto rounded-card border border-line bg-card">
          <table className="w-full min-w-[640px] table-fixed border-collapse text-left">
            <caption className="sr-only">
              {queueTabs.find((t) => t.value === tab)?.label}. Select a row to review it.
            </caption>
            <colgroup>
              <col />
              <col className="w-[162px]" />
              <col className="w-[82px]" />
              <col className="w-[108px]" />
              <col className="w-[96px]" />
            </colgroup>
            <thead className="bg-muted text-label text-secondary uppercase">
              <tr>
                <th scope="col" className="py-3 pr-3 pl-4 font-semibold">Content</th>
                <th scope="col" className="py-3 pr-3 font-semibold">Reason</th>
                <th scope="col" className="py-3 pr-3 font-semibold">Reports</th>
                <th scope="col" className="py-3 pr-3 font-semibold">Status</th>
                <th scope="col" className="py-3 pr-4 font-semibold">Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const isSelected = item.id === current?.id;
                const resolution = resolutions[item.id];
                const chip = resolution
                  ? { label: resolution.action.outcome, tone: resolution.action.outcomeTone }
                  : priorityChip[item.priority];
                return (
                  <tr
                    key={item.id}
                    onClick={() => setSelected((prev) => ({ ...prev, [tab]: item.id }))}
                    className={cn(
                      "cursor-pointer border-t border-line text-sm transition-colors first:border-t-0",
                      isSelected ? "bg-primary-tint-2" : "hover:bg-surface",
                    )}
                  >
                    <td className="py-3.5 pr-3 pl-4">
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        aria-controls={`${ids}-detail`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected((prev) => ({ ...prev, [tab]: item.id }));
                        }}
                        className="rounded-sm text-left font-medium text-ink"
                      >
                        {item.content}
                      </button>
                    </td>
                    <td className="py-3.5 pr-3 text-body">{item.reason}</td>
                    <td className="py-3.5 pr-3 text-body">{item.reports}</td>
                    <td className="py-3.5 pr-3">
                      <Chip tone={chip.tone}>{chip.label}</Chip>
                    </td>
                    <td className="py-3.5 pr-4 text-secondary">{item.age}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {current && (
          <ReportDetail
            id={`${ids}-detail`}
            item={current}
            caseLabel={caseLabel}
            actions={moderationActions[tab]}
            tab={tab}
            resolution={resolutions[current.id]}
            onAction={(action) => setPending({ item: current, action })}
          />
        )}
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {pending && (
        <ReasonDialog
          title={pending.action.confirmTitle}
          description={
            <>
              <p className="mb-1 font-medium text-ink">
                {caseLabel} #{pending.item.id} · {pending.item.content}
              </p>
              <p>{pending.action.confirmDescription}</p>
            </>
          }
          confirmLabel={pending.action.confirmLabel}
          tone={pending.action.confirmTone}
          onConfirm={confirm}
          onClose={() => setPending(null)}
        >
          {pending.action.durations && (
            <DialogSelect
              label="Duration"
              name="duration"
              options={pending.action.durations}
              defaultValue={pending.action.durations[0]?.value}
            />
          )}
        </ReasonDialog>
      )}
    </>
  );
}
