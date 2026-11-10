import { NotFoundPanel } from "@/components/social/not-found-panel";

export default function EventNotFound() {
  return (
    <NotFoundPanel
      title="This event isn’t available"
      description="It may not exist, it may still be a draft, or it may have been unpublished by the Charter Mission team."
      action={{ href: "/events", label: "Browse all events" }}
    />
  );
}
