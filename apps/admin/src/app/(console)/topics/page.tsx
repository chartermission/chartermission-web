import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminTopicRow } from "@chartermission/contracts";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { TopicsConsole } from "@/components/topics/topics-console";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Topics" };

async function Topics() {
  const viewer = await requireViewer("/topics");
  if (!can(viewer, PERM.trendingManage)) return <NoAccess section="topics" />;
  let rows: AdminTopicRow[];
  try {
    rows = await apiGet<AdminTopicRow[]>("/admin/topics");
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "Topics couldn’t be loaded."} />;
  }
  return <TopicsConsole initial={rows} />;
}

/** Topic (hashtag) catalogue: curated topics for onboarding and the Topics page; turn topics on and off. */
export default function TopicsPage() {
  return (
    <>
      <PageHeader
        title="Topics"
        description="Featured topics are suggested first when members sign up and listed on the Topics page. Inactive topics leave trending, suggestions and search; posts keep the tag."
      />
      <Suspense fallback={<SkeletonTable label="Loading topics" rows={8} />}>
        <Topics />
      </Suspense>
    </>
  );
}
