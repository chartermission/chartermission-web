"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ConversationView } from "@chartermission/contracts";
import { Button, Icon, type ButtonProps } from "@chartermission/ui";
import { T, useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { toast } from "@/components/social/toast";

/** Opens (or starts) the private conversation with a connection. */
export function MessageMemberButton({
  memberId,
  name,
  size,
  block = false,
  icon = true,
}: {
  memberId: string;
  /** For screen readers: "Message Amara". */
  name?: string;
  size?: ButtonProps["size"];
  block?: boolean;
  icon?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      const conversation = await api<ConversationView>(
        "/messages/conversations",
        { method: "POST", body: { memberId } },
      );
      router.push(`/messages/${conversation.id}`);
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  }
  return (
    <Button
      variant="secondary"
      size={size}
      block={block}
      onClick={() => void open()}
      aria-busy={busy}
      disabled={busy}
    >
      {icon && <Icon name="message" size={16} />}
      {t("Message")}
      {name && (
        <span className="sr-only">
          {" "}
          <T>{name}</T>
        </span>
      )}
    </Button>
  );
}
