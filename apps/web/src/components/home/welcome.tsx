import type { WelcomeSummary } from "@chartermission/contracts";
import { Panel } from "@chartermission/ui";
import { settle } from "@/components/social/data";
import { Bone } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";
import { WelcomeStrip } from "./welcome-strip";

/** GET /home/welcome (also records the visit). Renders nothing if it fails: the strip is a nicety, never a blocker. */
export async function Welcome() {
  const result = await settle(apiGet<WelcomeSummary>("/home/welcome"));
  if (!result.ok) return null;
  return <WelcomeStrip summary={result.data} />;
}

/** Same footprint as the strip without its nudge row. */
export function WelcomeSkeleton() {
  return (
    <Panel aria-hidden="true" className="flex items-start gap-4 p-5 max-sm:gap-3 max-sm:p-4">
      <Bone className="size-12 shrink-0 rounded-full max-sm:size-10" />
      <span className="flex flex-1 flex-col gap-2 pt-1">
        <Bone className="h-5 w-2/5" />
        <Bone className="h-3.5 w-3/5 max-sm:hidden" />
        <Bone className="h-3.5 w-4/5" />
      </span>
    </Panel>
  );
}
