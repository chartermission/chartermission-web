"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { MemberProfile, PreviewAs } from "@chartermission/contracts";
import { Button, Icon, buttonClasses } from "@chartermission/ui";
import { api } from "@/lib/api/client";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { ConnectControl, FollowControl, canConnectWith, useRelationship } from "@/components/network/relationship";
import { ConfirmDialog, UnblockHint } from "@/components/social/confirm-dialog";
import { Dialog } from "@/components/social/dialog";
import { Menu, type MenuItem } from "@/components/social/menu";
import { toast } from "@/components/social/toast";

const NOTE_MAX = 300;

const previewLabels: Record<PreviewAs, string> = {
  public: "Preview as a visitor",
  member: "Preview as a member",
  connection: "Preview as a connection",
};

function ConnectDialog({ name, onClose, onSend }: { name: string; onClose: () => void; onSend: (note: string) => Promise<boolean> }) {
  const id = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={`Connect with ${name}`} description="Add a note to say how you know each other (optional)." onClose={onClose} width={480} initialFocus="textarea">
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          setBusy(true);
          const ok = await onSend(note.trim());
          setBusy(false);
          if (ok) form.closest("dialog")?.close();
        }}
      >
        <label htmlFor={`${id}-note`} className="sr-only">
          Note
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX))}
          maxLength={NOTE_MAX}
          rows={4}
          placeholder={`Hi ${name.split(" ")[0]}, …`}
          aria-describedby={`${id}-count`}
          className="w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink outline-none placeholder:text-disabled focus:border-primary-light focus:ring-2 focus:ring-primary-tint"
        />
        <p id={`${id}-count`} className="-mt-2 self-end text-xs text-secondary">
          {note.length} / {NOTE_MAX}
        </p>
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={(event) => event.currentTarget.closest("dialog")?.close()}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Profile header actions for another member, or Edit / Preview for the viewer's own profile. */
export function ProfileActions({ member, canPost }: { member: MemberProfile; canPost: boolean }) {
  const router = useRouter();
  const controls = useRelationship(member, member.relationship);
  const [muted, setMuted] = useState(member.relationship.muted);
  const [modal, setModal] = useState<"connect" | "block" | "report" | "remove" | null>(null);

  if (member.relationship.self) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/settings/profile" className={buttonClasses()}>
          Edit profile
        </Link>
        <Menu
          label="Preview your profile"
          trigger={
            <span className={buttonClasses({ variant: "secondary" })}>
              <Icon name="eye" size={16} />
              Preview as
            </span>
          }
          items={(Object.keys(previewLabels) as PreviewAs[]).map((as) => ({
            label: previewLabels[as],
            onSelect: () => router.push(`/members/${member.handle}?preview=${as}`),
          }))}
        />
      </div>
    );
  }

  if (member.relationship.blocked) {
    return (
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await api(`/blocks/${member.id}`, { method: "DELETE" });
            toast.success(`Unblocked ${member.name}`);
            router.refresh();
          } catch (e) {
            toast.error(e);
          }
        }}
      >
        Unblock
      </Button>
    );
  }

  async function toggleMute() {
    try {
      await api("/mutes", { method: muted ? "DELETE" : "POST", body: { targetType: "member", targetId: member.id } });
      toast.success(muted ? `Unmuted ${member.name}` : `Muted ${member.name}. Their posts won’t appear in your feed.`);
      setMuted(!muted);
    } catch (e) {
      toast.error(e);
    }
  }

  const connectable = canConnectWith(member, member.relationship);
  const menu: MenuItem[] = [];
  if (connectable && controls.state.connection === "connected") menu.push({ label: "Remove connection", icon: "x", onSelect: () => setModal("remove") });
  menu.push({ label: muted ? `Unmute ${member.name}` : `Mute ${member.name}`, icon: "eye-off", onSelect: toggleMute });
  menu.push({ label: `Block ${member.name}`, icon: "shield", danger: true, onSelect: () => setModal("block") });
  menu.push({ label: "Report profile", icon: "flag", onSelect: () => setModal("report") });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!connectable ? null : controls.state.connection === "connected" ? (
        <span className="flex items-center gap-1.5 rounded-lg bg-success-light px-3 py-2 text-sm font-medium text-success">
          <Icon name="check" size={16} />
          Connected
        </span>
      ) : (
        <ConnectControl member={member} controls={controls} size="default" onConnectWithNote={canPost ? () => setModal("connect") : undefined} />
      )}
      {/* Official accounts are follow-only, so Follow is the main action there. */}
      <FollowControl member={member} controls={controls} size="default" prominent={!connectable} />
      {connectable && (
        <Button variant="secondary" disabled title="Messaging arrives in a later release">
          Message
          <span className="sr-only"> (coming in a later release)</span>
        </Button>
      )}
      <Menu
        label={`More actions for ${member.name}`}
        items={menu}
        trigger={
          <span className="flex size-[42px] items-center justify-center rounded-lg border border-line-strong text-body">
            <Icon name="more" size={20} />
          </span>
        }
      />
      {modal === "connect" && <ConnectDialog name={member.name} onClose={() => setModal(null)} onSend={(note) => controls.connect(note)} />}
      {modal === "report" && <ReportDialog targetType="member" targetId={member.id} subject={`${member.name}’s profile`} onClose={() => setModal(null)} />}
      {modal === "remove" && (
        <ConfirmDialog
          title={`Remove ${member.name} from your connections?`}
          confirmLabel="Remove"
          onClose={() => setModal(null)}
          onConfirm={async () => {
            if (!(await controls.removeConnection())) throw new Error("remove");
          }}
        >
          They won’t be told. You can send a new request later.
        </ConfirmDialog>
      )}
      {modal === "block" && (
        <ConfirmDialog
          title={`Block ${member.name}?`}
          confirmLabel="Block"
          danger
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await api(`/blocks/${member.id}`, { method: "POST" });
            toast.success(`${member.name} is blocked. You can unblock them in Settings → Blocked & muted.`);
            // Their profile is no longer available to you, so leave it.
            router.replace("/feed");
          }}
        >
          You won’t see each other’s posts or profiles. Any connection or follow between you is removed, and they can’t message, mention or
          request to connect with you. They aren’t told. <UnblockHint />
        </ConfirmDialog>
      )}
    </div>
  );
}
