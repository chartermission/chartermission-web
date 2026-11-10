import { NetworkCounts } from "@/components/people/network-counts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PreviewAs, socialNetworkOf, type MemberProfile, type Page, type PostView } from "@chartermission/contracts";
import { Chip, Icon, Panel, ProfileBadgeList, RoleBadgePill, buttonClasses, type IconName } from "@chartermission/ui";
import { PageColumns } from "@/components/page-columns";
import { getClientViewer } from "@/components/social/data";
import { absoluteDate } from "@/components/social/format";
import { MemberAvatar } from "@/components/social/post-parts";
import { PostStream } from "@/components/social/post-stream";
import { SectionRail } from "@/components/social/section-nav";
import { EmptyState, LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { T } from "@/i18n/client";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { ProfileActions } from "./profile-actions";
import { ProfileHighlightsLoader } from "@/components/stories/stories-loader";
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
  if (!member) notFound();
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

function ChipList({ label, items }: { label: string; items?: { id: string; name: string }[] }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-label uppercase text-secondary">{label}</h3>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <Chip>{item.name}</Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}

function monthLabel(intl: string, value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, 1)).toLocaleDateString(intl, { month: "short", year: "numeric", timeZone: "UTC" });
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

  return (
    <>
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
            {member.verified && <Icon name="verified" size={20} className="text-primary-light" label="Verified member" />}
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
          <T>Introduce yourself with a short video, attach your résumé and add your social links.</T>
          <Link href="/settings/profile#intro" className="font-medium text-primary-light hover:underline">
            <T>Add them to your profile</T>
          </Link>
        </p>
      )}

      {member.bio && (
        <Section title="About">
          <p className="whitespace-pre-line text-md text-body">{member.bio}</p>
        </Section>
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

      {hasTags && (
        <Section title="Skills and interests">
          <ChipList label="Sectors" items={member.sectors} />
          <ChipList label="Skills" items={member.skills} />
          <ChipList label="Interests" items={member.interests} />
          <ChipList label="Languages" items={member.languages} />
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
        <section aria-labelledby="member-posts" className="flex flex-col gap-3">
          <h2 id="member-posts" className="text-h3 text-ink">
            Recent posts
          </h2>
          <MemberPosts memberId={member.id} name={member.name} viewer={viewer} acceptNew={isSelf} />
        </section>
      )}
    </>
  );
}

const MEMBER_POSTS_PAGE = 10;

/** GET /feed?author= — this member's posts, newest first, with "Load more". */
async function MemberPosts({
  memberId,
  name,
  viewer,
  acceptNew,
}: {
  memberId: string;
  name: string;
  viewer: NonNullable<Awaited<ReturnType<typeof getClientViewer>>>;
  acceptNew: boolean;
}) {
  const t = await getT();
  const query = { author: memberId, limit: MEMBER_POSTS_PAGE };
  const page = await apiGet<Page<PostView>>("/feed", query).catch(() => undefined);
  return (
    <PostStream
      path="/feed"
      query={query}
      initial={page}
      acceptNew={acceptNew}
      viewer={viewer}
      label={t("Posts by {name}", { name })}
      empty={
        <EmptyState icon="message" title="No posts yet">
          {acceptNew ? "Posts you share appear here." : t("{name} hasn’t posted yet.", { name })}
        </EmptyState>
      }
    />
  );
}

async function ProfileRightRail(props: Props) {
  const { member } = await loadProfile(props).catch(() => ({ member: null }));
  if (!member || member.chapters.length === 0) return null;
  return (
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
