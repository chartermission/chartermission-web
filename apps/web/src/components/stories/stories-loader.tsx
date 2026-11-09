import type { HighlightView, StoryTray } from "@chartermission/contracts";
import { apiGet, getViewer } from "@/lib/api/server";
import { ProfileHighlights } from "./profile-highlights";
import { StoriesStrip } from "./stories-strip";

/** Home feed: GET /stories/tray for the strip. Renders nothing if the tray can't load. */
export async function StoriesStripLoader() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return null;
  const tray = await apiGet<StoryTray>("/stories/tray").catch(() => null);
  if (!tray) return null;
  return (
    <StoriesStrip
      initial={tray}
      me={{ id: viewer.id, name: viewer.name, avatarUrl: viewer.avatarUrl, tone: viewer.tone }}
      canPost={viewer.emailVerified}
    />
  );
}

/** Member profile: GET /highlights?member=. */
export async function ProfileHighlightsLoader({ memberId, name, own }: { memberId: string; name: string; own: boolean }) {
  const list = await apiGet<HighlightView[]>("/highlights", { member: memberId }).catch(() => null);
  if (!list) return null;
  return <ProfileHighlights initial={list} own={own} name={name} />;
}
