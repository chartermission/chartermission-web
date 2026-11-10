import type { Metadata } from "next";
import { SHARE_IMAGE } from "@/lib/share-image";
import { Container } from "@/components/public/container";
import { LandingHero } from "@/components/public/landing-hero";
import {
  LandingChapters,
  LandingCta,
  LandingFaq,
  LandingFeatures,
  LandingLearnAndMeet,
  LandingOrganisations,
  LandingSteps,
  LandingTrending,
  LandingTrust,
} from "@/components/public/landing-sections";
import { PublicFooter } from "@/components/public/public-footer";
import { PublicNav } from "@/components/public/public-nav";
import { getPublicOverview } from "@/lib/public-overview";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const title = t("Charter Mission — Where Africa and its diaspora build together");
  const description = t(
    "Africa has never lacked great minds. It has lacked the bridge between them. Charter Mission is the professional community where Africa and its diaspora build together: chapters, collaborators, opportunities, events and learning. Free and non-partisan.",
  );
  return {
    title: { absolute: title },
    description,
    keywords: ["Pan-African", "African diaspora", "professional network", "chapters", "fellowships", "grants", "jobs in Africa", "Charter Center"],
    openGraph: { images: [SHARE_IMAGE], type: "website", siteName: "Charter Mission", title, description, url: "/" },
    twitter: { card: "summary_large_image", images: [SHARE_IMAGE.url], title, description },
  };
}

/**
 * Public landing page. The numbers, chapters, topics and events are live (GET /public/overview,
 * cached for a few minutes); the nav and the calls to action change for signed-in members.
 */
export default async function LandingPage() {
  const overview = await getPublicOverview();
  return (
    <div className="relative">
      <Container className="absolute inset-x-0 top-0 z-10">
        <PublicNav />
      </Container>
      <main>
        <LandingHero overview={overview} />
        <LandingFeatures />
        <LandingSteps />
        <LandingChapters overview={overview} />
        <LandingLearnAndMeet overview={overview} />
        <LandingTrending overview={overview} />
        <LandingOrganisations overview={overview} />
        <LandingTrust />
        <LandingFaq />
        <LandingCta overview={overview} />
      </main>
      <PublicFooter />
    </div>
  );
}
