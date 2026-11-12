import Link from "next/link";
import type { CelebrationDetails, PageRef } from "@chartermission/contracts";
import { Icon } from "@chartermission/ui";
import { BrandPattern } from "@/components/illustrations";
import { celebrationMeta } from "./meta";

/**
 * Header band for a celebration: category, headline and organisation above the story.
 * `data-milestone-banner` marks it as the origin of the congratulate confetti (PostCard).
 * `aboutPage` (a Charter Center certificate names Charter Center's page) links the organisation.
 */
export function CelebrationBand({
  celebration,
  aboutPage = null,
  headingLevel = 3,
}: {
  celebration: CelebrationDetails;
  aboutPage?: PageRef | null;
  headingLevel?: 2 | 3;
}) {
  const meta = celebrationMeta[celebration.category];
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div
      data-milestone-banner=""
      className="relative w-full overflow-hidden rounded-[10px] border border-accent/20 bg-linear-to-br from-accent-light via-warning-light to-primary-tint-2 px-5 py-4 max-sm:px-4"
    >
      <BrandPattern tone="text-accent-hover" opacity={0.11} fade="right" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-0">
        <span className="absolute end-6 top-3 size-2 rotate-12 rounded-[2px] bg-accent/50" />
        <span className="absolute end-14 top-8 size-1.5 rounded-full bg-warning" />
        <span className="absolute end-4 top-12 size-1.5 -rotate-12 rounded-[1px] bg-primary-light/40" />
        <span className="absolute end-24 top-4 size-1 rounded-full bg-success" />
        <span className="absolute -end-6 -bottom-8 size-24 rounded-full border-[10px] border-accent/10" />
      </span>
      <div className="relative flex items-start gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-accent shadow-[0px_2px_6px_0px_rgba(0,0,0,0.08)]">
          <Icon name={meta.icon} size={22} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pe-10 max-sm:pe-4">
          <p className="text-label uppercase tracking-[0.6px] text-accent-hover">{meta.label}</p>
          <Heading className="text-h3 text-ink">{celebration.headline}</Heading>
          {aboutPage ? (
            <Link
              href={`/pages/${aboutPage.slug}`}
              className="relative z-10 flex w-fit max-w-full items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline"
            >
              <Icon name="building" size={14} className="shrink-0" />
              <span className="truncate">{celebration.organisation || aboutPage.name}</span>
              {aboutPage.verified && <Icon name="verified" size={14} className="shrink-0 text-info" />}
            </Link>
          ) : (
            celebration.organisation && (
              <p className="flex items-center gap-1.5 text-sm text-body">
                <Icon name="building" size={14} className="shrink-0 text-secondary" />
                <span className="truncate">{celebration.organisation}</span>
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
}
