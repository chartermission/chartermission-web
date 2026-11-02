import Link from "next/link";
import { Avatar, Icon } from "@chartermission/ui";
import type { DirectoryMember } from "@/lib/mock/network";
import { ConnectAction } from "./connect-action";

/**
 * Directory member card — Figma "Member card" (node 17:84) as used on
 * /network. App-local because the shared MemberCard has no avatar tone and
 * a fixed secondary "Connect" button, while this screen shows toned avatars
 * and Connect / Pending / Message states.
 */
export function DirectoryMemberCard({ member }: { member: DirectoryMember }) {
  return (
    <article className="flex w-full flex-col items-center gap-2 rounded-card border border-line bg-card px-4 py-5">
      <Avatar name={member.name} size={56} tone={member.tone} />
      <p className="flex items-center gap-1">
        <Link href={`/members/${member.handle}`} className="text-md font-medium text-ink hover:underline">
          {member.name}
        </Link>
        {member.verified && <Icon name="verified" size={14} className="text-primary-light" label="Verified" />}
      </p>
      <p className="w-full text-center text-sm text-body">{member.headline}</p>
      <p className="flex items-center gap-1 text-xs text-secondary">
        <Icon name="map-pin" size={14} className="shrink-0" />
        {member.location}
      </p>
      <p className="text-xs text-primary-light">
        {member.mutual} mutual connection{member.mutual === 1 ? "" : "s"}
      </p>
      <ConnectAction handle={member.handle} name={member.name} initial={member.connection} />
    </article>
  );
}
