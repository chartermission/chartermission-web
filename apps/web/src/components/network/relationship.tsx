"use client";

import { useState } from "react";
import type { ConnectionView, Relationship } from "@chartermission/contracts";
import { Button, cn, type ButtonProps } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { toast } from "@/components/social/toast";
import { T, useT } from "@/i18n/client";

export type RelationshipState = Pick<Relationship, "connection" | "connectionId" | "following">;

/** `official`: an organisation account, which members follow instead of connecting with. Team members connect like anyone. */
type Member = { id: string; name: string; official?: boolean };

/** Official accounts are follow-only, in both directions (the API refuses requests either way). */
export function canConnectWith(member: Member, relationship?: Pick<Relationship, "canConnect">): boolean {
  return !member.official && relationship?.canConnect !== false;
}

/** Connection and follow mutations shared by profile headers, directory cards and suggestions. */
export function useRelationship(member: Member, initial: RelationshipState) {
  const t = useT();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<Partial<RelationshipState>>, success?: string) {
    setBusy(label);
    try {
      const patch = await action();
      setState((current) => ({ ...current, ...patch }));
      if (success) toast.success(success);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return {
    state,
    busy,
    connect: (note?: string) =>
      run(
        "connect",
        async () => {
          const view = await api<ConnectionView>("/connections", { method: "POST", body: { memberId: member.id, note: note || undefined } });
          return { connection: view.status === "accepted" ? "connected" : "pending_outgoing", connectionId: view.id };
        },
        t("Connection request sent to {name}", { name: member.name }),
      ),
    withdraw: () =>
      run(
        "withdraw",
        async () => {
          await api(`/connections/${state.connectionId}/withdraw`, { method: "POST" });
          return { connection: "none", connectionId: null };
        },
        "Request withdrawn",
      ),
    accept: () =>
      run(
        "accept",
        async () => {
          await api(`/connections/${state.connectionId}/accept`, { method: "POST" });
          return { connection: "connected" };
        },
        t("You and {name} are now connected", { name: member.name }),
      ),
    decline: () =>
      run(
        "decline",
        async () => {
          await api(`/connections/${state.connectionId}/decline`, { method: "POST" });
          return { connection: "none", connectionId: null };
        },
        "Request declined",
      ),
    removeConnection: () =>
      run(
        "remove",
        async () => {
          await api(`/connections/${state.connectionId}`, { method: "DELETE" });
          return { connection: "none", connectionId: null };
        },
        t("Removed {name} from your connections", { name: member.name }),
      ),
    follow: () =>
      run("follow", async () => {
        await api("/follows", { method: "POST", body: { targetType: "member", targetId: member.id } });
        return { following: true };
      }),
    unfollow: () =>
      run("follow", async () => {
        await api("/follows", { method: "DELETE", body: { targetType: "member", targetId: member.id } });
        return { following: false };
      }),
  };
}

export type RelationshipControls = ReturnType<typeof useRelationship>;

/** Connect → Pending (click to withdraw) → Accept/Decline for incoming → Connected. */
export function ConnectControl({
  member,
  controls,
  size = "small",
  block = false,
  onConnectWithNote,
}: {
  member: Member;
  controls: RelationshipControls;
  size?: ButtonProps["size"];
  block?: boolean;
  /** Open a note dialog instead of sending straight away. */
  onConnectWithNote?: () => void;
}) {
  const { state, busy } = controls;
  if (member.official) return null;
  if (state.connection === "connected") {
    return (
      <Button variant="secondary" size={size} block={block} disabled title="Messaging arrives in a later release">
        Message<span className="sr-only"> <T vars={{ name: member.name }}>{"{name} (coming later)"}</T></span>
      </Button>
    );
  }
  if (state.connection === "pending_incoming") {
    return (
      <div className={cn("flex gap-2", block && "w-full")}>
        <Button size={size} block={block} disabled={!!busy} onClick={() => controls.accept()}>
          Accept<span className="sr-only"> <T vars={{ name: member.name }}>{"{name}’s request"}</T></span>
        </Button>
        <Button variant="secondary" size={size} block={block} disabled={!!busy} onClick={() => controls.decline()}>
          Decline<span className="sr-only"> <T vars={{ name: member.name }}>{"{name}’s request"}</T></span>
        </Button>
      </div>
    );
  }
  if (state.connection === "pending_outgoing") {
    return (
      <Button
        variant="secondary"
        size={size}
        block={block}
        disabled={!!busy}
        aria-pressed
        title="Request sent — select to withdraw"
        onClick={() => controls.withdraw()}
        className="group"
      >
        <span className="group-hover:hidden group-focus-visible:hidden">Pending</span>
        <span className="hidden group-hover:inline group-focus-visible:inline">Withdraw</span>
        <span className="sr-only"> <T vars={{ name: member.name }}>{"request to {name}"}</T></span>
      </Button>
    );
  }
  return (
    <Button
      variant={size === "small" ? "secondary" : "primary"}
      size={size}
      block={block}
      disabled={busy === "connect"}
      onClick={() => (onConnectWithNote ? onConnectWithNote() : controls.connect())}
    >
      {busy === "connect" ? "Sending…" : "Connect"}
      <span className="sr-only"> <T vars={{ name: member.name }}>{"with {name}"}</T></span>
    </Button>
  );
}

export function FollowControl({
  member,
  controls,
  size = "small",
  block = false,
  prominent = member.official ?? false,
}: {
  member: Member;
  controls: RelationshipControls;
  size?: ButtonProps["size"];
  block?: boolean;
  /** Follow is the main action (official accounts and pages, where there is no Connect). */
  prominent?: boolean;
}) {
  const { state, busy } = controls;
  return (
    <Button
      variant={state.following ? "secondary" : prominent ? (size === "small" ? "secondary" : "primary") : "ghost"}
      size={size}
      block={block}
      aria-pressed={state.following}
      disabled={busy === "follow"}
      onClick={() => (state.following ? controls.unfollow() : controls.follow())}
    >
      {state.following ? "Following" : "Follow"}
      <span className="sr-only"> {member.name}</span>
    </Button>
  );
}
