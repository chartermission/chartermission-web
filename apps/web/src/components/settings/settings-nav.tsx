"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon, cn, type IconName } from "@chartermission/ui";

const items: { href: string; label: string; icon: IconName }[] = [
  { href: "/settings", label: "Account", icon: "user" },
  { href: "/settings/profile", label: "Profile", icon: "users" },
  { href: "/settings/privacy", label: "Privacy & visibility", icon: "eye" },
  { href: "/settings/notifications", label: "Notifications", icon: "bell" },
  { href: "/settings/security", label: "Security & sign-in", icon: "shield" },
  { href: "/settings/blocked", label: "Blocked & muted", icon: "x" },
  { href: "/settings/data", label: "Your data", icon: "book" },
  { href: "/settings/moderation", label: "Moderation & reports", icon: "flag" },
];

function isCurrent(pathname: string, href: string) {
  if (href === "/settings") return pathname === "/settings";
  if (href === "/settings/moderation")
    return pathname.startsWith("/settings/moderation") || pathname.startsWith("/settings/reports");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Settings section nav (Figma 20:3110); a scrollable row on small screens. */
export function SettingsNav() {
  const pathname = usePathname();
  const list = useRef<HTMLUListElement>(null);

  // On small screens the nav is a horizontal strip: keep the current section in view.
  useEffect(() => {
    const strip = list.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !current || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft = current.offsetLeft - strip.clientWidth / 2 + current.clientWidth / 2;
  }, [pathname]);

  return (
    <div className="flex w-full shrink-0 flex-col gap-1 lg:sticky lg:top-[88px] lg:w-60">
      <p className="pb-3 text-h2 text-ink max-lg:pb-1">Settings</p>
      <nav aria-label="Settings">
        <ul
          ref={list}
          className="relative flex flex-col gap-1 max-lg:-mx-4 max-lg:flex-row max-lg:overflow-x-auto max-lg:px-4 max-lg:pb-1"
        >
          {items.map((item) => {
            const current = isCurrent(pathname, item.href);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm whitespace-nowrap transition-colors max-lg:py-2",
                    current ? "bg-primary-tint font-medium text-primary" : "text-body hover:bg-primary-tint-2",
                  )}
                >
                  <Icon name={item.icon} size={18} className={current ? "text-primary" : "text-secondary"} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
