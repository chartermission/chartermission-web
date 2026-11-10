"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Avatar, Icon, cn, type AvatarTone, type IconName } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { useT } from "@/i18n/client";
import { LanguageMenuItems } from "@/i18n/language-menu";
import { ProfileLink } from "@/components/social/post-parts";
import { memberHref } from "@/components/social/links";

export interface UserMenuViewer {
  name: string;
  handle: string;
  avatarUrl: string | null;
  tone: AvatarTone;
  /** Team members only: the admin console's address. */
  adminUrl?: string | null;
}

const itemClasses =
  "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm text-body outline-none hover:bg-primary-tint-2 focus-visible:bg-primary-tint-2 focus-visible:text-ink";

/**
 * Avatar menu in the top nav (WAI-ARIA menu button): Enter/Space/ArrowDown open it on the first
 * item, ArrowUp on the last; arrows, Home and End move; Escape closes and returns focus; Tab closes.
 */
export function UserMenu({ viewer }: { viewer: UserMenuViewer }) {
  const id = useId();
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  function openMenu(focus: "first" | "last") {
    setOpen(true);
    requestAnimationFrame(() => {
      const list = items();
      (focus === "first" ? list[0] : list[list.length - 1])?.focus();
    });
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") setOpen(false);
  }

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

  const links: { href: string; label: string; icon: IconName }[] = [
    { href: `/${viewer.handle}`, label: t("menu.viewProfile"), icon: "user" },
    { href: "/analytics", label: t("menu.analytics"), icon: "chart" },
    { href: "/pages", label: t("menu.pages"), icon: "building" },
    { href: "/settings", label: t("menu.settings"), icon: "shield" },
  ];

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        id={`${id}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={t("menu.accountMenuFor", { name: viewer.name })}
        onClick={() => (open ? close(false) : openMenu("first"))}
        onKeyDown={onButtonKeyDown}
        className="flex items-center gap-1 rounded-full p-0.5 text-secondary hover:bg-primary-tint-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-light"
      >
        <Avatar name={viewer.name} src={viewer.avatarUrl ?? undefined} tone={viewer.tone} size={32} />
        <Icon name="chevron-down" size={16} className={cn("transition-transform max-sm:hidden", open && "rotate-180")} />
      </button>
      {open && (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-button`}
          onKeyDown={onMenuKeyDown}
          className="absolute top-[calc(100%+8px)] end-0 z-40 flex w-64 flex-col gap-0.5 rounded-card border border-line bg-card p-1.5 shadow-[0px_12px_32px_0px_rgba(26,32,44,0.14)]"
        >
          <div className="flex items-center gap-3 px-3 py-2.5" role="none">
            <ProfileLink href={memberHref(viewer.handle)}>
<Avatar name={viewer.name} src={viewer.avatarUrl ?? undefined} tone={viewer.tone} size={40} />
</ProfileLink>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-ink">{viewer.name}</span>
              <span className="truncate text-xs text-secondary">@{viewer.handle}</span>
            </div>
          </div>
          <div role="separator" className="my-1 h-px bg-line" />
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              role="menuitem"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className={itemClasses}
            >
              <Icon name={link.icon} size={18} className="text-secondary" />
              {link.label}
            </Link>
          ))}
          {viewer.adminUrl && (
            // An API address that answers with a redirect to the console, so it has to be a full page load, not a <Link>.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/api/v1/auth/admin/sso/start" role="menuitem" tabIndex={-1} onClick={() => setOpen(false)} className={itemClasses}>
              <Icon name="shield" size={18} className="text-secondary" />
              <span className="flex-1">{t("menu.adminConsole")}</span>
              <Icon name="external" size={14} className="text-secondary" />
            </a>
          )}
          <LanguageMenuItems itemClasses={itemClasses} />
          <div role="separator" className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => void signOut()}
            disabled={signingOut}
            className={itemClasses}
          >
            <Icon name="arrow-up-right" size={18} className="text-secondary" />
            {signingOut ? t("menu.signingOut") : t("menu.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
