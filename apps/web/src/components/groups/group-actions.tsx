"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GroupDetail } from "@chartermission/contracts";
import { Button, Icon, buttonClasses } from "@chartermission/ui";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { absoluteUrl } from "@/components/social/links";
import { Menu, type MenuItem } from "@/components/social/menu";
import { openShare } from "@/components/social/share-out";
import { toast } from "@/components/social/toast";
import type { Viewer } from "@/components/social/viewer";
import { useT } from "@/i18n/client";
import { groupHref } from "./group-parts";
import { GroupInviteDialog } from "./invite-dialog";
import { JoinGroupButton, leaveGroup } from "./join-group-button";

/** Opens the Manage tab (the tabs follow the address's #hash). */
export function openManageTab() {
  window.location.hash = "manage";
}

/**
 * The group header's buttons, by what the viewer may do: Join / Ask to join / Accept (or Joined,
 * Requested), Invite, Manage (with what waits), Share, and Leave in the menu.
 */
export function GroupActions({ group, viewer }: { group: GroupDetail; viewer: Viewer }) {
  const t = useT();
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { abilities, membership } = group;
  const waiting = group.pending ? group.pending.requests + group.pending.posts : 0;
  const showJoin = membership.status !== "none" || abilities.join !== "none";
  const path = groupHref(group.slug);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(absoluteUrl(path));
      toast.success(t("Link copied"));
    } catch {
      toast.error(new Error("copy"));
    }
  }

  const share = () => openShare({ path, title: group.name, text: group.tagline ? `${group.name}: ${group.tagline}` : group.name });

  const menu: MenuItem[] = [
    { label: t("Share"), icon: "share", onSelect: share },
    { label: t("Copy link"), icon: "link", onSelect: copyLink },
    ...(abilities.leave && membership.status === "active" ? [{ label: t("Leave group"), icon: "log-out" as const, danger: true, onSelect: () => setLeaving(true) }] : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showJoin && !(membership.status === "active" && (abilities.moderate || abilities.manage)) && (
        <JoinGroupButton
          group={group}
          membership={membership}
          size="default"
          onChange={() => router.refresh()}
        />
      )}
      {abilities.invite && (
        <Button variant={membership.status === "active" && !abilities.moderate ? "primary" : "secondary"} onClick={() => setInviting(true)}>
          <Icon name="user-plus" size={18} />
          {t("Invite")}
        </Button>
      )}
      {(abilities.moderate || abilities.manage) && (
        <a href="#manage" className={buttonClasses({ variant: "secondary" })}>
          <Icon name="shield" size={18} />
          {t("Manage")}
          {waiting > 0 && (
            <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-inverse">
              <span aria-hidden="true">{waiting > 99 ? "99+" : waiting}</span>
              <span className="sr-only">{t("{count} waiting", { count: waiting })}</span>
            </span>
          )}
        </a>
      )}
      <Menu
        label={t("More actions for {name}", { name: group.name })}
        items={menu}
        trigger={
          <span className="flex size-[42px] items-center justify-center rounded-lg border border-line-strong text-body">
            <Icon name="more" size={20} />
          </span>
        }
      />
      {inviting && <GroupInviteDialog group={group} viewerHandle={viewer.handle} onClose={() => setInviting(false)} />}
      {leaving && (
        <ConfirmDialog
          title={t("Leave {name}?", { name: group.name })}
          confirmLabel={t("Leave group")}
          danger
          onClose={() => setLeaving(false)}
          onConfirm={async () => {
            await leaveGroup(group.slug);
            toast.success(t("You left {name}", { name: group.name }));
            router.refresh();
          }}
        >
          {group.visibility === "private"
            ? t("You’ll stop seeing its posts. To come back, you’ll have to ask to join again.")
            : t("Its posts will stop showing in your home feed. You can join again at any time.")}
        </ConfirmDialog>
      )}
    </div>
  );
}
