"use client";

import Link from "next/link";
import { PAGE_CATEGORY_LABELS, type PageSummary } from "@chartermission/contracts";
import { Chip, Icon } from "@chartermission/ui";
import { pageHref } from "@/components/social/links";
import { FollowPageButton } from "./follow-page-button";
import { PageLogo } from "./page-logo";
import { followersLabel } from "./followers-label";
import { useT } from "@/i18n/client";



/** Name with the verified tick and the "Official" tag for Charter Mission's own pages. */
export function PageName({ page, className }: { page: Pick<PageSummary, "name" | "verified" | "official">; className?: string }) {
  return (
    <span className={className ?? "flex min-w-0 items-center gap-1.5"}>
      <span className="truncate">{page.name}</span>
      {page.verified && <Icon name="verified" size={16} className="shrink-0 text-primary-light" label="Verified page" />}
      {page.official && <span className="shrink-0 rounded-full bg-primary-tint px-1.5 py-px text-[11px] font-semibold text-primary">Official</span>}
    </span>
  );
}

const statusChip: Partial<Record<PageSummary["status"], { tone: "warning" | "error"; label: string }>> = {
  pending: { tone: "warning", label: "In review" },
  rejected: { tone: "error", label: "Not approved" },
  suspended: { tone: "error", label: "Suspended" },
};

/** A page in the directory grid: logo, name, what it is, followers and Follow. */
export function PageCard({ page, role }: { page: PageSummary; role?: string }) {
  const t = useT();
  const status = statusChip[page.status];
  return (
    <article className="relative flex h-full flex-col gap-3 rounded-card border border-line bg-card p-4 transition-shadow hover:shadow-[0_4px_16px_rgb(15_42_42/0.08)]">
      <div className="flex items-start gap-3">
        <PageLogo name={page.name} src={page.logoUrl} size={52} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-md font-semibold text-ink">
            <Link href={pageHref(page.slug)} className="after:absolute after:inset-0 after:rounded-card hover:underline">
              <PageName page={page} />
            </Link>
          </h3>
          <p className="text-xs text-secondary">
            {PAGE_CATEGORY_LABELS[page.category]}
            {page.country ? ` · ${page.country.name}` : ""}
          </p>
        </div>
      </div>
      {page.tagline && <p className="line-clamp-2 text-sm text-body">{page.tagline}</p>}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-secondary">{followersLabel(t, page.followers)}</span>
        <span className="relative z-10 flex items-center gap-2">
          {status && <Chip tone={status.tone} className="px-2! py-0.5! text-xs!">{status.label}</Chip>}
          {role ? (
            <Link href={`${pageHref(page.slug)}/edit`} className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:bg-muted">
              Manage
            </Link>
          ) : (
            <FollowPageButton page={page} following={page.following} />
          )}
        </span>
      </div>
    </article>
  );
}
