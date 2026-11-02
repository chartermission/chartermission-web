"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, cn } from "@chartermission/ui";
import { consoleNav } from "@/lib/mock/console";

/** Admin section navigation (Figma "Sidebar", node 12:1570). */
export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Console sections" className="w-[248px] shrink-0 border-r border-line bg-card px-3 py-5">
      <ul className="sticky top-[80px] flex flex-col gap-0.5">
        {consoleNav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active ? "bg-primary-tint font-medium text-primary" : "text-body hover:bg-primary-tint-2",
                )}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon name={item.icon} size={18} className={active ? "text-primary" : "text-secondary"} />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.count !== undefined && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-label",
                      active ? "bg-accent text-inverse" : "bg-muted text-secondary",
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
