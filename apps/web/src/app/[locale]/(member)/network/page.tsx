import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  type MyReferrals,
  DirectoryQuery,
  type ConnectionView,
  type DirectoryMember,
  type Page,
  type SuggestedMember,
} from "@chartermission/contracts";
import { cn } from "@chartermission/ui";
import { PageHeader, PageShell } from "@/components/discover/page-shell";
import { ConnectionList } from "@/components/network/connection-list";
import { InvitePeopleButton } from "@/components/invite/invite-dialog";
import { Directory } from "@/components/network/directory";
import { DirectoryMemberCard } from "@/components/network/member-card";
import { requireClientViewer, settle } from "@/components/social/data";
import { memberHref } from "@/components/social/links";
import { MemberAvatar, TimeAgo } from "@/components/social/post-parts";
import { errorMessage } from "@/components/social/error-message";
import { EmptyState, LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGet } from "@/lib/api/server";
import { getTaxonomies } from "@/lib/taxonomies";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Network") };
}

const tabs = [
  { value: "connections", label: "Connections" },
  { value: "invitations", label: "Invitations" },
  { value: "directory", label: "Directory" },
  { value: "suggestions", label: "Suggestions" },
] as const;

type Tab = (typeof tabs)[number]["value"];
type SearchParams = PageProps<"/[locale]/network">["searchParams"];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function TabNav({ active, incoming }: { active: Tab; incoming: number }) {
  return (
    <nav aria-label="Network sections" className="flex gap-6 overflow-x-auto border-b border-line">
      {tabs.map((tab) => {
        const selected = tab.value === active;
        return (
          <Link
            key={tab.value}
            href={`/network?tab=${tab.value}`}
            aria-current={selected ? "page" : undefined}
            className={cn("group -mb-px flex shrink-0 flex-col items-center gap-2.5 text-md", selected ? "font-medium text-primary" : "text-secondary hover:text-ink")}
          >
            <span className="flex items-center gap-1.5">
              {tab.label}
              {tab.value === "invitations" && incoming > 0 && (
                <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-inverse">
                  {incoming}
                  <span className="sr-only"> pending</span>
                </span>
              )}
            </span>
            <span className={cn("h-[3px] w-full", selected ? "bg-accent" : "bg-transparent group-hover:bg-line")} />
          </Link>
        );
      })}
    </nav>
  );
}

const noMember = { self: false, connection: "none", connectionId: null, following: false, followsYou: false, blocked: false, muted: false } as const;

async function ConnectionsTab() {
  const result = await settle(apiGet<Page<ConnectionView>>("/me/connections", { filter: "connected" }));
  if (!result.ok) return <SectionError message={errorMessage(result.error)} retryHref="/network?tab=connections" />;
  return (
    <ConnectionList
      filter="connected"
      initial={result.data}
      title="Your connections"
      empty={
        <>
          You haven’t connected with anyone yet.{" "}
          <Link href="/network?tab=suggestions" className="font-medium text-primary-light hover:underline">
            See suggestions
          </Link>{" "}
          or{" "}
          <Link href="/network?tab=directory" className="font-medium text-primary-light hover:underline">
            search the directory
          </Link>
          .
        </>
      }
    />
  );
}

async function InvitationsTab({ incoming }: { incoming: Page<ConnectionView> | null }) {
  const outgoing = await settle(apiGet<Page<ConnectionView>>("/me/connections", { filter: "outgoing" }));
  return (
    <>
      <ConnectionList
        filter="incoming"
        initial={incoming ?? { items: [], nextCursor: null }}
        title="Received"
        empty="No pending invitations. Requests from other members appear here."
      />
      {outgoing.ok ? (
        <ConnectionList filter="outgoing" initial={outgoing.data} title="Sent" empty="You have no pending requests. Requests you send appear here until they’re answered." />
      ) : (
        <SectionError message={errorMessage(outgoing.error)} retryHref="/network?tab=invitations" />
      )}
      <Suspense fallback={<PanelSkeleton lines={2} />}>
        <JoinedThroughYou />
      </Suspense>
    </>
  );
}

