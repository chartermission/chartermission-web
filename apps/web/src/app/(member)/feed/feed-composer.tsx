"use client";

import { useCallback, useState } from "react";
import { Composer } from "@/components/composer";
import { CreatePostDialog, type ComposeTool } from "@/components/compose/create-post-dialog";
import { PostToast } from "@/components/compose/post-toast";

const composerTools: Record<string, ComposeTool> = {
  photo: "photo",
  link: "link",
  poll: "poll",
  topic: "topic",
};

/** Composer wired to the create-post dialog (Figma "Web / Create post — modal", node 19:2951). */
export function FeedComposer() {
  const [session, setSession] = useState<{ key: number; tool?: ComposeTool } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  return (
    <>
      <Composer
        onOpen={(tool) =>
          setSession((current) => ({ key: (current?.key ?? 0) + 1, tool: tool ? composerTools[tool] : undefined }))
        }
      />
      {session && (
        <CreatePostDialog
          key={session.key}
          initialTool={session.tool}
          onClose={() => setSession(null)}
          onPosted={setToast}
        />
      )}
      <PostToast message={toast} onDismiss={dismissToast} />
    </>
  );
}
