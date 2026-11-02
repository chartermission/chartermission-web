import Link from "next/link";
import { Avatar, Chip, buttonClasses, cn } from "@chartermission/ui";
import { initiativeStatusMeta, type Initiative } from "@/lib/mock/initiatives";
import { FollowButton } from "./initiative-actions";
import { JoinRequestProvider, JoinRequestTrigger } from "./join-request";

export type InitiativeSummary = Pick<
  Initiative,
  "slug" | "title" | "theme" | "status" | "country" | "summary" | "progressLabel" | "percent" | "lead" | "collaborators"
> & { roles: { id: string; title: string }[] };

export function toInitiativeSummary(initiative: Initiative): InitiativeSummary {
  const { slug, title, theme, status, country, summary, progressLabel, percent, lead, collaborators, roles } = initiative;
  return {
    slug,
    title,
    theme,
    status,
    country,
    summary,
    progressLabel,
    percent,
    lead,
    collaborators,
    roles: roles.map(({ id, title: roleTitle }) => ({ id, title: roleTitle })),
  };
}

/**
 * Directory card — Figma "Initiative card" (node 17:101). App-local rather
 * than the shared InitiativeCard because the design gives each lead avatar its
 * own tone and the footer action varies by status (join dialog / follow / view).
 */
export function InitiativeTile({ initiative, className }: { initiative: InitiativeSummary; className?: string }) {
  const status = initiativeStatusMeta[initiative.status];
  const href = `/initiatives/${initiative.slug}`;

  return (
    <article className={cn("flex w-full flex-col gap-3 rounded-card border border-line bg-card p-5", className)}>
      <div className="flex w-full items-center justify-between gap-2">
        <Chip>{initiative.theme}</Chip>
        <Chip tone={status.tone}>{status.label}</Chip>
      </div>
      <h2 className="text-h3 text-ink">
        <Link href={href} className="hover:underline">
          {initiative.title}
        </Link>
      </h2>
      <p className="text-sm text-body">{initiative.summary}</p>
      <div className="flex w-full flex-col gap-1.5">
        <div className="flex w-full justify-between gap-3 text-xs">
          <span className="text-secondary">{initiative.progressLabel}</span>
          <span className="text-primary">{initiative.percent}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-[3px] bg-muted"
          role="progressbar"
          aria-valuenow={initiative.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${initiative.title} progress`}
        >
          <div className="h-full rounded-[3px] bg-accent" style={{ width: `${initiative.percent}%` }} />
        </div>
      </div>
      <div className="h-px w-full bg-line" />
      <div className="flex w-full items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs text-secondary">
          <Avatar name={initiative.lead.name} size={24} tone={initiative.lead.tone} />
          <span className="truncate">
            Led by {initiative.lead.name} · {initiative.collaborators} collaborators
          </span>
        </span>
        <TileAction initiative={initiative} href={href} />
      </div>
    </article>
  );
}

function TileAction({ initiative, href }: { initiative: InitiativeSummary; href: string }) {
  if (initiative.status === "recruiting") {
    return (
      <JoinRequestProvider
        initiative={{
          slug: initiative.slug,
          title: initiative.title,
          leadName: initiative.lead.name,
          roles: initiative.roles,
        }}
      >
        <JoinRequestTrigger aria-label={`Request to join ${initiative.title}`}>Request to join</JoinRequestTrigger>
      </JoinRequestProvider>
    );
  }
  if (initiative.status === "active") return <FollowButton title={initiative.title} />;
  return (
    <Link href={href} className={buttonClasses({ variant: "secondary", size: "small" })}>
      View<span className="sr-only"> {initiative.title}</span>
    </Link>
  );
}
