"use client";

import { useState } from "react";
import type { ClaudeContentSettings } from "@chartermission/contracts";
import { Icon, SegmentedControl } from "@chartermission/ui";
import { ReasonDialog } from "@/components/reason-dialog";
import { toast } from "@/components/toast";
import { api } from "@/lib/api/client";

type Mode = ClaudeContentSettings["approval"];

const MODES: Record<Mode, { label: string; explain: string }> = {
  after: {
    label: "Review after publishing",
    explain: "Posts written with Claude go out on time. The team can hold, move or cancel scheduled posts and hide published ones.",
  },
  before: {
    label: "Approve before publishing",
    explain: "Posts written with Claude wait here until someone on the team approves them. Nobody else sees them before that.",
  },
};

/** The review mode for posts written with Claude, with a switch for those who manage settings. */
export function ReviewMode({ mode, canChange, onChanged }: { mode: Mode; canChange: boolean; onChanged: (mode: Mode) => void }) {
  const [pending, setPending] = useState<Mode | null>(null);
  return (
    <section aria-label="Review mode" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
          <Icon name={mode === "before" ? "shield" : "clock"} size={16} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium text-ink">{MODES[mode].label}</p>
          <p className="text-sm text-secondary">{MODES[mode].explain}</p>
        </div>
      </div>
      {canChange && (
        <SegmentedControl
          label="Review mode"
          size="small"
          value={mode}
          onChange={(next) => next !== mode && setPending(next)}
          items={[
            { value: "after", label: MODES.after.label },
            { value: "before", label: MODES.before.label },
          ]}
        />
      )}
      {pending && (
        <ReasonDialog
          title={pending === "before" ? "Approve posts before they are published?" : "Review posts after they are published?"}
          description={
            <div className="flex flex-col gap-2">
              <p>{MODES[pending].explain}</p>
              <p>
                {pending === "before"
                  ? "Posts already published stay up. Scheduled posts already waiting keep their time."
                  : "Posts already waiting for approval keep waiting until someone approves or declines them."}
              </p>
            </div>
          }
          confirmLabel="Switch"
          reasonField="none"
          onConfirm={async () => {
            const saved = await api<ClaudeContentSettings>("/admin/settings/claude-content", { method: "PUT", body: { approval: pending } });
            onChanged(saved.approval);
            setPending(null);
            toast(saved.approval === "before" ? "Posts written with Claude now wait for approval." : "Posts written with Claude now go out on time.");
          }}
          onClose={() => setPending(null)}
        />
      )}
    </section>
  );
}
