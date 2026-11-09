import Link from "next/link";
import type { MyAmbassadorView } from "@chartermission/contracts";
import { Icon, Panel, buttonClasses } from "@chartermission/ui";
import { apiGet } from "@/lib/api/server";

/** Home-feed reminder while the viewer is onboarding as an Ambassador. Renders nothing otherwise. */
export async function AmbassadorOnboardingNotice() {
  const view = await apiGet<MyAmbassadorView>("/ambassadors/me").catch(() => null);
  if (!view || view.status !== "onboarding" || !view.onboarding) return null;
  const { done, total } = view.onboarding;
  const next = view.agreement ? "Pick up where you left off" : "Start by signing the Ambassador Agreement";
  return (
    <Panel className="flex flex-wrap items-center gap-4 border-primary-light p-4" aria-label="Ambassador onboarding">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-inverse" aria-hidden>
        <Icon name="shield" size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-ink">
          Your Ambassador onboarding for {view.country?.name}: {done} of {total} steps done
        </p>
        <p className="text-sm text-secondary">{next}. Your badge goes live when every step is done.</p>
      </div>
      <Link href="/ambassadors" className={buttonClasses({ size: "small" })}>
        Continue
      </Link>
    </Panel>
  );
}
