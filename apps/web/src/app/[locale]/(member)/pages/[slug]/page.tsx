import { PeopleLink } from "@/components/people/people-link";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { PAGE_CATEGORY_LABELS, type GroupSummary, type Page, type PageDetail, type PostView, type ProductView, type ServiceView } from "@chartermission/contracts";
import { Chip, Icon, Panel, type IconName } from "@chartermission/ui";
import { TabList, TabPanel, Tabs } from "@/components/chapters/tabs";
import { OwnerGroups } from "@/components/groups/owner-groups";
import { PageColumns } from "@/components/page-columns";
import { PageActions } from "@/components/pages/page-actions";
import { PageName } from "@/components/pages/page-card";
import { followersLabel } from "@/components/pages/followers-label";
import { PageAbout, hasAboutContent } from "@/components/pages/page-about";
import { PageLogo } from "@/components/pages/page-logo";
import { PagePosts } from "@/components/pages/page-posts";
import { toPageRef } from "@/components/pages/page-ref";
import { PageProducts } from "@/components/products/page-products";
import { ServicesSection } from "@/components/services/services-section";
import { requireClientViewer, settle } from "@/components/social/data";
import { errorMessage } from "@/components/social/error-message";
import { absoluteDate } from "@/components/social/format";
import { memberHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import { SectionRail } from "@/components/social/section-nav";
import { LoadingStatus, PanelSkeleton, SectionError } from "@/components/social/skeletons";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { T } from "@/i18n/client";
import { getT, getIntlTag } from "@/i18n/server";

type Params = PageProps<"/[locale]/pages/[slug]">["params"];

const SLUG = /^[a-z0-9-]{3,60}$/;
const POSTS_PAGE = 10;

const getPage = cache(async (slug: string) => (SLUG.test(slug) ? apiGetOrNull<PageDetail>(`/pages/${slug}`) : null));

export async function generateMetadata({ params }: PageProps<"/[locale]/pages/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug.toLowerCase()).catch(() => null);
  return page ? { title: page.name, description: page.tagline ?? undefined } : { title: "Page" };
}

const statusNote: Partial<Record<PageDetail["status"], { tone: string; icon: IconName; title: string; body: string }>> = {
  pending: {
    tone: "border-info/40 bg-info-light",
    icon: "clock",
    title: "This page is being reviewed",
    body: "Only you and the other admins can see it for now. We’ll notify you when it’s live; you can keep editing in the meantime.",
  },
  rejected: {
    tone: "border-warning/40 bg-warning-light",
    icon: "alert",
    title: "This page wasn’t approved",
    body: "Edit the page to fix what’s listed and it goes back for review.",
  },
  suspended: {
    tone: "border-error/40 bg-error-light",
    icon: "shield",
    title: "This page is suspended",
    body: "Members can’t see it and it can’t post. Reply to the email we sent if you think this is a mistake.",
  },
};

async function PageMain({ params }: { params: Params }) {
  const intl = await getIntlTag();
  const t = await getT();
  const { slug } = await params;
  const viewer = await requireClientViewer(`/pages/${slug}`);
  const page = await getPage(slug.toLowerCase());
  if (!page) notFound();
  const note = statusNote[page.status];
  const location = [page.city, page.country?.name].filter(Boolean).join(", ");
  const canManage = page.viewer.canEdit;
  const visible = page.status === "active" || !!page.viewer.role || canManage;
  const query = { page: page.id, limit: POSTS_PAGE };
  const [posts, products, services, groups] = await Promise.all([
    visible ? apiGet<Page<PostView>>("/feed", query).catch(() => undefined) : undefined,
    visible && (page.productCount > 0 || canManage) ? settle(apiGet<ProductView[]>(`/pages/${page.slug}/products`)) : null,
    visible && (page.serviceCount > 0 || canManage) ? settle(apiGet<ServiceView[]>(`/pages/${page.slug}/services`)) : null,
    visible ? apiGet<Page<GroupSummary>>("/groups", { page: page.slug, limit: 12 }).catch(() => null) : null,
  ]);
  const ref = toPageRef(page);
  const bookable = !!(services?.ok && services.data.some((service) => service.bookable && service.active));
  const showAbout = canManage || hasAboutContent(page);
  const showProducts = canManage || page.productCount > 0;
  const showServices = canManage || page.serviceCount > 0;
  // Groups the page runs; its admins also get "Create a group" (live pages only).
  const canCreateGroup = canManage && page.status === "active";
  const showGroups = !!groups?.items.length || canCreateGroup;
  const tabs = [
    { value: "posts", label: t("Posts") },
    ...(showAbout ? [{ value: "about", label: t("About") }] : []),
    ...(showProducts ? [{ value: "products", label: t("Products ({count})", { count: page.productCount }) }] : []),
    ...(showServices ? [{ value: "services", label: t("Services ({count})", { count: page.serviceCount }) }] : []),
    ...(showGroups ? [{ value: "groups", label: t("Groups") }] : []),
  ];

  return (
    <>
      {note && (
        <div role="status" className={`flex items-start gap-3 rounded-card border px-4 py-3 text-sm text-ink ${note.tone}`}>
          <Icon name={note.icon} size={20} className="mt-0.5 shrink-0" />
          <p>
            <span className="font-medium">{note.title}.</span> {note.body}
            {page.reviewNote && page.status !== "pending" && <span className="mt-1 block"><T vars={{ reviewNote: page.reviewNote }}>{"Reviewer’s note: “{reviewNote}”"}</T></span>}
          </p>
        </div>
      )}

      <Tabs values={tabs.map((tab) => tab.value)} defaultValue="posts">
        <Panel className="flex flex-col overflow-hidden">
          {page.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the API's media route
            <img src={page.coverUrl} alt="" className="h-[132px] w-full object-cover max-sm:h-24" />
          ) : (
            <div className="h-[132px] w-full bg-gradient-to-r from-primary-dark via-primary to-primary-light max-sm:h-24" aria-hidden="true" />
          )}
          <div className="flex flex-col gap-3 px-6 pb-4 max-sm:px-4">
            <div className="-mt-10 flex flex-wrap items-end justify-between gap-4">
              <span className="rounded-[22px] border-4 border-card bg-card">
                <PageLogo name={page.name} src={page.logoUrl} size={88} />
              </span>
              <PageActions page={page} viewer={viewer} bookable={bookable} />
            </div>
            <h1 className="text-h2 text-ink">
              <PageName page={page} className="flex flex-wrap items-center gap-1.5" />
            </h1>
            {page.tagline && <p className="text-md text-body">{page.tagline}</p>}
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-secondary">
              <li className="flex items-center gap-1.5">
                <Icon name="building" size={16} />
                {PAGE_CATEGORY_LABELS[page.category]}
              </li>
              {location && (
                <li className="flex items-center gap-1.5">
                  <Icon name="map-pin" size={16} />
                  {location}
                </li>
              )}
              <li className="flex items-center gap-1.5">
                <Icon name="users" size={16} />
                {page.viewer.role && page.followers > 0 ? (
                  <PeopleLink source={{ path: `/pages/${page.slug}/followers`, title: t("Followers of {name}", { name: page.name }) }}>{followersLabel(t, page.followers)}</PeopleLink>
                ) : (
                  followersLabel(t, page.followers)
                )}
              </li>
              {page.website && (
                <li className="flex min-w-0 items-center gap-1.5">
                  <Icon name="globe" size={16} className="shrink-0" />
                  <a href={page.website} target="_blank" rel="noopener noreferrer nofollow" className="truncate text-primary-light hover:underline">
                    {page.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                </li>
              )}
            </ul>
          </div>
          {visible && (
            <div className="border-t border-line px-6 pt-3 max-sm:px-4">
              <TabList label={t("{name} sections", { name: page.name })} tabs={tabs} />
            </div>
          )}
        </Panel>

        <TabPanel value="posts">
          <h2 className="sr-only">Posts</h2>
          <PagePosts page={{ id: page.id, name: page.name, canPost: page.viewer.canPost }} initial={posts} viewer={viewer} limit={POSTS_PAGE} />
        </TabPanel>

        {showAbout && (
          <TabPanel value="about">
            <PageAbout page={page} since={absoluteDate(intl, page.createdAt)} canEdit={canManage} editHref={`/pages/${page.slug}/edit`} />
          </TabPanel>
        )}

        {showProducts && (
          <TabPanel value="products">
            {products && !products.ok ? (
              <SectionError message={errorMessage(products.error)} retryHref={`/pages/${page.slug}#products`} />
            ) : (
              <PageProducts page={ref} initial={products?.ok ? products.data : []} canManage={canManage} />
            )}
          </TabPanel>
        )}

        {showServices && (
          <TabPanel value="services">
            {services && !services.ok ? (
              <SectionError message={errorMessage(services.error)} retryHref={`/pages/${page.slug}#services`} />
            ) : (
              <ServicesSection host={{ type: "page", page: ref }} services={services?.ok ? services.data : []} canManage={canManage} />
            )}
          </TabPanel>
        )}
        {showGroups && (
          <TabPanel value="groups">
            <OwnerGroups owner={{ type: "page", slug: page.slug, name: page.name }} initial={groups} canCreate={canCreateGroup} />
          </TabPanel>
        )}
      </Tabs>
    </>
  );
}

/** Who runs the page (shown to its admins only) and a pointer to verification. */
async function PageRightRail({ params }: { params: Params }) {
  const { slug } = await params;
  const page = await getPage(slug.toLowerCase()).catch(() => null);
  if (!page?.admins) return null;
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-h3 text-ink">Admins</h2>
        <Chip tone="neutral" className="px-2! py-0.5! text-xs!">
          Only admins see this
        </Chip>
      </div>
      <ul className="flex flex-col gap-3">
        {page.admins.map((admin) => (
          <li key={admin.member.id} className="flex items-center gap-2.5">
            <MemberAvatar member={admin.member} size={32} link />
            <Link href={memberHref(admin.member.handle)} className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:underline">
              {admin.member.name}
            </Link>
            <span className="text-xs text-secondary">{admin.role === "owner" ? "Owner" : "Admin"}</span>
          </li>
        ))}
      </ul>
      <Link href={`/pages/${page.slug}/edit`} className="text-sm font-medium text-primary-light hover:underline">
        Manage page{page.verified ? "" : " and apply for verification"}
      </Link>
    </Panel>
  );
}

export default function PageView({ params }: PageProps<"/[locale]/pages/[slug]">) {
  return (
    <PageColumns
      left={<SectionRail active="/pages" />}
      right={
        <aside className="flex w-80 shrink-0 flex-col gap-4">
          <Suspense fallback={null}>
            <PageRightRail params={params} />
          </Suspense>
        </aside>
      }
    >
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading page" />
            <PanelSkeleton className="h-[320px]" lines={5} />
            <PanelSkeleton lines={4} />
          </>
        }
      >
        <PageMain params={params} />
      </Suspense>
    </PageColumns>
  );
}
