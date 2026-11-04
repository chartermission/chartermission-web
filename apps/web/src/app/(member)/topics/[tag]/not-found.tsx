import { NotFoundPanel } from "@/components/social/not-found-panel";

export default function TopicNotFound() {
  return (
    <NotFoundPanel
      title="No one has used this hashtag yet"
      description="Topics appear once members post with them. Use it in a post to start one, or explore what’s trending."
      action={{ href: "/topics", label: "Explore topics" }}
    />
  );
}
