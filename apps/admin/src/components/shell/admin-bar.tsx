import { Suspense } from "react";
import Link from "next/link";
import { Avatar, Logo, LogoMark } from "@chartermission/ui";
import type { AvatarTone } from "@chartermission/ui";
import { SessionTimer } from "./session-timer";
import { SignOutButton } from "./sign-out-button";
import { LanguageSwitcher } from "@/i18n/language-menu";

export type AdminBarViewer = { name: string; role: string; avatarUrl: string | null; tone: AvatarTone };

/**
 * Admin console top bar (Figma "Admin bar", node 12:1547): logo, session countdown and the
 * signed-in admin with their role and a sign-out button. `viewer` is undefined while loading.
 */
export function AdminBar({ viewer }: { viewer?: AdminBarViewer | null }) {
  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center gap-3 bg-primary-dark px-4 sm:gap-4 sm:px-6">
      <Link href="/moderation" aria-label="Charter Mission admin home" className="shrink-0 rounded-lg">
        <span className="hidden sm:inline-flex">
          <Logo theme="dark" />
        </span>
        <span className="inline-flex sm:hidden">
          <LogoMark theme="dark" />
        </span>
      </Link>
      <span className="hidden shrink-0 rounded-md bg-white/12 px-2.5 py-1 text-label text-inverse min-[400px]:inline">Admin console</span>
      <div className="min-w-0 flex-1" />
      <LanguageSwitcher dark />
      {viewer && (
        <Suspense fallback={null}>
          <SessionTimer />
        </Suspense>
      )}
      {viewer === undefined ? (
        <span className="flex items-center gap-2" aria-hidden="true">
          <span className="block h-4 w-24 animate-pulse rounded-md bg-white/10" />
          <span className="block size-8 animate-pulse rounded-full bg-white/10" />
        </span>
      ) : viewer ? (
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Avatar name={viewer.name} size={32} tone={viewer.tone} src={viewer.avatarUrl ?? undefined} />
          <p className="hidden min-w-0 flex-col leading-tight md:flex">
            <span className="truncate text-sm font-medium text-inverse">{viewer.name}</span>
            <span className="text-xs text-primary-tint">{viewer.role}</span>
          </p>
          <SignOutButton compact />
        </div>
      ) : null}
    </header>
  );
}
