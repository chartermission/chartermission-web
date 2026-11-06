import type { CourseSummary } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { BrandPattern } from "@/components/illustrations";
import { courseArt } from "./format";

/**
 * The course thumbnail from Charter Center, or generated art when it has none: a brand
 * gradient chosen by the first topic, the topic icon and a ring placed by the slug, so every
 * course keeps the same look everywhere. Decorative (the title is always next to it).
 */
export function CourseThumbnail({
  course,
  className,
  iconSize = 28,
  eager = false,
}: {
  course: Pick<CourseSummary, "slug" | "topics" | "thumbnailUrl">;
  className?: string;
  iconSize?: number;
  eager?: boolean;
}) {
  if (course.thumbnailUrl) {
    return (
      <div className={cn("overflow-hidden bg-muted", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Charter Center thumbnail of unknown size and host */}
        <img
          src={course.thumbnailUrl}
          alt=""
          loading={eager ? "eager" : "lazy"}
          className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </div>
    );
  }
  const art = courseArt(course);
  return (
    <div
      aria-hidden="true"
      className={cn("relative flex items-center justify-center overflow-hidden text-inverse", art.direction, art.gradient, className)}
    >
      <BrandPattern tone="text-inverse" opacity={0.09} fade="radial" />
      <span className={cn("pointer-events-none absolute size-40 rounded-full border-[14px] border-inverse/15", art.ring)} />
      <span className="relative flex size-16 items-center max-sm:size-12 justify-center rounded-2xl bg-inverse/12 ring-1 ring-inverse/20 backdrop-blur-[2px] transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none">
        <Icon name={art.icon} size={iconSize} />
      </span>
    </div>
  );
}
