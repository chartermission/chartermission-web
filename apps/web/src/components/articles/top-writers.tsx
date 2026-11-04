"use client";

import Link from "next/link";
import type { ArticlesHub } from "@chartermission/contracts";
import { Avatar, Icon, Panel } from "@chartermission/ui";
import { FollowControl, useRelationship } from "@/components/network/relationship";
import { memberHref } from "@/components/social/links";
import { staggerStyle } from "@/components/motion";
import type { Viewer } from "@/components/social/viewer";

type Writer = ArticlesHub["authors"][number];

function WriterCard({ writer, viewer, index }: { writer: Writer; viewer: Viewer; index: number }) {
  const { member, articles } = writer;
  const controls = useRelationship(member, { connection: "none", connectionId: null, following: member.isFollowing });
  const self = member.id === viewer.id;
  return (
    <li
      className="motion-fade-up relative flex w-full flex-col items-center gap-2 rounded-card border border-line bg-card px-4 pt-5 pb-4 text-center max-md:w-[188px] max-md:shrink-0 max-md:snap-start"
      style={staggerStyle(index, { step: 50, max: 5 })}
    >
      <Avatar name={member.name} src={member.avatarUrl ?? undefined} tone={member.tone} size={56} />
      <div className="flex w-full min-w-0 flex-col gap-0.5">
        <p className="flex items-center justify-center gap-1">
          <Link href={memberHref(member.handle)} className="truncate text-md font-medium text-ink hover:underline">
            {member.name}
          </Link>
          {member.verified && <Icon name="verified" size={16} className="shrink-0 text-primary" label="Verified" />}
        </p>
        <p className="line-clamp-1 min-h-4 text-xs text-secondary">{member.headline ?? " "}</p>
      </div>
      <p className="flex items-center gap-1 text-xs font-medium text-body">
        <Icon name="book" size={14} className="text-primary-light" />
        {articles} article{articles === 1 ? "" : "s"}
      </p>
      <div className="mt-1 w-full">
        {self ? (
          <p className="flex h-8 items-center justify-center rounded-lg bg-muted text-xs font-medium text-secondary">That’s you</p>
        ) : (
          <FollowControl member={member} controls={controls} block />
        )}
      </div>
    </li>
  );
}

/** "Top writers": members who have written the most articles, with follow. Scrolls sideways on small screens. */
export function TopWriters({ writers, viewer }: { writers: Writer[]; viewer: Viewer }) {
  if (!writers.length) return null;
  return (
    <Panel aria-labelledby="top-writers" className="relative flex flex-col gap-4 overflow-hidden p-5 max-sm:px-4">
      <div className="flex flex-col gap-0.5">
        <h2 id="top-writers" className="text-h3 text-ink">
          Top writers
        </h2>
        <p className="text-sm text-secondary">Members who share the most long-form writing. Follow them to see new articles in your feed.</p>
      </div>
      <ul className="grid grid-cols-5 gap-3 max-md:-mx-5 max-md:flex max-md:snap-x max-md:overflow-x-auto max-md:px-5 max-md:pb-1 max-sm:-mx-4 max-sm:px-4">
        {writers.map((writer, index) => (
          <WriterCard key={writer.member.id} writer={writer} viewer={viewer} index={index} />
        ))}
      </ul>
    </Panel>
  );
}
