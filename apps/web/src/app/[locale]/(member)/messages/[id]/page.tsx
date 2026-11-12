import type { Metadata } from "next";
import { Suspense } from "react";
import type { ConversationView } from "@chartermission/contracts";
import { MessagesView } from "@/components/messages/messages-view";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet } from "@/lib/api/server";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Messages") };
}

async function Messages({ params, searchParams }: PageProps<"/[locale]/messages/[id]">) {
  const { id } = await params;
  const around = (await searchParams).around;
  const viewer = await requireClientViewer(`/messages/${id}`);
  const list = await settle(apiGet<ConversationView[]>("/messages/conversations"));
  if (!list.ok) return <SectionError message={errorMessage(list.error)} retryHref="/messages" />;
  return <MessagesView viewerId={viewer.id} viewerHandle={viewer.handle} initial={list.data} activeId={id} focusMessageId={typeof around === "string" ? around : null} />;
}

/** Private messages: one conversation open. */
export default function MessagesPage({ params, searchParams }: PageProps<"/[locale]/messages/[id]">) {
  return (
    <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-5 max-md:px-0 max-md:py-0">
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading messages" />
            <PanelSkeleton />
          </>
        }
      >
        <Messages params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
