"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { Divider, Icon, Panel, SegmentedControl, TrendingItem, chipClasses } from "@chartermission/ui";
import { trendingScopes, trendingTopics } from "@/lib/mock-data";

const windows = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
] as const;

export function TrendingTopics() {
  const [window, setWindow] = useState<"24h" | "7d">("24h");
  const [scope, setScope] = useState(trendingScopes[0]);
  return (
    <Panel className="flex flex-col gap-1 p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-h3 text-ink">
          <Icon name="flame" size={20} className="text-accent" />
          Trending topics
        </h2>
        <SegmentedControl size="small" label="Time window" items={windows} value={window} onChange={setWindow} />
      </div>
      <div className="flex gap-1.5 pb-1.5 pt-2.5" role="group" aria-label="Trending scope">
        {trendingScopes.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={item === scope}
            onClick={() => setScope(item)}
            className={chipClasses(item === scope ? "active" : "filter")}
          >
            {item}
          </button>
        ))}
      </div>
      <ol>
        {trendingTopics.map((topic, index) => (
          <Fragment key={topic.tag}>
            {index > 0 && <Divider />}
            <li>
              <TrendingItem rank={index + 1} {...topic} href={`/topics/${topic.tag.toLowerCase()}`} linkAs={Link} />
            </li>
          </Fragment>
        ))}
      </ol>
      <Link href="/topics" className="pt-2 text-sm font-medium text-primary-light hover:underline">
        Show more topics
      </Link>
    </Panel>
  );
}
