"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MessagesUnread } from "@chartermission/contracts";
import { usePathname, useT } from "@/i18n/client";
import type { NavKey } from "@/components/nav-items";
import {
  Icon,
  Logo,
  LogoMark,
  buttonClasses,
  cn,
  type AvatarTone,
  type IconName,
} from "@chartermission/ui";
import { UserMenu } from "@/components/account/user-menu";
import { SearchBox } from "@/components/search/search-box";
import { subscribeMessages } from "@/components/messages/stream";
import { onMessagesChanged } from "@/components/messages/messages-events";
import { api } from "@/lib/api/client";
import { MobileNav, openNavDrawer } from "@/components/mobile-nav";

const links: { href: string; key: NavKey; icon: IconName }[] = [
  { href: "/feed", key: "home", icon: "home" },
  { href: "/articles", key: "articles", icon: "dashboard" },
  { href: "/network", key: "network", icon: "users" },
  { href: "/opportunities", key: "opportunities", icon: "briefcase" },
  { href: "/events", key: "events", icon: "calendar" },
  { href: "/learning", key: "learning", icon: "book" },
  { href: "/messages", key: "messages", icon: "mail" },
  { href: "/notifications", key: "alerts", icon: "bell" },
];

/** Member top navigation (Figma "Top nav / Web", node 7:157). */
export interface TopNavViewer {
  name: string;
  handle: string;
  avatarUrl: string | null;
  tone: AvatarTone;
  adminUrl?: string | null;
}

/** Screens where the member should finish a task first: logo and account menu only. */
const focusedPaths = ["/onboarding"];

/** Top nav that highlights the current section. Reads the URL, so render it inside a <Suspense> boundary. */
export function TopNav({
  viewer,
  unread = 0,
  unreadMessages = 0,
}: {
  viewer: TopNavViewer | null;
  unread?: number;
  unreadMessages?: number;
}) {
  const messages = useUnreadMessages(unreadMessages);
  return (
    <>
      <TopNavBar
        viewer={viewer}
        unread={unread}
        unreadMessages={messages}
        pathname={usePathname()}
      />
      {viewer && (
        <MobileNav viewer={viewer} unread={unread} unreadMessages={messages} />
      )}
    </>
  );
}

/** The Messages badge: starts from the server's count, then checks again every so often and whenever a conversation is read. */
function useUnreadMessages(initial: number): number {
  const [count, setCount] = useState(initial);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      api<MessagesUnread>("/messages/unread").then(
        (r) => live && setCount(r.unread + r.requests),
        () => undefined,
      );
    };
    const timer = window.setInterval(refresh, 60000);
    const off = onMessagesChanged(refresh);
    // Live: the server sends fresh counts whenever they change.
    const offLive = subscribeMessages((event) => {
      if (event.type === "unread") setCount(event.unread + event.requests);
      else if (event.type === "reconnected") refresh();
    });
    return () => {
      live = false;
      window.clearInterval(timer);
      off();
      offLive();
    };
  }, []);
  return count;
}

/**
 * The bar itself. With `pathname` null (the static-shell fallback) nothing is marked current, so it
 * never reads URL data outside a boundary.
 */
export function TopNavBar({
  viewer,
  unread = 0,
  unreadMessages = 0,
  pathname,
  guest = false,
}: {
  viewer: TopNavViewer | null;
  unread?: number;
  unreadMessages?: number;
  pathname: string | null;
  /** Signed out (e.g. reading a shared public post): sign-in and join instead of the member menu. */
  guest?: boolean;
}) {
  const t = useT();
  const under = (path: string) =>
    pathname !== null && (pathname === path || pathname.startsWith(`${path}/`));
  const focused = focusedPaths.some(under);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-card">
      <div className="flex h-16 items-center gap-6 px-8 max-lg:gap-3 max-lg:px-4">
        {viewer && !focused && !guest && (
          <button
            type="button"
            onClick={openNavDrawer}
            aria-label={t("nav.sections")}
            aria-haspopup="dialog"
            className="-ms-1 shrink-0 rounded-lg p-1.5 text-secondary hover:bg-primary-tint-2 lg:hidden"
          >
            <Icon name="menu" size={24} />
          </button>
        )}
        <Link
          href={guest ? "/" : "/feed"}
          aria-label="Charter Mission home"
          className="shrink-0 rounded-lg"
        >
          <Logo className="max-md:hidden" />
          <LogoMark className="md:hidden" />
        </Link>
        {!focused && !guest && (
          <SearchBox className="w-[420px] max-w-full max-2xl:w-[300px] max-xl:w-[220px] max-lg:hidden" />
        )}
        <div className="flex-1" />
        {!focused && !guest && (
          <nav
            aria-label={t("nav.main")}
            className="flex min-w-0 items-center gap-1 overflow-x-auto max-md:gap-0"
          >
            <Link
              href="/search"
              aria-label={t("nav.search")}
              className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-xs text-secondary hover:bg-primary-tint-2 lg:hidden"
            >
              <Icon name="search" size={20} />
              <span className="max-md:sr-only">Search</span>
            </Link>
            {links.map((link) => {
              const active = under(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs transition-colors hover:bg-primary-tint-2 max-md:px-2",
                    active ? "text-primary" : "text-secondary",
                    // Phones get the bottom tab bar and drawer; the top bar keeps Search and Messages.
                    link.href !== "/messages" && "max-md:hidden",
                  )}
                >
                  <span className="relative">
                    <Icon name={link.icon} size={20} />
                    {(link.href === "/notifications"
                      ? unread
                      : link.href === "/messages"
                        ? unreadMessages
                        : 0) > 0 ? (
                      <span className="absolute -top-1.5 -end-2 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-semibold text-inverse">
                        {link.href === "/messages"
                          ? unreadMessages > 99
                            ? "99+"
                            : unreadMessages
                          : unread > 99
                            ? "99+"
                            : unread}
                        <span className="sr-only"> {t("nav.unread")}</span>
                      </span>
                    ) : null}
                  </span>
                  <span className="max-md:sr-only">{t(`nav.${link.key}`)}</span>
                </Link>
              );
            })}
          </nav>
        )}
        {viewer ? (
          <div className="max-md:hidden">
            <UserMenu viewer={viewer} />
          </div>
        ) : guest ? (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/signin"
              className={buttonClasses({ variant: "secondary", size: "small" })}
            >
              Sign in
            </Link>
            <Link href="/signup" className={buttonClasses({ size: "small" })}>
              Join
            </Link>
          </div>
        ) : (
          <span
            aria-hidden
            className="h-9 w-[58px] shrink-0 rounded-full bg-muted max-sm:w-9"
          />
        )}
      </div>
    </header>
  );
}
