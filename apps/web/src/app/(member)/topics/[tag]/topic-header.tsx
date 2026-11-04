"use client";

import { useState } from "react";
import type { TopicView } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { ActivityChart, type ChartDay } from "./activity-chart";
import { TopicActions } from "./topic-actions";

/** Topic header: followers, 7-day activity, trending rank and velocity, follow / mute / report. */
export function TopicHeader({ topic, days }: { topic: TopicView; days?: ChartDay[] }) {
  const [followers, setFollowers] = useState(topic.followers);
  const stats: { value: string; label: string; tone?: "positive" | "negative" }[] = [
    { value: topic.posts.toLocaleString("en-US"), label: topic.posts === 1 ? "post" : "posts" },
    { value: followers.toLocaleString("en-US"), label: followers === 1 ? "follower" : "followers" },
  ];
  if (topic.velocityPct !== null) {
    stats.push({
      value: `${topic.velocityPct >= 0 ? "+" : ""}${topic.velocityPct}%`,
      label: "vs. usual, last 24h",
      tone: topic.velocityPct >= 0 ? "positive" : "negative",
    });
  }

  return (
    <Panel className="flex flex-col gap-4 p-6 max-sm:p-4">
      <div className="flex items-start gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-[14px] bg-accent-light text-accent max-sm:size-12">
          <Icon name="hash" size={32} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-all text-h1 text-ink max-sm:text-h2">#{topic.tag}</h1>
            {topic.trending && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-label text-inverse">
                <Icon name="flame" size={14} />#{topic.trending.rank} trending in {topic.trending.scopeLabel}
              </span>
            )}
          </div>
          {topic.description && <p className="text-sm text-body">{topic.description}</p>}
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-7 gap-y-2">
        {stats.map((stat) => (
          <div key={stat.label} className="flex flex-col-reverse">
            <dt className="text-xs text-secondary">{stat.label}</dt>
            <dd className={stat.tone === "positive" ? "text-h3 text-success" : stat.tone === "negative" ? "text-h3 text-error" : "text-h3 text-ink"}>{stat.value}</dd>
          </div>
        ))}
      </dl>

      <ActivityChart values={topic.activity7d} days={days} />

      <TopicActions tag={topic.tag} following={topic.following} muted={topic.muted} onFollowersChange={(delta) => setFollowers((n) => Math.max(0, n + delta))} />
    </Panel>
  );
}
