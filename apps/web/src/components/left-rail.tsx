import Link from "next/link";
import { Suspense } from "react";
import type { FollowView, MemberProfile, OwnProfile, Page } from "@chartermission/contracts";
import { Avatar, Chip, Divider, Panel } from "@chartermission/ui";
import { apiGet, apiGetOrNull, getViewer } from "@/lib/api/server";
import { PanelSkeleton } from "./social/skeletons";
import { SideNav } from "./side-nav";

/** The viewer's card: GET /me + GET /me/profile (completeness) + their public counts. */
async function ProfileSummary() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [own, profile] = await Promise.all([
    apiGet<OwnProfile>("/me/profile").catch(() => null),
    apiGetOrNull<MemberProfile>(`/members/${viewer.handle}`).catch(() => null),
  ]);
  const percent = own?.completeness.percent ?? null;
  return (
    <Panel className="flex flex-col gap-2.5 p-4">
      <Link href={`/members/${viewer.handle}`} className="group flex items-center gap-3">
        <Avatar name={viewer.name} src={viewer.avatarUrl ?? undefined} size={56} tone={viewer.tone} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-md font-medium text-ink group-hover:underline">{viewer.name}</span>
          {viewer.headline && <span className="line-clamp-2 text-xs text-secondary">{viewer.headline}</span>}
        </span>
      </Link>
      <Divider />
      {profile && (
        <>
          <Link href="/network?tab=connections" className="flex justify-between rounded-sm text-sm hover:underline">
            <span className="text-secondary">Connections</span>
            <span className="font-medium text-primary">{profile.counts.connections.toLocaleString("en-US")}</span>
          </Link>
          <p className="flex justify-between text-sm">
            <span className="text-secondary">Followers</span>
            <span className="font-medium text-primary">{profile.counts.followers.toLocaleString("en-US")}</span>
          </p>
        </>
      )}
      {percent !== null && percent < 100 && (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center justify-between text-xs text-secondary">
            Profile {percent}% complete
            <Link href="/settings/profile" className="font-medium text-primary-light hover:underline">
              Complete
            </Link>
          </p>
          <div
            className="h-1.5 w-full overflow-hidden rounded bg-muted"
            role="progressbar"
            aria-label="Profile completeness"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded bg-accent" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
    </Panel>
  );
}

/** GET /me/follows?type=hashtag */
async function FollowedHashtags() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const follows = await apiGet<Page<FollowView>>("/me/follows", { type: "hashtag", limit: 12 }).catch(() => null);
  if (!follows) return null;
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-medium text-ink">Hashtags you follow</h2>
      {follows.items.length ? (
        <ul className="flex flex-wrap gap-2">
          {follows.items.map((follow) => {
            const display = follow.hashtag?.display ?? follow.targetId;
            return (
              <li key={follow.targetId}>
                <Link href={`/topics/${encodeURIComponent(follow.targetId)}`}>
                  <Chip tone="hashtag" className="hover:bg-accent hover:text-inverse">
                    #{display}
                  </Chip>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-secondary">Follow a topic from its page to see more of it in your feed.</p>
      )}
    </Panel>
  );
}

/** Left column of the member layout: profile summary, section nav, followed hashtags. */
export function LeftRail() {
  return (
    <aside aria-label="Your profile and sections" className="flex w-60 shrink-0 flex-col gap-4">
      <Suspense fallback={<PanelSkeleton className="h-[188px]" lines={3} />}>
        <ProfileSummary />
      </Suspense>
      <Suspense fallback={<PanelSkeleton className="h-[392px]" lines={8} />}>
        <SideNav />
      </Suspense>
      <Suspense fallback={<PanelSkeleton className="h-[120px]" lines={2} />}>
        <FollowedHashtags />
      </Suspense>
    </aside>
  );
}
