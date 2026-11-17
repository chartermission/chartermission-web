import { Suspense } from "react";
import type { Metadata } from "next";
import { AnnouncementsList } from "@/components/messages/announcements-list";
import { MessagesHeader } from "@/components/messages/messages-nav";
import { SkeletonTable } from "@/components/skeletons";
import { NoAccess } from "@/components/states";
import { requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Sent messages" };

async function List() {
  const viewer = await requireViewer("/messages/sent");
  if (!can(viewer, PERM.membersMessage)) return <NoAccess section="messages" />;
  return <AnnouncementsList status="sent" />;
}

/** Messages → Sent messages: Bulk messages sent to members, newest first. */
export default function SentMessagesPage() {
  return (
    <>
      <MessagesHeader active="sent" />
      <Suspense fallback={<SkeletonTable label="Loading messages" rows={5} />}>
        <List />
      </Suspense>
    </>
  );
}
