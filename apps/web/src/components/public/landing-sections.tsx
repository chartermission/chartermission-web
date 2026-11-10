import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import type { PublicOverview } from "@chartermission/contracts";
import { ChapterAvatar, Icon, buttonClasses, cn, type IconName } from "@chartermission/ui";
import { getViewer } from "@/lib/api/server";
import { Container } from "./container";

const number = new Intl.NumberFormat("en-GB");

function SectionHeader({ id, eyebrow, title, children, center = false }: { id: string; eyebrow: string; title: string; children?: ReactNode; center?: boolean }) {
  return (
    <header className={cn("flex max-w-[720px] flex-col gap-3", center && "mx-auto items-center text-center")}>
      <p className="text-label tracking-[0.08em] text-accent uppercase">{eyebrow}</p>
      <h2 id={id} className="text-[36px] leading-[44px] font-bold tracking-[-0.6px] text-balance text-ink max-sm:text-[28px] max-sm:leading-9">
        {title}
      </h2>
      {children && <p className="text-[17px] leading-7 text-body">{children}</p>}
    </header>
  );
}

/* ------------------------------- What's inside ------------------------------- */

const features: { id: string; icon: IconName; tone: string; title: string; body: string; points: string[] }[] = [
  {
    id: "feed",
    icon: "message",
    tone: "bg-primary-tint text-primary",
    title: "A feed with substance",
    body: "Share updates, ask questions, celebrate milestones and publish long-form articles. Follow topics, not noise.",
    points: ["Posts, polls, photos and video", "Questions with a best answer", "Articles with their own reading page"],
  },
  {
    id: "network",
    icon: "users",
    tone: "bg-info-light text-info",
    title: "A network you can search",
    body: "Find members by country, sector and skill. Connect with peers and follow the people and pages you learn from.",
    points: ["Profiles you control", "Connections and follows", "24-hour stories and highlights"],
  },
  {
    id: "opportunities",
    icon: "briefcase",
    tone: "bg-accent-light text-accent",
    title: "Opportunities that find you",
    body: "Jobs, fellowships, grants and calls for partners, posted by members and organisations. Apply without leaving the platform.",
    points: ["Filter by type, country and sector", "Apply with your profile", "Post your own in minutes"],
  },
  {
    id: "learning-feature",
    icon: "book",
    tone: "bg-warning-light text-warning",
    title: "Learning with Charter Center",
    body: "Courses and learning paths from Charter Center, picked for builders: leadership, enterprise, policy and more.",
    points: ["Guided learning paths", "Save courses for later", "Opens once your profile is complete"],
  },
  {
    id: "events-feature",
    icon: "calendar",
    tone: "bg-success-light text-success",
    title: "Events, online and in person",
    body: "Meetups, workshops and conferences from members and chapters. Register in a click and get reminders.",
    points: ["Waitlists and reminders", "Add to your calendar", "Host your own"],
  },
  {
    id: "pages-feature",
    icon: "building",
    tone: "bg-primary-tint text-primary",
    title: "Pages for organisations",
    body: "Companies, institutions and initiatives get a page of their own, with followers, updates and a verified badge.",
    points: ["Post as your organisation", "See how posts perform", "Apply to be verified"],
  },
];

