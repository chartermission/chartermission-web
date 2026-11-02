import Link from "next/link";
import { Logo, buttonClasses, cn } from "@chartermission/ui";
import { publicNavLinks } from "@/lib/mock/public";

/**
 * Signed-out top bar — Figma "Public nav" (12:1326). Transparent: it sits over
 * the hero gradient, so the landing page positions it absolutely above <main>.
 */
export function PublicNav({ className }: { className?: string }) {
  return (
    <header className={cn("flex items-center justify-between gap-6 py-5", className)}>
      <Link href="/" aria-label="Charter Mission home" className="flex rounded-lg">
        <Logo theme="dark" />
      </Link>
      <nav aria-label="Main">
        <ul className="flex items-center gap-8 text-sm font-medium text-primary-tint">
          {publicNavLinks.map((link) => (
            <li key={link.label}>
              <Link href={link.href} className="rounded-sm hover:text-inverse hover:underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex items-center gap-2.5">
        {/* Ghost button on a dark background: same metrics as buttonClasses, inverse text. */}
        <Link
          href="/signin"
          className="inline-flex items-center justify-center rounded-lg px-[18px] py-[10px] text-md font-medium whitespace-nowrap text-inverse transition-colors hover:bg-white/10"
        >
          Sign in
        </Link>
        <Link href="/signup" className={buttonClasses({ variant: "accent" })}>
          Join free
        </Link>
      </div>
    </header>
  );
}
