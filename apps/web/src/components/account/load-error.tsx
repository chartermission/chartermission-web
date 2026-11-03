"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button, Icon, Panel, cn } from "@chartermission/ui";

/** Error state with a retry for a server-rendered section (router.refresh re-runs the server read). */
export function LoadError({
  title = "This section didn’t load",
  message = "Check your connection and try again.",
  retryHref,
  className,
  bare = false,
}: {
  title?: string;
  message?: string;
  /** Navigate here instead of refreshing (for pages whose shell itself failed). */
  retryHref?: string;
  className?: string;
  bare?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const body = (
    <div role="alert" className="flex items-start gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-error-light text-error">
        <Icon name="alert" size={18} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-md font-medium text-ink">{title}</p>
          <p className="text-sm text-secondary">{message}</p>
        </div>
        <Button
          variant="secondary"
          size="small"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              if (retryHref) router.push(retryHref);
              router.refresh();
            })
          }
        >
          {pending ? "Retrying…" : "Try again"}
        </Button>
      </div>
    </div>
  );
  if (bare) return <div className={cn("w-full", className)}>{body}</div>;
  return <Panel className={cn("w-full p-5", className)}>{body}</Panel>;
}
