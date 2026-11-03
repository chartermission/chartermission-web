"use client";

import Link from "next/link";
import { useState } from "react";
import type { ChapterRef, SuggestedMember } from "@chartermission/contracts";
import { Avatar, Button, Icon, cn } from "@chartermission/ui";
import { api, isApiError } from "@/lib/api/client";
import { RestrictedPrompt, VerifyPrompt } from "@/components/account/verify-prompt";
import { ChipPicker } from "./chip-picker";

type ConnectState = "idle" | "sending" | "sent";

/** Step 4: people to follow or connect with (each with its reason), and chapters to follow. */
export function CommunityStep({
  members,
  chapters,
  countryCode,
  followedMemberIds,
  followedChapterIds,
  onChange,
}: {
  members: SuggestedMember[];
  chapters: ChapterRef[];
  countryCode: string | null;
  followedMemberIds: string[];
  followedChapterIds: string[];
  onChange: (next: { followedMemberIds?: string[]; followedChapterIds?: string[] }) => void;
}) {
  const [connect, setConnect] = useState<Record<string, ConnectState>>({});
  const [connectError, setConnectError] = useState<{ kind: "verify" } | { kind: "restricted" | "other"; message: string } | null>(
    null,
  );

  async function sendRequest(member: SuggestedMember) {
    setConnect((prev) => ({ ...prev, [member.id]: "sending" }));
    setConnectError(null);
    try {
      await api("/connections", { method: "POST", body: { memberId: member.id } });
      setConnect((prev) => ({ ...prev, [member.id]: "sent" }));
    } catch (error) {
      setConnect((prev) => ({ ...prev, [member.id]: "idle" }));
      if (isApiError(error, "EMAIL_NOT_VERIFIED")) setConnectError({ kind: "verify" });
      else if (isApiError(error, "ACCOUNT_RESTRICTED") || isApiError(error, "ACCOUNT_SUSPENDED"))
        setConnectError({ kind: "restricted", message: error.message });
      else if (isApiError(error, "CONFLICT")) setConnect((prev) => ({ ...prev, [member.id]: "sent" }));
      else
        setConnectError({
          kind: "other",
          message: isApiError(error) ? error.message : "Something went wrong. Please try again.",
        });
    }
  }

  const sortedChapters = [...chapters].sort((a, b) => {
    const aLocal = a.countryCode === countryCode ? 0 : 1;
    const bLocal = b.countryCode === countryCode ? 0 : 1;
    return aLocal - bLocal || a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="community-people" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="community-people" className="text-md font-medium text-ink">
            People you may want to follow
          </h3>
          <p className="text-sm text-secondary">
            Suggested from your country, sectors and interests. Following shows their posts in your feed.
          </p>
        </div>
        <div aria-live="polite">
          {connectError?.kind === "verify" && <VerifyPrompt action="send connection requests" />}
          {connectError?.kind === "restricted" && <RestrictedPrompt message={connectError.message} />}
          {connectError?.kind === "other" && <p className="text-sm text-error">{connectError.message}</p>}
        </div>
        {members.length === 0 ? (
          <p className="rounded-lg bg-muted p-4 text-sm text-secondary">
            We don’t have suggestions for you yet. Add your sectors and interests and check{" "}
            <Link href="/network" className="font-medium text-primary-light hover:underline">
              Network
            </Link>{" "}
            later.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            {members.map((member) => {
              const following = followedMemberIds.includes(member.id);
              const state = connect[member.id] ?? "idle";
              return (
                <li key={member.id} className="flex flex-col gap-3 rounded-card border border-line p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={member.name} src={member.avatarUrl ?? undefined} tone={member.tone} size={40} />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-1 truncate text-sm font-medium text-ink">
                        {member.name}
                        {member.verified && <Icon name="verified" size={14} className="shrink-0 text-info" label="Verified" />}
                      </span>
                      {member.headline && <span className="line-clamp-2 text-xs text-secondary">{member.headline}</span>}
                      <span className="mt-1 inline-flex items-center gap-1 self-start rounded-full bg-primary-tint-2 px-2 py-0.5 text-xs text-primary">
                        <Icon name="lightbulb" size={12} />
                        {member.reason}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="small"
                      variant={following ? "primary" : "secondary"}
                      aria-pressed={following}
                      className="flex-1"
                      onClick={() =>
                        onChange({
                          followedMemberIds: following
                            ? followedMemberIds.filter((value) => value !== member.id)
                            : [...followedMemberIds, member.id],
                        })
                      }
                    >
                      {following ? (
                        <>
                          <Icon name="check" size={14} />
                          Following
                        </>
                      ) : (
                        "Follow"
                      )}
                      <span className="sr-only"> {member.name}</span>
                    </Button>
                    <Button
                      size="small"
                      variant="secondary"
                      className={cn("flex-1", state === "sent" && "text-success")}
                      disabled={state !== "idle"}
                      onClick={() => void sendRequest(member)}
                    >
                      {state === "sent" ? "Request sent" : state === "sending" ? "Sending…" : "Connect"}
                      <span className="sr-only"> with {member.name}</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ChipPicker
        label="Chapters to follow"
        description="Local chapters share events and news from their city."
        options={sortedChapters.map((chapter) => ({ id: chapter.id, label: chapter.name }))}
        selected={followedChapterIds}
        onChange={(next) => onChange({ followedChapterIds: next })}
        max={10}
        emptyText="No chapters yet."
      />
    </div>
  );
}
