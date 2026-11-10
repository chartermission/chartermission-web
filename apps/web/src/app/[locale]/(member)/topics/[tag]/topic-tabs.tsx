"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Page, PostView } from "@chartermission/contracts";
import { cn } from "@chartermission/ui";
import { PostStream } from "@/components/social/post-stream";
import type { Viewer } from "@/components/social/viewer";
import { useT } from "@/i18n/client";

const tabs = [
  { value: "top", label: "Top" },
  { value: "latest", label: "Latest" },
  { value: "media", label: "Media" },
] as const;

type TabValue = (typeof tabs)[number]["value"];

/** Top / Latest / Media tabs, each GET /topics/{tag}/posts?sort= with "Load more". */
export function TopicTabs({
  tag,
  initialTop,
  viewer,
  empties,
}: {
  tag: string;
  initialTop: Page<PostView> | null;
  viewer: Viewer;
  empties: Record<TabValue, ReactNode>;
}) {
  const t = useT();
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
    setActive(tabs[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <>
      <div role="tablist" aria-label={t("#{tag} posts", { tag })} className="flex gap-6 border-b border-line" onKeyDown={onKeyDown}>
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
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.value)}
              className={cn("-mb-px flex flex-col items-center gap-2.5 rounded-sm text-md", selected ? "font-medium text-primary" : "text-secondary hover:text-ink")}
            >
              {tab.label}
              <span aria-hidden="true" className={cn("h-[3px] w-full", selected && "bg-accent")} />
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${active}`}>
        <PostStream
          key={active}
          path={`/topics/${encodeURIComponent(tag.toLowerCase())}/posts`}
          query={{ sort: active }}
          initial={active === "top" && initialTop ? initialTop : undefined}
          viewer={viewer}
          empty={empties[active]}
          label={t("{label} posts tagged #{tag}", { label: t(tabs.find((tab) => tab.value === active)!.label), tag })}
        />
      </div>
    </>
  );
}
