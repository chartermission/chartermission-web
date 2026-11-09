import { Suspense } from "react";
import type { Metadata } from "next";
import type { LearningAccessRules } from "@chartermission/contracts";
import { PageHeader } from "@/components/shell/page-header";
import { LearningAccessForm } from "@/components/settings/learning-access-form";
import { LearningOverrides } from "@/components/settings/learning-overrides";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "E-learning access" };

async function LearningAccessSection() {
  const viewer = await requireViewer("/settings/learning");
  const canRules = can(viewer, PERM.settingsManage);
  const canOverride = can(viewer, PERM.courseCurate);
  if (!canRules && !canOverride) return <NoAccess section="e-learning access" />;
  let rules: LearningAccessRules | null = null;
  let failure: string | null = null;
  if (canRules) {
    try {
      rules = await apiGet<LearningAccessRules>("/admin/settings/learning-access");
    } catch (e) {
      failure = e instanceof ApiError ? e.message : "The unlock rules couldn’t be loaded.";
    }
  }
  return (
    <div className="flex flex-col gap-5">
      {canRules &&
        (rules ? (
          <LearningAccessForm initial={rules} />
        ) : (
          <div className="rounded-card border border-line bg-card">
            <ErrorState message={failure ?? "The unlock rules couldn’t be loaded."} />
          </div>
        ))}
      {canOverride && <LearningOverrides />}
    </div>
  );
}

/** E-learning access: what members must do before Learning opens, and per-member overrides. */
export default function LearningAccessPage() {
  return (
    <>
      <PageHeader
        title="E-learning access"
        description="Learning stays locked until a member completes their profile and starts taking part. Changes are recorded in the audit log."
      />
      <Suspense fallback={<div className="h-64 animate-pulse rounded-card border border-line bg-card" />}>
        <LearningAccessSection />
      </Suspense>
    </>
  );
}
