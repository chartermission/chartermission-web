"use client";

import { useEffect, useRef, useState } from "react";
import type { ShareTarget } from "@chartermission/contracts";
import { Button, Icon, buttonClasses, cn } from "@chartermission/ui";
import { openSendInMessage } from "@/components/messages/share-dialog";
import { Dialog, closeDialog } from "@/components/social/dialog";
import { absoluteUrl } from "@/components/social/links";
import { NoTranslate } from "@/i18n/auto";
import { useT } from "@/i18n/client";

const EVENT = "cm:share";

/** What is being shared. `path` is the site path (/events/x); `text` is the line that goes with it on X, WhatsApp… */
export type ShareRequest = {
  path: string;
  title: string;
  text?: string;
  /** Lets members also send it in a message. */
  send?: ShareTarget;
  /** Events and chapters: shared through the member's own invitation link, so newcomers land on an invitation and the sharer gets the credit. */
  invite?: { event: string } | { chapter: string };
  /** "Share to feed" (events), when the viewer can. */
  shareToFeed?: () => void;
};

/** Opens the share dialog from anywhere on a page that has a ShareHost (member and guest pages). */
export function openShare(request: ShareRequest) {
  window.dispatchEvent(new CustomEvent<ShareRequest>(EVENT, { detail: request }));
}

/** Mounted once per page layout. `inviterHandle` is the signed-in member (null for visitors). */
export function ShareHost({ inviterHandle }: { inviterHandle: string | null }) {
  const [request, setRequest] = useState<ShareRequest | null>(null);
  useEffect(() => {
    const on = (e: Event) => setRequest((e as CustomEvent<ShareRequest>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!request) return null;
  return <ShareDialog key={request.path} request={request} inviterHandle={inviterHandle} onClose={() => setRequest(null)} />;
}

/** The address to share: the page itself, or for events and chapters the sharer's invitation link. */
export function shareUrl(request: Pick<ShareRequest, "path" | "invite">, inviterHandle: string | null): string {
  if (request.invite && inviterHandle) {
    const params = new URLSearchParams({ from: inviterHandle, ...request.invite });
    return absoluteUrl(`/invite?${params.toString()}`);
  }
  return absoluteUrl(request.path);
}

const clip = (text: string, max: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

type Network = { id: string; name: string; href: (url: string, text: string, title: string) => string };

/** Each network's own "share a link" address. They read the page's preview (title, summary, picture) themselves. */
export const NETWORKS: Network[] = [
  { id: "linkedin", name: "LinkedIn", href: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` },
  { id: "x", name: "X", href: (url, text) => `https://x.com/intent/tweet?text=${encodeURIComponent(clip(text, 200))}&url=${encodeURIComponent(url)}` },
  { id: "facebook", name: "Facebook", href: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
  { id: "whatsapp", name: "WhatsApp", href: (url, text) => `https://wa.me/?text=${encodeURIComponent(`${clip(text, 300)}\n${url}`)}` },
  { id: "telegram", name: "Telegram", href: (url, text) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(clip(text, 300))}` },
];

function ShareDialog({ request, inviterHandle, onClose }: { request: ShareRequest; inviterHandle: string | null; onClose: () => void }) {
  const t = useT();
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  // Only ever rendered in the browser (it opens on a click), so the share sheet can be checked here.
  const [canShareSheet] = useState(() => typeof navigator !== "undefined" && typeof navigator.share === "function");
  const url = shareUrl(request, inviterHandle);
  const text = request.text?.trim() || request.title;
  const member = !!inviterHandle;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      inputRef.current?.select();
    }
  }

  const close = () => closeDialog(bodyRef.current);
  const mail = `mailto:?subject=${encodeURIComponent(clip(request.title, 120))}&body=${encodeURIComponent(`${clip(text, 500)}\n\n${url}`)}`;
  const tile = "flex min-h-[44px] items-center gap-2.5 rounded-[10px] border border-line bg-card px-3 py-2 text-sm font-medium text-ink hover:border-primary-light hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-light/40";

  return (
    <Dialog title={t("Share")} description={<NoTranslate>{clip(request.title, 140)}</NoTranslate>} onClose={onClose} width={500} initialFocus="[data-share-copy]">
      <div ref={bodyRef} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="share-link" className="text-sm font-medium text-ink">
            Link
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              id="share-link"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-body outline-none focus:border-primary-light"
            />
            <Button data-share-copy onClick={() => void copy()} className="shrink-0">
              <Icon name={copied ? "check" : "copy"} size={16} />
              {copied ? t("Copied") : t("Copy")}
            </Button>
          </div>
          <p role="status" className="sr-only">
            {copied ? t("Link copied to clipboard") : ""}
          </p>
          {request.invite && member && (
            <p className="text-xs text-secondary">People who are new to Charter Mission see your invitation first. You’re credited when they join.</p>
          )}
        </div>

        <section aria-labelledby="share-on" className="flex flex-col gap-2">
          <h3 id="share-on" className="text-sm font-medium text-ink">
            Share on
          </h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {NETWORKS.map((n) => (
              <li key={n.id}>
                <a href={n.href(url, text, request.title)} target="_blank" rel="noopener noreferrer" onClick={close} className={tile} data-network={n.id}>
                  <NoTranslate>
                    <span className="flex-1 truncate">{n.name}</span>
                  </NoTranslate>
                  <Icon name="arrow-up-right" size={16} className="shrink-0 text-secondary rtl:-scale-x-100" />
                  <span className="sr-only"> {t("(opens in a new tab)")}</span>
                </a>
              </li>
            ))}
            <li>
              <a href={mail} onClick={close} className={tile} data-network="email">
                <span className="flex-1 truncate">Email</span>
                <Icon name="mail" size={16} className="shrink-0 text-secondary" />
              </a>
            </li>
          </ul>
          {canShareSheet && (
            <button
              type="button"
              onClick={() => {
                void navigator.share({ title: request.title, text, url }).then(close, () => undefined);
              }}
              className={cn(tile, "justify-center")}
            >
              <Icon name="share" size={16} className="text-secondary" />
              More apps…
            </button>
          )}
        </section>

        {member && (request.send || request.shareToFeed) && (
          <section aria-labelledby="share-inside" className="flex flex-col gap-2">
            <h3 id="share-inside" className="text-sm font-medium text-ink">
              On Charter Mission
            </h3>
            <div className="flex flex-wrap gap-2">
              {request.shareToFeed && (
                <button
                  type="button"
                  className={buttonClasses({ variant: "secondary", size: "small" })}
                  onClick={() => {
                    const open = request.shareToFeed!;
                    close();
                    open();
                  }}
                >
                  <Icon name="edit" size={16} />
                  {t("Share to feed")}
                </button>
              )}
              {request.send && (
                <button
                  type="button"
                  className={buttonClasses({ variant: "secondary", size: "small" })}
                  onClick={() => {
                    close();
                    openSendInMessage(request.send!);
                  }}
                >
                  <Icon name="send" size={16} />
                  {t("Send in a message")}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}

/** A Share button that opens the dialog. */
export function ShareOutButton({
  request,
  variant = "ghost",
  size,
  className,
  label,
}: {
  request: ShareRequest;
  variant?: "ghost" | "secondary" | "primary";
  size?: "small";
  className?: string;
  label?: string;
}) {
  const t = useT();
  return (
    <button type="button" onClick={() => openShare(request)} className={buttonClasses({ variant, size, className })}>
      <Icon name="share" size={16} />
      {label ?? t("Share")}
    </button>
  );
}
