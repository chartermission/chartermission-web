import { Icon, cn } from "@chartermission/ui";

export const STEP_LABELS = ["About you", "Topics", "Skills", "Community"] as const;

/** Step indicator: segmented bar with labels; the current step carries aria-current="step". */
export function OnboardingProgress({ current }: { current: number }) {
  return (
    <nav aria-label="Onboarding progress" className="flex flex-col gap-2">
      <p className="text-sm text-secondary">
        Step {current + 1} of {STEP_LABELS.length}
      </p>
      <ol className="grid grid-cols-4 gap-2">
        {STEP_LABELS.map((label, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={label} aria-current={active ? "step" : undefined} className="flex flex-col gap-1.5">
              <span className={cn("h-1.5 rounded-full", done || active ? "bg-primary" : "bg-muted")} aria-hidden="true" />
              <span
                className={cn(
                  "flex items-center gap-1 text-xs max-sm:sr-only",
                  active ? "font-medium text-ink" : done ? "text-body" : "text-secondary",
                )}
              >
                {done && <Icon name="check" size={12} className="text-success" />}
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
