import type { ReactNode, Ref } from "react";
import Link from "next/link";
import { Icon, Logo, type IconName } from "@chartermission/ui";

const defaultHighlights = [
  "Connect with professionals in 54 countries and the diaspora",
  "Reviewed jobs, fellowships and grants — no stale listings",
  "Start or join initiatives, events and local chapters",
  "Control who sees every field on your profile",
];

/**
 * Split layout shared by sign up, sign in and the other account screens — Figma "Web / Sign up" (17:1511):
 * brand panel on the left (hidden below lg), form panel on the right.
 */
export function AuthShell({
  heading = "Join the community building Africa’s next chapter",
  highlights = defaultHighlights,
  children,
}: {
  heading?: string;
  highlights?: string[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-card">
      <aside className="flex min-w-0 flex-1 flex-col justify-between gap-12 bg-[linear-gradient(124deg,var(--color-primary-dark)_0%,var(--color-primary)_50%,var(--color-primary-light)_71.4%)] px-16 py-12 max-lg:hidden max-xl:px-12">
        <Link href="/" aria-label="Charter Mission home" className="flex self-start rounded-lg">
          <Logo theme="dark" />
        </Link>
        <div className="flex flex-col gap-5">
          <p className="text-display text-inverse max-xl:text-h1">{heading}</p>
          <ul className="flex flex-col gap-5">
            {highlights.map((item) => (
              <li key={item} className="flex items-center gap-3 text-md text-primary-tint">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-inverse">
                  <Icon name="check" size={14} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-primary-tint">Non-partisan. Membership never depends on a political position.</p>
      </aside>

      <main
        id="main"
        className="flex w-[640px] shrink-0 flex-col items-center justify-center px-8 py-12 max-xl:w-[560px] max-lg:w-full max-sm:justify-start max-sm:px-5"
      >
        <Link href="/" aria-label="Charter Mission home" className="mb-10 flex self-center rounded-lg lg:hidden">
          <Logo />
        </Link>
        <div className="flex w-full max-w-[420px] flex-col">{children}</div>
      </main>
    </div>
  );
}

/** Placeholder with the form panel's footprint while a URL- or session-dependent form streams in. */
export function AuthFormSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex w-full flex-col gap-[18px]">
      <span className="h-10 w-3/5 animate-pulse rounded bg-muted" />
      <span className="h-5 w-4/5 animate-pulse rounded bg-muted" />
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="h-[70px] animate-pulse rounded-lg bg-muted" />
      ))}
      <span className="h-11 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/** Icon + heading + body used by the confirmation states (check email, verified, reset done…). */
export function AuthStatus({
  icon,
  tone = "info",
  title,
  children,
  headingRef,
}: {
  icon: IconName;
  tone?: "info" | "success" | "warning" | "error";
  title: string;
  children?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const toneClass = {
    info: "bg-info-light text-info",
    success: "bg-success-light text-success",
    warning: "bg-warning-light text-warning",
    error: "bg-error-light text-error",
  }[tone];
  return (
    <div className="flex flex-col items-start gap-[18px]">
      <span className={`flex size-12 items-center justify-center rounded-full ${toneClass}`}>
        <Icon name={icon} size={24} />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 ref={headingRef} tabIndex={-1} className="text-h1 text-ink focus-visible:outline-none">
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
