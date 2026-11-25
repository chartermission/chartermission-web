import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense, cache } from "react";
import type { ServiceView } from "@chartermission/contracts";
import { Icon, Panel } from "@chartermission/ui";
import { asServiceList, hostHref, hostName, sortServices } from "@/components/services/format";
import { ServiceCard } from "@/components/services/service-card";
import { ServiceDetail } from "@/components/services/service-detail";
import { HostIdentity } from "@/components/services/service-parts";
import { getClientViewer } from "@/components/social/data";
import { Bone, LoadingStatus } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { ApiError } from "@/lib/api/errors";
import { apiGet, apiGetOrNull } from "@/lib/api/server";
import { NoTranslate } from "@/i18n/auto";
import { getT } from "@/i18n/server";

type Props = PageProps<"/[locale]/services/[id]">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /services/{id}; null when it doesn't exist, is hidden, or needs a signed-in member. */
const getService = cache(async (id: string) => {
  if (!UUID.test(id)) return null;
  try {
    return await apiGetOrNull<ServiceView>(`/services/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const service = await getService(id).catch(() => null);
  if (!service) return {};
  const description = service.description.replace(/\s+/g, " ").trim();
  return {
    title: `${service.title} · ${hostName(service.host)}`,
    description: description.length > 160 ? `${description.slice(0, 159).trimEnd()}…` : description,
  };
}

/** One service, shareable: who offers it, what it is, Book / Enquire / Message, and their other services. */
export default function ServicePage({ params }: Props) {
  return (
    <main id="main" className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 pb-12 pt-8 max-sm:gap-4 max-sm:px-3 max-sm:pt-5">
      <Suspense fallback={<ServiceSkeleton />}>
        <ServiceMain params={params} />
      </Suspense>
      <Toaster />
    </main>
  );
}

function ServiceSkeleton() {
  return (
    <>
      <LoadingStatus label="Loading service" />
      <Bone className="h-4 w-40" />
      <Panel aria-hidden="true" className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <Bone className="size-14 shrink-0 rounded-full" />
          <span className="flex flex-1 flex-col gap-1.5">
            <Bone className="h-4 w-1/3" />
            <Bone className="h-3 w-1/2" />
          </span>
        </div>
        <Bone className="h-7 w-3/5" />
        <Bone className="h-3.5 w-[92%]" />
        <Bone className="h-3.5 w-[85%]" />
        <Bone className="h-3.5 w-[60%]" />
        <Bone className="h-9 w-32 rounded-lg" />
      </Panel>
    </>
  );
}

async function ServiceMain({ params }: Pick<Props, "params">) {
  const t = await getT();
  const { id } = await params;
  const [viewer, service] = await Promise.all([getClientViewer(), getService(id)]);
  if (!service) {
    if (!viewer) redirect(`/signin?next=${encodeURIComponent(`/services/${id}`)}`);
    notFound();
  }
  const { host } = service;
  const listPath = host.type === "page" ? `/pages/${encodeURIComponent(host.page.slug)}/services` : `/members/${encodeURIComponent(host.member.handle)}/services`;
  const others = await apiGet<unknown>(listPath)
    .then((body) => sortServices(asServiceList(body)).filter((s) => s.id !== service.id && s.active))
    .catch(() => [] as ServiceView[]);
  const name = hostName(host);

  return (
    <>
      <Link href={hostHref(host)} className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} />
        <NoTranslate>{name}</NoTranslate>
      </Link>

      <Panel className="flex flex-col gap-5 p-6 max-sm:p-4">
        <HostIdentity host={host} size={56} />
        <ServiceDetail service={service} signedIn={!!viewer} />
      </Panel>

      {others.length > 0 && (
        <section aria-labelledby="more-services" className="flex flex-col gap-3">
          <h2 id="more-services" className="text-h3 text-ink">
            {t("More from {name}", { name })}
          </h2>
          <ul className="flex flex-col gap-3">
            {others.map((other) => (
              <li key={other.id}>
                <ServiceCard service={other} signedIn={!!viewer} headingLevel={3} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
