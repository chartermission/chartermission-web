"use client";

import { useState } from "react";
import type { AnonymousViewers, ProfileViewer, ProfileViewsPage } from "@chartermission/contracts";
import { Button, Chip, Icon, Panel } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ErrorNotice } from "@/components/social/errors";
import { MemberAvatar, TimeAgo } from "@/components/social/post-parts";
import { NoTranslate } from "@/i18n/auto";
import { useIntlTag, useT } from "@/i18n/client";
import { placeVar } from "@/i18n/places";

function Viewer({ viewer }: { viewer: ProfileViewer }) {
  const t = useT();
  return (
    <li className="flex items-center gap-3 px-5 py-3.5 max-sm:px-4">
      <MemberAvatar member={viewer.member} size={40} link />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <a href={`/${viewer.member.handle}`} className="truncate text-sm font-medium text-ink hover:underline">
            <NoTranslate>{viewer.member.name}</NoTranslate>
          </a>
          {viewer.connection && <Chip>Connection</Chip>}
        </span>
        {viewer.member.headline && (
          <NoTranslate>
            <span dir="auto" className="bidi-auto truncate text-xs text-secondary">
              {viewer.member.headline}
            </span>
          </NoTranslate>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-secondary">
        <TimeAgo iso={viewer.viewedAt} />
        {viewer.days > 1 && <span>{t("Viewed on {count} days", { count: viewer.days })}</span>}
      </span>
    </li>
  );
}

function Anonymous({ group }: { group: AnonymousViewers }) {
  const t = useT();
  const intl = useIntlTag();
  const name = group.name ? placeVar(group.name, intl, t) : "";
  const text =
    group.kind === "company"
      ? group.count === 1
        ? t("Someone at {name}", { name })
        : t("{count} people at {name}", { count: group.count, name })
      : group.kind === "chapter"
        ? group.count === 1
          ? t("Someone in the {chapter}", { chapter: name })
          : t("{count} people in the {chapter}", { count: group.count, chapter: name })
        : group.count === 1
          ? t("A Charter Mission member")
          : t("{count} Charter Mission members", { count: group.count });
  return (
    <li className="flex items-center gap-3 px-5 py-3.5 max-sm:px-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-secondary">
        <Icon name="eye-off" size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-ink">{text}</span>
        <span className="text-xs text-secondary">Viewing in private mode</span>
      </span>
      <TimeAgo iso={group.lastViewedAt} className="shrink-0 text-xs text-secondary" />
    </li>
  );
}

/** Named viewers (most recent first, "Load more") and private-mode viewers collapsed into groups. */
export function ViewerList({ initial }: { initial: ProfileViewsPage }) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await api<ProfileViewsPage>("/me/profile-views", { query: { cursor } });
      setItems((current) => [...current, ...page.items.filter((v) => !current.some((x) => x.member.id === v.member.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  if (!items.length && !initial.anonymous.length) {
    return (
      <Panel className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary-tint-2 text-primary-light">
          <Icon name="eye" size={24} />
        </span>
        <p className="text-md font-medium text-ink">No profile views in the last 90 days</p>
        <p className="max-w-sm text-sm text-secondary">Post, comment and connect with members: people who notice you often look at your profile next.</p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Panel className="overflow-hidden">
        <ul className="flex flex-col divide-y divide-line" aria-busy={loading}>
          {items.map((viewer) => (
            <Viewer key={viewer.member.id} viewer={viewer} />
          ))}
          {initial.anonymous.map((group) => (
            <Anonymous key={`${group.kind}:${group.name ?? ""}`} group={group} />
          ))}
        </ul>
        {error ? <ErrorNotice error={error} onRetry={more} className="m-4" /> : null}
      </Panel>
      {cursor && (
        <Button variant="secondary" block onClick={more} disabled={loading}>
          {loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
