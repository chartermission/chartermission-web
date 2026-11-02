import Link from "next/link";
import { Avatar, Icon, Logo } from "@chartermission/ui";
import { staffViewer } from "@/lib/mock/console";

/** Admin console top bar (Figma "Admin bar", node 12:1547). */
export function AdminBar() {
  return (
    <header className="sticky top-0 z-30 flex h-[60px] items-center gap-4 bg-primary-dark px-6">
      <Link href="/moderation" aria-label="Charter Mission admin home" className="shrink-0 rounded-lg">
        <Logo theme="dark" />
      </Link>
      <span className="shrink-0 rounded-md bg-white/12 px-2.5 py-1 text-label text-inverse">Admin console</span>
      <form action="/search" role="search" className="min-w-0 flex-1">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-white/8 px-3 text-primary-tint focus-within:ring-2 focus-within:ring-primary-tint/60">
          <Icon name="search" size={16} />
          <span className="sr-only">Search the console</span>
          <input
            name="q"
            type="search"
            placeholder="Search members, content, reports…"
            className="w-full min-w-0 bg-transparent text-sm text-inverse outline-none placeholder:text-primary-tint"
          />
        </label>
      </form>
      <p className="flex shrink-0 items-center gap-1.5 text-xs text-primary-tint">
        <Icon name="shield" size={16} className="text-success" />
        MFA session · {staffViewer.mfaMinutesLeft} min left
      </p>
      <Avatar name={staffViewer.name} size={32} tone="accent" />
    </header>
  );
}
