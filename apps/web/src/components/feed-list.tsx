import Link from "next/link";
import type { ReactNode } from "react";
import type { FeedQuery, Page, PostView } from "@chartermission/contracts";
import { PostCard as MockPostCard, type PostCardProps } from "@chartermission/ui";
import { topicHref } from "@/components/social/links";
import { PostStream } from "@/components/social/post-stream";
import type { Viewer } from "@/components/social/viewer";

export { topicHref };

type LiveProps = { query: FeedQuery; initial: Page<PostView>; viewer: Viewer; empty: ReactNode };
/** Later-phase screens (chapters, initiatives) still render placeholder posts until their modules land. */
type PlaceholderProps = { posts: (PostCardProps & { id: string })[] };

/**
 * GET /feed with "Load more" cursor pagination; posts the viewer creates appear at the top.
 * With `posts`, renders static placeholder cards for later-phase screens.
 */
export function FeedList(props: LiveProps | PlaceholderProps) {
  if ("posts" in props) {
    return (
      <>
        {props.posts.map(({ id, ...post }) => (
          <MockPostCard key={id} {...post} linkAs={Link} tagHref={topicHref} />
        ))}
      </>
    );
  }
  const { query, initial, viewer, empty } = props;
  return (
    <PostStream
      path="/feed"
      label="Feed"
      query={{
        tab: query.tab,
        country: query.country,
        sector: query.sector,
        chapter: query.chapter,
        announcements: query.announcements ? "true" : undefined,
      }}
      initial={initial}
      viewer={viewer}
      empty={empty}
      acceptNew
    />
  );
}
