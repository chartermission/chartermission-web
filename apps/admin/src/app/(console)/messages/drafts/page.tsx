import { Suspense } from "react";
import type { Metadata } from "next";
import { AnnouncementsList } from "@/components/messages/announcements-list";
import { MessagesHeader } from "@/components/messages/messages-nav";
import { SkeletonTable } from "@/components/skeletons";
import { NoAccess } from "@/components/states";
import { requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Drafts" };

async function List() {
  const viewer = await requireViewer("/messages/drafts");
  if (!can(viewer, PERM.membersMessage)) return <NoAccess section="messages" />;
  return <AnnouncementsList status="draft" />;
}

/** Messages → Drafts: Messages saved without sending, newest first. */
export default function DraftMessagesPage() {
  return (
    <>
      <MessagesHeader active="drafts" />
      <Suspense fallback={<SkeletonTable label="Loading messages" rows={5} />}>
        <List />
      </Suspense>
    </>
  );
}
