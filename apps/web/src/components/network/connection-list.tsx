"use client";

import { MessageMemberButton } from "./message-member";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type {
  ConnectionView,
  ConnectionsQuery,
  Page,
} from "@chartermission/contracts";
import { Button, Panel } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { ErrorNotice } from "@/components/social/errors";
import { memberHref } from "@/components/social/links";
import { MemberAvatar, TimeAgo } from "@/components/social/post-parts";
import { toast } from "@/components/social/toast";
import { T, useT } from "@/i18n/client";

type Filter = ConnectionsQuery["filter"];

function Row({
  connection,
  filter,
  onDone,
}: {
  connection: ConnectionView;
  filter: Filter;
  onDone: (id: string, message: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { member } = connection;

  async function act(path: string, method: "POST" | "DELETE", message: string) {
    setBusy(true);
    try {
      await api(path, { method });
      onDone(connection.id, message);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4 max-sm:px-4">
      <MemberAvatar member={member} size={56} link />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={memberHref(member.handle)}
          className="truncate text-md font-medium text-ink hover:underline"
        >
          {member.name}
        </Link>
        {member.headline && (
          <p className="truncate text-sm text-body">{member.headline}</p>
        )}
        <p className="text-xs text-secondary">
          {filter === "connected"
            ? "Connected"
            : filter === "incoming"
              ? "Sent you a request"
              : "You sent a request"}{" "}
          · <TimeAgo iso={connection.createdAt} />
        </p>
        {connection.note && (
          <p className="mt-1 rounded-lg bg-surface px-3 py-2 text-sm text-body">
            “{connection.note}”
          </p>
        )}
      </div>
      <div className="flex gap-2 max-sm:w-full max-sm:justify-end">
        {filter === "incoming" && (
          <>
            <Button
              variant="secondary"
              size="small"
              disabled={busy}
              onClick={() =>
                act(
                  `/connections/${connection.id}/decline`,
                  "POST",
                  t("Declined {name}’s request", { name: member.name }),
                )
              }
            >
              Decline<span className="sr-only"> {member.name}</span>
            </Button>
            <Button
              size="small"
              disabled={busy}
              onClick={() =>
                act(
                  `/connections/${connection.id}/accept`,
                  "POST",
                  t("You and {name} are now connected", { name: member.name }),
                )
              }
            >
              Accept<span className="sr-only"> {member.name}</span>
            </Button>
          </>
        )}
        {filter === "outgoing" && (
          <Button
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={() =>
              act(
                `/connections/${connection.id}/withdraw`,
                "POST",
                "Request withdrawn",
              )
            }
          >
            Withdraw
            <span className="sr-only">
              {" "}
              <T vars={{ name: member.name }}>{"request to {name}"}</T>
            </span>
          </Button>
        )}
        {filter === "connected" && (
          <>
            <MessageMemberButton
              memberId={member.id}
              name={member.name}
              size="small"
              icon={false}
            />
            <Button
              variant="ghost"
              size="small"
              onClick={() => setConfirming(true)}
            >
              Remove<span className="sr-only"> {member.name}</span>
            </Button>
          </>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          title={t("Remove {name}?", { name: member.name })}
          confirmLabel="Remove"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await api(`/connections/${connection.id}`, { method: "DELETE" });
            onDone(
              connection.id,
              t("Removed {name} from your connections", { name: member.name }),
            );
          }}
        >
          They won’t be told. You can send a new request later.
        </ConfirmDialog>
      )}
    </li>
  );
}

/** GET /me/connections?filter= with accept / decline / withdraw / remove and "Load more". */
export function ConnectionList({
  filter,
  initial,
  title,
  empty,
}: {
  filter: Filter;
  initial: Page<ConnectionView>;
  title: string;
  empty: ReactNode;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function more() {
    setLoading(true);
    setError(null);
    try {
      const page = await api<Page<ConnectionView>>("/me/connections", {
        query: { filter, cursor: cursor ?? undefined },
      });
      setItems((current) => [
        ...current,
        ...page.items.filter((c) => !current.some((x) => x.id === c.id)),
      ]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  function done(id: string, message: string) {
    setItems((current) => current.filter((c) => c.id !== id));
    toast.success(message);
    router.refresh();
  }

  return (
    <Panel aria-label={title} className="flex flex-col">
      <h2 className="px-5 pb-1 pt-4 text-h3 text-ink max-sm:px-4">{title}</h2>
      {items.length === 0 ? (
        <div className="px-5 pb-6 pt-2 text-sm text-secondary max-sm:px-4">
          {empty}
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((connection) => (
            <Row
              key={connection.id}
              connection={connection}
              filter={filter}
              onDone={done}
            />
          ))}
        </ul>
      )}
      {error ? (
        <ErrorNotice error={error} onRetry={more} className="mx-5 mb-4" />
      ) : null}
      {cursor && (
        <div className="border-t border-line p-3">
          <Button variant="ghost" block disabled={loading} onClick={more}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </Panel>
  );
}
