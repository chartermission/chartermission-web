"use client";

import Link from "next/link";
import { usePathname, useT } from "@/i18n/client";
import { NavItem, Panel } from "@chartermission/ui";
import { sectionNavItems as items } from "./nav-items";

export function SideNav() {
  const pathname = usePathname();
  const t = useT();
  return (
    <Panel aria-label={t("nav.sections")} className="flex flex-col gap-0.5 p-2">
      <nav className="flex flex-col gap-0.5">
        {items.map(({ key, ...item }) => (
          <NavItem
            key={item.href}
            {...item}
            label={t(`nav.${key}`)}
            linkAs={Link}
            active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
          />
        ))}
      </nav>
    </Panel>
  );
}
