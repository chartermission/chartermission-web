import type { Metadata } from "next";
import { Suspense } from "react";
import type { StoryView } from "@chartermission/contracts";
import { LoadError } from "@/components/account/load-error";
import { settle } from "@/components/account/settle";
import { PageShell } from "@/components/discover/page-shell";
import { SingleStory } from "@/components/stories/single-story";
import { apiGet, requireViewer } from "@/lib/api/server";

export const metadata: Metadata = { title: "Story" };

async function Story({ params }: { params: PageProps<"/stories/[id]">["params"] }) {
  const { id } = await params;
  await requireViewer(`/stories/${id}`);
  const result = await settle(apiGet<StoryView>(`/stories/${encodeURIComponent(id)}`));
  if (!result.ok) {
    return <LoadError title="This story isn’t available" message="It may have expired, been deleted, or be visible only to the author’s connections." retryHref="/feed" />;
  }
  return <SingleStory story={result.data} />;
}

export default function StoryPage({ params }: PageProps<"/stories/[id]">) {
  return (
    <PageShell>
      <Suspense fallback={null}>
        <Story params={params} />
      </Suspense>
    </PageShell>
  );
}
