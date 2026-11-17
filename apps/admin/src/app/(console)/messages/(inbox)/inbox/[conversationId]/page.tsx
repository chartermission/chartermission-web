import { Suspense } from "react";
import type { Metadata } from "next";
import { InboxThread } from "@/components/messages/inbox-thread";
import { EmptyState } from "@/components/states";

export const metadata: Metadata = { title: "Conversation" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Thread({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  if (!UUID.test(conversationId)) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon="message" title="Conversation not found" />
      </div>
    );
  }
  return <InboxThread key={conversationId} conversationId={conversationId} />;
}

/** One member's conversation with Charter Mission, beside the inbox list. */
export default function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  return (
    <Suspense fallback={<div className="flex-1 animate-pulse bg-surface" />}>
      <Thread params={params} />
    </Suspense>
  );
}
