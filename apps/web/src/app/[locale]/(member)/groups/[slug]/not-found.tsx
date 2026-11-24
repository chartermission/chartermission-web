import { NotFoundPanel } from "@/components/social/not-found-panel";

export default function GroupNotFound() {
  return (
    <NotFoundPanel
      title="This group isn’t available"
      description="It may not exist, it may have been deleted, or the Charter Mission team may have suspended it."
      action={{ href: "/groups", label: "Browse groups" }}
    />
  );
}
