import type { Metadata } from "next";
import { Container } from "@/components/public/container";
import { LandingHero } from "@/components/public/landing-hero";
import { LandingCta, LandingFeatures, LandingTrending } from "@/components/public/landing-sections";
import { PublicFooter } from "@/components/public/public-footer";
import { PublicNav } from "@/components/public/public-nav";

const title = "Charter Mission — Where Africa and its diaspora build together";
const description =
  "Find collaborators across 54 countries, discover reviewed jobs, fellowships and grants, join initiatives and events, and keep learning — a free, non-partisan Pan-African community.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  keywords: ["Pan-African", "African diaspora", "professional network", "fellowships", "grants", "jobs in Africa"],
  openGraph: {
    type: "website",
    siteName: "Charter Mission",
    locale: "en",
    title,
    description,
  },
  twitter: {
    card: "summary",
    title,
    description,
  },
};

/** Public landing page — Figma "Web / Public landing page" (node 12:1324). */
export default function LandingPage() {
  return (
    <div className="relative">
      <Container className="absolute inset-x-0 top-0 z-10">
        <PublicNav />
      </Container>
      <main>
        <LandingHero />
        <LandingFeatures />
        <LandingTrending />
        <LandingCta />
      </main>
      <PublicFooter />
    </div>
  );
}
