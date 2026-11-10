"use client";

import Link from "next/link";
import type { SuggestedMember } from "@chartermission/contracts";
import { Avatar } from "@chartermission/ui";
import { memberHref } from "@/components/social/links";
import { ConnectControl, FollowControl, useRelationship } from "./relationship";

function SuggestionRow({ member }: { member: SuggestedMember }) {
  const controls = useRelationship(member, { connection: "none", connectionId: null, following: false });
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <Avatar name={member.name} src={member.avatarUrl ?? undefined} tone={member.tone} />
        <Link href={memberHref(member.handle)} className="group flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-sm font-medium text-ink group-hover:underline">{member.name}</span>
          {member.headline && <span className="truncate text-xs text-secondary">{member.headline}</span>}
          <span className="truncate text-xs text-primary-light">{member.reason}</span>
        </Link>
      </div>
      <div className="flex gap-2 ps-[50px]">
        {member.canConnect !== false && <ConnectControl member={member} controls={controls} />}
        <FollowControl member={member} controls={controls} prominent={member.official || member.canConnect === false} />
      </div>
    </li>
  );
}

/** Compact suggested-member rows with Connect and Follow. */
export function SuggestionList({ members }: { members: SuggestedMember[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {members.map((member) => (
        <SuggestionRow key={member.id} member={member} />
      ))}
    </ul>
  );
}
