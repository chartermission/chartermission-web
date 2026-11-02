import type { Metadata } from "next";
import Link from "next/link";
import { Icon, Logo } from "@chartermission/ui";
import { SignUpForm } from "@/components/public/signup-form";
import { countryGroups, signUpHighlights } from "@/lib/mock/public";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Join Charter Mission free: connect with professionals in 54 countries and the diaspora, find reviewed opportunities and start or join initiatives.",
};

/** Sign up — Figma "Web / Sign up" (node 17:1511). */
export default function SignUpPage() {
  return (
    <div className="flex min-h-dvh bg-card">
      {/* Brand panel (17:1512) */}
      <aside className="flex min-w-0 flex-1 flex-col justify-between gap-12 bg-[linear-gradient(124deg,var(--color-primary-dark)_0%,var(--color-primary)_50%,var(--color-primary-light)_71.4%)] px-16 py-12 max-lg:hidden max-xl:px-12">
        <Link href="/" aria-label="Charter Mission home" className="flex self-start rounded-lg">
          <Logo theme="dark" />
        </Link>
        <div className="flex flex-col gap-5">
          <p className="text-display text-inverse max-xl:text-h1">Join the community building Africa’s next chapter</p>
          <ul className="flex flex-col gap-5">
            {signUpHighlights.map((item) => (
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

      {/* Form panel (17:1544) */}
      <main className="flex w-[640px] shrink-0 flex-col items-center justify-center px-8 py-12 max-xl:w-[560px] max-lg:w-full">
        <Link href="/" aria-label="Charter Mission home" className="mb-10 flex self-center rounded-lg lg:hidden">
          <Logo />
        </Link>
        <SignUpForm countryGroups={countryGroups} />
      </main>
    </div>
  );
}
