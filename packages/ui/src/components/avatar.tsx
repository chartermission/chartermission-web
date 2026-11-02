import { cn } from "../cn";

export type AvatarSize = 24 | 32 | 40 | 56 | 96;

const sizeClasses: Record<AvatarSize, string> = {
  24: "size-6 text-xs",
  32: "size-8 text-label",
  40: "size-10 text-sm font-medium",
  56: "size-14 text-h3",
  96: "size-24 text-h1",
};

export type AvatarTone = "tint" | "primary" | "accent" | "success" | "warning" | "info";

const toneClasses: Record<AvatarTone, string> = {
  tint: "bg-primary-tint text-primary",
  primary: "bg-primary text-inverse",
  accent: "bg-accent-light text-accent-hover",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  info: "bg-info-light text-info",
};

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Initials avatar (Figma Avatar, node 5:246). */
export function Avatar({
  name,
  size = 40,
  tone = "tint",
  src,
  className,
}: {
  name: string;
  size?: AvatarSize;
  tone?: AvatarTone;
  src?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full whitespace-nowrap",
        sizeClasses[size],
        toneClasses[tone],
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
