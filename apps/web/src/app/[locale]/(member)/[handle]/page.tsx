import { NetworkCounts } from "@/components/people/network-counts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, cache, type ReactNode } from "react";
import { PreviewAs, socialNetworkOf, type MemberProfile, type MemberRef, type Page, type PostView, type ProfileCertification } from "@chartermission/contracts";
import { Chip, Icon, Panel, ProfileBadgeList, RoleBadgePill, buttonClasses, type IconName, VerifiedBadge } from "@chartermission/ui";
import { PageColumns } from "@/components/page-columns";
import { getClientViewer } from "@/components/social/data";
import { absoluteDate, monthLabel } from "@/components/social/format";
import { MemberAvatar } from "@/components/social/post-parts";
import { ActivityCarousel } from "@/components/profile/activity-carousel";
import { SectionRail } from "@/components/social/section-nav";
import { EmptyState, LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { T } from "@/i18n/client";
import { NoTranslate } from "@/i18n/auto";
import type { Translate } from "@/i18n/translate";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { ProfileActions } from "./profile-actions";
import { ProfileHighlightsLoader } from "@/components/stories/stories-loader";
import { asServiceList } from "@/components/services/format";
import { ServicesSection } from "@/components/services/services-section";
import { ProfileCompletionCard } from "@/components/people/profile-completion";
import { ProfileTagList } from "@/components/people/profile-tag-list";
import { CertificationTile, VerifiedChip } from "@/components/people/certification-parts";
import { ExpandableList } from "@/components/people/expandable-list";
import { getT, getIntlTag } from "@/i18n/server";

export async function generateMetadata({ params }: PageProps<"/[locale]/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  return { title: handle };
}

type Props = Pick<PageProps<"/[locale]/[handle]">, "params" | "searchParams">;

const previewLabels: Record<PreviewAs, string> = {
  public: "a visitor who isn’t signed in",
  member: "a signed-in member",
  connection: "one of your connections",
};

/** A username, or a member id from an old link. Anything else at /{something} is simply not a page. */
const LOOKS_LIKE_MEMBER = /^(?:[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

async function loadProfile({ params, searchParams }: Props) {
  const { handle } = await params;
  if (!LOOKS_LIKE_MEMBER.test(handle)) notFound();
  const [sp, viewer] = await Promise.all([searchParams, getClientViewer()]);
  const previewParam = PreviewAs.safeParse(Array.isArray(sp.preview) ? sp.preview[0] : sp.preview);
  const isSelf = viewer?.handle === handle.toLowerCase();
  const preview = isSelf && previewParam.success ? previewParam.data : null;
  const member = preview
    ? await apiGet<MemberProfile>("/me/profile/preview", { as: preview })
    : await apiGetOrNull<MemberProfile>(`/members/${encodeURIComponent(handle.toLowerCase())}`).catch((e: unknown) => {
        if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 401) return null;
        throw e;
      });
  if (!member) {
    // Signed out, and the profile is for members only: sign in and come straight back.
    if (!viewer) redirect(`/signin?next=${encodeURIComponent(`/${handle}`)}`);
    notFound();
  }
  // A username the member used before: send the visitor to the current address.
  if (!preview && !/^[0-9a-f-]{36}$/i.test(handle) && handle.toLowerCase() !== member.handle.toLowerCase()) {
    redirect(`/${member.handle}`);
  }
  return { member, viewer, preview };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <h2 className="text-h3 text-ink">{title}</h2>
      {children}
    </Panel>
  );
}

/** How many licenses & certifications show before "Show all". */
const CERTIFICATIONS_SHOWN = 3;

/**
 * One license or certification, LinkedIn-style: picture or icon, name, issuer, dates, credential ID
 * and a "Show credential" link. Verified ones (Charter Mission exams) link to their public post.
 */
function CertificationRow({ cert, intl, t, thisMonth }: { cert: ProfileCertification; intl: string; t: Translate; thisMonth: string }) {
  const dates = [
    cert.issueDate && t("Issued {date}", { date: monthLabel(intl, cert.issueDate) }),
    cert.expiryDate &&
      (cert.expiryDate.slice(0, 7) < thisMonth
        ? t("Expired {date}", { date: monthLabel(intl, cert.expiryDate) })
        : t("Expires {date}", { date: monthLabel(intl, cert.expiryDate) })),
  ].filter(Boolean);
  const url = cert.credentialUrl?.trim() || null;
  // Verified: the certificate's public post (same tab). The member's own: their link, in a new tab.
  const internal = url && cert.verified && url.startsWith("/") && !url.startsWith("//") ? url : null;
  const external = url && !internal && /^https?:\/\//i.test(url) ? url : null;
  const showClasses = buttonClasses({ variant: "secondary", size: "small", className: "mt-2 self-start rounded-full" });
  return (
    <li className="flex items-start gap-3">
      <CertificationTile imageUrl={cert.verified ? cert.imageUrl : null} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <NoTranslate>
            <span dir="auto" className="bidi-auto min-w-0 break-words text-md font-semibold text-ink">
              {cert.name}
            </span>
          </NoTranslate>
          {cert.verified && <VerifiedChip />}
        </span>
        <NoTranslate>
          <span dir="auto" className="bidi-auto text-sm text-body">
            {cert.issuer}
          </span>
        </NoTranslate>
        {dates.length > 0 && <span className="text-xs text-secondary">{dates.join(" · ")}</span>}
        {cert.credentialId && (
          <span className="break-all text-xs text-secondary">
            Credential ID{" "}
            <NoTranslate>
              <bdi>{cert.credentialId}</bdi>
            </NoTranslate>
          </span>
        )}
        {internal && (
          <Link href={internal} className={showClasses}>
            Show credential
            <Icon name="arrow-up-right" size={14} className="rtl:-scale-x-100" />
          </Link>
        )}
        {external && (
          <a href={external} target="_blank" rel="noopener noreferrer nofollow" className={showClasses}>
            Show credential
            <Icon name="external" size={14} className="rtl:-scale-x-100" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </span>
    </li>
  );
}

async function ProfileMain(props: Props) {
  const intl = await getIntlTag();
  const t = await getT();
  const { member, viewer, preview } = await loadProfile(props);
  const isSelf = member.relationship.self && !preview;
  const location = [member.city, member.country?.name].filter(Boolean).join(", ");
  const facts: { icon: IconName; content: ReactNode }[] = [];
  if (location) facts.push({ icon: "map-pin", content: location });
  if (member.organisation) facts.push({ icon: "building", content: member.organisation });
  // Official accounts are follow-only, so they have followers but no connections.
  facts.push({
    icon: "users",
    content: viewer ? (
      <NetworkCounts
        handle={member.handle}
        name={member.name}
        connections={member.counts.connections}
        followers={member.counts.followers}
        official={member.official}
        self={member.relationship.self}
      />
    ) : (
      `${member.counts.followers.toLocaleString("en-US")} follower${member.counts.followers === 1 ? "" : "s"}`
    ),
  });
  facts.push({ icon: "calendar", content: `Joined ${absoluteDate(intl, member.joinedAt)}` });

  const contact: { icon: IconName; label: string; value: ReactNode }[] = [];
  if (member.email) contact.push({ icon: "mail", label: "Email", value: <a href={`mailto:${member.email}`} className="text-primary-light hover:underline">{member.email}</a> });
  if (member.website)
    contact.push({
      icon: "globe",
      label: "Website",
      value: (
        <a href={member.website} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary-light hover:underline">
          {member.website.replace(/^https?:\/\//, "")}
        </a>
      ),
    });
  // Social and professional links, each named after its network when the address is a known one.
  const links = (member.links ?? [])
    .filter((link) => /^https?:\/\//i.test(link.url))
    .map((link) => ({ url: link.url, name: link.label.trim() || socialNetworkOf(link.url)?.label || link.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]! }));
  const hasTags = !!(member.skills?.length || member.sectors?.length || member.interests?.length || member.languages?.length);
  const certifications = member.certifications ?? [];
  // For "Expired" vs "Expires": months compare as text (YYYY-MM).
  const thisMonth = new Date().toISOString().slice(0, 7);

  return (
    <>
      {isSelf && (
        // Below xl the right rail is hidden: the completion card leads the main column instead.
        <div className="empty:hidden xl:hidden">
          <Suspense fallback={null}>
            <ProfileCompletionCard variant="main" />
          </Suspense>
        </div>
      )}
      {preview && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-info/40 bg-info-light px-4 py-3 text-sm text-ink">
          <span className="flex items-center gap-2">
            <Icon name="eye" size={18} className="text-info" />
            You’re seeing your profile as {previewLabels[preview]} would. Hidden fields are left out.
          </span>
          <Link href={`/${member.handle}`} className="font-medium text-primary-light hover:underline">
            Exit preview
          </Link>
        </div>
      )}
      <Panel className="flex flex-col overflow-hidden">
        {member.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by the API's media route
          <img src={member.coverUrl} alt="" className="h-[132px] w-full object-cover max-sm:h-24" />
        ) : (
          <div className="h-[132px] w-full bg-gradient-to-r from-primary-dark via-primary-light via-65% to-accent max-sm:h-24" aria-hidden="true" />
        )}
        <div className="flex flex-col gap-3 px-6 pb-6 max-sm:px-4">
          <div className="-mt-12 flex flex-wrap items-end justify-between gap-4">
            <span className="rounded-full border-4 border-card bg-card">
              <MemberAvatar member={member} size={96} />
            </span>
            {viewer && !preview && <ProfileActions member={member} canPost={viewer.emailVerified} />}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="text-h2 text-ink">{member.name}</h1>
            {member.verified && <VerifiedBadge size={20} label="Verified member" />}
            {member.official ? <Chip tone="info">Official account</Chip> : member.staff && <Chip tone="info">Charter Mission team</Chip>}
            {member.relationship.followsYou && !member.relationship.self && <Chip>Follows you</Chip>}
          </div>
          {member.headline && <p dir="auto" className="bidi-auto text-md text-body">{member.headline}</p>}
          {(member.badge || member.badges.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {member.badge && <RoleBadgePill badge={member.badge} />}
              <ProfileBadgeList badges={member.badges} />
            </div>
          )}
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {facts.map((fact, index) => (
              <li key={index} className="flex items-center gap-1.5 text-sm text-secondary">
                <Icon name={fact.icon} size={16} className="shrink-0" />
                {fact.content}
              </li>
            ))}
          </ul>
          {(links.length > 0 || member.resume) && (
            <ul className="flex flex-wrap items-center gap-2" aria-label="Links">
              {member.resume && (
                <li>
                  <a
                    href={member.resume.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={member.resume.name}
                    className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-inverse hover:bg-primary-light"
                  >
                    <Icon name="book" size={14} />
                    <T>Résumé</T>
                    <span className="text-xs font-normal opacity-80">PDF</span>
                  </a>
                </li>
              )}
              {links.map((link) => (
                <li key={link.url}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    title={link.url}
                    className="flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-sm font-medium text-ink hover:border-primary hover:text-primary"
                  >
                    <span dir="auto">{link.name}</span>
                    <Icon name="arrow-up-right" size={14} className="text-secondary" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          {member.relationship.blocked && (
            <p role="note" className="flex items-center gap-2 rounded-lg bg-error-light px-3 py-2 text-sm text-ink">
              <Icon name="shield" size={16} className="text-error" />
              You blocked {member.name}. They can’t see your posts or profile, or interact with you.
            </p>
          )}
        </div>
      </Panel>

      {viewer && !preview && !member.relationship.blocked && (
        <Suspense fallback={null}>
          <ProfileHighlightsLoader memberId={member.id} name={member.name} own={isSelf} />
        </Suspense>
      )}

      {member.introVideo && (
        <Section title="Intro video">
          <div dir="ltr" className="overflow-hidden rounded-[10px] bg-ink">
            <video
              src={member.introVideo.url}
              poster={member.introVideo.posterUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              aria-label={t("{name}: intro video", { name: member.name })}
              className="block max-h-[480px] w-full bg-ink object-contain"
            />
          </div>
        </Section>
      )}
      {isSelf && !preview && !member.introVideo && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border border-dashed border-line-strong bg-card px-4 py-3 text-sm text-secondary">
          <Icon name="video" size={16} />
          {/* Only ask for what's missing: the résumé and links may already be there. */}
          {member.resume || links.length > 0 ? (
            <>
              <T>Introduce yourself with a short video so members can put a face to your name.</T>
              <Link href="/settings/profile#intro" className="font-medium text-primary-light hover:underline">
                <T>Add an intro video</T>
              </Link>
            </>
          ) : (
            <>
              <T>Introduce yourself with a short video, attach your résumé and add your social links.</T>
              <Link href="/settings/profile#intro" className="font-medium text-primary-light hover:underline">
                <T>Add them to your profile</T>
              </Link>
            </>
          )}
        </p>
      )}

      {member.bio && (
        <Section title="About">
          <p className="whitespace-pre-line text-md text-body">{member.bio}</p>
        </Section>
      )}

      {!preview && !member.relationship.blocked && (
        // From xl up, Services sit in the right rail (compact); this copy is for smaller screens.
        <div className="empty:hidden xl:hidden">
          <Suspense fallback={<PanelSkeleton lines={3} />}>
            <MemberServices member={member} own={isSelf} signedIn={!!viewer} />
          </Suspense>
        </div>
      )}

      {member.experience && member.experience.length > 0 && (
        <Section title="Experience">
          <ul className="flex flex-col gap-4">
            {member.experience.map((role, index) => (
              <li key={role.id ?? index} className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-tint text-primary">
                  <Icon name="building" size={20} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-md font-medium text-ink">{role.title}</span>
                  <span className="text-sm text-body">{role.organisation}</span>
                  <span className="text-xs text-secondary">
                    {monthLabel(intl, role.startDate)} – {role.endDate ? monthLabel(intl, role.endDate) : "Present"}
                    {role.location ? ` · ${role.location}` : ""}
                  </span>
                  {role.description && <span className="mt-1 whitespace-pre-line text-sm text-body">{role.description}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {certifications.length > 0 && (
        <Section title="Licenses & certifications">
          <ExpandableList
            limit={CERTIFICATIONS_SHOWN}
            showAllLabel={t("Show all {count} licenses & certifications", { count: certifications.length })}
            className="flex flex-col gap-4"
          >
            {certifications.map((cert) => (
              <CertificationRow key={`${cert.verified ? "exam" : "own"}-${cert.id}`} cert={cert} intl={intl} t={t} thisMonth={thisMonth} />
            ))}
          </ExpandableList>
        </Section>
      )}

      {hasTags && (
        <Section title="Skills and interests">
          <ProfileTagList label="Sectors" items={member.sectors} />
          <ProfileTagList label="Skills" items={member.skills} />
          <ProfileTagList label="Interests" items={member.interests} />
          <ProfileTagList label="Languages" items={member.languages} />
        </Section>
      )}

      {contact.length > 0 && (
        <Section title="Contact">
          <dl className="flex flex-col gap-3">
            {contact.map((item, index) => (
              <div key={index} className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                <dt className="flex w-28 items-center gap-2.5 text-sm font-medium text-ink">
                  <Icon name={item.icon} size={18} className="text-secondary" />
                  {item.label}
                </dt>
                <dd className="min-w-0 text-sm">{item.value}</dd>
              </div>
            ))}
          </dl>
          {isSelf && <p className="text-xs text-secondary">You choose who sees each field in Settings → Privacy.</p>}
        </Section>
      )}

      {isSelf && !member.bio && !hasTags && (
        <EmptyState
          icon="user"
          title="Tell members about yourself"
          actions={
            <Link href="/settings/profile" className={buttonClasses({ size: "small" })}>
              Complete your profile
            </Link>
          }
        >
          Add a bio, your sectors and skills so people with shared interests can find you.
        </EmptyState>
      )}

      {viewer && !preview && !member.relationship.blocked && (
        <MemberActivity memberId={member.id} handle={member.handle} name={member.name} followers={member.counts.followers} own={isSelf} />
      )}
    </>
  );
}

/** GET /members/{handle}/services, once per request (the rail and the narrow-screen copy share it). */
const getMemberServices = cache((handle: string) =>
  apiGet<unknown>(`/members/${encodeURIComponent(handle)}/services`)
    .then(asServiceList)
    .catch(() => null),
);

/** The Services panel (hidden for others when there are none). `compact` for the right rail. */
async function MemberServices({ member, own, signedIn, compact = false }: { member: MemberProfile; own: boolean; signedIn: boolean; compact?: boolean }) {
  const services = await getMemberServices(member.handle);
  if (!services || (!own && services.length === 0)) return null;
  const ref: MemberRef = {
    id: member.id,
    handle: member.handle,
    name: member.name,
    headline: member.headline,
    avatarUrl: member.avatarUrl,
    tone: member.tone,
    verified: member.verified,
    staff: member.staff,
    official: member.official,
    badge: member.badge ?? null,
  };
  return <ServicesSection host={{ type: "member", member: ref }} services={services} canManage={own} signedIn={signedIn} compact={compact} />;
}

/** Posts in the Activity row before "Show all posts". */
const ACTIVITY_POSTS = 8;

/**
 * Activity, like LinkedIn: the member's latest posts as a row of small cards that scrolls sideways;
 * "Show all posts" opens the full feed of their posts (/{handle}/activity).
 */
async function MemberActivity({ memberId, handle, name, followers, own }: { memberId: string; handle: string; name: string; followers: number; own: boolean }) {
  const t = await getT();
  const page = await apiGet<Page<PostView>>("/feed", { author: memberId, limit: ACTIVITY_POSTS }).catch(() => undefined);
  const posts = page?.items ?? [];
  return (
    <section aria-labelledby="member-activity" className="flex flex-col gap-3 rounded-card border border-line bg-card p-5 max-sm:px-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <h2 id="member-activity" className="text-h3 text-ink">
            Activity
          </h2>
          <p className="text-sm text-secondary">{t("{count} followers", { count: followers.toLocaleString() })}</p>
        </div>
        {own && (
          <Link href="/feed?compose=1" className={buttonClasses({ variant: "secondary", size: "small" })}>
            Create a post
          </Link>
        )}
      </div>
      {page === undefined ? (
        <p className="text-sm text-secondary">Posts couldn’t be loaded. Refresh the page to try again.</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-secondary">{own ? "Posts you share appear here." : t("{name} hasn’t posted yet.", { name })}</p>
      ) : (
        <ActivityCarousel posts={posts} label={t("Posts by {name}", { name })} />
      )}
      {posts.length > 0 && (
        <Link
          href={`/${handle}/activity`}
          className="-mx-5 -mb-5 flex items-center justify-center gap-1 border-t border-line py-3 text-sm font-semibold text-secondary hover:bg-muted hover:text-ink max-sm:-mx-4"
        >
          Show all posts
          <Icon name="chevron-right" size={16} />
        </Link>
      )}
    </section>
  );
}

/** Right rail: profile completion (own profile only), Services, Chapters. */
async function ProfileRightRail(props: Props) {
  const { member, viewer, preview } = await loadProfile(props).catch(() => ({ member: null, viewer: null, preview: null }));
  if (!member) return null;
  const isSelf = member.relationship.self && !preview;
  return (
    <>
      {isSelf && (
        <Suspense fallback={<PanelSkeleton className="h-[220px]" lines={4} />}>
          <ProfileCompletionCard variant="rail" />
        </Suspense>
      )}
      {!preview && !member.relationship.blocked && (
        <Suspense fallback={<PanelSkeleton lines={3} />}>
          <MemberServices member={member} own={isSelf} signedIn={!!viewer} compact />
        </Suspense>
      )}
      {member.chapters.length > 0 && (
        <Panel className="flex flex-col gap-3 p-5">
          <h2 className="text-h3 text-ink">Chapters</h2>
          <ul className="flex flex-col gap-3">
            {member.chapters.map((chapter) => (
              <li key={chapter.id}>
                <Link href={`/chapters/${chapter.slug}`} className="group flex items-center gap-2.5">
                  <Icon name="globe" size={20} className="shrink-0 text-primary-light" />
                  <span className="text-sm font-medium text-ink group-hover:underline">{chapter.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

/** Member profile — Figma "Web / Member profile" (node 9:860, body 9:913). Only fields the API returns are shown. */
export default function MemberProfilePage({ params, searchParams }: PageProps<"/[locale]/[handle]">) {
  return (
    <PageColumns
      left={<SectionRail active="/network" />}
      right={
        <aside className="flex w-80 shrink-0 flex-col gap-4">
          <Suspense fallback={<PanelSkeleton lines={3} />}>
            <ProfileRightRail params={params} searchParams={searchParams} />
          </Suspense>
        </aside>
      }
    >
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading profile" />
            <PanelSkeleton className="h-[360px]" lines={5} />
            <PanelSkeleton lines={4} />
          </>
        }
      >
        <ProfileMain params={params} searchParams={searchParams} />
      </Suspense>
    </PageColumns>
  );
}
