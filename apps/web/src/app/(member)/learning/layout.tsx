import { Suspense, type ReactNode } from "react";
import type { LearningAccess } from "@chartermission/contracts";
import { PageShell } from "@/components/discover/page-shell";
import { LockedLearning } from "@/components/learning/locked-learning";
import { settle } from "@/components/social/data";
import { Bone, LoadingStatus } from "@/components/social/skeletons";
import { apiGet, requireViewer } from "@/lib/api/server";

/**
 * E-learning access gate: until the member meets the admin-set unlock rules, every Learning page
 * shows the checklist instead. If the check itself fails, the pages load and handle errors themselves.
 */
async function Gate({ children }: { children: ReactNode }) {
  await requireViewer("/learning");
  const access = await settle(apiGet<LearningAccess>("/learning/access"));
  if (access.ok && !access.data.unlocked) return <LockedLearning access={access.data} />;
  return children;
}

function GateSkeleton() {
  return (
    <PageShell className="gap-8 max-sm:px-4 max-sm:pt-5">
      <LoadingStatus label="Loading Learning" />
      <div aria-hidden="true" className="flex flex-col gap-6">
        <Bone className="h-10 w-48" />
        <Bone className="h-[260px] w-full rounded-2xl" />
      </div>
    </PageShell>
  );
}

export default function LearningLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<GateSkeleton />}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
