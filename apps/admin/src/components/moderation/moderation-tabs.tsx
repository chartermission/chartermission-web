import Link from "next/link";
import { cn } from "@chartermission/ui";

export type ModerationTab = "reports" | "hidden" | "appeals";

const TABS: { value: ModerationTab; label: string; href: string }[] = [
  { value: "reports", label: "Reports", href: "/moderation" },
  { value: "hidden", label: "Hidden content", href: "/moderation/hidden" },
  { value: "appeals", label: "Appeals", href: "/appeals" },
];

/** Queue switcher under the stats (Figma tabs, node 12:1665). Each tab is its own page. */
export function ModerationTabs({ active }: { active: ModerationTab }) {
  return (
    <nav aria-label="Moderation queues" className="-mb-1 overflow-x-auto">
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
  );
}
