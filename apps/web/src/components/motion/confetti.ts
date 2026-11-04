"use client";

import { cleanUp, createLayer, piece, random } from "./layer";
import { canAnimate } from "./reduced-motion";

/** Charter Mission brand confetti: orange, navy, blue, amber, green. */
export const BRAND_CONFETTI = [
  "var(--color-accent)",
  "var(--color-primary)",
  "var(--color-primary-light)",
  "var(--color-warning)",
  "var(--color-accent-hover)",
  "var(--color-success)",
];

export type ConfettiOptions = {
  /** Pieces (default 30). */
  count?: number;
  /** Duration of the shower in ms (default 1200). */
  duration?: number;
  /** CSS colours (default BRAND_CONFETTI). */
  colors?: string[];
};

const running = new WeakSet<Element>();

/**
 * A light confetti shower that pops up out of `origin` (e.g. a milestone banner) and falls
 * around it. Click-through, cleaned up after, at most one at a time per origin; does nothing
 * under reduced motion.
 */
export function confetti(origin: Element | null | undefined, { count = 30, duration = 1200, colors = BRAND_CONFETTI }: ConfettiOptions = {}) {
  if (!origin || !canAnimate() || running.has(origin)) return;
  const rect = origin.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) return;
  running.add(origin);
  const layer = createLayer(rect.left, rect.top);
  const animations: Animation[] = [];
  const gravity = 520; // px/s²

  for (let i = 0; i < count; i += 1) {
    const shape = i % 3; // 0 rectangle, 1 square, 2 dot
    const w = shape === 0 ? random(5, 7) : shape === 1 ? random(5, 6.5) : random(4.5, 6);
    const h = shape === 0 ? w * random(1.6, 2.2) : w;
    const x0 = rect.width * random(0.12, 0.88);
    const y0 = rect.height * random(0.25, 0.6);
    // Spread outward from the banner's centre line, mostly upward first.
    const side = (x0 / rect.width - 0.5) * 2;
    const vx = side * random(60, 170) + random(-40, 40);
    const vy = -random(160, 300);
    const spin = random(260, 720) * (Math.random() < 0.5 ? -1 : 1);
    const flip = random(1, 3) * 180;
    const life = (duration / 1000) * random(0.75, 1);
    const el = piece(layer, {
      width: `${w}px`,
      height: `${h}px`,
      marginLeft: `${-w / 2}px`,
      marginTop: `${-h / 2}px`,
      background: colors[i % colors.length],
      borderRadius: shape === 2 ? "9999px" : "1.5px",
    });
    const frames: Keyframe[] = [];
    const steps = 8;
    for (let s = 0; s <= steps; s += 1) {
      const t = (s / steps) * life;
      const x = x0 + vx * t;
      const y = y0 + vy * t + 0.5 * gravity * t * t;
      const p = s / steps;
      frames.push({
        transform: `translate(${x}px, ${y}px) rotate(${spin * p}deg) rotateX(${flip * p}deg) scale(${s === 0 ? 0.3 : 1})`,
        opacity: p > 0.72 ? Math.max(0, 1 - (p - 0.72) / 0.28) : 1,
        offset: p,
      });
    }
    animations.push(el.animate(frames, { duration: life * 1000, delay: random(0, 120), easing: "linear", fill: "forwards" }));
  }
  cleanUp(layer, animations, duration + 150);
  void Promise.allSettled(animations.map((a) => a.finished)).then(() => running.delete(origin));
}
