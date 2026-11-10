import { NotFoundPanel } from "@/components/social/not-found-panel";

export default function MemberNotFound() {
  return (
    <NotFoundPanel
      title="This profile isn’t available"
      description="The member may have changed their handle, deactivated their account, or limited who can see their profile. If you blocked them, you can unblock them in Settings → Blocked & muted."
      action={{ href: "/network?tab=directory", label: "Search the directory" }}
    />
  );
}
