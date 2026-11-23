import { Suspense } from "react";
import type { Metadata } from "next";
import type { ClaudeContentSettings } from "@chartermission/contracts";
import { ContentCalendar } from "@/components/content-calendar/content-calendar";
import { parseParams } from "@/components/content-calendar/shared";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Content calendar" };

async function Calendar({ searchParams }: Pick<PageProps<"/content-calendar">, "searchParams">) {
  const params = parseParams(await searchParams);
  const viewer = await requireViewer("/content-calendar");
  if (!can(viewer, PERM.moderationView)) return <NoAccess section="the content calendar" />;
  let settings: ClaudeContentSettings;
  try {
    settings = await apiGet<ClaudeContentSettings>("/admin/settings/claude-content");
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "The content calendar couldn’t be loaded."} />;
  }
  return (
    <ContentCalendar
      initial={params}
      approval={settings.approval}
      canAct={can(viewer, PERM.moderationAct)}
      canManageSettings={can(viewer, PERM.settingsManage)}
    />
  );
}

/** Posts members write and schedule with Claude: review them on a calendar or as a list. */
export default function ContentCalendarPage(props: PageProps<"/content-calendar">) {
  return (
    <>
      <PageHeader
        title="Content calendar"
        description="Posts members write with Claude, scheduled and published. Hold, move or cancel what is coming up, approve what is waiting and hide what shouldn’t stay up."
      />
      <Suspense fallback={<SkeletonTable label="Loading the content calendar" rows={8} />}>
        <Calendar searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
