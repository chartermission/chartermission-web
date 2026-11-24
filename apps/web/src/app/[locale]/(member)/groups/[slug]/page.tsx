import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import type { GroupDetail, GroupMemberView, Page, PostView } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { TabList, TabPanel, Tabs } from "@/components/chapters/tabs";
import { GroupAbout } from "@/components/groups/group-about";
import { GroupActions } from "@/components/groups/group-actions";
import { ConnectionsLine } from "@/components/groups/group-card";
import { GroupManage } from "@/components/groups/group-manage";
import { GroupMembers } from "@/components/groups/group-members";
import { GroupLogo, LockIcon, RunBy, VisibilityChip } from "@/components/groups/group-parts";
import { GroupPosts, LockedPosts } from "@/components/groups/group-posts";
import { PageColumns } from "@/components/page-columns";
import { requireClientViewer, settle } from "@/components/social/data";
import { MemberAvatar } from "@/components/social/post-parts";
import { SectionRail } from "@/components/social/section-nav";
import { LoadingStatus, PanelSkeleton } from "@/components/social/skeletons";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { getTaxonomies, groupCountries } from "@/lib/taxonomies";
import { NoTranslate } from "@/i18n/auto";
import { T } from "@/i18n/client";
import { getT } from "@/i18n/server";

type Params = PageProps<"/[locale]/groups/[slug]">["params"];

const SLUG = /^[a-z0-9-]{3,60}$/;
const POSTS_PAGE = 10;

const getGroup = cache(async (slug: string) => (SLUG.test(slug) ? apiGetOrNull<GroupDetail>(`/groups/${slug}`) : null));

export async function generateMetadata({ params }: PageProps<"/[locale]/groups/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const group = await getGroup(slug.toLowerCase()).catch(() => null);
  return group ? { title: group.name, description: group.tagline ?? undefined } : { title: "Group" };
}

async function GroupMain({ params }: { params: Params }) {
  const t = await getT();
  const { slug } = await params;
  const viewer = await requireClientViewer(`/groups/${slug}`);
  const group = await getGroup(slug.toLowerCase());
  if (!group) notFound();
  const { abilities } = group;
  const canManage = abilities.moderate || abilities.manage;
  const [posts, members, taxonomies] = await Promise.all([
    abilities.seeContent ? settle(apiGet<Page<PostView>>("/feed", { group: group.slug, limit: POSTS_PAGE })) : null,
    abilities.seeContent ? settle(apiGet<Page<GroupMemberView>>(`/groups/${group.slug}/members`, { limit: 30 })) : null,
    abilities.manage ? settle(getTaxonomies()) : null,
  ]);
  // A 403 here means the viewer lost access since the group loaded: show the lock, not an error.
  const locked = !abilities.seeContent || (!!posts && !posts.ok && (posts.error as { status?: number }).status === 403);
  const waiting = group.pending ? group.pending.requests + group.pending.posts : 0;

  const tabs = [
    { value: "posts", label: t("Posts") },
    { value: "about", label: t("About") },
    ...(locked ? [] : [{ value: "members", label: t("Members") }]),
    ...(canManage ? [{ value: "manage", label: waiting ? t("Manage ({count})", { count: waiting }) : t("Manage") }] : []),
  ];

  return (
    <>
      {group.status === "suspended" && (
        <div role="status" className="flex items-start gap-3 rounded-card border border-error/40 bg-error-light px-4 py-3 text-sm text-ink">
          <Icon name="shield" size={20} className="mt-0.5 shrink-0 text-error" />
          <p>
            <span className="font-medium">{t("The Charter Mission team suspended this group.")}</span>{" "}
            {t("Only its admins can see it, and no one can post in it. Reply to the email we sent if you think this is a mistake.")}
            {group.statusNote && (
              <span className="mt-1 block">
                <T vars={{ note: group.statusNote }}>{"Note from the team: “{note}”"}</T>
              </span>
            )}
          </p>
        </div>
      )}
      {group.status === "archived" && (
        <div role="status" className="flex items-start gap-3 rounded-card border border-line bg-card px-4 py-3 text-sm text-ink">
          <Icon name="archive" size={20} className="mt-0.5 shrink-0 text-secondary" />
          <p>
            <span className="font-medium">{t("This group is archived.")}</span> {t("You can read it, but no one can join, post, comment or react.")}
          </p>
        </div>
      )}

      <Tabs values={tabs.map((tab) => tab.value)} defaultValue="posts">
        <Panel className="flex flex-col overflow-hidden">
          {group.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the API's media route
            <img src={group.coverUrl} alt="" className="h-[132px] w-full object-cover max-sm:h-24" />
          ) : (
            <div className="h-[132px] w-full bg-gradient-to-r from-primary-dark via-primary to-primary-light max-sm:h-24" aria-hidden="true" />
          )}
          <div className="flex flex-col gap-3 px-6 pb-4 max-sm:px-4">
            <div className="-mt-10 flex flex-wrap items-end justify-between gap-4">
              <span className="rounded-[22px] border-4 border-card bg-card">
                <GroupLogo name={group.name} src={group.logoUrl} size={88} />
              </span>
              <GroupActions group={group} viewer={viewer} />
            </div>
            <div className="flex flex-col gap-1.5">
              <h1 className="flex flex-wrap items-center gap-2 text-h2 text-ink">
                <span dir="auto" className="min-w-0 break-words">
                  <NoTranslate>{group.name}</NoTranslate>
                </span>
                <VisibilityChip visibility={group.visibility} className="text-sm" />
              </h1>
              {group.tagline && (
                <p dir="auto" className="text-md text-body">
                  <NoTranslate>{group.tagline}</NoTranslate>
                </p>
              )}
            </div>
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-secondary">
              <li className="flex items-center gap-1.5">
                <Icon name="users" size={16} />
                {t("{count} members", { count: group.memberCount })}
              </li>
              {group.country && (
                <li className="flex items-center gap-1.5">
                  <Icon name="map-pin" size={16} />
                  {group.country.name}
                </li>
              )}
              {group.ownerType !== "member" && (
                <li className="min-w-0">
                  <RunBy group={group} />
                </li>
              )}
              {group.admins.length > 0 && (
                <li className="flex items-center gap-1.5">
                  <span className="flex -space-x-1.5">
                    {group.admins.slice(0, 5).map(({ member }) => (
                      <span key={member.id} className="rounded-full ring-2 ring-card" title={member.name}>
                        <MemberAvatar member={member} size={24} />
                      </span>
                    ))}
                  </span>
                  <a href="#about" className="hover:underline">
                    {t("{count} admins and moderators", { count: group.admins.length })}
                  </a>
                </li>
              )}
            </ul>
            <ConnectionsLine group={group} />
          </div>
          <div className="border-t border-line px-6 pt-3 max-sm:px-4">
            <TabList label={t("{name} sections", { name: group.name })} tabs={tabs} />
          </div>
        </Panel>

        <TabPanel value="posts">
          {locked ? (
            <>
              <LockedPosts group={group} />
              <GroupAbout group={group} compact />
            </>
          ) : (
            <GroupPosts group={group} viewer={viewer} initial={posts?.ok ? posts.data : undefined} limit={POSTS_PAGE} />
          )}
        </TabPanel>

        <TabPanel value="about">
          <GroupAbout group={group} compact={locked} />
        </TabPanel>

        {!locked && (
          <TabPanel value="members">
            <GroupMembers slug={group.slug} name={group.name} initial={members?.ok ? members.data : undefined} viewerId={viewer.id} />
          </TabPanel>
        )}

        {canManage && (
          <TabPanel value="manage">
            <GroupManage group={group} viewer={viewer} countries={taxonomies?.ok ? groupCountries(taxonomies.data.countries) : []} />
          </TabPanel>
        )}
      </Tabs>
    </>
  );
}

