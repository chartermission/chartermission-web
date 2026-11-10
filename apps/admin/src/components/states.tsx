"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon, cn, type IconName } from "@chartermission/ui";
import { useT } from "@/i18n/client";

/** Section that loaded fine but has nothing to show. */
export function EmptyState({
  icon = "check",
  title,
  children,
  className,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-secondary">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-md font-medium text-ink">{title}</p>
      {children && <div className="max-w-md text-sm text-secondary">{children}</div>}
    </div>
  );
}

/** A section whose data failed to load, with a retry that re-requests the server data. */
export function ErrorState({ message, className }: { message: string; className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-error-light text-error">
        <Icon name="alert" size={20} />
      </span>
      <p className="max-w-md text-sm text-body">{message}</p>
      <Button
        variant="secondary"
        size="small"
        disabled={pending}
        aria-busy={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}

/** Shown when the signed-in admin's role does not include a section's permission. */
export function NoAccess({ section }: { section: string }) {
  const t = useT();
  return (
    <div className="rounded-card border border-line bg-card">
      <EmptyState icon="shield" title={t("You don’t have access to {section}", { section })}>
        Your role doesn’t include this part of the console. Ask a Platform Admin if you need it.
      </EmptyState>
    </div>
  );
}


/** A whole console section that failed to load (bordered card with retry). */
export function LoadError({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-line bg-card">
      <ErrorState message={message} />
    </div>
  );
}
