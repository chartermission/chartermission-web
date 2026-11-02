"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@chartermission/ui";

const tabs = [
  { value: "top", label: "Top" },
  { value: "latest", label: "Latest" },
  { value: "media", label: "Media" },
  { value: "people", label: "People" },
  { value: "opportunities", label: "Opportunities" },
] as const;

type TabValue = (typeof tabs)[number]["value"];

/** Underlined tabs (Top / Latest / Media / People / Opportunities) with server-rendered panels. */
export function TopicTabs({ label, panels }: { label: string; panels: Record<TabValue, ReactNode> }) {
  const [active, setActive] = useState<TabValue>("top");
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.value === active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActive(tabs[next].value);
    refs.current[next]?.focus();
  }

  return (
    <>
      <div role="tablist" aria-label={label} className="flex gap-6" onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => {
          const selected = tab.value === active;
          return (
            <button
              key={tab.value}
              ref={(node) => {
                refs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${tab.value}`}
              aria-selected={selected}
              aria-controls={`${id}-panel-${tab.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.value)}
              className={cn(
                "flex flex-col items-center gap-2.5 rounded-sm text-md",
                selected ? "font-medium text-primary" : "text-secondary hover:text-ink",
              )}
            >
              {tab.label}
              <span aria-hidden="true" className={cn("h-[3px] w-full", selected && "bg-accent")} />
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.value}
          role="tabpanel"
          id={`${id}-panel-${tab.value}`}
          aria-labelledby={`${id}-tab-${tab.value}`}
          hidden={tab.value !== active}
          className="flex flex-col gap-4"
        >
          {panels[tab.value]}
        </div>
      ))}
    </>
  );
}
