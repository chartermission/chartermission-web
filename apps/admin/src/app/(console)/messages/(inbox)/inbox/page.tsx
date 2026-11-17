import { redirect } from "next/navigation";

/** /messages/inbox is the inbox itself. */
export default function InboxIndexPage() {
  redirect("/messages");
}
