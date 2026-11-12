"use client";

import { useEffect, useState } from "react";
import type { MessagesConfig } from "@chartermission/contracts";
import { Button, Icon, Panel } from "@chartermission/ui";
import { toast } from "@/components/social/toast";
import { useT } from "@/i18n/client";
import { api } from "@/lib/api/client";
import { disablePush, enablePush, pushState, type PushState } from "./push";

/** Settings card: message notifications on this device, while Charter Mission isn't open. */
export function PushSettings() {
  const t = useT();
  const [config, setConfig] = useState<MessagesConfig | null>(null);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<MessagesConfig>("/messages/config")
      .then(async (c) => {
        setConfig(c);
        setState(await pushState(c).catch(() => "unsupported" as const));
      })
      .catch(() => setState("unconfigured"));
  }, []);

  if (!state || state === "unconfigured") return null;

  async function change(on: boolean) {
    setBusy(true);
    try {
      setState(on && config ? await enablePush(config) : await disablePush());
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel aria-labelledby="push-heading" className="flex items-start gap-4 p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-tint text-primary">
        <Icon name="bell" size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id="push-heading" className="text-h3 text-ink">
          {t("Message notifications on this device")}
        </h2>
        <p className="text-sm text-secondary">
          {state === "unsupported"
            ? t("This browser can’t show notifications. On an iPhone, add Charter Mission to your Home Screen first.")
            : state === "denied"
              ? t("Notifications are blocked for this site. Allow them in your browser’s settings, then come back.")
              : t("Get a notification for new messages when Charter Mission isn’t open. If a message stays unread for a few hours, we also send an email.")}
        </p>
      </div>
      {(state === "on" || state === "off") && (
        <Button variant={state === "on" ? "secondary" : "primary"} size="small" disabled={busy} onClick={() => void change(state !== "on")}>
          {state === "on" ? t("Turn off") : t("Turn on")}
        </Button>
      )}
    </Panel>
  );
}
