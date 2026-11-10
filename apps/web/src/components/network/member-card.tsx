"use client";

import Link from "next/link";
import type { DirectoryMember } from "@chartermission/contracts";
import { Avatar, Icon, RoleBadgeIcon } from "@chartermission/ui";
import { memberHref } from "@/components/social/links";
import { ConnectControl, FollowControl, canConnectWith, useRelationship } from "./relationship";
import { ProfileLink } from "@/components/social/post-parts";

/**
 * Directory member card — Figma "Member card" (node 17:84) as used on /network,
 * with live Connect / Pending / Accept / Message and Follow states.
 */
export function DirectoryMemberCard({ member, reason }: { member: DirectoryMember; reason?: string }) {
  const controls = useRelationship(member, member.relationship);
  const self = member.relationship.self;
  return (
    <article className="flex w-full flex-col items-center gap-2 rounded-card border border-line bg-card px-4 py-5">
      <ProfileLink href={memberHref(member.handle)}>
<Avatar name={member.name} src={member.avatarUrl ?? undefined} size={56} tone={member.tone} />
</ProfileLink>
      <p className="flex items-center gap-1">
        <Link href={memberHref(member.handle)} className="text-center text-md font-medium text-ink hover:underline">
          {member.name}
        </Link>
        {member.verified && <Icon name="verified" size={14} className="shrink-0 text-primary-light" label="Verified" />}
        <RoleBadgeIcon badge={member.badge} size={14} />
      </p>
      {member.headline && <p className="line-clamp-2 w-full text-center text-sm text-body">{member.headline}</p>}
      {member.location && (
        <p className="flex items-center gap-1 text-xs text-secondary">
          <Icon name="map-pin" size={14} className="shrink-0" />
          {member.location}
        </p>
      )}
      {reason ? (
        <p className="text-center text-xs text-primary-light">{reason}</p>
      ) : (
        member.mutualConnections > 0 && (
          <p className="text-xs text-primary-light">
            {member.mutualConnections} mutual connection{member.mutualConnections === 1 ? "" : "s"}
          </p>
        )
      )}
      <div className="mt-auto flex w-full flex-col gap-1.5 pt-1">
        {self ? (
          <Link href={memberHref(member.handle)} className="text-center text-sm font-medium text-primary-light hover:underline">
            This is you
          </Link>
        ) : (
          <>
            {canConnectWith(member, member.relationship) && <ConnectControl member={member} controls={controls} block />}
            <FollowControl member={member} controls={controls} block prominent={!canConnectWith(member, member.relationship)} />
          </>
        )}
      </div>
    </article>
  );
}
