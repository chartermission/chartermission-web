import type { Moment } from "@chartermission/contracts";
import type { Viewer } from "@/components/social/viewer";
import { ChapterCard } from "./chapter-card";
import { NewMembersCard } from "./new-members-card";
import { PromptCard } from "./prompt-card";
import { SpotlightCard } from "./spotlight-card";

function MomentView({ moment, viewer }: { moment: Moment; viewer: Viewer }) {
  switch (moment.kind) {
    case "spotlight":
      return <SpotlightCard moment={moment} viewer={viewer} />;
    case "new_members":
      return <NewMembersCard moment={moment} viewer={viewer} />;
    case "prompt":
      return <PromptCard moment={moment} viewer={viewer} />;
    case "chapter_highlight":
      return <ChapterCard moment={moment} />;
    default:
      return null;
  }
}

/** Moment cards in API order, keyed for PostStream's `interleave`. */
export function momentItems(moments: Moment[], viewer: Viewer) {
  return moments.map((moment) => ({ key: moment.id, node: <MomentView moment={moment} viewer={viewer} /> }));
}
