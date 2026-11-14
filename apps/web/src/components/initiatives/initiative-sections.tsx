import Link from "next/link";
import { OPPORTUNITY_TYPE_LABELS, type InitiativeDetail, type InitiativeMilestoneView, type InitiativeTeamMember, type OpportunityType } from "@chartermission/contracts";
import { Chip, Icon, Panel, chipClasses, cn } from "@chartermission/ui";
import { MemberAvatar } from "@/components/social/post-parts";
import { memberHref } from "@/components/social/links";
import { JoinRequestTrigger } from "./join-request";
import { hostHref, hostName } from "./format";
import { NoTranslate } from "@/i18n/auto";
import { T } from "@/i18n/client";
import { getIntlTag, getT } from "@/i18n/server";

/** The long description, paragraph by paragraph (members' own words are never translated). */
export function AboutPanel({ description }: { description: string }) {
  const paragraphs = description.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paragraphs.length) return null;
  return (
    <Panel aria-labelledby="about-heading" className="flex flex-col gap-3 p-5">
      <h2 id="about-heading" className="text-h3 text-ink">
        About
      </h2>
      <NoTranslate>
        <div className="flex flex-col gap-3 text-md whitespace-pre-line text-body">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </NoTranslate>
    </Panel>
  );
}

/** "Roles we need" card (Figma 18:1957). Organisers also see filled roles. */
export async function RolesNeeded({ initiative, canApply }: { initiative: InitiativeDetail; canApply: boolean }) {
  const t = await getT();
  const open = initiative.roles.filter((r) => r.open).length;
  return (
    <Panel aria-labelledby="roles-heading" className="flex flex-col gap-3.5 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="roles-heading" className="text-h3 text-ink">
          Roles we need
        </h2>
        <span className="text-sm font-medium text-accent-hover">
          <T vars={{ count: open }}>{"{count} open"}</T>
        </span>
      </div>
      <ul className="flex flex-col gap-3.5">
        {initiative.roles.map((role) => (
          <li key={role.id} className={cn("flex items-center gap-4 rounded-[10px] bg-surface p-4", !role.open && "opacity-70")}>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <h3 className="flex flex-wrap items-center gap-2 text-md font-medium text-ink">
                <NoTranslate>{role.title}</NoTranslate>
                {!role.open && <Chip tone="neutral">Filled</Chip>}
              </h3>
              {role.description && (
                <p className="text-sm text-body">
                  <NoTranslate>{role.description}</NoTranslate>
                </p>
              )}
              {role.skills.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
                  {role.skills.map((skill) => (
                    <li key={skill} className={chipClasses("filter")}>
                      <NoTranslate>{skill}</NoTranslate>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {canApply && role.open && (
              <JoinRequestTrigger roleId={role.id} aria-label={t("Apply for {title}", { title: role.title })}>
                Apply
              </JoinRequestTrigger>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const milestoneStateLabel: Record<InitiativeMilestoneView["state"], string> = {
  done: "Completed",
  current: "In progress",
  upcoming: "Not started",
};

function MilestoneMarker({ state }: { state: InitiativeMilestoneView["state"] }) {
  if (state === "upcoming") {
    return <span aria-hidden="true" className="size-6 shrink-0 rounded-full border border-line-strong bg-muted" />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-inverse", state === "done" ? "bg-success" : "bg-accent")}
    >
      <Icon name={state === "done" ? "check" : "clock"} size={14} />
    </span>
  );
}

/** Milestones timeline card (Figma 18:1994): note, then when it was done or is due. */
export async function Milestones({ milestones, headingId }: { milestones: InitiativeMilestoneView[]; headingId: string }) {
  const t = await getT();
  const intl = await getIntlTag();
  const month = new Intl.DateTimeFormat(intl, { month: "short", year: "numeric", timeZone: "UTC" });
  if (!milestones.length) {
    return (
      <Panel aria-labelledby={headingId} className="flex flex-col gap-2 p-5">
        <h2 id={headingId} className="text-h3 text-ink">
          Milestones
        </h2>
        <p className="text-sm text-secondary">No milestones yet.</p>
      </Panel>
    );
  }
  return (
    <Panel aria-labelledby={headingId} className="flex flex-col gap-3 p-5">
      <h2 id={headingId} className="text-h3 text-ink">
        Milestones
      </h2>
      <ol className="flex flex-col gap-3">
        {milestones.map((m) => {
          const when = m.doneAt
            ? month.format(new Date(m.doneAt))
            : m.targetDate
              ? t("target {date}", { date: month.format(new Date(`${m.targetDate}T00:00:00Z`)) })
              : null;
          const meta = [m.note, when].filter(Boolean).join(" · ");
          return (
            <li key={m.id} className="flex items-start gap-3.5">
              <MilestoneMarker state={m.state} />
              <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", m.state === "upcoming" && "text-secondary")}>
                <p className={cn("text-md", m.state === "upcoming" ? "text-secondary" : "font-medium text-ink")}>
                  <NoTranslate>{m.title}</NoTranslate>
                  <span className="sr-only"> — {milestoneStateLabel[m.state]}</span>
                </p>
                {meta && (
                  <p className="text-xs text-secondary">
                    <NoTranslate>{meta}</NoTranslate>
                  </p>
                )}
              </div>
              {m.state === "current" && (
                <Chip tone="hashtag" className="self-center">
                  In progress
                </Chip>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function TeamRow({ member }: { member: InitiativeTeamMember }) {
  return (
    <li className="flex items-center gap-2.5">
      <MemberAvatar member={member.member} size={32} link />
      <Link href={memberHref(member.member.handle)} className="group flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-ink group-hover:underline">{member.member.name}</span>
        <span className="truncate text-xs text-secondary">
          <NoTranslate>{member.role ?? member.member.headline ?? ""}</NoTranslate>
        </span>
      </Link>
      {member.lead ? <Chip tone="hashtag">Lead</Chip> : member.organiser ? <Chip tone="info">Organiser</Chip> : null}
    </li>
  );
}

/** Team card (Figma 18:2095). `seeAllHref` links to the People tab. */
export function TeamPanel({ team, total, seeAllHref, headingId }: { team: InitiativeTeamMember[]; total: number; seeAllHref?: string; headingId: string }) {
  return (
    <Panel aria-labelledby={headingId} className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-h3 text-ink">
          Team
        </h2>
        {seeAllHref && total > team.length && (
          <a href={seeAllHref} className="text-sm font-medium text-primary-light hover:underline">
            <T vars={{ count: total }}>{"See all {count}"}</T>
          </a>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {team.map((member) => (
          <TeamRow key={member.member.id} member={member} />
        ))}
      </ul>
    </Panel>
  );
}

/** Who runs it, when that is a page or a chapter. */
export function HostPanel({ initiative }: { initiative: InitiativeDetail }) {
  const { host } = initiative;
  if (host.type === "member") return null;
  return (
    <Panel aria-labelledby="host-heading" className="flex flex-col gap-2 p-5">
      <h2 id="host-heading" className="text-h3 text-ink">
        Hosted by
      </h2>
      <Link href={hostHref(host)} className="group flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
          <Icon name={host.type === "page" ? "building" : "globe"} size={18} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-ink group-hover:underline">{hostName(host)}</span>
          <span className="text-xs text-secondary">{host.type === "page" ? "Page" : "Chapter"}</span>
        </span>
      </Link>
    </Panel>
  );
}

const joiningSteps = [
  "Send a short request saying how you can help",
  "The lead reviews it — usually within 3 days",
  "Once approved, you join the team and see its updates in your feed",
];

/** "How joining works" card (Figma 18:2125). */
export function HowJoiningWorks() {
  return (
    <Panel aria-labelledby="joining-heading" className="flex flex-col gap-2.5 p-5">
      <h2 id="joining-heading" className="text-h3 text-ink">
        How joining works
      </h2>
      <ol className="flex flex-col gap-2.5">
        {joiningSteps.map((step, index) => (
          <li key={step} className="flex items-start gap-2.5">
            <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-tint text-label text-primary">
              {index + 1}
            </span>
            <span className="flex-1 text-sm text-body">{step}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** "Related opportunities" card (Figma 18:2139): open listings posted by the organisers. */
export function RelatedOpportunities({ items }: { items: InitiativeDetail["related"] }) {
  if (items.length === 0) return null;
  return (
    <Panel aria-labelledby="related-heading" className="flex flex-col gap-3 p-5">
      <h2 id="related-heading" className="text-h3 text-ink">
        Related opportunities
      </h2>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.slug}>
            <Link href={`/opportunities/${item.slug}`} className="group flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
                <Icon name="briefcase" size={18} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-ink group-hover:underline">
                  <NoTranslate>{item.title}</NoTranslate>
                </span>
                <span className="text-xs text-secondary">
                  <NoTranslate>{item.organisation}</NoTranslate> · {OPPORTUNITY_TYPE_LABELS[item.type as OpportunityType] ?? item.type}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
