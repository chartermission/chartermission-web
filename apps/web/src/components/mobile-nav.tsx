"use client";

import { openInviteDialog } from "@/components/invite/invite-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Avatar, Icon, cn, type IconName } from "@chartermission/ui";
import { usePathname, useT } from "@/i18n/client";
import { LanguageList } from "@/i18n/language-menu";
import { api } from "@/lib/api/client";
import { sectionNavItems } from "@/components/nav-items";
import { requestCompose } from "@/components/home/compose-request";
import type { TopNavViewer } from "@/components/top-nav";
import { canInstall, promptInstall, useInstallState } from "@/components/pwa/install";

/*
 * Phone navigation, app style: a bottom tab bar (Home, Network, Post, Alerts, Menu) and a side
 * drawer with every section (Ambassadors, Chapters, Pages…), the account links, language and sign
 * out. The drawer button also sits in the top bar below the desktop breakpoint, where the left rail
 * is hidden.
 */

const DRAWER_EVENT = "cm:open-drawer";

/** Opens the navigation drawer (the top-bar button and the Menu tab both use this). */
export function openNavDrawer() {
  window.dispatchEvent(new Event(DRAWER_EVENT));
}

/** Screens with their own bottom controls or a task to finish: no tab bar. */
export const NO_TAB_BAR = [
  /^\/onboarding/,
  /^\/messages\/.+/,
  /^\/articles\/new/,
  /^\/articles\/[^/]+\/edit/,
];

export function MobileNav({
  viewer,
  unread,
  unreadMessages,
}: {
  viewer: TopNavViewer;
  unread: number;
  unreadMessages: number;
}) {
  const pathname = usePathname();
  const showTabs = !NO_TAB_BAR.some((re) => re.test(pathname));
  return (
    <>
      {showTabs && <TabBar pathname={pathname} unread={unread} />}
      <NavDrawer
        viewer={viewer}
        pathname={pathname}
        unread={unread}
        unreadMessages={unreadMessages}
      />
    </>
  );
}

