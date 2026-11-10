"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { DirectoryMember } from "@chartermission/contracts";
import { Icon, RoleBadgeIcon } from "@chartermission/ui";
import { memberHref } from "@/components/social/links";
import { MemberAvatar } from "@/components/social/post-parts";
import { ConnectControl, FollowControl, canConnectWith, useRelationship } from "./relationship";

/** A member in a list (search results) with Connect and Follow. */
export function MemberRow({ member, avatarBadge }: { member: DirectoryMember; avatarBadge?: ReactNode }) {
  const controls = useRelationship(member, member.relationship);
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5 max-sm:px-4">
      <span className="relative shrink-0">
        <MemberAvatar member={member} size={40} />
        {avatarBadge}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1">
          <Link href={memberHref(member.handle)} className="truncate text-sm font-medium text-ink hover:underline">
            {member.name}
          </Link>
          {member.verified && <Icon name="verified" size={14} className="shrink-0 text-primary" label="Verified" />}
          <RoleBadgeIcon badge={member.badge} size={14} />
        </span>
        {member.headline && <span className="truncate text-xs text-body">{member.headline}</span>}
        {member.location && <span className="truncate text-xs text-secondary">{member.location}</span>}
      </div>
      {member.relationship.self ? (
        <span className="text-xs text-secondary">You</span>
      ) : (
        <div className="flex gap-2 max-sm:w-full max-sm:justify-end">
          {canConnectWith(member, member.relationship) && <ConnectControl member={member} controls={controls} />}
          <FollowControl member={member} controls={controls} prominent={!canConnectWith(member, member.relationship)} />
        </div>
      )}
    </li>
  );
}
