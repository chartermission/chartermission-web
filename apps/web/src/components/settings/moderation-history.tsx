"use client";

import Link from "next/link";
import { useState } from "react";
import {
  POLICY_REF_LABELS,
  REPORT_REASON_LABELS,
  type MyModerationAction,
  type MyReport,
  type Page,
} from "@chartermission/contracts";
import { Button, Chip, Icon, buttonClasses } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { formatDate } from "@/components/account/format";
import {
  ACTION_LABELS,
  APPEAL_STATUS,
  REPORTED_LABELS,
  REPORT_STATUS,
  TARGET_LABELS,
  expiryText,
} from "@/components/account/moderation-labels";
import { guidelineHref } from "@/components/account/policy-links";
import { SettingsCard } from "./settings-card";

/** Actions on the member's account or content (GET /me/moderation-actions), with appeal entry points. */
export function ModerationActions({ actions }: { actions: MyModerationAction[] }) {
  return (
    <SettingsCard
      id="actions"
      title="Actions on your account"
      description="When a moderator acts on your account or content, it appears here with the guideline it relied on."
    >
      {actions.length === 0 ? (
        <li className="flex items-center gap-3 py-5 text-sm text-secondary">
          <Icon name="check" size={18} className="text-success" />
          No moderation actions. Your account is in good standing.
        </li>
      ) : (
        actions.map((action) => {
          const expiry = expiryText(action);
          return (
            <li key={action.id} className="flex flex-col gap-2.5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">{ACTION_LABELS[action.action]}</span>
                  <span className="text-xs text-secondary">
                    {TARGET_LABELS[action.target.type]} · {formatDate(action.createdAt)}
                    {expiry ? ` · ${expiry}` : ""}
                  </span>
                </div>
                {action.appeal ? (
                  <Chip tone={APPEAL_STATUS[action.appeal.status].tone} className="px-2.5 py-0.5 text-xs">
                    {APPEAL_STATUS[action.appeal.status].label}
                  </Chip>
                ) : null}
              </div>
              <p className="text-sm text-body">{action.summary}</p>
              {action.target.preview && (
                <blockquote className="line-clamp-2 border-s-2 border-line ps-3 text-sm text-secondary">
                  {action.target.preview}
                </blockquote>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {action.policyRef ? (
                  <Link href={guidelineHref(action.policyRef)} className="text-xs font-medium text-primary-light hover:underline">
                    Guideline: {POLICY_REF_LABELS[action.policyRef]}
                  </Link>
                ) : (
                  <span />
                )}
                {action.canAppeal ? (
                  <Link href={`/appeals/${action.id}`} className={buttonClasses({ variant: "secondary", size: "small" })}>
                    Appeal
                  </Link>
                ) : action.appeal ? (
                  <Link href={`/appeals/${action.id}`} className="text-sm font-medium text-primary-light hover:underline">
                    View appeal
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })
      )}
    </SettingsCard>
  );
}

/** Reports the member made (GET /me/reports), in general terms (spec 4.15). */
export function MyReports({ initial }: { initial: Page<MyReport> }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<MyReport>>("/me/reports", { query: { cursor, limit: 20 } });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(isApiError(e) ? e.message : "More reports didn’t load. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingsCard
      id="reports"
      title="Your reports"
      description="What happened to the things you reported. We don’t share details of action taken against other members."
    >
      {items.length === 0 ? (
        <li className="flex items-center gap-3 py-5 text-sm text-secondary">
          <Icon name="flag" size={18} />
          You haven’t reported anything. Use “Report” on a post, comment or profile if something breaks the guidelines.
        </li>
      ) : (
        items.map((report) => (
          <li key={report.id} className="flex flex-col gap-1.5 py-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="text-sm font-medium text-ink">
                {REPORTED_LABELS[report.targetType]} · {REPORT_REASON_LABELS[report.reason]}
              </span>
              <Chip tone={REPORT_STATUS[report.status].tone} className="px-2.5 py-0.5 text-xs">
                {REPORT_STATUS[report.status].label}
              </Chip>
            </div>
            <p className="text-sm text-body">{report.summary}</p>
            <span className="text-xs text-secondary">
              Reported {formatDate(report.createdAt)}
              {report.resolvedAt ? ` · Resolved ${formatDate(report.resolvedAt)}` : ""}
            </span>
          </li>
        ))
      )}
      {(cursor || error) && (
        <li className="flex items-center gap-3 py-3">
          {cursor && (
            <Button variant="ghost" size="small" onClick={() => void loadMore()} disabled={loading}>
              {loading ? "Loading…" : "Show more"}
            </Button>
          )}
          {error && (
            <span role="alert" className="text-sm text-error">
              {error}
            </span>
          )}
        </li>
      )}
    </SettingsCard>
  );
}
