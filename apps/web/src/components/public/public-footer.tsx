import Link from "next/link";
import { Logo } from "@chartermission/ui";
import { footerColumns } from "@/lib/mock/public";
import { Container } from "./container";

/** Dark marketing footer — Figma "Footer" (12:1518). */
export function PublicFooter() {
  return (
    <footer className="bg-primary-dark py-14">
      <Container className="flex items-start gap-16">
        <div className="flex w-80 shrink-0 flex-col gap-3">
          <Link href="/" aria-label="Charter Mission home" className="flex self-start rounded-lg">
            <Logo theme="dark" />
          </Link>
          <p className="text-sm text-primary-tint">
            A Pan-African professional community and opportunity platform. Non-partisan; membership never depends on a
            political position.
          </p>
        </div>
        {footerColumns.map((column) => (
          <nav key={column.title} aria-labelledby={`footer-${column.title}`} className="flex flex-col gap-2.5">
            <h2 id={`footer-${column.title}`} className="text-label text-inverse">
              {column.title}
            </h2>
            <ul className="flex flex-col gap-2.5 text-sm text-primary-tint">
              {column.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="rounded-sm whitespace-nowrap hover:text-inverse hover:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
    </footer>
  );
}
