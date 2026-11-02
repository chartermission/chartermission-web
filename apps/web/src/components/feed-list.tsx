import Link from "next/link";
import { PostCard } from "@chartermission/ui";
import type { FeedPost } from "@/lib/mock-data";

export const topicHref = (tag: string) => `/topics/${tag.toLowerCase()}`;

export function FeedList({ posts }: { posts: FeedPost[] }) {
  return (
    <>
      {posts.map(({ id, ...post }) => (
        <PostCard key={id} {...post} linkAs={Link} tagHref={topicHref} />
      ))}
    </>
  );
}
