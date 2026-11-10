import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminChapterRow, Taxonomies } from "@chartermission/contracts";
import { ChaptersConsole } from "@/components/chapters/chapters-console";
import { PageHeader } from "@/components/shell/page-header";
import { SkeletonTable } from "@/components/skeletons";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Chapters" };

async function Chapters() {
  const viewer = await requireViewer("/chapters");
  if (!can(viewer, PERM.chaptersAdmin)) return <NoAccess section="chapters" />;
  let data: [AdminChapterRow[], Taxonomies];
  try {
    data = await Promise.all([apiGet<AdminChapterRow[]>("/admin/chapters"), apiGet<Taxonomies>("/taxonomies")]);
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "Chapters couldn’t be loaded."} />;
  }
  return <ChaptersConsole initial={data[0]} countries={data[1].countries} />;
}

/** Chapter catalogue: one chapter per country, at home and in the diaspora. */
export default function ChaptersPage() {
  return (
    <>
      <PageHeader
        title="Chapters"
        description="Add, rename, deactivate or remove chapters, and set their pictures and covers. Chapters without an upload use the generated brand design."
      />
      <Suspense fallback={<SkeletonTable label="Loading chapters" rows={8} />}>
        <Chapters />
      </Suspense>
    </>
  );
}
