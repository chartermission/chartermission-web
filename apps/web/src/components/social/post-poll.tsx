"use client";

import { useState } from "react";
import type { PollView, PostView } from "@chartermission/contracts";
import { Icon, cn } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { formatCount, timeLeft } from "./format";
import { toast } from "./toast";

/** Poll with vote buttons; results show after voting or once it closes (POST /posts/{id}/poll/vote). */
export function PostPoll({ postId, poll, onUpdated }: { postId: string; poll: PollView; onUpdated: (post: PostView) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const showResults = poll.closed || poll.myVoteOptionId !== null;

  async function vote(optionId: string) {
    setBusy(optionId);
    try {
      onUpdated(await api<PostView>(`/posts/${postId}/poll/vote`, { method: "POST", body: { optionId } }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  }

  const footer = `${formatCount(poll.totalVotes)} vote${poll.totalVotes === 1 ? "" : "s"} · ${poll.closed ? "Final results" : timeLeft(poll.closesAt)}`;

  return (
    <div className="flex w-full flex-col gap-2" role="group" aria-label={`Poll: ${poll.question}`}>
      <p className="text-md font-medium text-ink">{poll.question}</p>
      {poll.options.map((option) => {
        const chosen = poll.myVoteOptionId === option.id;
        if (showResults) {
          return (
            <div
              key={option.id}
              className={cn(
                "relative flex h-10 w-full items-center justify-between overflow-hidden rounded-lg border px-[11px]",
                chosen ? "border-primary" : "border-line",
              )}
            >
              <span
                className={cn("absolute inset-y-0 start-0", chosen ? "bg-primary-tint" : "bg-muted")}
                style={{ width: `${option.percent}%` }}
                aria-hidden="true"
              />
              <span className={cn("relative flex items-center gap-1.5 text-sm text-ink", chosen && "font-medium")}>
                {option.label}
                {chosen && (
                  <>
                    <Icon name="check" size={14} className="text-primary" />
                    <span className="sr-only">(your vote)</span>
                  </>
                )}
              </span>
              <span className={cn("relative text-sm font-medium", chosen ? "text-primary" : "text-secondary")}>
                {option.percent}%<span className="sr-only">, {formatCount(option.votes)} votes</span>
              </span>
            </div>
          );
        }
        return (
          <button
            key={option.id}
            type="button"
            disabled={busy !== null}
            onClick={() => vote(option.id)}
            className="flex h-10 w-full items-center justify-center rounded-lg border border-primary-light px-3 text-sm font-medium text-primary-light transition-colors hover:bg-primary-tint-2 disabled:opacity-60"
          >
            {busy === option.id ? "Voting…" : option.label}
          </button>
        );
      })}
      <p className="text-xs text-secondary" aria-live="polite">
        {footer}
        {!showResults && " · Results show after you vote"}
      </p>
    </div>
  );
}
