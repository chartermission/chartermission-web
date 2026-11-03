"use client";

import { useState } from "react";
import type { TopicView } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { TopicActions } from "./topic-actions";

const dayLabels = ["6 days ago", "5 days ago", "4 days ago", "3 days ago", "2 days ago", "Yesterday", "Today"];

function ActivityChart({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <figure className="flex flex-col gap-1.5">
      <div className="flex h-14 w-full items-end gap-1.5" role="img" aria-label={`Posts per day over the last 7 days: ${values.map((v, i) => `${dayLabels[i]} ${v}`).join(", ")}`}>
        {values.map((value, index) => (
          <span
            key={dayLabels[index]}
            title={`${dayLabels[index]}: ${value} post${value === 1 ? "" : "s"}`}
            className={index === values.length - 1 ? "flex-1 rounded-[3px] bg-accent" : "flex-1 rounded-[3px] bg-primary-tint"}
            style={{ height: `${Math.max(value / max, 0.04) * 100}%` }}
          />
        ))}
      </div>
      <figcaption className="text-xs text-secondary">
        {total.toLocaleString("en-US")} post{total === 1 ? "" : "s"} in the last 7 days
      </figcaption>
    </figure>
  );
}

/** Topic header: followers, 7-day activity, trending rank and velocity, follow / mute / report. */
export function TopicHeader({ topic }: { topic: TopicView }) {
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

      <ActivityChart values={topic.activity7d} />

      <TopicActions tag={topic.tag} following={topic.following} muted={topic.muted} onFollowersChange={(delta) => setFollowers((n) => Math.max(0, n + delta))} />
    </Panel>
  );
}
