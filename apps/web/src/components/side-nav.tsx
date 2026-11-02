"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavItem, Panel } from "@chartermission/ui";
import { sectionNavItems as items } from "./nav-items";

export function SideNav() {
  const pathname = usePathname();
  return (
    <Panel aria-label="Sections" className="flex flex-col gap-0.5 p-2">
      <nav className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavItem
            key={item.href}
            {...item}
            linkAs={Link}
            active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
          />
        ))}
      </nav>
    </Panel>
  );
}