function TabBar({ pathname, unread }: { pathname: string; unread: number }) {
  const t = useT();
  const under = (path: string) =>
    pathname === path || pathname.startsWith(`${path}/`);

  function post(event: MouseEvent<HTMLAnchorElement>) {
    // On the feed the composer opens in place; elsewhere the link goes to /feed?compose=1.
    if (pathname === "/feed" && requestCompose()) event.preventDefault();
  }

  const tab =
    "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";
  const tabs: {
    href: string;
    label: string;
    icon: IconName;
    badge?: number;
  }[] = [
    { href: "/feed", label: t("nav.home"), icon: "home" },
    { href: "/network", label: t("nav.network"), icon: "users" },
  ];
  return (
    <nav
      data-tab-bar=""
      aria-label={t("nav.main")}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-16 items-stretch">
        {tabs.map((item) => (
          <TabLink
            key={item.href}
            {...item}
            active={under(item.href)}
            className={tab}
          />
        ))}
        <Link
          href="/feed?compose=1"
          onClick={post}
          className={cn(tab, "text-secondary")}
        >
          <span className="flex h-8 w-11 items-center justify-center rounded-xl bg-primary text-inverse">
            <Icon name="plus" size={20} />
          </span>
          <span>Create</span>
        </Link>
        <TabLink
          href="/notifications"
          label={t("nav.alerts")}
          icon="bell"
          badge={unread}
          active={under("/notifications")}
          className={tab}
        />
        <button
          type="button"
          onClick={openNavDrawer}
          className={cn(tab, "text-secondary")}
          aria-haspopup="dialog"
        >
          <Icon name="menu" size={22} />
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
}

function TabLink({
  href,
  label,
  icon,
  badge = 0,
  active,
  className,
}: {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  active: boolean;
  className: string;
}) {
  const t = useT();
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(className, active ? "text-primary" : "text-secondary")}
    >
      <span className="relative">
        <Icon name={icon} size={22} />
        {badge > 0 && <Badge count={badge} />}
      </span>
      <span className="truncate">{label}</span>
      {badge > 0 && <span className="sr-only"> {t("nav.unread")}</span>}
    </Link>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span className="absolute -top-1.5 -end-2.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-semibold text-inverse">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NavDrawer({
  viewer,
  pathname,
  unread,
  unreadMessages,
}: {
  viewer: TopNavViewer;
  pathname: string;
  unread: number;
  unreadMessages: number;
}) {
  const t = useT();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const installState = useInstallState();
  const under = (path: string) =>
    pathname === path || pathname.startsWith(`${path}/`);

  useEffect(() => {
    const open = () => {
      const dialog = ref.current;
      if (dialog && !dialog.open) dialog.showModal();
    };
    window.addEventListener(DRAWER_EVENT, open);
    return () => window.removeEventListener(DRAWER_EVENT, open);
  }, []);

  // A link inside the drawer changes the page: close it.
  useEffect(() => {
    ref.current?.close();
  }, [pathname]);

  // Close when the screen grows past the breakpoint (the left rail takes over).
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const onChange = () => wide.matches && ref.current?.close();
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {
      // The session cookie is cleared server-side even if the session was already gone.
    }
    router.replace("/signin?notice=signedout");
    router.refresh();
  }

  const close = () => ref.current?.close();
  const item =
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium";
  const account: {
    href: string;
    label: string;
    icon: IconName;
    badge?: number;
  }[] = [
    {
      href: "/messages",
      label: t("nav.messages"),
      icon: "mail",
      badge: unreadMessages,
    },
    {
      href: "/notifications",
      label: t("nav.alerts"),
      icon: "bell",
      badge: unread,
    },
    { href: "/settings", label: t("menu.settings"), icon: "shield" },
  ];

  return (
    <dialog
      ref={ref}
      aria-label={t("nav.sections")}
      onClick={(event) => event.target === ref.current && close()}
      className={cn(
        "fixed inset-y-0 start-0 m-0 h-dvh max-h-dvh w-[86vw] max-w-sm bg-card p-0 text-ink shadow-xl",
        "backdrop:bg-black/40 open:flex open:flex-col",
      )}
    >
      <div className="flex items-center gap-3 border-b border-line px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4">
        <Link
          href={`/${viewer.handle}`}
          onClick={close}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg"
        >
          <Avatar
            name={viewer.name}
            src={viewer.avatarUrl ?? undefined}
            tone={viewer.tone}
            size={56}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-ink">
              {viewer.name}
            </span>
            <span className="truncate text-sm text-primary-light">
              {t("menu.viewProfile")}
            </span>
          </span>
        </Link>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="rounded-lg p-2 text-secondary hover:bg-muted"
        >
          <Icon name="x" size={22} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <nav aria-label={t("nav.sections")} className="flex flex-col">
          {sectionNavItems.map(({ href, key, icon }) => (
            <Link
              key={href}
              href={href}
              onClick={close}
              aria-current={under(href) ? "page" : undefined}
              className={cn(
                item,
                under(href)
                  ? "bg-primary-tint text-primary"
                  : "text-ink hover:bg-muted",
              )}
            >
              <Icon
                name={icon}
                size={20}
                className={under(href) ? "text-primary" : "text-secondary"}
              />
              {t(`nav.${key}`)}
            </Link>
          ))}
        </nav>
        <div role="separator" className="mx-3 my-2 h-px bg-line" />
        {account.map(({ href, label, icon, badge }) => (
          <Link
            key={href}
            href={href}
            onClick={close}
            aria-current={under(href) ? "page" : undefined}
            className={cn(
              item,
              under(href)
                ? "bg-primary-tint text-primary"
                : "text-ink hover:bg-muted",
            )}
          >
            <Icon name={icon} size={20} className="text-secondary" />
            <span className="flex-1">{label}</span>
            {!!badge && badge > 0 && (
              <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs leading-5 font-semibold text-inverse">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => {
            close();
            openInviteDialog();
          }}
          className={cn(item, "w-full text-ink hover:bg-muted")}
        >
          <Icon name="user-plus" size={20} className="text-secondary" />
          {t("Invite people")}
        </button>
        {canInstall(installState) && (
          <button
            type="button"
            onClick={() => {
              close();
              void promptInstall();
            }}
            className={cn(item, "w-full text-ink hover:bg-muted")}
          >
            <Icon name="download" size={20} className="text-secondary" />
            {t("Install app")}
          </button>
        )}
        {viewer.adminUrl && (
          // eslint-disable-next-line @next/next/no-html-link-for-pages
          <a
            href="/api/v1/auth/admin/sso/start"
            onClick={close}
            className={cn(item, "text-ink hover:bg-muted")}
          >
            <Icon name="shield" size={20} className="text-secondary" />
            <span className="flex-1">{t("menu.adminConsole")}</span>
            <Icon name="external" size={14} className="text-secondary" />
          </a>
        )}
        <div role="separator" className="mx-3 my-2 h-px bg-line" />
        <LanguageList className="px-3 py-1" />
      </div>
      <div className="border-t border-line px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={signingOut}
          className={cn(item, "w-full text-ink hover:bg-muted")}
        >
          <Icon name="arrow-up-right" size={20} className="text-secondary" />
          {signingOut ? t("menu.signingOut") : t("menu.signOut")}
        </button>
      </div>
    </dialog>
  );
}