export function LandingFeatures() {
  return (
    <section id="features" aria-labelledby="features-title" className="scroll-mt-6 bg-surface py-24 max-sm:py-16">
      <Container className="flex flex-col gap-12">
        <SectionHeader id="features-title" eyebrow="What’s inside" title="Everything you need to build, together" center>
          One place for the conversations, people, opportunities and learning that move work forward across Africa and its diaspora.
        </SectionHeader>
        <ul className="grid grid-cols-3 gap-6 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {features.map((feature) => (
            <li key={feature.id} className="flex flex-col gap-4 rounded-card border border-line bg-card p-6 transition-shadow hover:shadow-[0_8px_24px_rgb(15_42_42/0.08)]">
              <span className={cn("flex size-12 items-center justify-center rounded-[12px]", feature.tone)}>
                <Icon name={feature.icon} size={24} />
              </span>
              <div className="flex flex-col gap-2">
                <h3 className="text-h3 text-ink">{feature.title}</h3>
                <p className="text-sm leading-6 text-body">{feature.body}</p>
              </div>
              <ul className="mt-auto flex flex-col gap-1.5 border-t border-line pt-4">
                {feature.points.map((point) => (
                  <li key={point} className="flex items-center gap-2 text-sm text-ink">
                    <Icon name="check" size={16} className="shrink-0 text-primary-light" />
                    {point}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/* ------------------------------- How it works ------------------------------- */

const steps = [
  { title: "Create your profile", body: "Sign up with your email, say where you are and what you work on. You choose what each audience can see." },
  { title: "Join your chapter", body: "Every African country and diaspora community has a chapter. Follow yours to meet the people building near you." },
  { title: "Start building", body: "Post, ask, connect and learn. Follow the topics and pages that matter to your work, and share what you know." },
];

export function LandingSteps() {
  return (
    <section aria-labelledby="steps-title" className="bg-card py-24 max-sm:py-16">
      <Container className="flex flex-col gap-12">
        <SectionHeader id="steps-title" eyebrow="How it works" title="From sign-up to your first conversation in minutes" center />
        <ol className="grid grid-cols-3 gap-8 max-lg:grid-cols-1">
          {steps.map((step, index) => (
            <li key={step.title} className="relative flex flex-col gap-3 rounded-card bg-surface p-7">
              <span className="flex size-11 items-center justify-center rounded-full bg-primary text-h3 text-inverse">{index + 1}</span>
              <h3 className="text-h3 text-ink">{step.title}</h3>
              <p className="text-md leading-7 text-body">{step.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

/* ------------------------------- Chapters (live) ------------------------------- */

export function LandingChapters({ overview }: { overview: PublicOverview }) {
  return (
    <section id="chapters" aria-labelledby="chapters-title" className="scroll-mt-6 bg-surface py-24 max-sm:py-16">
      <Container className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-center gap-14 max-lg:grid-cols-1 max-lg:gap-10">
        <div className="flex flex-col items-start gap-6">
          <SectionHeader id="chapters-title" eyebrow="Chapters" title="Your country has a chapter. So does your diaspora.">
            Chapters are where the community becomes local: the people, posts and events for one country
            {overview.chapters ? `, ${number.format(overview.chapters)} of them so far, ` : " "}
            across the continent and in the cities the diaspora calls home.
          </SectionHeader>
          <ul className="flex flex-col gap-2.5 text-md text-ink">
            {["A feed for your country’s members", "Chapter events and pinned announcements", "Ambassadors who welcome new members"].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
                  <Icon name="check" size={14} />
                </span>
                {item}
              </li>
            ))}
          </ul>
          <Link href="/chapters" className={buttonClasses()}>
            Find your chapter
            <Icon name="chevron-right" size={18} />
          </Link>
        </div>
        {overview.topChapters.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            {overview.topChapters.map((chapter) => (
              <li key={chapter.slug}>
                <Link
                  href={`/chapters/${chapter.slug}`}
                  className="flex items-center gap-3 rounded-card border border-line bg-card px-4 py-3.5 transition-shadow hover:shadow-[0_8px_24px_rgb(15_42_42/0.08)]"
                >
                  <ChapterAvatar name={chapter.name} countryCode={chapter.countryCode} size={44} className="rounded-full" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-md font-semibold text-ink">{chapter.name}</span>
                    <span className="text-xs text-secondary">
                      {chapter.members > 0 ? `${number.format(chapter.members)} member${chapter.members === 1 ? "" : "s"}` : "Be among the first to join"}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={18} className="shrink-0 text-secondary" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-card border border-dashed border-line-strong bg-card p-8 text-center text-md text-secondary">Sign in to browse every chapter.</div>
        )}
      </Container>
    </section>
  );
}

/* ------------------------------- Learning and events (live) ------------------------------- */

const eventDate = (iso: string) => {
  const date = new Date(iso);
  return {
    day: date.toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" }),
    month: date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }),
  };
};

const formatLabel: Record<string, string> = { online: "Online", in_person: "In person", hybrid: "Hybrid" };

export function LandingLearnAndMeet({ overview }: { overview: PublicOverview }) {
  return (
    <section aria-label="Learning and events" className="bg-card py-24 max-sm:py-16">
      <Container className="grid grid-cols-2 gap-6 max-lg:grid-cols-1">
        <article id="learning" className="relative flex scroll-mt-6 flex-col gap-5 overflow-hidden rounded-[20px] bg-primary-dark p-9 max-sm:p-6">
          <span aria-hidden="true" className="absolute -top-16 -end-16 size-56 rounded-full bg-white/5" />
          <span className="flex size-12 items-center justify-center rounded-[12px] bg-white/10 text-accent-on-dark">
            <Icon name="book" size={24} />
          </span>
          <h2 className="text-[28px] leading-9 font-bold tracking-[-0.4px] text-inverse">Keep learning with Charter Center</h2>
          <p className="text-md leading-7 text-primary-tint">
            {overview.courses ? `${number.format(overview.courses)} courses` : "Courses"} and guided learning paths from Charter Center sit inside your membership, synced daily
            so the catalogue is always current.
          </p>
          <ul className="flex flex-col gap-2 text-md text-inverse">
            {["Learning paths that build on each other", "Save courses and pick up where you left off", "Unlocked when your profile is complete"].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <Icon name="check" size={18} className="shrink-0 text-accent-on-dark" />
                {item}
              </li>
            ))}
          </ul>
          <Link href="/learning" className={buttonClasses({ variant: "secondary", className: "mt-auto self-start" })}>
            Browse the catalogue
          </Link>
        </article>

        <article id="events" className="flex scroll-mt-6 flex-col gap-5 rounded-[20px] border border-line bg-surface p-9 max-sm:p-6">
          <span className="flex size-12 items-center justify-center rounded-[12px] bg-success-light text-success">
            <Icon name="calendar" size={24} />
          </span>
          <h2 className="text-[28px] leading-9 font-bold tracking-[-0.4px] text-ink">Meet the community</h2>
          <p className="text-md leading-7 text-body">
            {overview.upcomingEvents > 0
              ? `${number.format(overview.upcomingEvents)} event${overview.upcomingEvents === 1 ? "" : "s"} coming up, online and in person.`
              : "Workshops, meetups and conferences from members and chapters."}{" "}
            Register in a click, join the waitlist when one is full, and get a reminder before it starts.
          </p>
          {overview.events.length > 0 && (
            <ul className="flex flex-col gap-2.5">
              {overview.events.map((event) => {
                const date = eventDate(event.startsAt);
                return (
                  <li key={event.slug}>
                    <Link href={`/events/${event.slug}`} className="flex items-center gap-3.5 rounded-card border border-line bg-card px-4 py-3 hover:border-line-strong">
                      <span className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-accent-light py-1 leading-tight">
                        <span className="text-[11px] font-semibold text-accent-hover uppercase">{date.month}</span>
                        <span className="text-h3 text-ink">{date.day}</span>
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-md font-medium text-ink">{event.title}</span>
                        <span className="text-xs text-secondary">
                          {formatLabel[event.format] ?? "Event"}
                          {event.location ? ` · ${event.location}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/events" className={buttonClasses({ className: "mt-auto self-start" })}>
            See all events
          </Link>
        </article>
      </Container>
    </section>
  );
}

/* ------------------------------- Topics (live) ------------------------------- */

export function LandingTrending({ overview }: { overview: PublicOverview }) {
  if (!overview.trending.length) return null;
  return (
    <section aria-labelledby="community-title" className="bg-surface py-[72px]">
      <Container className="flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="community-title" className="text-h2 text-ink">
            What the community is talking about
          </h2>
          <p className="text-sm text-secondary">Topics from the last two weeks</p>
        </header>
        <ul className="flex flex-wrap gap-3">
          {overview.trending.map((item) => (
            <li key={item.tag}>
              <Link href={`/topics/${encodeURIComponent(item.tag.toLowerCase())}`} className="flex items-center gap-2 rounded-full bg-accent-light px-4 py-2.5 transition-colors hover:bg-accent/15">
                <span className="text-md font-medium text-accent-hover">#{item.tag}</span>
                <span className="text-xs text-secondary">
                  {number.format(item.posts)} post{item.posts === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

/* ------------------------------- Organisations and Ambassadors ------------------------------- */

export function LandingOrganisations({ overview }: { overview: PublicOverview }) {
  return (
    <section id="organisations" aria-labelledby="organisations-title" className="scroll-mt-6 bg-card py-24 max-sm:py-16">
      <Container className="flex flex-col gap-12">
        <SectionHeader id="organisations-title" eyebrow="For organisations and leaders" title="Bring your organisation, and help lead your chapter">
          Charter Mission is built by its members. Two ways to do more than take part.
        </SectionHeader>
        <div className="grid grid-cols-2 gap-6 max-lg:grid-cols-1">
          <article className="flex flex-col gap-4 rounded-[20px] border border-line p-8 max-sm:p-6">
            <span className="flex size-12 items-center justify-center rounded-[12px] bg-primary-tint text-primary">
              <Icon name="building" size={24} />
            </span>
            <h3 className="text-h2 text-ink">Pages</h3>
            <p className="text-md leading-7 text-body">
              Give your company, institution or initiative a home{overview.pages >= 10 ? `, alongside ${number.format(overview.pages)} others` : ""}. Share updates with your followers,
              add your team as admins and see how each post performs.
            </p>
            <ul className="flex flex-col gap-2 text-md text-ink">
              {["Post as your organisation, not as a person", "Analytics for reach and engagement", "A verified badge once we’ve confirmed it’s you"].map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <Icon name="check" size={18} className="shrink-0 text-primary-light" />
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/pages/new" className={buttonClasses({ variant: "secondary", className: "mt-auto self-start" })}>
              Create a page
            </Link>
          </article>
          <article id="ambassadors" className="flex scroll-mt-6 flex-col gap-4 rounded-[20px] border border-line p-8 max-sm:p-6">
            <span className="flex size-12 items-center justify-center rounded-[12px] bg-accent-light text-accent">
              <Icon name="shield" size={24} />
            </span>
            <h3 className="text-h2 text-ink">Ambassadors</h3>
            <p className="text-md leading-7 text-body">
              Ambassadors are members who grow and look after their country’s chapter: welcoming newcomers, hosting events and keeping the conversation useful.
            </p>
            <ul className="flex flex-col gap-2 text-md text-ink">
              {["An Ambassador badge on your profile", "Onboarding and training with the team", "A direct line to the people running the platform"].map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <Icon name="check" size={18} className="shrink-0 text-primary-light" />
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/ambassadors" className={buttonClasses({ variant: "secondary", className: "mt-auto self-start" })}>
              About the programme
            </Link>
          </article>
        </div>
      </Container>
    </section>
  );
}

/* ------------------------------- Trust ------------------------------- */

const trust: { icon: IconName; title: string; body: string }[] = [
  { icon: "eye", title: "You decide who sees what", body: "Set the visibility of every profile field, and preview your profile as a visitor, a member or a connection." },
  { icon: "shield", title: "Moderated by people", body: "Clear community guidelines, a report button on everything, and an appeal for every moderation decision." },
  { icon: "globe", title: "Non-partisan by design", body: "Membership never depends on a political position. The community is for building, across every border." },
  { icon: "verified", title: "No advertising trackers", body: "We keep a short, published list of first-party statistics and nothing else. Your data can be exported or deleted." },
];

export function LandingTrust() {
  return (
    <section aria-labelledby="trust-title" className="bg-primary-dark py-24 max-sm:py-16">
      <Container className="flex flex-col gap-12">
        <header className="flex max-w-[720px] flex-col gap-3">
          <p className="text-label tracking-[0.08em] text-accent-on-dark uppercase">Trust and safety</p>
          <h2 id="trust-title" className="text-[36px] leading-[44px] font-bold tracking-[-0.6px] text-balance text-inverse max-sm:text-[28px] max-sm:leading-9">
            A community you can put your name to
          </h2>
        </header>
        <ul className="grid grid-cols-4 gap-6 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {trust.map((item) => (
            <li key={item.title} className="flex flex-col gap-3 rounded-card border border-white/15 bg-white/5 p-6">
              <Icon name={item.icon} size={24} className="text-accent-on-dark" />
              <h3 className="text-h3 text-inverse">{item.title}</h3>
              <p className="text-sm leading-6 text-primary-tint">{item.body}</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-primary-tint">
          Read the{" "}
          <Link href="/guidelines" className="font-medium text-inverse underline underline-offset-2">
            community guidelines
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" className="font-medium text-inverse underline underline-offset-2">
            privacy notice
          </Link>
          .
        </p>
      </Container>
    </section>
  );
}

/* ------------------------------- Questions ------------------------------- */

const faqs = [
  { q: "Is Charter Mission free?", a: "Yes. Joining, posting, connecting, following chapters and attending community events are free." },
  {
    q: "Who can join?",
    a: "Anyone building for Africa: people on the continent, members of the diaspora, and friends of both. You sign up with an email address and choose your country.",
  },
  {
    q: "I don’t live in Africa. Is there a chapter for me?",
    a: "Yes. Alongside a chapter for every African country there are diaspora chapters for the countries where members live, such as the United Kingdom and the UAE.",
  },
  {
    q: "What is the verified badge?",
    a: "A tick beside a name that tells members the profile or page really is who it says. You apply from your settings once your profile is complete, and the team reviews each request.",
  },
  {
    q: "Can my organisation have a presence?",
    a: "Yes. Create a page for a company, institution or initiative, add colleagues as admins and post as the organisation. New pages are checked by the team before they go live.",
  },
  {
    q: "How is my information used?",
    a: "To run your account and show your profile to the audiences you choose. There are no third-party advertising trackers, and you can export or delete your data from your settings.",
  },
];

export function LandingFaq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-6 bg-surface py-24 max-sm:py-16">
      <Container className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-14 max-lg:grid-cols-1 max-lg:gap-8">
        <SectionHeader id="faq-title" eyebrow="Questions" title="Good to know before you join" />
        <div className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
          {faqs.map((item) => (
            <details key={item.q} className="group px-6 py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-md font-medium text-ink [&::-webkit-details-marker]:hidden">
                {item.q}
                <Icon name="chevron-down" size={20} className="shrink-0 text-secondary transition-transform group-open:rotate-180" />
              </summary>
              <p className="pb-5 text-md leading-7 text-body">{item.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ------------------------------- Closing call to action ------------------------------- */

function JoinButtons() {
  return (
    <>
      <Link href="/signup" className={buttonClasses({ variant: "secondary", className: "px-6! py-3!" })}>
        Create your profile
      </Link>
      <Link href="/signin" className="inline-flex items-center justify-center rounded-lg border border-white/50 px-6 py-3 text-md font-medium whitespace-nowrap text-inverse hover:bg-white/10">
        Sign in
      </Link>
    </>
  );
}

async function CtaButtons() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return <JoinButtons />;
  return (
    <Link href="/feed" className={buttonClasses({ variant: "secondary", className: "px-6! py-3!" })}>
      Back to your feed
      <Icon name="chevron-right" size={18} />
    </Link>
  );
}

export function LandingCta({ overview }: { overview: PublicOverview }) {
  return (
    <section aria-labelledby="cta-title" className="bg-[linear-gradient(100deg,var(--color-accent)_0%,#ff3a12_60%,var(--color-accent-orange)_100%)] py-16">
      <Container className="flex items-center justify-between gap-8 max-lg:flex-col max-lg:items-start">
        <div className="flex flex-col gap-2">
          <h2 id="cta-title" className="text-[36px] leading-[44px] font-bold tracking-[-0.6px] text-inverse max-sm:text-[28px] max-sm:leading-9">
            {overview.countries >= 5 ? `Join members in ${number.format(overview.countries)} countries` : "Take your place in the community"}
          </h2>
          <p className="text-[17px] text-inverse/90">Free to join. Your profile, your visibility settings, your community.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Suspense fallback={<JoinButtons />}>
            <CtaButtons />
          </Suspense>
        </div>
      </Container>
    </section>
  );
}
