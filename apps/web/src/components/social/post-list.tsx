import Link from "next/link";
import { PostCard } from "@chartermission/ui";
import { topicHref } from "@/components/feed-list";
import type { FeedPost } from "@/lib/mock-data";

export const postHref = (id: string) => `/posts/${id}`;

/**
 * Post cards whose body opens the post detail page (PostCard's stats line is
 * plain text, so the body is the natural link target). Pass `linkedIds` to
 * link only posts that have a detail page.
 */
export function LinkedPostList({ posts, linkedIds }: { posts: FeedPost[]; linkedIds?: readonly string[] }) {
  return (
    <>
      {posts.map(({ id, body, ...post }) => {
        const linked = !linkedIds || linkedIds.includes(id);
        return (
          <PostCard
            key={id}
            {...post}
            body={
              linked ? (
                <Link href={postHref(id)} className="block rounded-sm hover:text-primary-dark">
                  {body}
                  <span className="sr-only"> — open post and comments</span>
                </Link>
              ) : (
                body
              )
            }
            linkAs={Link}
            tagHref={topicHref}
          />
        );
      })}
    </>
  );
}
