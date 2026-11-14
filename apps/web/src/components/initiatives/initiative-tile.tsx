"use client";

import Link from "next/link";
import type { InitiativeSummary } from "@chartermission/contracts";
import { Avatar, Chip, buttonClasses, cn } from "@chartermission/ui";
import { FollowButton } from "./initiative-actions";
import { JoinRequestProvider, JoinRequestTrigger } from "./join-request";
import { initiativeHref, initiativeStatusMeta, progressLabel } from "./format";
import { NoTranslate } from "@/i18n/auto";
import { T, useT } from "@/i18n/client";

/**
 * Directory card — Figma "Initiative card" (node 17:101): theme and status, title, summary, progress
 * through the milestones, who leads it, and one action (ask to join while recruiting, else follow).
 */
export function InitiativeTile({ initiative, className }: { initiative: InitiativeSummary; className?: string }) {
  const t = useT();
  const status = initiativeStatusMeta[initiative.status];
  const href = initiativeHref(initiative.slug);
  const host = initiative.host.type === "member" ? null : initiative.host.type === "page" ? initiative.host.page.name : initiative.host.chapter.name;

  return (
    <article className={cn("relative flex w-full flex-col overflow-hidden rounded-card border border-line bg-card", className)}>
      {initiative.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- uploaded cover of any size
        <img src={initiative.coverUrl} alt="" className="h-24 w-full object-cover" loading="lazy" />
      ) : (
        <div aria-hidden="true" className="h-2 w-full bg-gradient-to-r from-primary-dark via-primary-light via-60% to-accent" />
      )}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-1.5">
            {initiative.theme && <Chip>{initiative.theme.name}</Chip>}
            {initiative.country && <Chip tone="filter">{initiative.country.name}</Chip>}
          </span>
          <Chip tone={status.tone}>{status.label}</Chip>
        </div>
        <h2 className="text-h3 text-ink">
          <Link href={href} className="hover:underline">
            <NoTranslate>{initiative.title}</NoTranslate>
          </Link>
        </h2>
        <p className="line-clamp-3 text-sm text-body">
          <NoTranslate>{initiative.summary}</NoTranslate>
        </p>
        <div className="mt-auto flex w-full flex-col gap-1.5">
          <div className="flex w-full justify-between gap-3 text-xs">
            <span className="truncate text-secondary">{progressLabel(t, initiative)}</span>
            {initiative.milestones.total > 0 && <span className="text-primary">{initiative.percent}%</span>}
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-[3px] bg-muted"
            role="progressbar"
            aria-valuenow={initiative.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("{title} progress", { title: initiative.title })}
          >
            <div className="h-full rounded-[3px] bg-accent" style={{ width: `${initiative.percent}%` }} />
          </div>
        </div>
        <div className="h-px w-full bg-line" />
        <div className="flex w-full items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-xs text-secondary">
            <Avatar name={initiative.lead.name} src={initiative.lead.avatarUrl ?? undefined} size={24} tone={initiative.lead.tone} />
            <span className="truncate">
              {host ? (
                <T vars={{ name: initiative.lead.name, host, count: initiative.teamCount }}>{"Led by {name} for {host} · {count} on the team"}</T>
              ) : (
                <T vars={{ name: initiative.lead.name, count: initiative.teamCount }}>{"Led by {name} · {count} on the team"}</T>
              )}
            </span>
          </span>
          <TileAction initiative={initiative} href={href} />
        </div>
      </div>
    </article>
  );
}

function TileAction({ initiative, href }: { initiative: InitiativeSummary; href: string }) {
  const t = useT();
  const { viewer } = initiative;
  if (viewer.member || viewer.canManage) {
    return (
      <Link href={href} className={buttonClasses({ variant: "secondary", size: "small", className: "shrink-0" })}>
        {viewer.canManage ? "Manage" : "Your team"}
        <span className="sr-only"> {initiative.title}</span>
      </Link>
    );
  }
  if (initiative.status === "recruiting") {
    return (
      <JoinRequestProvider
        initiative={{ id: initiative.id, title: initiative.title, leadName: initiative.lead.name, roles: initiative.openRoles }}
        pending={viewer.request?.status === "pending"}
      >
        <JoinRequestTrigger aria-label={t("Request to join {title}", { title: initiative.title })} className="shrink-0">
          Request to join
        </JoinRequestTrigger>
      </JoinRequestProvider>
    );
  }
  if (initiative.status === "completed" || initiative.status === "archived") {
    return (
      <Link href={href} className={buttonClasses({ variant: "secondary", size: "small", className: "shrink-0" })}>
        View<span className="sr-only"> {initiative.title}</span>
      </Link>
    );
  }
  return <FollowButton initiativeId={initiative.id} title={initiative.title} following={viewer.following} className="shrink-0" />;
}
