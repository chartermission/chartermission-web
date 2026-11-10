import { NotFoundPanel } from "@/components/social/not-found-panel";

export default function PostNotFound() {
  return (
    <NotFoundPanel
      title="This post isn’t available"
      description="It may have been deleted by its author, removed by moderators, or shared only with members you’re not connected to."
      action={{ href: "/feed", label: "Back to your feed" }}
    />
  );
}
