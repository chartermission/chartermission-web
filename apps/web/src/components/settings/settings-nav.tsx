import Link from "next/link";
import { Icon, cn, type IconName } from "@chartermission/ui";

const items: { href: string; label: string; icon: IconName; current?: boolean }[] = [
  { href: "/settings/account", label: "Account", icon: "user" },
  { href: "/settings/profile", label: "Profile", icon: "users" },
  { href: "/settings", label: "Privacy & visibility", icon: "eye", current: true },
  { href: "/settings#notifications", label: "Notifications", icon: "bell" },
  { href: "/settings/blocked", label: "Blocked members", icon: "x" },
  { href: "/settings/security", label: "Security & sign-in", icon: "shield" },
  { href: "/settings#your-data", label: "Your data", icon: "book" },
];

/** Settings section nav (Figma 20:3110). */
export function SettingsNav() {
  return (
    <div className="flex w-full shrink-0 flex-col gap-1 lg:sticky lg:top-[88px] lg:w-60">
      <p className="pb-3 text-h2 text-ink">Settings</p>
      <nav aria-label="Settings">
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={item.current ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  item.current ? "bg-primary-tint font-medium text-primary" : "text-body hover:bg-primary-tint-2",
                )}
              >
                <Icon name={item.icon} size={18} className={item.current ? "text-primary" : "text-secondary"} />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
