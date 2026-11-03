"use client";

import { useEffect } from "react";
import { Button, Icon } from "@chartermission/ui";

/** Unexpected failure while rendering a console page; the shell stays usable. */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-line bg-card px-6 py-12 text-center">
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-error-light text-error">
        <Icon name="alert" size={20} />
      </span>
      <h1 className="text-h3 text-ink">This page couldn’t be loaded</h1>
      <p className="max-w-md text-sm text-secondary">
        Something went wrong on our side. Try again; if it keeps happening, the service may be down.
      </p>
      <Button variant="secondary" size="small" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
