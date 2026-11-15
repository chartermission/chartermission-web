import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminPageRow, Page, PagesSettings } from "@chartermission/contracts";
import { PagesConsole } from "@/components/pages/pages-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Pages" };

async function Pages() {
  const viewer = await requireViewer("/pages");
  if (!can(viewer, PERM.pagesManage)) return <NoAccess section="pages" />;
  let data: [Page<AdminPageRow>, PagesSettings];
  try {
    data = await Promise.all([apiGet<Page<AdminPageRow>>("/admin/pages", { limit: 100 }), apiGet<PagesSettings>("/admin/settings/pages")]);
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "Pages couldn’t be loaded."} />;
  }
  return <PagesConsole initial={data[0]} settings={data[1]} canChangeSettings={can(viewer, PERM.settingsManage)} />;
}

/** Pages for organisations: create them, verify, suspend and remove (and review new ones if review is switched on). */
export default function PagesPage() {
  return (
    <>
      <PageHeader
        title="Pages"
        description="Pages for organisations, companies and initiatives. Members’ pages go live straight away; create pages here, verify or suspend them, and choose who may create pages."
      />
      <Suspense fallback={<SkeletonTable label="Loading pages" rows={6} />}>
        <Pages />
      </Suspense>
    </>
  );
}
