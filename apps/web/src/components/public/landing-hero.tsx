import Link from "next/link";
import { Icon, OpportunityCard, TrendingItem, buttonClasses } from "@chartermission/ui";
import { heroOpportunity, heroTrending, landingStats } from "@/lib/mock/public";
import { Container } from "./container";

const previewShadow = "shadow-[0_16px_40px_rgba(0,0,0,0.25)]";

/**
 * Landing hero: pitch, stats and a product preview — Figma "Hero" (12:1325).
 * The transparent PublicNav (82px) is overlaid on its top padding (82 + 72 gap).
 */
export function LandingHero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="bg-[linear-gradient(147deg,var(--color-primary-dark)_0%,var(--color-primary)_50%,var(--color-primary-light)_71.4%)] pt-[154px] pb-[88px]"
    >
      <Container className="flex items-center gap-14">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-6">
          <p className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium text-accent-light">
            <Icon name="globe" size={14} />
            Pan-African · Non-partisan · Free to join
          </p>
          <h1 id="hero-title" className="text-display text-inverse">
            Where Africa and its diaspora build together
          </h1>
          <p className="text-h3 text-primary-tint">
            Find collaborators across 54 countries, discover jobs, fellowships and grants, join initiatives that
            matter, and keep learning — all in one trusted community.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClasses({ variant: "accent" })}>
              Join Charter Mission
            </Link>
            <Link href="/feed" className={buttonClasses({ variant: "secondary" })}>
              Explore opportunities
            </Link>
          </div>
          <dl className="flex gap-10 pt-4">
            {landingStats.map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse">
                <dt className="text-sm text-primary-tint">{stat.label}</dt>
                <dd className="text-h1 text-inverse">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <aside className="flex w-[460px] shrink-0 flex-col gap-4 max-xl:w-[400px]" aria-label="Preview of the member area">
          <section
            aria-labelledby="hero-trending-title"
            className={`flex flex-col gap-0.5 rounded-card border border-line bg-card p-5 ${previewShadow}`}
          >
            <h2 id="hero-trending-title" className="flex items-center gap-2 text-h3 text-ink">
              <Icon name="flame" size={20} className="text-accent" />
              Trending now
            </h2>
            <ol className="flex flex-col gap-0.5">
              {heroTrending.map((topic, index) => (
                <li key={topic.tag}>
                  <TrendingItem rank={index + 1} {...topic} href="/feed" linkAs={Link} />
                </li>
              ))}
            </ol>
          </section>
          <OpportunityCard {...heroOpportunity} href="/feed" linkAs={Link} className={previewShadow} />
        </aside>
      </Container>
    </section>
  );
}
