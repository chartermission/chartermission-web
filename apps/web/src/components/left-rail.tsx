import Link from "next/link";
import { Avatar, Chip, Divider, Panel } from "@chartermission/ui";
import { followedHashtags, viewer } from "@/lib/mock-data";
import { SideNav } from "./side-nav";

export function ProfileSummary() {
  return (
    <Panel className="flex flex-col gap-2.5 p-4">
      <Link href={`/members/${viewer.handle}`} className="flex items-center gap-3">
        <Avatar name={viewer.name} size={56} tone="primary" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-md font-medium text-ink">{viewer.name}</span>
          <span className="text-xs text-secondary">{viewer.headline}</span>
        </span>
      </Link>
      <Divider />
      <p className="flex justify-between text-sm">
        <span className="text-secondary">Connections</span>
        <span className="font-medium text-primary">{viewer.connections}</span>
      </p>
      <p className="flex justify-between text-sm">
        <span className="text-secondary">Profile views</span>
        <span className="font-medium text-primary">{viewer.profileViews}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-secondary">Profile {viewer.profileComplete}% complete</p>
        <div
          className="h-1.5 w-full overflow-hidden rounded bg-muted"
          role="progressbar"
          aria-label="Profile completeness"
          aria-valuenow={viewer.profileComplete}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded bg-accent" style={{ width: `${viewer.profileComplete}%` }} />
        </div>
      </div>
    </Panel>
  );
}

export function FollowedHashtags() {
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Hashtags you follow</h2>
        <Link href="/settings#topics" className="text-xs text-primary-light hover:underline">
          Manage
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {followedHashtags.map((tag) => (
          <Link key={tag} href={`/topics/${tag.toLowerCase()}`}>
            <Chip tone="hashtag">#{tag}</Chip>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

/** Left column of the member layout: profile summary, section nav, followed hashtags. */
export function LeftRail() {
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-4">
      <ProfileSummary />
      <SideNav />
      <FollowedHashtags />
    </aside>
  );
}
