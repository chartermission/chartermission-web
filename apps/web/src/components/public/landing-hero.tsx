import Link from "next/link";
import { Suspense } from "react";
import type { PublicOverview } from "@chartermission/contracts";
import { T } from "@/i18n/client";
import { Icon, buttonClasses } from "@chartermission/ui";
import { BrandPattern } from "@/components/illustrations";
import { getViewer } from "@/lib/api/server";
import { Container } from "./container";
import { getIntlTag } from "@/i18n/server";

const number = new Intl.NumberFormat("en-GB");

/** Round big numbers down to something that reads well: 12,480 → "12,400+". */
function approx(n: number): string {
  if (n < 100) return number.format(n);
  const step = n < 1000 ? 10 : n < 10_000 ? 100 : 1000;
  return `${number.format(Math.floor(n / step) * step)}+`;
}

function SignedOutCta() {
  return (
    <>
      <Link href="/signup" className={buttonClasses({ variant: "accent", className: "px-6! py-3! text-[17px]!" })}>
        <T k="landing.join" />
        <Icon name="chevron-right" size={18} />
      </Link>
      <Link href="/#features" className="inline-flex items-center justify-center rounded-lg border border-white/40 px-6 py-3 text-[17px] font-medium whitespace-nowrap text-inverse transition-colors hover:bg-white/10">
        <T k="landing.seeInside" />
      </Link>
    </>
  );
}

/** Signed-in members get a way back in, not an invitation to join. Streams in behind Suspense. */
async function HeroCta() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return <SignedOutCta />;
  const first = viewer.name.split(" ")[0] ?? viewer.name;
  return (
    <>
      <Link href="/feed" className={buttonClasses({ variant: "accent", className: "px-6! py-3! text-[17px]!" })}>
        <T k="landing.welcomeBack" vars={{ name: first }} />
        <Icon name="chevron-right" size={18} />
      </Link>
      <Link href={`/${viewer.handle}`} className="inline-flex items-center justify-center rounded-lg border border-white/40 px-6 py-3 text-[17px] font-medium whitespace-nowrap text-inverse transition-colors hover:bg-white/10">
        <T k="landing.yourProfile" />
      </Link>
    </>
  );
}

