import { Suspense } from "react";
import type { Metadata } from "next";
import { AnnouncementComposer } from "@/components/messages/announcement-composer";
import { ComposerSkeleton } from "@/components/messages/composer-skeleton";
import { LoadError, NoAccess } from "@/components/states";
import { ApiError } from "@/lib/api/errors";
import { requireViewer } from "@/lib/api/server";
import { loadAudienceOptions, loadMessagingSettings } from "@/lib/messages-server";
import type { AudienceOptions } from "@/lib/messages";
import { PERM, can } from "@/lib/permissions";

export const metadata: Metadata = { title: "New message" };

async function Composer() {
  const viewer = await requireViewer("/messages/new");
  if (!can(viewer, PERM.membersMessage)) return <NoAccess section="messages" />;
  let options: AudienceOptions;
  const settingsPromise = loadMessagingSettings();
  try {
    options = await loadAudienceOptions();
  } catch (e) {
    return <LoadError message={e instanceof ApiError ? e.message : "The audience filters couldn’t be loaded."} />;
  }
  return <AnnouncementComposer initial={null} options={options} settings={await settingsPromise} viewerEmail={viewer.email} />;
}

/** Write a bulk message to members. */
export default function NewMessagePage() {
  return (
    <Suspense fallback={<ComposerSkeleton />}>
      <Composer />
    </Suspense>
  );
}