/** The people who joined Charter Mission through the viewer's invitation links. */
async function JoinedThroughYou() {
  const t = await getT();
  const viewer = await requireClientViewer("/network?tab=invitations");
  const result = await settle(apiGet<MyReferrals>("/invites/mine"));
  if (!result.ok) return null;
  const { total, people } = result.data;
  return (
    <section aria-labelledby="joined-heading" className="flex flex-col gap-3 rounded-card border border-line bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="joined-heading" className="text-h3 text-ink">
            {t("Joined through your invitations")} <span className="text-secondary">({total})</span>
          </h2>
          <p className="text-sm text-secondary">{t("People who signed up with your invitation link. Personal invitations connect you automatically.")}</p>
        </div>
        <InvitePeopleButton inviterHandle={viewer.handle} variant="secondary" />
      </div>
      {people.length === 0 ? (
        <p className="text-sm text-secondary">{t("No one yet. Share your invitation link and they’ll appear here when they join.")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          {people.map(({ member, kind, joinedAt }) => (
            <li key={member.id} className="flex items-center gap-3">
              <MemberAvatar member={member} size={40} link />
              <div className="flex min-w-0 flex-col">
                <Link href={memberHref(member.handle)} className="truncate text-sm font-medium text-ink hover:underline">
                  {member.name}
                </Link>
                <span className="truncate text-xs text-secondary">
                  {kind === "event" ? t("Through an event invitation") : kind === "chapter" ? t("Through a chapter invitation") : t("Through your personal invitation")} ·{" "}
                  <TimeAgo iso={joinedAt} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function SuggestionsTab() {
  const result = await settle(apiGet<SuggestedMember[]>("/members/suggestions"));
  if (!result.ok) return <SectionError message={errorMessage(result.error)} retryHref="/network?tab=suggestions" />;
  const suggestions = result.data;
  return (
    <>
      <p className="text-sm text-secondary">Suggested because you share a country, sector, skill or chapter. Each card says why.</p>
      {suggestions.length ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {suggestions.map((member) => (
            <li key={member.id} className="flex">
              <DirectoryMemberCard member={{ ...member, location: null, mutualConnections: 0, relationship: { ...noMember } }} reason={member.reason} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon="users"
          title="No suggestions yet"
          actions={
            <Link href="/settings/profile" className="text-sm font-medium text-primary-light hover:underline">
              Add sectors and skills to your profile
            </Link>
          }
        >
          Suggestions come from shared countries, sectors, skills and chapters.
        </EmptyState>
      )}
    </>
  );
}

async function DirectoryTab({ sp }: { sp: Awaited<SearchParams> }) {
  const parsed = DirectoryQuery.safeParse({
    q: first(sp.q),
    country: first(sp.country),
    sector: first(sp.sector),
    skill: first(sp.skill),
    sort: first(sp.sort),
  });
  const query = parsed.success ? parsed.data : DirectoryQuery.parse({});
  const filters = { q: query.q, country: query.country, sector: query.sector, skill: query.skill, sort: query.sort };
  const [page, taxonomies] = await Promise.all([
    settle(apiGet<Page<DirectoryMember>>("/members", { ...filters, sort: query.sort === "relevance" ? undefined : query.sort })),
    getTaxonomies().catch(() => ({ countries: [], sectors: [], skills: [] })),
  ]);
  if (!page.ok) return <SectionError message={errorMessage(page.error)} retryHref="/network?tab=directory" />;
  return <Directory key={JSON.stringify(filters)} filters={filters} initial={page.data} taxonomies={taxonomies} />;
}

async function NetworkMain({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const tabParam = first(sp.tab);
  const tab: Tab = tabs.some((t) => t.value === tabParam) ? (tabParam as Tab) : "connections";
  await requireClientViewer("/network");
  const incoming = await apiGet<Page<ConnectionView>>("/me/connections", { filter: "incoming", limit: 50 }).catch(() => null);
  return (
    <>
      <TabNav active={tab} incoming={incoming?.items.length ?? 0} />
      {tab === "connections" && <ConnectionsTab />}
      {tab === "invitations" && <InvitationsTab incoming={incoming} />}
      {tab === "suggestions" && <SuggestionsTab />}
      {tab === "directory" && <DirectoryTab sp={sp} />}
    </>
  );
}

/** Invite people who aren't on Charter Mission yet. */
async function InviteAction() {
  const viewer = await requireClientViewer("/network");
  return <InvitePeopleButton inviterHandle={viewer.handle} />;
}

/** Network — connections, invitations, directory and suggestions (Figma "Web / Network directory", node 17:1602). */
export default function NetworkPage({ searchParams }: PageProps<"/[locale]/network">) {
  return (
    <PageShell>
      <PageHeader
        title="Network"
        description="Find people by country, sector and skill. Connections see more of each other’s profiles."
        actions={
          <Suspense>
            <InviteAction />
          </Suspense>
        }
      />
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading your network" />
            <PanelSkeleton className="h-11" lines={0} />
            <PanelSkeleton className="h-[420px]" lines={6} />
          </>
        }
      >
        <NetworkMain searchParams={searchParams} />
      </Suspense>
      <Toaster />
    </PageShell>
  );
}
