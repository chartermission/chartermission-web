import type { Metadata } from "next";
import { InboxPlaceholder } from "@/components/messages/inbox-shell";

export const metadata: Metadata = { title: "Messages" };

/** /messages: the inbox with no conversation open. */
export default function MessagesPage() {
  return <InboxPlaceholder />;
}
