import Link from "next/link";
import { Icon, buttonClasses, cn } from "@chartermission/ui";
import { PageHeader } from "@/components/shell/page-header";

export type MessagesTab = "inbox" | "sent" | "drafts";

const TABS: { value: MessagesTab; label: string; href: string }[] = [
  { value: "inbox", label: "Inbox", href: "/messages" },
  { value: "sent", label: "Sent", href: "/messages/sent" },
  { value: "drafts", label: "Drafts", href: "/messages/drafts" },
];

/** Messages title row with "New message", and the Inbox / Sent / Drafts tabs (each tab is its own page). */
export function MessagesHeader({ active }: { active: MessagesTab }) {
  return (
    <>
      <PageHeader
        title="Messages"
        description="Write to members as Charter Mission by email, in their inbox or as a notification, and answer their replies."
        actions={
          <>
            <Link href="/settings/messaging" className={buttonClasses({ variant: "secondary", size: "small" })}>
              Messaging settings
            </Link>
            <Link href="/messages/new" className={buttonClasses({ variant: "primary", size: "small" })}>
              <Icon name="plus" size={16} />
              New message
            </Link>
          </>
        }
      />
      <nav aria-label="Messages" className="-mb-1 overflow-x-auto">
        <ul className="flex gap-6 border-b border-line">
          {TABS.map((tab) => {
            const isActive = tab.value === active;
            return (
              <li key={tab.value} className="shrink-0">
                <Link
                  href={tab.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "-mb-px flex flex-col gap-2.5 rounded-sm pt-1 text-md whitespace-nowrap transition-colors",
                    isActive ? "font-medium text-primary" : "text-secondary hover:text-ink",
                  )}
                >
                  {tab.label}
                  <span aria-hidden="true" className={cn("h-[3px] w-full", isActive && "bg-accent")} />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