/** Right column: what kind of group it is, in a sentence, and its numbers. */
async function GroupRightRail({ params }: { params: Params }) {
  const t = await getT();
  const { slug } = await params;
  const group = await getGroup(slug.toLowerCase()).catch(() => null);
  if (!group) return null;
  const priv = group.visibility === "private";
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <h2 className="flex items-center gap-2 text-h3 text-ink">
        {priv ? <LockIcon size={18} /> : <Icon name="globe" size={18} />}
        {priv ? t("Private group") : t("Public group")}
      </h2>
      <p className="text-sm text-body">
        {priv
          ? t("Anyone can find it and see who runs it. Only members see its posts and who is in it.")
          : t("Anyone on Charter Mission can see its posts and join.")}
      </p>
      <ul className="flex flex-col gap-1.5 text-sm text-secondary">
        <li className="flex items-center gap-1.5">
          <Icon name="message" size={16} />
          {t("{count} posts", { count: group.postCount })}
        </li>
        {group.postApproval && (
          <li className="flex items-center gap-1.5">
            <Icon name="shield" size={16} />
            {t("Admins approve posts before they appear")}
          </li>
        )}
        {group.postPermission === "admins" && (
          <li className="flex items-center gap-1.5">
            <Icon name="edit" size={16} />
            {t("Only admins and moderators post")}
          </li>
        )}
      </ul>
    </Panel>
  );
}

/** A group: header, Posts, About, Members and (for its moderators and admins) Manage. */
export default function GroupView({ params }: PageProps<"/[locale]/groups/[slug]">) {
  return (
    <PageColumns
      left={<SectionRail active="/groups" />}
      right={
        <aside className="flex w-80 shrink-0 flex-col gap-4">
          <Suspense fallback={null}>
            <GroupRightRail params={params} />
          </Suspense>
        </aside>
      }
    >
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading group" />
            <PanelSkeleton className="h-[320px]" lines={5} />
            <PanelSkeleton lines={4} />
          </>
        }
      >
        <GroupMain params={params} />
      </Suspense>
    </PageColumns>
  );
}
