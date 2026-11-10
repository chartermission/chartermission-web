import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { POLICY_REF_LABELS, type MyModerationAction } from "@chartermission/contracts";
import { Chip, Icon, Panel, buttonClasses } from "@chartermission/ui";
import { AppealForm } from "@/components/account/appeal-form";
import { formatDate, formatDateTime } from "@/components/account/format";
import { LoadError } from "@/components/account/load-error";
import { guidelineHref } from "@/components/account/policy-links";
import { ACTION_LABELS, APPEAL_STATUS, TARGET_LABELS, expiryText } from "@/components/account/moderation-labels";
import { SettingsCardSkeleton } from "@/components/settings/settings-card";
import { apiGet, requireViewer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Appeal a decision", robots: { index: false } };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 py-2.5 max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="text-sm text-secondary">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

async function Appeal({ params }: Pick<PageProps<"/[locale]/appeals/[actionId]">, "params">) {
  const { actionId } = await params;
  await requireViewer(`/appeals/${actionId}`);
  let actions: MyModerationAction[];
  try {
    actions = await apiGet<MyModerationAction[]>("/me/moderation-actions");
  } catch {
    return <LoadError title="This decision didn’t load" />;
  }
  const action = actions.find((item) => item.id === actionId);
  if (!action) {
    return (
      <Panel className="flex flex-col items-start gap-3 p-6">
        <h1 className="text-h2 text-ink">We couldn’t find that decision</h1>
        <p className="text-md text-secondary">It may have been reversed, or the link belongs to another account.</p>
        <Link href="/settings/moderation" className={buttonClasses({ variant: "secondary" })}>
          See all decisions
        </Link>
      </Panel>
    );
  }
  const expiry = expiryText(action);
  return (
    <>
      <Panel aria-labelledby="decision-heading" className="flex flex-col gap-3 p-6 max-sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-label text-secondary uppercase">Moderation decision</p>
            <h1 id="decision-heading" className="text-h2 text-ink">
              {ACTION_LABELS[action.action]}
            </h1>
          </div>
          {action.appeal && (
            <Chip tone={APPEAL_STATUS[action.appeal.status].tone}>{APPEAL_STATUS[action.appeal.status].label}</Chip>
          )}
        </div>
        <p className="text-md text-body">{action.summary}</p>
        <dl className="flex flex-col divide-y divide-line border-t border-line">
          <Row label="Applies to">{TARGET_LABELS[action.target.type]}</Row>
          {action.target.preview && (
            <Row label="Content">
              <blockquote className="border-s-2 border-line ps-3 text-secondary">{action.target.preview}</blockquote>
            </Row>
          )}
          <Row label="Guideline">
            {action.policyRef ? (
              <Link href={guidelineHref(action.policyRef)} className="text-primary-light hover:underline">
                {POLICY_REF_LABELS[action.policyRef]}
              </Link>
            ) : (
              "Community Guidelines"
            )}
          </Row>
          <Row label="Date">{formatDateTime(action.createdAt)}</Row>
          {expiry && <Row label="Duration">{expiry}</Row>}
        </dl>
      </Panel>

      <Panel aria-labelledby="appeal-heading" className="flex flex-col gap-4 p-6 max-sm:p-5">
        <h2 id="appeal-heading" className="text-h3 text-ink">
          Your appeal
        </h2>
        {action.appeal ? (
          <div className="flex flex-col gap-2 text-sm text-body">
            <p className="flex items-center gap-2">
              <Icon name="check" size={16} className="text-success" />
              {action.appeal.status === "open" || action.appeal.status === "in_review"
                ? "We’ve received your appeal. A different moderator will review it and we’ll notify you of the outcome."
                : action.appeal.status === "overturned"
                  ? `Your appeal was successful${action.appeal.decidedAt ? ` (${formatDate(action.appeal.decidedAt)})` : ""}. The decision was reversed and any restriction lifted.`
                  : `Your appeal was reviewed${action.appeal.decidedAt ? ` on ${formatDate(action.appeal.decidedAt)}` : ""} and the decision stands. Appeal decisions are final.`}
            </p>
            <p className="text-secondary">Each decision can be appealed once.</p>
          </div>
        ) : action.canAppeal ? (
          <AppealForm actionId={action.id} />
        ) : (
          <p className="text-sm text-body">
            This decision can no longer be appealed. Appeals must be made within the appeal window.
          </p>
        )}
      </Panel>
    </>
  );
}

/** Appeal a moderation action — target of moderation and appeal-outcome notifications. */
export default function AppealPage({ params }: PageProps<"/[locale]/appeals/[actionId]">) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 pt-8 pb-16 max-sm:px-4">
      <Link href="/settings/moderation" className="flex items-center gap-1 self-start text-sm text-secondary hover:text-ink">
        <Icon name="chevron-left" size={16} />
        Moderation & reports
      </Link>
      <Suspense fallback={<SettingsCardSkeleton rows={4} />}>
        <Appeal params={params} />
      </Suspense>
    </main>
  );
}
