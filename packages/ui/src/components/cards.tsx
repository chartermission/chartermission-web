import type { ElementType, ReactNode } from "react";
import { Icon } from "../icons";
import { cn } from "../cn";
import { Avatar } from "./avatar";
import { Chip, type ChipTone } from "./chip";
import { buttonClasses } from "./button";

type LinkProps = { href?: string; linkAs?: ElementType };

/** Wrapper used by cards: renders a link when href is given, otherwise a span. */
function MaybeLink({ href, linkAs: LinkAs = "a", className, children }: LinkProps & { className?: string; children: ReactNode }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <LinkAs href={href} className={cn("hover:underline", className)}>
      {children}
    </LinkAs>
  );
}

/* ------------------------------------------------------------------ */
/* Opportunity card — Figma node 7:108                                 */
/* ------------------------------------------------------------------ */

export type OpportunityCardProps = LinkProps & {
  title: string;
  meta: string;
  chips: { label: string; tone?: ChipTone }[];
  saved?: boolean;
  className?: string;
};

export function OpportunityCard({ title, meta, chips, saved, href, linkAs, className }: OpportunityCardProps) {
  return (
    <article className={cn("flex w-full items-start gap-4 rounded-card border border-line bg-card p-5", className)}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-primary-tint text-primary">
        <Icon name="building" size={22} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="text-h3 text-ink">
          <MaybeLink href={href} linkAs={linkAs}>
            {title}
          </MaybeLink>
        </h3>
        <p className="text-sm text-secondary">{meta}</p>
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <Chip key={chip.label} tone={chip.tone ?? "neutral"}>
              {chip.label}
            </Chip>
          ))}
        </div>
      </div>
      <button
        type="button"
        aria-pressed={saved}
        aria-label={saved ? "Saved" : "Save opportunity"}
        className={cn("rounded-md p-0.5 hover:bg-muted", saved ? "text-primary" : "text-secondary")}
      >
        <Icon name="bookmark" size={20} fill={saved ? "currentColor" : "none"} />
      </button>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Event card — Figma node 7:134                                       */
/* ------------------------------------------------------------------ */

export type EventCardProps = LinkProps & {
  month: string;
  day: string;
  format: "Online" | "In person" | "Hybrid";
  title: string;
  when: string;
  where: string;
  going: string;
  actionLabel?: string;
  className?: string;
};

const formatTone: Record<EventCardProps["format"], ChipTone> = {
  Online: "success",
  "In person": "warning",
  Hybrid: "info",
};

