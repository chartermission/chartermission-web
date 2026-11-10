import { cn } from "@chartermission/ui";

/** A page's logo: a rounded square (people are round), with the page's initial when there is no picture. */
export function PageLogo({ name, src, size = 48, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, borderRadius: Math.max(6, Math.round(size * 0.22)) };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- permission-checked API media
    return <img src={src} alt="" width={size} height={size} style={style} className={cn("shrink-0 border border-line bg-card object-cover", className)} />;
  }
  const initial = name.trim().charAt(0).toUpperCase() || "P";
  return (
    <span
      aria-hidden="true"
      style={{ ...style, fontSize: Math.round(size * 0.42) }}
      className={cn("flex shrink-0 items-center justify-center bg-primary font-semibold text-inverse", className)}
    >
      {initial}
    </span>
  );
}
