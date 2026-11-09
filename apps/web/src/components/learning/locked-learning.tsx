import Link from "next/link";
import type { LearningAccess, LearningRequirement } from "@chartermission/contracts";
import { Chip, Icon, Panel, buttonClasses, cn } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { BrandPattern } from "@/components/illustrations";

const ACTION: Record<LearningRequirement["key"], string> = {
  profile_info: "Edit profile",
  photo: "Add photo",
  cover_photo: "Add cover photo",
  chapter: "Find a chapter",
  posts: "Write a post",
  connections: "Find people",
};

function detail(r: LearningRequirement): string | null {
  if (r.key === "profile_info" && !r.done && r.missing?.length) return `Still to add: ${r.missing.join(", ")}.`;
  if (r.target > 1) return `${r.current.toLocaleString("en-US")} of ${r.target.toLocaleString("en-US")}`;
  return null;
}

function Requirement({ r }: { r: LearningRequirement }) {
  const extra = detail(r);
  const counted = r.target > 1;
  return (
    <li className="flex items-center gap-4 px-5 py-4 max-sm:px-4">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border-2",
          r.done ? "border-success bg-success text-inverse" : "border-line-strong text-transparent",
        )}
        aria-hidden="true"
      >
        <Icon name="check" size={16} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn("text-md font-medium", r.done ? "text-secondary line-through decoration-1" : "text-ink")}>
          {r.label}
          <span className="sr-only">{r.done ? " (done)" : " (to do)"}</span>
        </span>
        {extra && !r.done && <span className="text-sm text-secondary">{extra}</span>}
        {counted && !r.done && (
          <span className="h-1.5 w-full max-w-[280px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span className="block h-full rounded-full bg-primary-light" style={{ width: `${Math.round((r.current / r.target) * 100)}%` }} />
          </span>
        )}
      </div>
      {!r.done && (
        <Link href={r.href} className={buttonClasses({ variant: "secondary", size: "small" })}>
          {ACTION[r.key]}
        </Link>
      )}
    </li>
  );
}

/** Shown instead of Learning until the member meets the admin-set unlock rules (GET /learning/access). */
export function LockedLearning({ access }: { access: LearningAccess }) {
  const total = access.requirements.length;
  const done = access.requirements.filter((r) => r.done).length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <PageShell className="gap-6 max-sm:px-4 max-sm:pt-5">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-h1 text-ink">Learning</h1>
          <Chip tone="hashtag">From Charter Center</Chip>
        </div>
        <p className="text-md text-secondary">Short, practical courses and learning paths picked for members.</p>
      </header>
      <section
        aria-labelledby="unlock-heading"
        className="relative isolate overflow-hidden rounded-2xl bg-linear-to-r from-primary-dark via-primary via-70% to-accent p-8 max-sm:p-5"
      >
        <BrandPattern tone="text-inverse" opacity={0.07} fade="left" className="-z-10" />
        <div className="flex max-w-2xl flex-col gap-3">
          <h2 id="unlock-heading" className="text-h1 text-inverse max-sm:text-h2">
            Unlock Learning
          </h2>
          <p className="text-md text-primary-tint">
            Learning opens once your profile is complete and you’ve started taking part in the community. Finish the steps below and the
            courses unlock straight away.
          </p>
          <div className="flex items-center gap-3 pt-1">
            <span
              role="progressbar"
              aria-label="Steps done"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-valuetext={`${done} of ${total} steps done`}
              className="h-2 w-full max-w-[320px] overflow-hidden rounded-full bg-inverse/20"
            >
              <span className="block h-full rounded-full bg-inverse" style={{ width: `${percent}%` }} />
            </span>
            <span className="text-sm font-medium text-inverse">
              {done} of {total} done
            </span>
          </div>
        </div>
      </section>
      <Panel className="overflow-hidden">
        <ul className="divide-y divide-line">
          {access.requirements.map((r) => (
            <Requirement key={r.key} r={r} />
          ))}
        </ul>
      </Panel>
    </PageShell>
  );
}
