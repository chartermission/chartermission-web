import type { ReactNode } from "react";
import { Icon } from "@chartermission/ui";
import { selectClasses } from "@/components/ambassadors/modal";

/** A select whose value the form holds (the shared SelectBox keeps its own). */
export function Select({ id, value, onChange, describedBy, children }: { id: string; value: string; onChange: (value: string) => void; describedBy?: string; children: ReactNode }) {
  return (
    <span className="relative">
      <select id={id} value={value} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} className={selectClasses()}>
        {children}
      </select>
      <Icon name="chevron-down" size={14} className="pointer-events-none absolute inset-y-0 end-3 my-auto h-fit text-secondary" />
    </span>
  );
}
