import type { MemberRef } from "@chartermission/contracts";
import { Avatar, cn } from "@chartermission/ui";

/** Ring thickness and the white gap between ring and photo, in px. */
const RING = 2.5;
const GAP = 2;

/** Outer diameter of a StoryRing around an avatar of `size` px (for placeholders that must line up). */
export const storyRingSize = (size: 40 | 56) => size + 2 * (RING + GAP);

/**
 * Avatar in a ring: brand gradient while there are unseen stories, grey once all are seen.
 * Every layer is a fixed-size square flex box, so the ring stays a true circle and the photo sits
 * exactly in its centre (inline layers would add a text line's descender space below the photo).
 */
export function StoryRing({
  member,
  unseen,
  size = 56,
  className,
}: {
  member: Pick<MemberRef, "name" | "avatarUrl" | "tone">;
  unseen: boolean;
  size?: 40 | 56;
  className?: string;
}) {
  const outer = storyRingSize(size);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        unseen ? "bg-gradient-to-tr from-accent via-warning to-primary-light" : "bg-line-strong",
        className,
      )}
      style={{ width: outer, height: outer }}
    >
      <span className="flex items-center justify-center rounded-full bg-card" style={{ width: size + 2 * GAP, height: size + 2 * GAP }}>
        <Avatar name={member.name} src={member.avatarUrl ?? undefined} tone={member.tone} size={size} />
      </span>
    </span>
  );
}
