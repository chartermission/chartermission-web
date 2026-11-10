import Link from "next/link";
import { Suspense } from "react";
import { Avatar, Icon, Logo, buttonClasses, cn } from "@chartermission/ui";
import { getViewer } from "@/lib/api/server";
import { T } from "@/i18n/client";
import { LanguageSwitcher } from "@/i18n/language-menu";

/** Landing-page sections the nav links scroll to. */
export const publicNavLinks = [
  { key: "features", label: "What’s inside", href: "/#features" },
  { key: "chapters", label: "Chapters", href: "/#chapters" },
  { key: "learning", label: "Learning", href: "/#learning" },
  { key: "events", label: "Events", href: "/#events" },
  { key: "organisations", label: "For organisations", href: "/#organisations" },
] as const;

const ghostOnDark =
  "inline-flex items-center justify-center rounded-lg px-[18px] py-[10px] text-md font-medium whitespace-nowrap text-inverse transition-colors hover:bg-white/10";

function SignedOutActions() {
  return (
    <>
      <Link href="/signin" className={cn(ghostOnDark, "max-sm:hidden")}>
        <T k="public.signIn" />
      </Link>
      <Link href="/signup" className={buttonClasses({ variant: "accent", className: "max-sm:px-3.5!" })}>
        <T k="public.joinFree" />
      </Link>
    </>
  );
}

/**
 * Reads the session cookie, so it streams in behind a Suspense boundary: signed-in members see
 * themselves and a way back into the app instead of "Sign in / Join free".
 */
async function NavActions() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return <SignedOutActions />;
  return (
    <>
      <Link href={`/members/${viewer.handle}`} className="flex items-center gap-2.5 rounded-full py-1 pe-3 ps-1 text-sm font-medium text-inverse hover:bg-white/10 max-sm:pe-1">
        <Avatar name={viewer.name} src={viewer.avatarUrl ?? undefined} tone={viewer.tone} size={32} />
        <span className="max-w-[160px] truncate max-sm:sr-only">{viewer.name}</span>
      </Link>
      <Link href="/feed" className={buttonClasses({ variant: "accent", className: "max-sm:px-3.5!" })}>
        <span className="max-sm:hidden"><T k="public.goToFeed" /></span>
        <span className="sm:hidden"><T k="public.feed" /></span>
        <Icon name="chevron-right" size={18} />
      </Link>
    </>
  );
}

/**
 * Public top bar. Transparent: it sits over the hero gradient, so the landing page positions it
 * absolutely above <main>. Section links collapse into a menu on small screens.
 */
export function PublicNav({ className }: { className?: string }) {
  return (
    <header className={cn("flex items-center justify-between gap-4 py-5", className)}>
      <Link href="/" aria-label="Charter Mission home" className="flex rounded-lg">
        <Logo theme="dark" />
      </Link>
      <nav aria-label="Main" className="max-lg:hidden">
        <ul className="flex items-center gap-7 text-sm font-medium text-primary-tint">
          {publicNavLinks.map((link) => (
            <li key={link.label}>
              <Link href={link.href} className="rounded-sm hover:text-inverse hover:underline">
                <T k={`public.nav.${link.key}`} />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex items-center gap-2">
        <LanguageSwitcher tone="inverse" className="max-sm:hidden" />
        <Suspense fallback={<SignedOutActions />}>
          <NavActions />
        </Suspense>
        <details className="group relative lg:hidden">
          <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg text-inverse hover:bg-white/10 [&::-webkit-details-marker]:hidden">
            <Icon name="menu" size={22} className="group-open:hidden" />
            <Icon name="x" size={22} className="hidden group-open:block" />
            <span className="sr-only">Menu</span>
          </summary>
          <nav aria-label="Sections" className="absolute top-full end-0 z-20 mt-2 w-60 rounded-card border border-line bg-card p-2 shadow-[0_16px_40px_rgba(0,0,0,0.25)]">
            <ul className="flex flex-col">
              {publicNavLinks.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-ink hover:bg-muted">
                    <T k={`public.nav.${link.key}`} />
                  </Link>
                </li>
              ))}
              <li className="mt-1 border-t border-line pt-1 sm:hidden">
                <Link href="/signin" className="block rounded-lg px-3 py-2.5 text-sm font-medium text-primary hover:bg-muted">
                  <T k="public.signIn" />
                </Link>
              </li>
            </ul>
          </nav>
        </details>
      </div>
    </header>
  );
}
