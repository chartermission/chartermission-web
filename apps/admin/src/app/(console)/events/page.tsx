import { Suspense } from "react";
import type { Metadata } from "next";
import type { AdminEventRow, EventDetail, Page, RegistrationView } from "@chartermission/contracts";
import { EventsWorkspace, EventsWorkspaceSkeleton } from "@/components/events/events-workspace";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGet, apiGetOrNull, requireViewer } from "@/lib/api/server";
import {
  eventsApiQuery,
  eventsSearch,
  eventsViewKey,
  parseEventsView,
  parseSelectedEvent,
  type EventRegistrationsPreview,
} from "@/lib/events-view";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Events" };

/** The selected event's full detail and, for admins with host powers, its latest registrations. */
async function loadDetail(id: string, canSeeRegistrations: boolean) {
  const [detail, registrations] = await Promise.all([
    apiGetOrNull<EventDetail>(`/events/${id}`).catch((e: unknown): ApiError => {
      if (e instanceof ApiError) return e;
      throw e;
    }),
    canSeeRegistrations
      ? apiGet<Page<RegistrationView>>(`/events/${id}/registrations`, { status: "active", limit: 5 })
          .then((p): EventRegistrationsPreview => ({ items: p.items, more: p.nextCursor !== null }))
          .catch((e: unknown): EventRegistrationsPreview => (e instanceof ApiError && e.status === 403 ? "forbidden" : null))
      : ("forbidden" as const),
  ]);
  return { detail, registrations };
}

async function EventsQueue({ searchParams }: Pick<PageProps<"/events">, "searchParams">) {
  const params = await searchParams;
  const view = parseEventsView(params);
  const requested = parseSelectedEvent(params);
  const viewer = await requireViewer(`/events${eventsSearch(view, requested)}`);
  if (!can(viewer, PERM.eventReview)) return <NoAccess section="the events review queue" />;
  const canSeeRegistrations = can(viewer, PERM.eventManage);

  let page: Page<AdminEventRow>;
  let selected: Awaited<ReturnType<typeof loadDetail>> | null = null;
  try {
    const [list, requestedDetail] = await Promise.all([
      apiGet<Page<AdminEventRow>>("/admin/events", eventsApiQuery(view)),
      requested ? loadDetail(requested, canSeeRegistrations) : null,
    ]);
    page = list;
    selected = requestedDetail;
    if (!requested && page.items[0]) selected = await loadDetail(page.items[0].id, canSeeRegistrations);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="the events review queue" />;
    return (
      <div className="rounded-card border border-line bg-card">
        <ErrorState message={e instanceof ApiError ? e.message : "The events queue couldn’t be loaded."} />
      </div>
    );
  }

  const detail = selected && !(selected.detail instanceof ApiError) ? selected.detail : null;
  const detailError =
    selected?.detail instanceof ApiError
      ? selected.detail.message
      : requested && !detail
        ? "That event was not found. It may have been deleted by its host."
        : null;

  return (
    <EventsWorkspace
      key={eventsViewKey(view)}
      view={view}
      initialRows={page.items}
      initialCursor={page.nextCursor}
      selectedId={requested ?? detail?.id ?? null}
      detail={detail}
      detailError={detailError}
      registrations={selected?.registrations ?? null}
      canReview={can(viewer, PERM.eventReview)}
      canFeature={can(viewer, PERM.eventFeature)}
    />
  );
}

/** Events review queue and review panel (spec 4.9: review queue, approve / request changes / reject / unpublish, feature). */
export default function EventsPage(props: PageProps<"/events">) {
  return (
    <>
      <PageHeader
        title="Events"
        description="Events from hosts and chapters wait here before they’re listed. Decisions and notes go to the host; every action is written to the audit log."
      />
      <Suspense fallback={<EventsWorkspaceSkeleton />}>
        <EventsQueue searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}
