"use client";

import Link from "next/link";
import { useId, useRef, useState, type MouseEvent } from "react";
import type { WelcomeNudgeKind, WelcomeSummary } from "@chartermission/contracts";
import { Icon, buttonClasses, cn, type IconName } from "@chartermission/ui";
import { BrandPattern } from "@/components/illustrations";
import { formatCount } from "@/components/social/format";
import { postTypeMeta } from "@/components/social/post-types/meta";
import { requestCompose } from "./compose-request";
import { greetingFor, useDayPeriod, type DayPeriod } from "./day-period";
import { hideForToday, useHiddenToday } from "./hidden-today";
import { TimeMotif } from "./time-motif";

const wash: Record<DayPeriod, string> = {
  morning: "from-accent-light/80",
  afternoon: "from-warning-light/80",
  evening: "from-primary-tint/80",
  night: "from-primary-tint/80",
};

const nudgeIcon: Record<WelcomeNudgeKind, IconName> = {
  complete_profile: "user",
  first_post: "send",
  follow_chapter: "map-pin",
  answer_question: postTypeMeta.question.icon,
};

/** `short` is the phone wording, where the strip has to stay compact. */
type Stat = { key: string; count: number; text: string; short: string; href: string; icon: IconName };

function statsOf({ stats, chapter, lastVisitAt }: WelcomeSummary): Stat[] {
  const s = (count: number, one: string, many = `${one}s`) => (count === 1 ? one : many);
  const all: Stat[] = [
    {
      key: "posts",
      count: stats.newPosts,
      text: `new ${s(stats.newPosts, "post")} ${lastVisitAt ? "since your last visit" : "today"}`,
      short: `new ${s(stats.newPosts, "post")}`,
      href: "/feed?tab=latest",
      icon: "message",
    },
    { key: "questions", count: stats.openQuestions, text: `open ${s(stats.openQuestions, "question")}`, short: `open ${s(stats.openQuestions, "question")}`, href: "/feed?type=question&unanswered=true", icon: postTypeMeta.question.icon },
    {
      key: "members",
      count: stats.newMembers,
      text: chapter ? `new ${s(stats.newMembers, "member")} in ${chapter.name}` : `new ${s(stats.newMembers, "member")} this week`,
      short: `new ${s(stats.newMembers, "member")}`,
      href: chapter ? `/chapters/${chapter.slug}#members` : "/network?tab=directory&sort=recent",
      icon: "users",
    },
    { key: "celebrations", count: stats.celebrations, text: `${s(stats.celebrations, "celebration")} this week`, short: s(stats.celebrations, "celebration"), href: "/feed?type=celebration", icon: postTypeMeta.celebration.icon },
  ];
  return all.filter((stat) => stat.count > 0);
}

/**
 * Personal welcome strip at the top of the home feed: a time-of-day greeting (local time,
 * so it appears once the page is live), "today in the community" links and one suggested
 * next step that can be put off until tomorrow.
 */
export function WelcomeStrip({ summary }: { summary: WelcomeSummary }) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const period = useDayPeriod();
  const { firstName, nudge } = summary;
  const nudgeKey = nudge ? `nudge:${nudge.kind}` : "nudge:none";
  const nudgeHidden = useHiddenToday(nudgeKey);
  const [announcement, setAnnouncement] = useState("");

  const firstWelcome = summary.isNewMember && !summary.lastVisitAt;
  const heading = firstWelcome ? `Welcome to Charter Mission, ${firstName}` : period ? `${greetingFor[period]}, ${firstName}` : null;
  const intro = firstWelcome
    ? "We’re glad you’re here. This is what’s happening in the community today."
    : summary.lastVisitAt
      ? "Welcome back. Here’s what’s new in the community."
      : "Here’s what’s happening in the community today.";
  const stats = statsOf(summary);

  function openNudge(event: MouseEvent<HTMLAnchorElement>) {
    // Already on the feed: open the composer in place instead of a round trip through ?compose=1.
    if (nudge?.kind === "first_post" && !event.metaKey && !event.ctrlKey && !event.shiftKey && requestCompose()) event.preventDefault();
  }

  function hideNudge() {
    hideForToday(nudgeKey);
    setAnnouncement("Suggestion hidden until tomorrow");
    headingRef.current?.focus();
  }

  return (
    <section aria-labelledby={headingId} className="relative overflow-hidden rounded-card border border-line bg-card">
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 start-0 w-3/5 bg-linear-to-r to-transparent transition-opacity duration-500",
          period ? cn(wash[period], "opacity-100") : "opacity-0",
        )}
      />
      <BrandPattern fade="right" opacity={0.05} />
      <div className="relative flex flex-col gap-3 p-5 max-sm:gap-2.5 max-sm:p-4">
        <div className="flex items-start gap-4 max-sm:gap-3">
          <TimeMotif period={period} className="mt-0.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className={cn(
                "text-h3 text-ink outline-none transition-opacity duration-300 max-sm:text-md max-sm:font-semibold",
                heading ? "opacity-100" : "opacity-0",
              )}
            >
              {heading ?? `Welcome back, ${firstName}`}
            </h2>
            <p className="text-sm text-secondary max-sm:hidden">{intro}</p>
            {stats.length > 0 ? (
              <ul aria-label="Today in the community" className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-sm text-body max-sm:gap-x-3">
                {stats.map((stat) => (
                  <li key={stat.key}>
                    <Link href={stat.href} className="group flex items-center gap-1.5 rounded-sm hover:text-primary-light">
                      <Icon name={stat.icon} size={15} className="shrink-0 text-secondary group-hover:text-primary-light" />
                      <span className="group-hover:underline">
                        <span className="font-semibold text-ink group-hover:text-primary-light">{formatCount(stat.count)}</span>{" "}
                        <span className="max-sm:hidden">{stat.text}</span>
                        <span className="sm:hidden">{stat.short}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-body">It’s a quiet moment in the community — a good time to share what you’re working on.</p>
            )}
          </div>
        </div>
        {nudge && nudgeHidden === false && (
          <div className="motion-fade-up flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 sm:ps-16">
            <Link
              href={nudge.href}
              onClick={openNudge}
              className={buttonClasses({ size: "small", className: "max-w-full min-w-0 justify-start text-start" })}
            >
              <Icon name={nudgeIcon[nudge.kind]} size={16} className="shrink-0" />
              <span className="min-w-0 whitespace-normal">{nudge.label}</span>
              <Icon name="chevron-right" size={16} className="shrink-0" />
            </Link>
            <button type="button" onClick={hideNudge} className="rounded-sm text-xs font-medium text-secondary hover:text-primary hover:underline">
              Not today
            </button>
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </section>
  );
}
