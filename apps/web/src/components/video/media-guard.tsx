"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Whether the element is on screen; an <audio> (usually hidden behind custom controls) counts by its container. */
const visible = (node: Element): boolean => {
  const el = node.tagName === "AUDIO" && node.parentElement ? node.parentElement : node;
  return isShown(el);
};
const isShown = (el: Element) =>
  el.isConnected && (typeof (el as HTMLElement).checkVisibility === "function" ? (el as HTMLElement).checkVisibility() : (el as HTMLElement).offsetParent !== null);

/** Stops a playing embedded player (YouTube, Vimeo…) by reloading it, which leaves it paused at its start screen. */
function stopEmbed(frame: HTMLIFrameElement) {
  const src = frame.src;
  frame.src = "about:blank";
  frame.src = src.replace(/([?&])autoplay=1(&|$)/, "$1autoplay=0$2");
}

/**
 * Nothing keeps playing out of sight: videos, voice notes and embedded players pause when the
 * browser tab is hidden, and when the member moves to another page (pages they left stay mounted
 * but hidden, so their media would otherwise play on).
 */
export function MediaGuard() {
  const pathname = usePathname();

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((m) => !m.paused && m.pause());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    // After the new page is shown and the old one hidden.
    const timer = window.setTimeout(() => {
      document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((m) => {
        if (!m.paused && !visible(m)) m.pause();
      });
      document.querySelectorAll<HTMLIFrameElement>("iframe[data-media-embed]").forEach((f) => {
        if (!visible(f)) stopEmbed(f);
      });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  // Tabs inside a page (and anything else that hides a playing video without a page change).
  useEffect(() => {
    const timer = window.setInterval(() => {
      document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((m) => {
        if (!m.paused && !visible(m)) m.pause();
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return null;
}
