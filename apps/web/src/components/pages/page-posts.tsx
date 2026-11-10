"use client";

import type { Page, PostView } from "@chartermission/contracts";
import { PostStream } from "@/components/social/post-stream";
import { EmptyState } from "@/components/social/skeletons";
import type { Viewer } from "@/components/social/viewer";
import { useT } from "@/i18n/client";

/** A page's posts (GET /feed?page=), newest first. Posts its admins publish as the page appear at the top straight away. */
export function PagePosts({
  page,
  initial,
  viewer,
  limit,
}: {
  page: { id: string; name: string; canPost: boolean };
  initial?: Page<PostView>;
  viewer: Viewer;
  limit: number;
}) {
  const t = useT();
  return (
    <PostStream
      path="/feed"
      query={{ page: page.id, limit }}
      initial={initial}
      viewer={viewer}
      label={t("Posts by {name}", { name: page.name })}
      acceptNew={page.canPost}
      acceptCreated={(post) => post.page?.id === page.id}
      empty={
        <EmptyState icon="message" title="No posts yet">
          {page.canPost ? "Use Create post to share the page’s first update with its followers." : t("{name} hasn’t posted yet. Follow the page to see its updates in your feed.", { name: page.name })}
        </EmptyState>
      }
    />
  );
}
