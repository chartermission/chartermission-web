import Link from "next/link";
import { Avatar, Chip, Icon, Panel, PostCard, chipClasses, cn } from "@chartermission/ui";
import { topicHref } from "@/components/feed-list";
import type { Initiative, Milestone, TeamMember } from "@/lib/mock/initiatives";
import { JoinRequestTrigger } from "./join-request";

/** "Roles we need" card (Figma 18:1957). */
export function RolesNeeded({ initiative }: { initiative: Initiative }) {
  const acceptsRequests = initiative.status === "recruiting";
  return (
    <Panel aria-labelledby="roles-heading" className="flex flex-col gap-3.5 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="roles-heading" className="text-h3 text-ink">
          Roles we need
        </h2>
        <span className="text-sm font-medium text-accent-hover">{initiative.roles.length} open</span>
      </div>
      <ul className="flex flex-col gap-3.5">
        {initiative.roles.map((role) => (
          <li key={role.id} className="flex items-center gap-4 rounded-[10px] bg-surface p-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <h3 className="text-md font-medium text-ink">{role.title}</h3>
              <p className="text-sm text-body">{role.description}</p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
                {role.skills.map((skill) => (
                  <li key={skill} className={chipClasses("filter")}>
                    {skill}
                  </li>
                ))}
              </ul>
            </div>
            {acceptsRequests && (
              <JoinRequestTrigger roleId={role.id} aria-label={`Apply for ${role.title}`}>
                Apply
              </JoinRequestTrigger>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

const milestoneStateLabel: Record<Milestone["state"], string> = {
  done: "Completed",
  current: "In progress",
  upcoming: "Not started",
};

function MilestoneMarker({ state }: { state: Milestone["state"] }) {
  if (state === "upcoming") {
    return <span aria-hidden="true" className="size-6 shrink-0 rounded-full border border-line-strong bg-muted" />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full text-inverse",
        state === "done" ? "bg-success" : "bg-accent",
      )}
    >
      <Icon name={state === "done" ? "check" : "clock"} size={14} />
    </span>
  );
}

/** Milestones timeline card (Figma 18:1994). */
export function Milestones({ milestones, headingId }: { milestones: Milestone[]; headingId: string }) {
  return (
    <Panel aria-labelledby={headingId} className="flex flex-col gap-3 p-5">
      <h2 id={headingId} className="text-h3 text-ink">
        Milestones
      </h2>
      <ol className="flex flex-col gap-3">
        {milestones.map((milestone) => (
          <li key={milestone.title} className="flex items-start gap-3.5">
            <MilestoneMarker state={milestone.state} />
            <div className={cn("flex min-w-0 flex-1 flex-col gap-0.5", milestone.state === "upcoming" && "text-secondary")}>
              <p className={cn("text-md", milestone.state === "upcoming" ? "text-secondary" : "font-medium text-ink")}>
                {milestone.title}
                <span className="sr-only"> — {milestoneStateLabel[milestone.state]}</span>
              </p>
              <p className="text-xs text-secondary">{milestone.meta}</p>
            </div>
            {milestone.state === "current" && (
              <Chip tone="hashtag" className="self-center">
                In progress
              </Chip>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function UpdatesList({ initiative }: { initiative: Initiative }) {
  if (initiative.updates.length === 0) {
    return (
      <Panel className="flex flex-col items-center gap-1 px-6 py-10 text-center">
        <p className="text-md font-medium text-ink">No updates yet</p>
        <p className="text-sm text-secondary">Follow this initiative to hear when {initiative.lead.name} posts one.</p>
      </Panel>
    );
  }
  return (
    <>
      <h2 className="sr-only">Latest updates</h2>
      {initiative.updates.map(({ id, ...post }) => (
        <PostCard key={id} {...post} linkAs={Link} tagHref={topicHref} />
      ))}
    </>
  );
}

function TeamRow({ member }: { member: TeamMember }) {
  return (
    <li className="flex items-center gap-2.5">
      <Avatar name={member.name} size={32} tone={member.tone} />
      <Link href={`/members/${member.handle}`} className="group flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-ink group-hover:underline">{member.name}</span>
        <span className="text-xs text-secondary">{member.role}</span>
      </Link>
      {member.lead && <Chip tone="hashtag">Lead</Chip>}
    </li>
  );
}

/** Team card (Figma 18:2095). `seeAllHref` links to the People tab. */
export function TeamPanel({
  team,
  total,
  seeAllHref,
  headingId,
}: {
  team: TeamMember[];
  total: number;
  seeAllHref?: string;
  headingId: string;
}) {
  return (
    <Panel aria-labelledby={headingId} className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-h3 text-ink">
          Team
        </h2>
        {seeAllHref && (
          <a href={seeAllHref} className="text-sm font-medium text-primary-light hover:underline">
            See all {total}
          </a>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {team.map((member) => (
          <TeamRow key={member.handle} member={member} />
        ))}
      </ul>
    </Panel>
  );
}

const joiningSteps = [
  "Send a short request saying how you can help",
  "The lead reviews it — usually within 3 days",
  "Once approved, you’ll see updates and the team space",
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
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-tint text-label text-primary"
            >
              {index + 1}
            </span>
            <span className="flex-1 text-sm text-body">{step}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** "Related opportunities" card (Figma 18:2139). */
export function RelatedOpportunities({ items }: { items: Initiative["related"] }) {
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
                <span className="text-sm font-medium text-ink group-hover:underline">{item.title}</span>
                <span className="text-xs text-secondary">{item.meta}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
