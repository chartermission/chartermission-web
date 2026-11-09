"use client";

import Link from "next/link";
import type { MemberProfile } from "@chartermission/contracts";
import { Icon, Panel, buttonClasses, RoleBadgeIcon } from "@chartermission/ui";
import { FollowControl, useRelationship } from "@/components/network/relationship";
import { memberHref } from "./links";
import { MemberAvatar } from "./post-parts";

/** "About the author" on the post page: follow and view profile. */
export function AuthorCard({ member }: { member: MemberProfile }) {
  const controls = useRelationship(member, member.relationship);
  const location = [member.city, member.country?.name].filter(Boolean).join(", ");
  return (
    <Panel className="flex flex-col gap-3 p-5">
      <h2 className="sr-only">About the author</h2>
      <div className="flex items-center gap-3">
        <MemberAvatar member={member} size={56} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex items-center gap-1 text-md font-medium text-ink">
            {member.name}
            {member.verified && <Icon name="verified" size={16} className="text-primary" label="Verified" />}
            <RoleBadgeIcon badge={member.badge} size={16} />
          </p>
          {member.headline && <p className="text-xs text-secondary">{member.headline}</p>}
          {location && <p className="text-xs text-secondary">{location}</p>}
        </div>
      </div>
      <p className="text-xs text-secondary">
        {member.counts.followers.toLocaleString("en-US")} follower{member.counts.followers === 1 ? "" : "s"} · {member.counts.posts.toLocaleString("en-US")} post{member.counts.posts === 1 ? "" : "s"}
      </p>
      <div className="flex gap-2">
        {!member.relationship.self && (
          <div className="flex-1">
            <FollowControl member={member} controls={controls} block />
          </div>
        )}
        <Link href={memberHref(member.handle)} className={buttonClasses({ variant: "secondary", size: "small", className: "flex-1" })}>
          View profile
        </Link>
      </div>
    </Panel>
  );
}
