"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { InitiativeDetail } from "@chartermission/contracts";
import { Icon, buttonClasses } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { Menu, type MenuItem } from "@/components/social/menu";
import { toast } from "@/components/social/toast";
import { ShareOutButton } from "@/components/social/share-out";
import { FollowButton } from "./initiative-actions";
import { JoinRequestTrigger } from "./join-request";
import { initiativeHref } from "./format";
import { useT } from "@/i18n/client";

/**
 * The hero's buttons: ask to join (or the pending request, which can be withdrawn), follow, share;
 * for organisers Manage (with the number of requests waiting) and Edit; and a menu to leave the team
 * or report the initiative.
 */
export function InitiativeHeaderActions({ initiative, viewerId }: { initiative: InitiativeDetail; viewerId: string }) {
  const t = useT();
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { viewer } = initiative;
  const pending = viewer.request?.status === "pending";
  const canAsk = initiative.status === "recruiting" && !viewer.member && !viewer.canManage;
  const href = initiativeHref(initiative.slug);

  async function withdraw() {
    try {
      await api(`/initiatives/${initiative.id}/join-requests/me`, { method: "DELETE" });
      toast.success("Request withdrawn");
      router.refresh();
    } catch (e) {
      toast.error(e);
    }
  }

  const menu: MenuItem[] = [
    ...(pending ? [{ label: t("Withdraw my request"), icon: "x" as const, onSelect: () => void withdraw() }] : []),
    ...(viewer.member && initiative.lead.id !== viewerId
      ? [{ label: t("Leave the team"), icon: "log-out" as const, onSelect: () => setLeaving(true) }]
      : []),
    ...(!viewer.canManage ? [{ label: t("Report"), icon: "flag" as const, onSelect: () => setReporting(true) }] : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {viewer.canManage && (
        <>
          <Link href={`${href}/manage`} className={buttonClasses({ variant: "accent" })}>
            <Icon name="users" size={16} />
            Manage
            {initiative.pendingRequests > 0 && (
              <span className="min-w-5 rounded-full bg-inverse px-1.5 text-center text-xs leading-5 font-semibold text-accent-hover">
                {initiative.pendingRequests}
              </span>
            )}
          </Link>
          <Link href={`${href}/edit`} className={buttonClasses({ variant: "secondary" })}>
            <Icon name="edit" size={16} />
            Edit
          </Link>
        </>
      )}
      {canAsk && (
        <JoinRequestTrigger variant="accent" size="default">
          Request to join
        </JoinRequestTrigger>
      )}
      {viewer.member && !viewer.canManage && (
        <span className="flex items-center gap-1.5 rounded-lg bg-success-light px-3 py-2 text-sm font-medium text-success">
          <Icon name="check" size={16} />
          You’re on the team
        </span>
      )}
      <FollowButton initiativeId={initiative.id} title={initiative.title} following={viewer.following} size="default" onChange={() => router.refresh()} />
      <ShareOutButton request={{ path: `/initiatives/${initiative.slug}`, title: initiative.title, text: `${initiative.title}: ${initiative.summary}` }} />
      {menu.length > 0 && <Menu label={t("More options for {title}", { title: initiative.title })} items={menu} />}
      {reporting && <ReportDialog targetType="initiative" targetId={initiative.id} subject={`“${initiative.title}”`} onClose={() => setReporting(false)} />}
      {leaving && (
        <ConfirmDialog
          title="Leave the team?"
          confirmLabel="Leave"
          danger
          onConfirm={async () => {
            await api(`/initiatives/${initiative.id}/team/${viewerId}`, { method: "DELETE" });
            toast.success("You’ve left the team");
            router.refresh();
          }}
          onClose={() => setLeaving(false)}
        >
          You’ll stop appearing on the team. You can ask to join again while it’s recruiting.
        </ConfirmDialog>
      )}
    </div>
  );
}
