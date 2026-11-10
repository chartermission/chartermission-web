import { LanguageSwitcher } from "@/i18n/language-menu";
import Link from "next/link";
import { Logo } from "@chartermission/ui";
import { Container } from "./container";

const columns = [
  {
    title: "Platform",
    links: [
      { label: "What’s inside", href: "/#features" },
      { label: "Chapters", href: "/#chapters" },
      { label: "Learning", href: "/#learning" },
      { label: "Events", href: "/#events" },
    ],
  },
  {
    title: "Take part",
    links: [
      { label: "Join free", href: "/signup" },
      { label: "Sign in", href: "/signin" },
      { label: "Pages for organisations", href: "/#organisations" },
      { label: "Become an Ambassador", href: "/#ambassadors" },
    ],
  },
  {
    title: "Trust",
    links: [
      { label: "Community guidelines", href: "/guidelines" },
      { label: "Privacy notice", href: "/privacy" },
      { label: "Terms of use", href: "/terms" },
      { label: "Questions", href: "/#faq" },
    ],
  },
];

/** Dark marketing footer. */
export function PublicFooter() {
  return (
    <footer className="bg-primary-dark py-14">
      <Container className="flex flex-col gap-10">
        <div className="flex items-start gap-16 max-lg:flex-col max-lg:gap-10">
          <div className="flex w-80 max-w-full shrink-0 flex-col gap-3">
            <Link href="/" aria-label="Charter Mission home" className="flex self-start rounded-lg">
              <Logo theme="dark" />
            </Link>
            <p className="text-sm text-primary-tint">
              A Pan-African professional community for people building across the continent and the diaspora. Non-partisan; membership never depends on a political
              position.
            </p>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-8 max-sm:grid-cols-2">
            {columns.map((column) => (
              <nav key={column.title} aria-labelledby={`footer-${column.title}`} className="flex flex-col gap-2.5">
                <h2 id={`footer-${column.title}`} className="text-label text-inverse">
                  {column.title}
                </h2>
                <ul className="flex flex-col gap-2.5 text-sm text-primary-tint">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="rounded-sm hover:text-inverse hover:underline">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-6">
          <p className="text-xs text-primary-tint">© Charter Mission · chartermission.com</p>
          <LanguageSwitcher tone="inverse" />
        </div>
      </Container>
    </footer>
  );
}
