"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, cn } from "@chartermission/ui";
import { activeNavKey, type ConsoleNavItem } from "@/lib/permissions";
import { SkeletonBar } from "@/components/skeletons";

/**
 * Admin section navigation (Figma "Sidebar", node 12:1570). A vertical sidebar from the `lg`
 * breakpoint; a horizontally scrolling strip under the admin bar on smaller screens.
 * `items` is undefined while the viewer loads.
 */
export function AdminSidebar({ items }: { items?: ConsoleNavItem[] }) {
  const pathname = usePathname();
  const active = activeNavKey(pathname);
  const navRef = useRef<HTMLElement>(null);

  // On the narrow horizontal strip, keep the current section visible.
  useEffect(() => {
    const list = navRef.current?.querySelector("ul");
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (list && current && list.scrollWidth > list.clientWidth) {
      list.scrollLeft = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
    }
  }, [active, items]);

  return (
    <nav
      ref={navRef}
      aria-label="Console sections"
      className="shrink-0 border-b border-line bg-card px-3 py-2 lg:w-[248px] lg:border-r lg:border-b-0 lg:py-5"
    >
      <ul className="relative flex gap-1 overflow-x-auto lg:sticky lg:top-[80px] lg:flex-col lg:gap-0.5 lg:overflow-visible">
        {items === undefined
          ? Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                <SkeletonBar className="size-[18px]" />
                <SkeletonBar className="h-4 w-24" />
              </li>
            ))
          : items.map((item) => {
              const isActive = item.key === active;
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors lg:py-2.5",
                      isActive ? "bg-primary-tint font-medium text-primary" : "text-body hover:bg-primary-tint-2",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2 lg:gap-3">
                      <Icon name={item.icon} size={18} className={isActive ? "text-primary" : "text-secondary"} />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.count !== undefined && item.count > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-label",
                          isActive ? "bg-accent text-inverse" : "bg-muted text-secondary",
                        )}
                      >
                        {item.count}
                        <span className="sr-only"> open</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
      </ul>
    </nav>
  );
}
