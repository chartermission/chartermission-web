import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { AnnouncementView } from "@chartermission/contracts";
import { AnnouncementComposer } from "@/components/messages/announcement-composer";
import { AnnouncementDetail } from "@/components/messages/announcement-detail";
import { ComposerSkeleton } from "@/components/messages/composer-skeleton";
import { EmptyState, LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { apiGetOrNull, requireViewer } from "@/lib/api/server";
import { loadAudienceOptions, loadMessagingSettings } from "@/lib/messages-server";
import type { AudienceOptions } from "@/lib/messages";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Message" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function NotFound() {
  return (
    <div className="rounded-card border border-line bg-card">
      <EmptyState icon="mail" title="Message not found">
        It may have been a draft that was deleted.{" "}
        <Link href="/messages/sent" className="text-primary hover:underline">
          Back to sent messages
        </Link>
      </EmptyState>
    </div>
  );
}

async function Announcement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireViewer(`/messages/${id}`);
  if (!can(viewer, PERM.membersMessage)) return <NoAccess section="messages" />;
  if (!UUID.test(id)) return <NotFound />;
  let announcement: AnnouncementView | null;
  let options: AudienceOptions;
  const settingsPromise = loadMessagingSettings();
  try {
    [announcement, options] = await Promise.all([apiGetOrNull<AnnouncementView>(`/admin/announcements/${id}`), loadAudienceOptions()]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return <NoAccess section="messages" />;
    return <LoadError message={e instanceof ApiError ? e.message : "This message couldn’t be loaded."} />;
  }
  if (!announcement) return <NotFound />;
  if (announcement.status === "draft") {
    return <AnnouncementComposer key={announcement.id} initial={announcement} options={options} settings={await settingsPromise} viewerEmail={viewer.email} />;
  }
  return <AnnouncementDetail key={announcement.id} initial={announcement} options={options} />;
}

/** A draft opens in the composer; a sent message shows its delivery and content. */
export default function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<ComposerSkeleton />}>
      <Announcement params={params} />
    </Suspense>
  );
}
