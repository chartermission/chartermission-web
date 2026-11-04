import { NotFoundPanel } from "@/components/social/not-found-panel";

export default function ArticleNotFound() {
  return (
    <NotFoundPanel
      title="This article isn’t available"
      description="It may have been deleted by its author, removed by moderators, or shared only with members you’re not connected to."
      action={{ href: "/articles", label: "Browse all articles" }}
    />
  );
}
