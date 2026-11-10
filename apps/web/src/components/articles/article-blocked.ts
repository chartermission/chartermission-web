import { absoluteDateTime } from "@/components/social/format";
import { activeUntil, type Viewer } from "@/components/social/viewer";
import type { Translate } from "@/i18n/translate";

/** Why the viewer can't publish right now, if anything. */
export function articleBlockedReason(intl: string, t: Translate, viewer: Viewer): string | null {
  if (!viewer.emailVerified) return "Verify your email address to publish articles.";
  if (viewer.status === "suspended") return "Your account is suspended, so you can’t publish.";
  const until = activeUntil(viewer.restrictions.postingUntil);
  return until ? t("You can’t post until {date}.", { date: absoluteDateTime(intl, until) }) : null;
}
