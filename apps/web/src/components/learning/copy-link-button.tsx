"use client";

import { useState } from "react";
import { Icon, buttonClasses, cn } from "@chartermission/ui";
import { absoluteUrl } from "@/components/social/links";
import { toast } from "@/components/social/toast";

/** Share: the native share sheet where there is one (phones), otherwise copy the link. */
export function CopyLinkButton({ path, title, className }: { path: string; title: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = absoluteUrl(path);
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied");
    } catch {
      toast.error(new Error("We couldn’t copy the link. Copy it from the address bar instead."));
    }
  }

  return (
    <button type="button" onClick={share} className={buttonClasses({ variant: "secondary", className: cn(className) })}>
      <Icon name={copied ? "check" : "share"} size={18} />
      {copied ? "Copied" : "Share"}
      <span className="sr-only"> {title}</span>
    </button>
  );
}
