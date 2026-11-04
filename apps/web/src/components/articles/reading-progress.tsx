"use client";

import { useEffect, useRef, type RefObject } from "react";
import { cn } from "@chartermission/ui";
import { useReducedMotion } from "@/components/motion";

/**
 * Thin bar under the top nav showing how far through `target` the reader has read (a reading
 * line at mid-viewport moving through the body).
 * Decorative (hidden from assistive tech). Updates once per frame through a CSS transform;
 * the easing between updates is switched off under reduced motion.
 */
export function ReadingProgress({ target }: { target: RefObject<HTMLElement | null> }) {
  const barRef = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = target.current;
      const bar = barRef.current;
      if (!el || !bar) return;
      const rect = el.getBoundingClientRect();
      // How far a reading line in the middle of the viewport has moved through the body.
      const line = window.innerHeight / 2;
      const progress = Math.min(1, Math.max(0, (line - rect.top) / Math.max(1, rect.height)));
      bar.style.transform = `scaleX(${progress})`;
      bar.parentElement!.dataset.state = progress > 0 ? "reading" : "top";
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (target.current) observer?.observe(target.current);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [target]);

  return (
    <div
      aria-hidden="true"
      data-state="top"
      className="pointer-events-none fixed inset-x-0 top-16 z-30 h-[3px] bg-transparent transition-opacity data-[state=top]:opacity-0"
    >
      <span
        ref={barRef}
        data-reading-progress=""
        style={{ transform: "scaleX(0)" }}
        className={cn("block h-full w-full origin-left bg-accent", !reduced && "transition-transform duration-150 ease-out")}
      />
    </div>
  );
}
