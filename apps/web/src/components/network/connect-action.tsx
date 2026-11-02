"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClasses } from "@chartermission/ui";
import type { ConnectionState } from "@/lib/mock/network";

/** Connect → Pending (withdrawable) or Message for existing connections. No backend yet. */
export function ConnectAction({ handle, name, initial }: { handle: string; name: string; initial: ConnectionState }) {
  const [state, setState] = useState(initial);

  if (state === "connected") {
    return (
      <Link href={`/messages/${handle}`} className={buttonClasses({ size: "small", block: true })}>
        Message<span className="sr-only"> {name}</span>
      </Link>
    );
  }

  const pending = state === "pending";
  return (
    <button
      type="button"
      aria-pressed={pending}
      onClick={() => setState(pending ? "none" : "pending")}
      className={buttonClasses({ variant: "secondary", size: "small", block: true })}
      title={pending ? "Request sent — click to withdraw" : undefined}
    >
      {pending ? "Pending" : "Connect"}
      <span className="sr-only"> {pending ? `(request to ${name} sent; withdraw)` : `with ${name}`}</span>
    </button>
  );
}
