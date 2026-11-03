"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, Icon, Logo, cn, type AvatarTone, type IconName } from "@chartermission/ui";

const links: { href: string; label: string; icon: IconName }[] = [
  { href: "/feed", label: "Home", icon: "home" },
  { href: "/network", label: "Network", icon: "users" },
  { href: "/opportunities", label: "Opportunities", icon: "briefcase" },
  { href: "/events", label: "Events", icon: "calendar" },
  { href: "/learning", label: "Learning", icon: "book" },
  { href: "/notifications", label: "Alerts", icon: "bell" },
];

/** Member top navigation (Figma "Top nav / Web", node 7:157). */
export interface TopNavViewer {
  name: string;
  handle: string;
  avatarUrl: string | null;
  tone: AvatarTone;
}

export function TopNav({ viewer, unread = 0 }: { viewer: TopNavViewer | null; unread?: number }) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-card">
      <div className="flex h-16 items-center gap-6 px-8">
        <Link href="/feed" aria-label="Charter Mission home">
          <Logo />
        </Link>
        <form action="/search" role="search" className="w-[420px] max-w-full">
          <label className="flex h-10 items-center gap-2.5 rounded-lg bg-muted px-3.5 text-secondary focus-within:ring-2 focus-within:ring-primary-light">
            <Icon name="search" size={18} />
            <span className="sr-only">Search</span>
            <input
              name="q"
              type="search"
              placeholder="Search members, opportunities, #topics"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-disabled"
            />
          </label>
        </form>
        <div className="flex-1" />
        <nav aria-label="Main" className="flex items-center gap-1">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs transition-colors hover:bg-primary-tint-2",
                  active ? "text-primary" : "text-secondary",
                )}
              >
                <span className="relative">
                  <Icon name={link.icon} size={20} />
                  {link.href === "/notifications" && unread > 0 ? (
                    <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-semibold text-inverse">
                      {unread > 99 ? "99+" : unread}
                      <span className="sr-only"> unread</span>
                    </span>
                  ) : null}
                </span>
                {link.label}
              </Link>
            );
          })}
        </nav>
        {viewer ? (
          <Link href={`/members/${viewer.handle}`} aria-label="Your profile">
            <Avatar name={viewer.name} src={viewer.avatarUrl ?? undefined} tone={viewer.tone} size={32} />
          </Link>
        ) : (
          <span aria-hidden className="size-8 rounded-full bg-muted" />
        )}
      </div>
    </header>
  );
}
