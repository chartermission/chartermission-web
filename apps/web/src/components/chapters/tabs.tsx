"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@chartermission/ui";

type TabsContextValue = { value: string; select: (value: string) => void; baseId: string };

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs() {
  const context = useContext(TabsContext);
  if (!context) throw new Error("Tabs components must be used inside <Tabs>");
  return context;
}

/**
 * Underline tabs used by the chapter page and initiative detail. The selected
 * tab is mirrored in the URL hash (#events, #people…) so in-page links and
 * shared URLs open the right panel. Panels stay in the DOM (hidden) so the
 * server-rendered content is always present.
 */
export function Tabs({ values, defaultValue, children }: { values: string[]; defaultValue: string; children: ReactNode }) {
  const [value, setValue] = useState(defaultValue);
  const baseId = useId();
  const valuesKey = values.join("|");

  useEffect(() => {
    const known = valuesKey.split("|");
    const fromHash = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (known.includes(hash)) setValue(hash);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [valuesKey]);

  function select(next: string) {
    setValue(next);
    const url = next === defaultValue ? window.location.pathname + window.location.search : `#${next}`;
    window.history.replaceState(window.history.state, "", url);
  }

  return <TabsContext.Provider value={{ value, select, baseId }}>{children}</TabsContext.Provider>;
}

export function TabList({
  label,
  tabs,
  tone = "default",
  className,
}: {
  label: string;
  tabs: { value: string; label: string }[];
  /** "inverse" for tabs sitting on the dark chapter header. */
  tone?: "default" | "inverse";
  className?: string;
}) {
  const { value, select, baseId } = useTabs();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    select(tabs[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={cn("flex items-start gap-6 overflow-x-auto", className)}>
      {tabs.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.value}`}
            aria-selected={selected}
            aria-controls={`${baseId}-panel-${tab.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "flex shrink-0 flex-col items-center gap-2.5 rounded-t-sm text-md whitespace-nowrap transition-colors",
              tone === "inverse"
                ? selected
                  ? "font-medium text-inverse"
                  : "text-primary-tint hover:text-inverse"
                : selected
                  ? "font-medium text-primary"
                  : "text-secondary hover:text-ink",
            )}
          >
            {tab.label}
            <span aria-hidden="true" className={cn("h-[3px] w-full", selected && "bg-accent")} />
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  const { value: selected, baseId } = useTabs();
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      hidden={selected !== value}
      tabIndex={0}
      className={cn("flex flex-col gap-4 focus-visible:outline-offset-4", className)}
    >
      {children}
    </div>
  );
}
