"use client";

import { useRouter } from "next/navigation";
import type { StoryView } from "@chartermission/contracts";
import { StoryViewer } from "./story-viewer";

/** /stories/[id]: one story on its own (links from notifications and the moderation console). */
export function SingleStory({ story }: { story: StoryView }) {
  const router = useRouter();
  return (
    <StoryViewer
      groups={[{ key: story.id, author: story.author, stories: [story] }]}
      onClose={() => (window.history.length > 1 ? router.back() : router.push("/feed"))}
    />
  );
}
