import Link from "next/link";
import type { LearningPathSummary } from "@chartermission/contracts";
import { Chip, Icon, cn } from "@chartermission/ui";

import { formatMinutes, levelLabel, levelTone, pathHref } from "./format";
import type { Translate } from "@/i18n/translate";
import { getT } from "@/i18n/server";

/** "5 courses · 14 hours" */
export function pathMeta(t: Translate, path: Pick<LearningPathSummary, "courseCount" | "totalMinutes">) {
  return [t("{count} courses", { count: path.courseCount }), formatMinutes(path.totalMinutes)].filter(Boolean).join(" · ");
}

/** White card for a learning path (hub band, course page). The whole card opens the path page. */
export async function PathCard({ path, className, headingLevel = 3 }: { path: LearningPathSummary; className?: string; headingLevel?: 3 | 4 }) {
  const t = await getT();
  const Heading = headingLevel === 4 ? "h4" : "h3";
  return (
    <article
      className={cn(
        "group relative flex flex-col gap-2.5 rounded-card border border-line bg-card p-5 transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[0px_8px_20px_-8px_rgba(25,37,80,0.25)] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-primary-light",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary-tint-2 text-primary-light">
          <Icon name="map-pin" size={16} />
        </span>
        {path.level && (
          <Chip tone={levelTone[path.level]} className="px-2.5 py-0.5 text-xs">
            {levelLabel(path.level)}
          </Chip>
        )}
        <span className="text-xs text-secondary">{pathMeta(t, path)}</span>
      </div>
      <Heading className="text-h3 text-ink">
        <Link href={pathHref(path.slug)} className="outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-primary-light">
          {path.title}
        </Link>
      </Heading>
      <p className="line-clamp-2 text-sm text-body">{path.description}</p>
      <span aria-hidden="true" className="mt-auto flex items-center gap-1 pt-1 text-sm font-medium text-primary-light">
        View path
        <Icon name="chevron-right" size={16} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </span>
    </article>
  );
}
