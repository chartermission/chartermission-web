import type { SVGProps } from "react";
import { Icon, chipClasses, cn } from "@chartermission/ui";

/*
 * Pieces shared by the profile's "Licenses & certifications" section and its editor. No hooks, so
 * both server pages and client components can use them.
 */

/** An award rosette, for certifications without a picture (the icon set has none). */
export function AwardIcon({ size = 20, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={(2 * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M12 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" />
      <path d="m15.48 12.89 1.51 8.53a.5.5 0 0 1-.81.47l-3.58-2.69a1 1 0 0 0-1.2 0l-3.59 2.69a.5.5 0 0 1-.81-.47l1.51-8.53" />
    </svg>
  );
}

/**
 * "Verified" on a certificate earned through a Charter Mission exam. The explanation is a tooltip
 * for pointers and real text for screen readers.
 */
export function VerifiedChip({ className }: { className?: string }) {
  return (
    <span title="Issued through a Charter Mission exam by Charter Center" className={chipClasses("success", cn("gap-1 px-2 py-0.5 text-xs", className))}>
      <Icon name="check" size={12} />
      Verified
      <span className="sr-only">Issued through a Charter Mission exam by Charter Center</span>
    </span>
  );
}

/** The leading tile: the certificate image when there is one, otherwise the award icon. */
export function CertificationTile({ imageUrl, className }: { imageUrl?: string | null; className?: string }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served by the API with its own access rules
      <img src={imageUrl} alt="" loading="lazy" className={cn("size-11 shrink-0 rounded-lg border border-line bg-card object-cover", className)} />
    );
  }
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary", className)}>
      <AwardIcon size={20} />
    </span>
  );
}
