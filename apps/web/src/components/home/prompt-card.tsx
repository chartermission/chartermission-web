"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PromptMoment } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, chipClasses } from "@chartermission/ui";
import { topicHref } from "@/components/social/links";
import { onPostCreated } from "@/components/social/post-events";
import type { Viewer } from "@/components/social/viewer";
import { requestCompose } from "./compose-request";
import { MomentCard } from "./moment-card";
import { AvatarStack } from "./moment-parts";
import { useT } from "@/i18n/client";

/** Today's #DailyPrompt: the question set large, who answered, Share your answer / See answers. */
export function PromptCard({ moment, viewer }: { moment: PromptMoment; viewer: Viewer }) {
  const t = useT();
  const [state, setState] = useState({ answered: moment.answered, responses: moment.responses, responders: moment.responders });
  const tag = moment.hashtag;

  // Answering from this card (or the composer) flips it to "You answered today".
  useEffect(
    () =>
      onPostCreated((post) => {
        if (!post.hashtags.some((h) => h.toLowerCase() === tag.toLowerCase())) return;
        setState((current) =>
          current.answered
            ? current
            : {
                answered: true,
                responses: current.responses + 1,
                responders: [{ ...viewer, verified: false, staff: false, official: false }, ...current.responders.filter((r) => r.id !== viewer.id)],
              },
        );
      }),
    [tag, viewer],
  );

  const { answered, responses, responders } = state;
  const count = responses === 1 ? "1 member answered today" : t("{responses} members answered today", { responses });
  return (
    <MomentCard id={moment.id} label="Daily prompt" icon="message" iconTone="text-info">
      {(headingId) => (
        <div className="relative flex flex-col gap-4">
          <span aria-hidden="true" className="pointer-events-none absolute -end-16 -bottom-24 size-44 rounded-full border-[16px] border-accent/10" />
          <span className={chipClasses("hashtag", "relative self-start px-2.5 py-1 text-xs")}>#{tag}</span>
          <h2 id={headingId} className="relative max-w-[30ch] text-h2 text-balance text-ink max-sm:text-h3">
            {moment.prompt}
          </h2>
          <p className="relative flex items-center gap-2.5 text-sm text-body">
            {responders.length > 0 && <AvatarStack members={responders} size={32} />}
            {responses > 0 ? count : "No answers yet today. Yours could be the first."}
          </p>
          <div className="relative flex flex-wrap items-center gap-3">
            {answered ? (
              <span className="flex items-center gap-1.5 rounded-lg bg-success-light px-3 py-1.5 text-sm font-medium text-success">
                <Icon name="check" size={16} />
                You answered today
              </span>
            ) : (
              <Button size="small" onClick={() => requestCompose({ body: `\n\n#${tag}` })}>
                <Icon name="message" size={16} />
                Share your answer
              </Button>
            )}
            <Link href={topicHref(tag)} className={buttonClasses({ variant: answered ? "secondary" : "ghost", size: "small" })}>
              See answers
              <Icon name="chevron-right" size={14} />
            </Link>
          </div>
        </div>
      )}
    </MomentCard>
  );
}
