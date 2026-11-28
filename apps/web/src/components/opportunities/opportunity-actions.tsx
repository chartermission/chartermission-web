"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { APPLICATION_STATUS_LABELS, type MyApplication, type OpportunityDetail } from "@chartermission/contracts";
import { Button, Chip, Icon, Panel, buttonClasses } from "@chartermission/ui";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { relativeTime } from "@/components/social/format";
import { toast } from "@/components/social/toast";
import { api } from "@/lib/api/client";
import { SaveOpportunityButton, applicationTone } from "./opportunity-card";
import { applyLinkLabel } from "./apply-link";
import { ApplyForm, CvTile, applicationRecipient, onlyRecipientSees } from "./apply-form";
import { ShareOpportunityDialog, canShareOpportunity } from "./share-opportunity-dialog";
import { T, useT, useIntlTag } from "@/i18n/client";

/**
 * The listing's action panel. Applicants: apply with the form (note, phone, CV, link), see what they
 * sent and its status, withdraw and apply again (pre-filled) — or, for
 * listings that take applications on the organisation's side (applyUrl), go to that link or email.
 * Poster: applicants link, edit, close or reopen, delete. Everyone: share an open listing to the feed.
 */
export function OpportunityActions({ opportunity: initial }: { opportunity: OpportunityDetail }) {
  const intl = useIntlTag();
  const t = useT();
  const router = useRouter();
  const [o, setO] = useState(initial);
  const [applying, setApplying] = useState(false);
  const [justApplied, setJustApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"withdraw" | "delete" | "report" | "share" | null>(null);
  const app = o.viewer.application;
  const activeApp = app && app.status !== "withdrawn" ? app : null;
  const shareable = canShareOpportunity(o);
  const shareButton = shareable && (
    <Button variant="secondary" size="small" block onClick={() => setModal("share")}>
      <Icon name="share" size={16} />
      Share to feed
    </Button>
  );
  const shareDialog = modal === "share" && <ShareOpportunityDialog opportunity={o} onClose={() => setModal(null)} />;

  function applied(next: OpportunityDetail) {
    setO(next);
    setApplying(false);
    setJustApplied(true);
    toast.success("Application sent");
  }

  async function setOpen(open: boolean) {
    setBusy(true);
    try {
      setO(await api<OpportunityDetail>(`/opportunities/${o.id}/${open ? "reopen" : "close"}`, { method: "POST", body: {} }));
      toast.success(open ? "Listing reopened" : "Listing closed to new applications");
      router.refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  if (o.viewer.isOwner) {
    return (
      <Panel className="flex flex-col gap-4 p-5">
        <h2 className="text-h3 text-ink">Your listing</h2>
        {o.applyUrl ? (
          <p className="flex items-start gap-2 text-sm text-secondary">
            <Icon name={o.applyUrl.startsWith("mailto:") ? "mail" : "external"} size={16} className="mt-px shrink-0" />
            <span>
              People apply on your site or by email, not in Charter Mission.{" "}
              <a href={o.applyUrl} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-primary-light hover:underline">
                {applyLinkLabel(t, o.applyUrl)}
              </a>
            </span>
          </p>
        ) : (
          <p className="text-sm text-secondary">
            {o.applicationCount} {o.applicationCount === 1 ? "applicant" : "applicants"} · posted {relativeTime(intl, t, o.createdAt)}
          </p>
        )}
        {o.moderationState !== "visible" && (
          <p className="flex items-start gap-2 rounded-lg bg-error-light p-3 text-sm text-body">
            <Icon name="alert" size={16} className="mt-px shrink-0 text-error" />
            A moderator {o.moderationState === "removed" ? "removed" : "hid"} this listing, so members can’t see it. Check your account’s moderation page to appeal.
          </p>
        )}
        {!o.applyUrl && o.source === "import" && (
          <p className="flex items-start gap-2 text-xs text-secondary">
            <Icon name="info" size={14} className="mt-px shrink-0" />
            Charter Mission staff review applications to imported listings in the admin console.
          </p>
        )}
        {!o.applyUrl && (
          <Link href={`/opportunities/${o.slug}/applicants`} className={buttonClasses({ block: true })}>
            <Icon name="users" size={18} />
            Review applicants
          </Link>
        )}
        {shareButton}
        <div className="grid grid-cols-2 gap-2">
          <Link href={`/opportunities/${o.slug}/edit`} className={buttonClasses({ variant: "secondary", size: "small" })}>
            Edit
          </Link>
          <Button variant="secondary" size="small" aria-disabled={busy} onClick={() => setOpen(o.status !== "open")}>
            {o.status === "open" ? "Close" : "Reopen"}
          </Button>
        </div>
        <button type="button" onClick={() => setModal("delete")} className="self-start text-sm font-medium text-error hover:underline">
          Delete listing
        </button>
        {modal === "delete" && (
          <ConfirmDialog
            title="Delete this listing?"
            confirmLabel="Delete"
            danger
            onClose={() => setModal(null)}
            onConfirm={async () => {
              await api(`/opportunities/${o.id}`, { method: "DELETE" });
              toast.success("Listing deleted");
              router.push("/opportunities/mine");
            }}
          >
            Applicants will no longer see it. This can’t be undone.
          </ConfirmDialog>
        )}
        {shareDialog}
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h3 text-ink">{activeApp ? "Your application" : "Apply"}</h2>
        <SaveOpportunityButton id={o.id} title={o.title} saved={o.viewer.saved} />
      </div>

      {o.applyUrl && !activeApp ? (
        shareable ? (
          <>
            <a
              href={o.applyUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={buttonClasses({ block: true })}
            >
              <Icon name={o.applyUrl.startsWith("mailto:") ? "mail" : "external"} size={18} className="shrink-0" />
              <span className="truncate">{applyLinkLabel(t, o.applyUrl)}</span>
            </a>
            <p className="flex items-start gap-2 text-xs text-secondary">
              <Icon name="info" size={14} className="mt-px shrink-0" />
              Applications for this opportunity happen on the organisation’s side, not in Charter Mission.
            </p>
          </>
        ) : (
          <p className="flex items-start gap-2 text-sm text-secondary">
            <Icon name="alert" size={16} className="mt-px shrink-0" />
            Applications are closed.
          </p>
        )
      ) : activeApp ? (
        <>
          {justApplied && (
            <p role="status" className="flex items-start gap-2 rounded-lg bg-success-light p-3 text-sm text-ink">
              <Icon name="check" size={16} className="mt-px shrink-0 text-success" />
              Application sent. We’ll notify you when there’s a decision.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={applicationTone[activeApp.status]}>{APPLICATION_STATUS_LABELS[activeApp.status]}</Chip>
            <span className="text-xs text-secondary"><T vars={{ time: relativeTime(intl, t, activeApp.createdAt) }}>{"Sent {time}"}</T></span>
          </div>
          <SentApplication app={activeApp} />
          <p className="text-xs text-secondary">
            {activeApp.status === "accepted"
              ? "The poster accepted your application. Look out for a message from them about next steps."
              : activeApp.status === "declined"
                ? "The poster went with other applicants this time."
                : "The poster can see your profile and what you sent. We’ll notify you when they make a decision."}
          </p>
          {(activeApp.status === "submitted" || activeApp.status === "shortlisted") && (
            <button type="button" onClick={() => setModal("withdraw")} className="self-start text-sm font-medium text-secondary hover:text-error hover:underline">
              Withdraw application
            </button>
          )}
        </>
      ) : o.viewer.canApply ? (
        applying ? (
          <ApplyForm
            opportunity={o}
            previous={app?.status === "withdrawn" ? app : null}
            onApplied={applied}
            onCancel={() => setApplying(false)}
          />
        ) : (
          <>
            <p className="text-sm text-secondary">{onlyRecipientSees(t, applicationRecipient(o))}</p>
            <Button block onClick={() => setApplying(true)}>
              {app?.status === "withdrawn" ? "Apply again" : "Apply now"}
            </Button>
          </>
        )
      ) : (
        <p className="flex items-start gap-2 text-sm text-secondary">
          <Icon name="alert" size={16} className="mt-px shrink-0" />
          {o.viewer.cannotApplyReason ?? "Applications are closed."}
        </p>
      )}

      {o.moreInfoUrl && (
        <a href={o.moreInfoUrl} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1.5 text-sm font-medium text-primary-light hover:underline">
          More information
          <Icon name="external" size={14} />
        </a>
      )}
      {shareButton}
      {o.viewer.canReport && (
        <button type="button" onClick={() => setModal("report")} className="flex items-center gap-1.5 self-start text-xs text-secondary hover:text-ink hover:underline">
          <Icon name="flag" size={14} />
          Report this listing
        </button>
      )}

      {modal === "withdraw" && (
        <ConfirmDialog
          title="Withdraw your application?"
          confirmLabel="Withdraw"
          danger
          onClose={() => setModal(null)}
          onConfirm={async () => {
            setO(await api<OpportunityDetail>(`/opportunities/${o.id}/applications/mine`, { method: "DELETE" }));
            setJustApplied(false);
            toast.success("Application withdrawn");
          }}
        >
          The poster will no longer see it. You can apply again while the listing is open.
        </ConfirmDialog>
      )}
      {shareDialog}
      {modal === "report" && <ReportDialog targetType="opportunity" targetId={o.id} subject={`“${o.title}”`} onClose={() => setModal(null)} />}
    </Panel>
  );
}

/** What the applicant sent: their note, and the phone number, link and CV when they gave them. */
function SentApplication({ app }: { app: MyApplication }) {
  return (
    <div className="flex flex-col gap-2">
      <blockquote dir="auto" className="whitespace-pre-line break-words rounded-lg bg-muted p-3 text-sm text-body">
        {app.note}
      </blockquote>
      {(app.phone || app.link) && (
        <dl className="flex flex-col gap-1.5 text-sm">
          {app.phone && (
            <div className="flex items-center gap-2">
              <dt className="w-14 shrink-0 text-xs text-secondary">Phone</dt>
              <dd dir="ltr" className="min-w-0 truncate text-body">
                {app.phone}
              </dd>
            </div>
          )}
          {app.link && (
            <div className="flex items-center gap-2">
              <dt className="w-14 shrink-0 text-xs text-secondary">Link</dt>
              <dd className="min-w-0 truncate">
                <a href={app.link} target="_blank" rel="noopener noreferrer nofollow" dir="ltr" className="text-primary-light hover:underline">
                  {app.link.replace(/^https?:\/\//i, "")}
                </a>
              </dd>
            </div>
          )}
        </dl>
      )}
      {app.cv && <CvTile cv={app.cv} />}
    </div>
  );
}
