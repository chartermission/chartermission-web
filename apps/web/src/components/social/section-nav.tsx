import Link from "next/link";
import { NavItem, Panel } from "@chartermission/ui";
import { sectionNavItems as items } from "../nav-items";

/**
 * Section navigation for pages that live outside a nav section's URL but
 * belong to it in the design (a member profile highlights "Network", a post
 * detail highlights "Home"). Same items and styling as SideNav, with the
 * active item passed in instead of derived from the pathname.
 */
export function SectionNav({ active }: { active?: string }) {
  return (
    <Panel aria-label="Sections" className="flex flex-col gap-0.5 p-2">
      <nav className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavItem key={item.href} {...item} linkAs={Link} active={item.href === active} />
        ))}
      </nav>
    </Panel>
  );
}

/** Left column for topic, profile and post pages: navigation only. */
export function SectionRail({ active }: { active?: string }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-4">
      <SectionNav active={active} />
    </aside>
  );
}
