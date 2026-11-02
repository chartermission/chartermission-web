import Link from "next/link";
import { Icon, buttonClasses, cn } from "@chartermission/ui";
import { communityTags, landingFeatures } from "@/lib/mock/public";
import { Container } from "./container";

/** Six-card feature grid — Figma "Features" (12:1430). */
export function LandingFeatures() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-6 bg-surface py-24">
      <Container className="flex flex-col gap-10">
        <header className="flex flex-col items-center gap-3 text-center">
          <p className="text-label text-accent">ONE PLATFORM</p>
          <h2 id="features-title" className="text-h1 text-ink">
            Everything you need to build, together
          </h2>
        </header>
        <ul className="grid grid-cols-3 gap-6">
          {landingFeatures.map((feature) => (
            <li
              key={feature.id}
              id={feature.id}
              className="flex scroll-mt-6 flex-col gap-3 rounded-card border border-line bg-card p-6"
            >
              <span className={cn("flex size-12 items-center justify-center rounded-[10px]", feature.tone)}>
                <Icon name={feature.icon} size={24} />
              </span>
              <h3 className="text-h3 text-ink">{feature.title}</h3>
              <p className="text-sm text-body">{feature.description}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/** Hashtag pills — Figma "Trending band" (12:1483). */
export function LandingTrending() {
  return (
    <section aria-labelledby="community-title" className="bg-card py-[72px]">
      <Container className="flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <h2 id="community-title" className="text-h2 text-ink">
            What the community is talking about
          </h2>
          <p className="text-sm text-secondary">Updated every few minutes</p>
        </header>
        <ul className="flex flex-wrap gap-3">
          {communityTags.map((item) => (
            <li key={item.tag}>
              <Link
                href="/feed"
                className="flex items-center gap-2 rounded-full bg-accent-light px-4 py-2.5 transition-colors hover:bg-accent/15"
              >
                <span className="text-md font-medium text-accent-hover">#{item.tag}</span>
                <span className="text-xs text-secondary">{item.posts}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/** Orange call-to-action strip — Figma "CTA band" (12:1512). */
export function LandingCta() {
  return (
    <section aria-labelledby="cta-title" className="bg-accent py-14">
      <Container className="flex items-center justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 id="cta-title" className="text-h1 text-inverse">
            Join members across 54 countries
          </h2>
          <p className="text-md text-accent-light">
            Free to join. Your profile, your visibility settings, your community.
          </p>
        </div>
        <Link href="/signup" className={buttonClasses({ variant: "secondary" })}>
          Create your profile
        </Link>
      </Container>
    </section>
  );
}
