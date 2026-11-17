import { Suspense, type ReactNode } from "react";
import { InboxShell } from "@/components/messages/inbox-shell";
import { MessagesHeader } from "@/components/messages/messages-nav";
import { SkeletonCard } from "@/components/skeletons";
import { NoAccess } from "@/components/states";
import { requireViewer } from "@/lib/api/server";
import { PERM, can } from "@/lib/permissions";

async function Inbox({ children }: { children: ReactNode }) {
  const viewer = await requireViewer("/messages");
  if (!can(viewer, PERM.membersMessage)) return <NoAccess section="messages" />;
  return <InboxShell>{children}</InboxShell>;
}

/** Messages → Inbox: members' conversations with Charter Mission, list and open thread side by side. */
export default function InboxLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MessagesHeader active="inbox" />
      <Suspense fallback={<SkeletonCard lines={8} className="min-h-[520px]" />}>
        <Inbox>{children}</Inbox>
      </Suspense>
    </>
  );
}