/** A small card floating beside the map, showing something live from the community. */
function FloatCard({ className, icon, label, children }: { className: string; icon: "flame" | "calendar" | "globe" | "book"; label: string; children: React.ReactNode }) {
  return (
    <div className={`absolute flex max-w-[230px] flex-col gap-1 rounded-card border border-white/60 bg-card/95 px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.28)] backdrop-blur ${className}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-accent-hover uppercase">
        <Icon name={icon} size={14} />
        {label}
      </p>
      {children}
    </div>
  );
}

/** The brand's Africa network map inside soft rings, with live cards around it. Decorative on small screens. */
async function HeroArt({ overview }: { overview: PublicOverview }) {
  const intl = await getIntlTag();
  const topic = overview.trending[0];
  const event = overview.events[0];
  const chapter = overview.topChapters[0];
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px] max-lg:max-w-[380px]">
      <svg viewBox="0 0 520 520" className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <radialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
            <stop offset="60%" stopColor="#ffffff" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="260" cy="260" r="250" fill="url(#hero-glow)" />
        {[120, 178, 236].map((r, i) => (
          <circle key={r} cx="260" cy="260" r={r} fill="none" stroke="#ffffff" strokeOpacity={0.28 - i * 0.07} strokeWidth="1.5" strokeDasharray={i === 1 ? "2 10" : undefined} strokeLinecap="round" />
        ))}
        {/* Nodes on the rings: people and chapters around the continent. */}
        {[
          [260, 24, 7, "#ff9a1f"],
          [468, 168, 5, "#ffffff"],
          [84, 150, 6, "#ffffff"],
          [60, 330, 5, "#ff9a1f"],
          [420, 420, 7, "#ffffff"],
          [190, 482, 5, "#ffffff"],
          [392, 96, 4, "#ff9a1f"],
        ].map(([cx, cy, r, fill]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill={fill as string} />
        ))}
      </svg>
      {/* eslint-disable-next-line @next/next/no-img-element -- small static brand artwork */}
      <img src="/brand/africa-network.png" alt="" width={254} height={263} className="absolute top-1/2 left-1/2 w-[46%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_12px_32px_rgba(0,0,0,0.3)]" />

      {topic && (
        <FloatCard className="top-[6%] -start-[2%] max-lg:hidden" icon="flame" label="Trending now">
          <p className="text-md font-semibold text-ink">#{topic.tag}</p>
          <p className="text-xs text-secondary">
            {number.format(topic.posts)} post{topic.posts === 1 ? "" : "s"} in the last two weeks
          </p>
        </FloatCard>
      )}
      {event && (
        <FloatCard className="end-[-4%] bottom-[10%] max-lg:hidden" icon="calendar" label="Coming up">
          <p className="line-clamp-2 text-sm font-semibold text-ink">{event.title}</p>
          <p className="text-xs text-secondary">
            {new Date(event.startsAt).toLocaleDateString(intl, { day: "numeric", month: "short", timeZone: "UTC" })}
            {event.location ? ` · ${event.location}` : event.format === "online" ? " · Online" : ""}
          </p>
        </FloatCard>
      )}
      {chapter && (
        <FloatCard className="top-[16%] end-[-2%] max-lg:hidden" icon="globe" label="Chapters">
          <p className="text-sm font-semibold text-ink">{chapter.name}</p>
          <p className="text-xs text-secondary">and {number.format(Math.max(overview.chapters - 1, 0))} more across Africa and the diaspora</p>
        </FloatCard>
      )}
    </div>
  );
}

/**
 * Landing hero: the pitch, the way in (or back in, for signed-in members), live numbers and the
 * brand map. The transparent PublicNav (82px) is overlaid on its top padding.
 */
export function LandingHero({ overview }: { overview: PublicOverview }) {
  // Numbers are shown when they are real and worth showing; a brand-new community leads with what is on offer.
  const stats = [
    overview.members >= 100 ? { value: approx(overview.members), label: "members" as const } : null,
    overview.chapters ? { value: number.format(overview.chapters), label: "chapters" as const } : null,
    overview.countries >= 5 ? { value: number.format(overview.countries), label: "countries" as const } : null,
    overview.courses ? { value: number.format(overview.courses), label: "courses" as const } : null,
  ]
    .filter((s): s is { value: string; label: "members" | "chapters" | "countries" | "courses" } => !!s)
    .slice(0, 3);

  return (
    <section
      aria-labelledby="hero-title"
      className="relative overflow-hidden bg-[linear-gradient(147deg,var(--color-primary-dark)_0%,var(--color-primary)_55%,var(--color-primary-light)_100%)] pt-[136px] pb-24 max-lg:pt-[112px] max-lg:pb-16"
    >
      <BrandPattern tone="text-inverse" opacity={0.07} fade="left" />
      <Container className="relative grid grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-center gap-12 max-lg:grid-cols-1 max-lg:gap-10">
        <div className="flex min-w-0 flex-col items-start gap-6">
          <p className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-inverse">
            <Icon name="globe" size={14} />
            <T k="landing.eyebrow" />
          </p>
          <h1 id="hero-title" className="text-[52px] leading-[1.1] font-bold tracking-[-1.4px] text-balance text-inverse max-lg:text-[42px] max-sm:text-[34px]">
            <T k="landing.titleA" /> <span className="text-accent-on-dark"><T k="landing.titleB" /></span>
          </h1>
          <p className="max-w-[560px] text-[19px] leading-8 text-primary-tint max-sm:text-[17px] max-sm:leading-7">
            <T k="landing.lead" />
          </p>
          <div className="flex flex-wrap gap-3">
            <Suspense fallback={<SignedOutCta />}>
              <HeroCta />
            </Suspense>
          </div>
          {stats.length > 0 && (
            <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t border-white/15 pt-6">
              {stats.map((stat) => (
                <div key={stat.label} className="flex flex-col-reverse">
                  <dt className="text-sm text-primary-tint"><T k={`landing.stats.${stat.label}`} /></dt>
                  <dd className="text-h1 text-inverse tabular-nums">{stat.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <HeroArt overview={overview} />
      </Container>
    </section>
  );
}
