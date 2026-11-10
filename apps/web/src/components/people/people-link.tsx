"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@chartermission/ui";
import { PeopleDialog, type PeopleSource } from "./people-dialog";

/** A count that opens the list of members behind it ("12 reactions", "340 followers"). */
export function PeopleLink({ source, children, className, label }: { source: PeopleSource; children: ReactNode; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={label}
        onClick={() => setOpen(true)}
        className={cn("rounded-sm text-start outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary-light", className)}
      >
        {children}
      </button>
      {open && <PeopleDialog source={source} onClose={() => setOpen(false)} />}
    </>
  );
}