export function EventCard({
  month,
  day,
  format,
  title,
  when,
  where,
  going,
  actionLabel = "Register",
  href,
  linkAs,
  className,
}: EventCardProps) {
  return (
    <article className={cn("flex w-full flex-col overflow-hidden rounded-card border border-line bg-card", className)}>
      <div className="flex h-28 w-full items-start bg-primary p-4">
        <span className="flex flex-col items-center rounded-lg bg-card px-2.5 py-1.5 font-semibold">
          <span className="text-label text-accent">{month}</span>
          <span className="text-h2 text-ink">{day}</span>
        </span>
      </div>
      <div className="flex w-full flex-col gap-2 p-4">
        <Chip tone={formatTone[format]}>{format}</Chip>
        <h3 className="text-h3 text-ink">
          <MaybeLink href={href} linkAs={linkAs}>
            {title}
          </MaybeLink>
        </h3>
        <p className="flex items-center gap-1.5 text-sm text-body">
          <Icon name="clock" size={16} className="text-secondary" />
          {when}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-body">
          <Icon name="map-pin" size={16} className="text-secondary" />
          {where}
        </p>
        <div className="flex w-full items-center justify-between">
          <span className="text-sm font-medium text-secondary">{going}</span>
          <button type="button" className={buttonClasses({ size: "small" })}>
            {actionLabel}
          </button>
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Member card — Figma node 17:84                                      */
/* ------------------------------------------------------------------ */

export type MemberCardProps = LinkProps & {
  name: string;
  verified?: boolean;
  headline: string;
  location: string;
  mutual?: string;
  actionLabel?: string;
  className?: string;
};

export function MemberCard({
  name,
  verified,
  headline,
  location,
  mutual,
  actionLabel = "Connect",
  href,
  linkAs,
  className,
}: MemberCardProps) {
  return (
    <article className={cn("flex w-full flex-col items-center gap-2 rounded-card border border-line bg-card px-4 py-5", className)}>
      <Avatar name={name} size={56} />
      <p className="flex items-center gap-1">
        <MaybeLink href={href} linkAs={linkAs} className="text-md font-medium text-ink">
          {name}
        </MaybeLink>
        {verified && <Icon name="verified" size={14} className="text-primary" label="Verified" />}
      </p>
      <p className="w-full text-center text-sm text-body">{headline}</p>
      <p className="flex items-center gap-1 text-xs text-secondary">
        <Icon name="map-pin" size={14} />
        {location}
      </p>
      {mutual && <p className="text-xs text-primary-light">{mutual}</p>}
      <button type="button" className={buttonClasses({ variant: "secondary", size: "small", block: true })}>
        {actionLabel}
      </button>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Initiative card — Figma node 17:101                                 */
/* ------------------------------------------------------------------ */

export type InitiativeCardProps = LinkProps & {
  theme: string;
  status: { label: string; tone: ChipTone };
  title: string;
  summary: string;
  milestone: string;
  percent: number;
  lead: string;
  collaborators: string;
  actionLabel?: string;
  className?: string;
};

export function InitiativeCard({
  theme,
  status,
  title,
  summary,
  milestone,
  percent,
  lead,
  collaborators,
  actionLabel = "Request to join",
  href,
  linkAs,
  className,
}: InitiativeCardProps) {
  return (
    <article className={cn("flex w-full flex-col gap-3 rounded-card border border-line bg-card p-5", className)}>
      <div className="flex w-full items-center justify-between">
        <Chip>{theme}</Chip>
        <Chip tone={status.tone}>{status.label}</Chip>
      </div>
      <h3 className="text-h3 text-ink">
        <MaybeLink href={href} linkAs={linkAs}>
          {title}
        </MaybeLink>
      </h3>
      <p className="text-sm text-body">{summary}</p>
      <div className="flex w-full flex-col gap-1.5">
        <div className="flex w-full justify-between text-xs">
          <span className="text-secondary">{milestone}</span>
          <span className="text-primary">{percent}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-[3px] bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${title} progress`}
        >
          <div className="h-full rounded-[3px] bg-accent" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="h-px w-full bg-line" />
      <div className="flex w-full items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs text-secondary">
          <Avatar name={lead} size={24} />
          Led by {lead} · {collaborators}
        </span>
        <button type="button" className={buttonClasses({ variant: "secondary", size: "small" })}>
          {actionLabel}
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Course card — Figma node 19:94                                      */
/* ------------------------------------------------------------------ */

export type CourseCardProps = {
  level: { label: string; tone: ChipTone };
  title: string;
  duration: string;
  provider: string;
  /** Charter Center course URL — opens in a new tab. */
  href: string;
  className?: string;
};

export function CourseCard({ level, title, duration, provider, href, className }: CourseCardProps) {
  return (
    <article className={cn("flex w-full flex-col overflow-hidden rounded-card border border-line bg-card", className)}>
      <div className="flex h-[140px] w-full items-center justify-center bg-gradient-to-r from-primary to-primary-light p-4 text-inverse">
        <Icon name="book" size={36} />
      </div>
      <div className="flex w-full flex-1 flex-col gap-2 p-4">
        <Chip tone={level.tone}>{level.label}</Chip>
        <h3 className="text-md font-medium text-ink">{title}</h3>
        <p className="flex items-center gap-1.5 text-xs text-secondary">
          <Icon name="clock" size={14} />
          {duration}
        </p>
        <p className="flex items-center gap-1.5 text-xs text-body">
          <Icon name="verified" size={14} className="text-accent" />
          {provider}
        </p>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses({ variant: "secondary", size: "small", block: true, className: "mt-auto" })}
        >
          Start learning ↗<span className="sr-only"> (opens Charter Center in a new tab)</span>
        </a>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Trending item — Figma node 5:275                                    */
/* ------------------------------------------------------------------ */

export type TrendingItemProps = LinkProps & {
  rank: number;
  context: string;
  tag: string;
  stats: string;
  className?: string;
};

export function TrendingItem({ rank, context, tag, stats, href, linkAs: LinkAs = "a", className }: TrendingItemProps) {
  const content = (
    <>
      <span className="w-4 shrink-0 text-md font-medium text-disabled">{rank}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs text-secondary">{context}</span>
        <span className="text-md font-medium text-ink">#{tag}</span>
        <span className="text-xs text-secondary">{stats}</span>
      </span>
      <Icon name="trending" size={18} className="shrink-0 text-accent" />
    </>
  );
  const classes = cn("flex w-full items-start gap-3 py-2.5", className);
  return href ? (
    <LinkAs href={href} className={cn(classes, "rounded-md hover:bg-primary-tint-2")}>
      {content}
    </LinkAs>
  ) : (
    <div className={classes}>{content}</div>
  );
}
