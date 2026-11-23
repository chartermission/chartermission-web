"use client";

import type { ContentCalendarAction, ContentCalendarItem } from "@chartermission/contracts";
import { Avatar, Chip, Icon, cn } from "@chartermission/ui";
import { SelectAllBox, SelectBox } from "@/components/bulk/select-box";
import { RowMenu } from "@/components/row-menu";
import { useIntlTag, useT } from "@/i18n/client";
import { formatDateTime } from "@/lib/format";
import { ACTION_LABELS, DANGER, stateMeta, utcTitle } from "./shared";

/** Actions a row offers from its menu (the drawer shows them all, with detail). */
export function rowActions(item: ContentCalendarItem): ContentCalendarAction[] {
  if (item.kind === "draft") {
    switch (item.state) {
      case "scheduled":
        return ["hold", "reschedule", "cancel"];
      case "held":
        return item.review?.state === "pending" ? ["release", "approve", "decline", "reschedule", "cancel"] : ["release", "reschedule", "cancel"];
      case "awaiting_approval":
        return ["approve", "decline", "hold", "reschedule", "cancel"];
      case "failed":
        return ["reschedule", "cancel"];
      default:
        return [];
    }
  }
  if (item.state === "awaiting_approval") return ["approve", "decline"];
  if (item.state === "published") return item.moderationState === "visible" ? ["hide"] : ["restore"];
  return [];
}

/** Table of items with selection for batch actions. */
export function CalendarList({
  items,
  canAct,
  selection,
  onOpen,
  onAction,
}: {
  items: ContentCalendarItem[];
  canAct: boolean;
  selection: { has: (key: string) => boolean; toggle: (key: string) => void; toggleAll: (keys: readonly string[]) => void; state: (keys: readonly string[]) => "all" | "some" | "none" };
  onOpen: (item: ContentCalendarItem) => void;
  onAction: (item: ContentCalendarItem, action: ContentCalendarAction) => void;
}) {
  const t = useT();
  const tag = useIntlTag();
  const keys = items.map((i) => i.key);
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <caption className="sr-only">Posts written with Claude</caption>
        <thead className="border-b border-line bg-muted text-label text-secondary uppercase">
          <tr>
            {canAct && (
              <th scope="col" className="w-10 py-2.5 ps-4 pe-1 text-start">
                <SelectAllBox state={selection.state(keys)} onToggle={() => selection.toggleAll(keys)} />
              </th>
            )}
            <th scope="col" className={cn("py-2.5 pe-2.5 text-start font-semibold", !canAct && "ps-4")}>Author</th>
            <th scope="col" className="py-2.5 pe-2.5 text-start font-semibold">Post</th>
            <th scope="col" className="py-2.5 pe-2.5 text-start font-semibold">When</th>
            <th scope="col" className="py-2.5 pe-2.5 text-start font-semibold">State</th>
            <th scope="col" className="py-2.5 pe-2.5 text-start font-semibold">Source</th>
            <th scope="col" className="py-2.5 pe-4 text-end font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const meta = stateMeta(item.state);
            const actions = rowActions(item);
            return (
              <tr key={item.key} className="border-t border-line align-top first:border-t-0 hover:bg-muted/40">
                {canAct && (
                  <td className="py-3 ps-4 pe-1">
                    <SelectBox checked={selection.has(item.key)} label={t("Select the post by {name}", { name: item.author.name })} onChange={() => selection.toggle(item.key)} />
                  </td>
                )}
                <td className={cn("py-3 pe-2.5", !canAct && "ps-4")}>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={item.author.name} size={32} src={item.author.avatarUrl ?? undefined} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-ink">{item.page?.name ?? item.author.name}</span>
                      <span className="truncate text-xs text-secondary">@{item.author.handle}</span>
                    </div>
                  </div>
                </td>
                <td className="max-w-[360px] py-3 pe-2.5">
                  <button type="button" onClick={() => onOpen(item)} className="flex w-full items-start gap-2 text-start">
                    {item.media.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- API media URL, small thumbnail
                      <img src={item.media.thumbnailUrl} alt="" className="size-10 shrink-0 rounded-md border border-line object-cover" />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="line-clamp-2 text-ink hover:underline">{item.excerpt}</span>
                      {(item.media.count > 0 || item.chapter) && (
                        <span className="flex items-center gap-1 text-xs text-secondary">
                          {item.media.count > 0 && (
                            <>
                              <Icon name="image" size={12} />
                              <span className="tabular-nums">{item.media.count}</span>
                            </>
                          )}
                          {item.chapter && <span className="truncate">{item.chapter.name}</span>}
                        </span>
                      )}
                    </span>
                  </button>
                </td>
                <td className="py-3 pe-2.5 whitespace-nowrap text-body">
                  <time dateTime={item.at} title={utcTitle(item.at, tag)} className="tabular-nums">
                    {formatDateTime(item.at, undefined, tag)}
                  </time>
                </td>
                <td className="py-3 pe-2.5">
                  <span className="flex flex-wrap gap-1">
                    <Chip tone={meta.tone}>{meta.label}</Chip>
                    {item.moderationState === "hidden" && <Chip tone="error">Hidden</Chip>}
                  </span>
                </td>
                <td className="py-3 pe-2.5 text-body">{item.source === "claude" ? (item.claudeClient ?? "Claude") : "Site or app"}</td>
                <td className="py-3 pe-4">
                  <div className="flex justify-end">
                    <RowMenu
                      label={t("More actions for the post by {name}", { name: item.author.name })}
                      items={[
                        { label: "Open", onSelect: () => onOpen(item) },
                        ...(canAct ? actions.map((a) => ({ label: ACTION_LABELS[a], danger: DANGER.has(a), onSelect: () => onAction(item, a) })) : []),
                        ...(item.postUrl ? [{ label: "View on site ↗", onSelect: () => window.open(item.postUrl!, "_blank", "noopener") }] : []),
                      ]}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
