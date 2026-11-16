"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SuggestedMember } from "@chartermission/contracts";
import { Avatar } from "@chartermission/ui";
import { memberHref } from "@/components/social/links";
import { ConnectControl, FollowControl, useRelationship, type RelationshipControls } from "./relationship";
import { ProfileLink } from "@/components/social/post-parts";
import { useT } from "@/i18n/client";

function SuggestionRow({ member, onRequested, arriving }: { member: SuggestedMember; onRequested?: () => void; arriving: boolean }) {
  const controls = useRelationship(member, {
    connection: "none",
    connectionId: null,
    following: false,
  });
  // With onRequested, a sent request takes the row out of the list (the list says so).
  const connect: RelationshipControls["connect"] = async (note) => {
    const sent = await controls.connect(note);
    if (sent) onRequested?.();
    return sent;
  };
  return (
    <li data-member-id={member.id} className={arriving ? "motion-fade-up flex flex-col gap-2" : "flex flex-col gap-2"}>
      <div className="flex items-center gap-2.5">
        <ProfileLink href={memberHref(member.handle)}>
          <Avatar
            name={member.name}
            src={member.avatarUrl ?? undefined}
            tone={member.tone}
          />
        </ProfileLink>
        <Link
          href={memberHref(member.handle)}
          className="group flex min-w-0 flex-1 flex-col gap-px"
        >
          <span className="truncate text-sm font-medium text-ink group-hover:underline">
            {member.name}
          </span>
          {member.headline && (
            <span className="truncate text-xs text-secondary">
              {member.headline}
            </span>
          )}
          <span className="truncate text-xs text-primary-light">
            {member.reason}
          </span>
        </Link>
      </div>
      <div className="flex gap-2 ps-[50px]">
        {member.canConnect !== false && (
          <ConnectControl member={member} controls={onRequested ? { ...controls, connect } : controls} />
        )}
        <FollowControl
          member={member}
          controls={controls}
          prominent={member.official || member.canConnect === false}
        />
      </div>
    </li>
  );
}

/**
 * Compact suggested-member rows with Connect and Follow. With `limit`, only that many show at a
 * time and the rest wait client-side: once a connection request is sent from a row, the row
 * leaves (the toast and a polite announcement say so) and the next suggestion takes its place.
 */
export function SuggestionList({ members, limit }: { members: SuggestedMember[]; limit?: number }) {
  const t = useT();
  const listRef = useRef<HTMLUListElement>(null);
  const emptyRef = useRef<HTMLAnchorElement>(null);
  const [requested, setRequested] = useState<string[]>([]);
  const [arrived, setArrived] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  /** After a row leaves with focus in it: the position whose row takes the focus. */
  const refocus = useRef<number | null>(null);
  const remaining = members.filter((member) => !requested.includes(member.id));
  const shown = limit === undefined ? remaining : remaining.slice(0, limit);

  function requestedFrom(member: SuggestedMember) {
    const next = limit === undefined ? undefined : remaining[limit];
    const active = document.activeElement;
    if (active === document.body || !!listRef.current?.contains(active)) refocus.current = shown.findIndex((m) => m.id === member.id);
    setRequested((current) => [...current, member.id]);
    if (next) setArrived((current) => [...current, next.id]);
    // The toast says the request was sent; this says what took the row's place.
    setAnnouncement(next ? t("Next suggestion: {name}", { name: next.name }) : "");
  }

  useEffect(() => {
    const index = refocus.current;
    if (index === null) return;
    refocus.current = null;
    const rows = listRef.current?.querySelectorAll<HTMLElement>(":scope > li");
    const row = rows?.length ? rows[Math.min(index, rows.length - 1)] : undefined;
    (row?.querySelector<HTMLElement>("button:not(:disabled)") ?? emptyRef.current)?.focus();
  }, [requested]);

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {shown.length > 0 ? (
        <ul ref={listRef} className="flex flex-col gap-4">
          {shown.map((member) => (
            <SuggestionRow
              key={member.id}
              member={member}
              arriving={arrived.includes(member.id)}
              onRequested={limit === undefined ? undefined : () => requestedFrom(member)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-secondary">
          That’s everyone for now.{" "}
          <Link ref={emptyRef} href="/network?tab=suggestions" className="font-medium text-primary-light hover:underline">
            See more suggestions
          </Link>
        </p>
      )}
    </>
  );
}
