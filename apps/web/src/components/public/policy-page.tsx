import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, buttonClasses } from "@chartermission/ui";
import { Container } from "./container";
import { PublicFooter } from "./public-footer";

export type PolicySection = { id: string; title: string; body: ReactNode };

const policyLinks = [
  { href: "/terms", label: "Terms of Use" },
  { href: "/privacy", label: "Privacy Notice" },
  { href: "/guidelines", label: "Community Guidelines" },
];

/** Plain-language policy page (Terms, Privacy, Guidelines) linked from sign-up and re-acceptance. */
export function PolicyPage({
  path,
  title,
  intro,
  sections,
}: {
  path: string;
  title: string;
  intro: string;
  sections: PolicySection[];
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="border-b border-line bg-card">
        <Container className="flex h-16 items-center justify-between gap-4 max-sm:px-4">
          <Link href="/" aria-label="Charter Mission home" className="rounded-lg">
            <Logo />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/signin" className={buttonClasses({ variant: "ghost", size: "small" })}>
              Sign in
            </Link>
            <Link href="/signup" className={buttonClasses({ variant: "accent", size: "small", className: "max-sm:hidden" })}>
              Join free
            </Link>
          </div>
        </Container>
      </header>
      <main id="main" className="flex-1 py-10">
        <Container className="flex items-start gap-10 max-lg:flex-col max-sm:px-4">
          <nav aria-label="Policies" className="w-56 shrink-0 lg:sticky lg:top-8 max-lg:w-full">
            <ul className="flex flex-col gap-1 max-lg:flex-row max-lg:flex-wrap">
              {policyLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={link.href === path ? "page" : undefined}
                    className={
                      link.href === path
                        ? "block rounded-lg bg-primary-tint px-3 py-2 text-sm font-medium text-primary"
                        : "block rounded-lg px-3 py-2 text-sm text-body hover:bg-primary-tint-2"
                    }
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <article className="flex max-w-[720px] min-w-0 flex-1 flex-col gap-6 rounded-card border border-line bg-card p-8 max-sm:p-5">
            <header className="flex flex-col gap-2">
              <h1 className="text-h1 text-ink">{title}</h1>
              <p className="text-md text-secondary">{intro}</p>
            </header>
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="flex scroll-mt-8 flex-col gap-2"
              >
                <h2 id={`${section.id}-title`} className="text-h3 text-ink">
                  {section.title}
                </h2>
                <div className="flex flex-col gap-2 text-md text-body [&_li]:ml-5 [&_li]:list-disc">{section.body}</div>
              </section>
            ))}
          </article>
        </Container>
      </main>
      <PublicFooter />
    </div>
  );
}
