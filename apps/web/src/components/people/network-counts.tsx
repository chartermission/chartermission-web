"use client";

import { useT } from "@/i18n/client";
import { PeopleLink } from "./people-link";

/**
 * "128 connections · 340 followers" on a profile. Each opens the list of members, unless the
 * member keeps their network private (then the lists answer with a short explanation).
 */
export function NetworkCounts({
  handle,
  name,
  connections,
  followers,
  official,
  self,
}: {
  handle: string;
  name: string;
  connections: number;
  followers: number;
  /** Official accounts are follow-only: they have followers but no connections. */
  official: boolean;
  self: boolean;
}) {
  const t = useT();
  const base = `/members/${encodeURIComponent(handle)}`;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5">
      {!official && (
        <>
          <PeopleLink
            source={{ path: `${base}/connections`, title: self ? t("people.yourConnections") : t("people.connectionsOf", { name }), empty: t("people.noConnections") }}
          >
            {t("profile.connections", { count: connections })}
          </PeopleLink>
          <span aria-hidden>·</span>
        </>
      )}
      <PeopleLink source={{ path: `${base}/followers`, title: self ? t("people.yourFollowers") : t("people.followersOf", { name }), empty: t("people.noFollowers") }}>
        {t("profile.followers", { count: followers })}
      </PeopleLink>
      <span aria-hidden>·</span>
      <PeopleLink source={{ path: `${base}/following`, title: self ? t("people.youFollow") : t("people.followedBy", { name }), empty: t("people.noFollowing") }}>
        {t("profile.following")}
      </PeopleLink>
    </span>
  );
}
