"use client";

import Link from "next/link";
import { useState } from "react";
import type { GroupSummary, Page } from "@chartermission/contracts";
import { Button, Icon, buttonClasses } from "@chartermission/ui";
import { ErrorNotice } from "@/components/social/errors";
import { EmptyState } from "@/components/social/skeletons";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { GroupCard, GroupGrid } from "./group-card";

/**
 * The groups a page or chapter runs (GET /groups?page= or ?chapter=), for its profile's Groups tab,
 * with "Create a group" for the people who run it.
 */
export function OwnerGroups({
  owner,
  initial,
  canCreate,
}: {
  owner: { type: "page" | "chapter"; slug: string; name: string };
  initial: Page<GroupSummary> | null;
  canCreate: boolean;
}) {
  const t = useT();
  const [items, setItems] = useState(initial?.items ?? []);
  const [cursor, setCursor] = useState(initial?.nextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(initial ? null : new Error("load"));
  const createHref = `/groups/new?${owner.type}=${encodeURIComponent(owner.slug)}`;

  async function load(after: string | null) {
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<GroupSummary>>("/groups", { query: { [owner.type]: owner.slug, limit: 12, cursor: after ?? undefined } });
      setItems((current) => (after ? [...current, ...page.items.filter((g) => !current.some((c) => c.id === g.id))] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby={`${owner.type}-groups-heading`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${owner.type}-groups-heading`} className="text-h3 text-ink">
          {t("Groups")}
        </h2>
        {canCreate && (
          <Link href={createHref} className={buttonClasses({ variant: "secondary", size: "small" })}>
            <Icon name="plus" size={16} />
            {t("Create a group")}
          </Link>
        )}
      </div>
      {error ? <ErrorNotice error={error} onRetry={() => load(null)} /> : null}
      {items.length ? (
        <GroupGrid narrow busy={loading}>
          {items.map((group) => (
            <li key={group.id}>
              <GroupCard group={group} />
            </li>
          ))}
        </GroupGrid>
      ) : (
        !error &&
        !loading && (
          <EmptyState icon="users" title={t("No groups yet")}>
            {canCreate
              ? owner.type === "page"
                ? t("Start a group for the people who follow {name}. The page’s admins run it together.", { name: owner.name })
                : t("Start a group for members of {name}. The chapter team runs it together.", { name: owner.name })
              : t("{name} doesn’t run any groups yet.", { name: owner.name })}
          </EmptyState>
        )
      )}
      {cursor && (
        <Button variant="secondary" className="self-center" onClick={() => load(cursor)} aria-disabled={loading}>
          {loading ? t("Loading…") : t("Show more groups")}
        </Button>
      )}
    </section>
  );
}
