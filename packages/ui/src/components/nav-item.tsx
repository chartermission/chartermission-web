import type { ElementType, ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cn } from "../cn";

/** Sidebar navigation row (Figma Nav item, node 5:274). */
export function NavItem({
  icon,
  label,
  href,
  active,
  linkAs: LinkAs = "a",
  trailing,
  className,
}: {
  icon: IconName;
  label: string;
  href: string;
  active?: boolean;
  linkAs?: ElementType;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <LinkAs
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-md transition-colors",
        active ? "bg-primary-tint font-medium text-primary" : "text-body hover:bg-primary-tint-2",
        className,
      )}
    >
      <Icon name={icon} size={20} className={active ? "text-primary" : "text-secondary"} />
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </LinkAs>
  );
}
