"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminInboxStartInput } from "@chartermission/contracts";
import { FormModal } from "@/components/ambassadors/modal";
import { inputClasses } from "@/components/form-field";
import { toast } from "@/components/toast";
import { ApiError, api, errorMessage } from "@/lib/api/client";
import { useT } from "@/i18n/client";

const MAX = 4000;

/**
 * "Message" on a member's row: writes to them as Charter Mission in their official conversation
 * (POST /admin/inbox/start, which continues the conversation if there is one), then opens it in the inbox.
 */
export function MessageMemberDialog({ member, onClose }: { member: { id: string; name: string }; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");

  return (
    <FormModal
      title={t("Message {name}", { name: member.name })}
      description="Sent as Charter Mission to their inbox. If you’ve written to them before, it continues that conversation."
      submitLabel="Send"
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={async () => {
        const text = body.trim();
        if (!text) {
          setError(t("Write a message"));
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const input: AdminInboxStartInput = { memberId: member.id, body: text };
          const result = await api<{ conversationId?: string } | undefined>("/admin/inbox/start", { method: "POST", body: input });
          toast(t("Message sent to {name}.", { name: member.name }));
          if (result?.conversationId) router.push(`/messages/inbox/${result.conversationId}`);
          else onClose();
        } catch (e) {
          setError(e instanceof ApiError && e.fields?.body ? e.fields.body : errorMessage(e));
          setBusy(false);
        }
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-label text-ink">Message</span>
        <textarea
          name="body"
          rows={6}
          autoFocus
          value={body}
          maxLength={MAX + 100}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          className={inputClasses(false, "resize-y")}
        />
        <span className="text-xs text-secondary">{t("{count} of {max} characters", { count: body.trim().length, max: MAX })}</span>
      </label>
    </FormModal>
  );
}
