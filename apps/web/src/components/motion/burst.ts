"use client";

import { cleanUp, createLayer, piece, random } from "./layer";
import { canAnimate } from "./reduced-motion";

export type BurstOptions = {
  /** CSS colours, e.g. "var(--color-success)". The first is the ring; particles cycle through all. */
  colors: string[];
  /** Number of particles (default 8). */
  count?: number;
  /** How far particles travel from the centre, in px (default 22). */
  radius?: number;
  /** Total duration in ms (default 520). */
  duration?: number;
  /** Particle size in px (default 4). */
  size?: number;
};

/**
 * A small radial burst (ring + sparks) centred on `target`, e.g. a reaction icon.
 * Fire-and-forget, click-through, cleaned up after; does nothing under reduced motion.
 */
export function burst(target: Element | null | undefined, { colors, count = 8, radius = 22, duration = 520, size = 4 }: BurstOptions) {
  if (!target || !canAnimate() || !colors.length) return;
  const rect = target.getBoundingClientRect();
  const layer = createLayer(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const animations: Animation[] = [];

  const ringSize = 8;
  const ring = piece(layer, {
    width: `${ringSize}px`,
    height: `${ringSize}px`,
    marginLeft: `${-ringSize / 2}px`,
    marginTop: `${-ringSize / 2}px`,
    borderRadius: "9999px",
    border: `1.5px solid ${colors[0]}`,
  });
  const ringScale = (radius * 1.7) / ringSize;
  animations.push(
    ring.animate(
      [
        { transform: "scale(0.6)", opacity: 0.7 },
        { transform: `scale(${ringScale})`, opacity: 0 },
      ],
      { duration: duration * 0.8, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "forwards" },
    ),
  );

  const offset = random(0, Math.PI * 2);
  for (let i = 0; i < count; i += 1) {
    const angle = offset + (i / count) * Math.PI * 2 + random(-0.18, 0.18);
    const distance = radius * random(0.85, 1.2);
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    const spark = i % 2 === 1;
    const w = spark ? size * 1.9 : size;
    const h = spark ? Math.max(1.5, size * 0.55) : size;
    const rotate = `${(angle * 180) / Math.PI}deg`;
    const el = piece(layer, {
      width: `${w}px`,
      height: `${h}px`,
      marginLeft: `${-w / 2}px`,
      marginTop: `${-h / 2}px`,
      borderRadius: "9999px",
      background: colors[i % colors.length],
    });
    animations.push(
      el.animate(
        [
          { transform: `translate(0, 0) rotate(${rotate}) scale(0.4)`, opacity: 0 },
          { transform: `translate(${dx * 0.35}px, ${dy * 0.35}px) rotate(${rotate}) scale(1)`, opacity: 1, offset: 0.2 },
          { transform: `translate(${dx}px, ${dy}px) rotate(${rotate}) scale(0.8)`, opacity: 0.9, offset: 0.7 },
          { transform: `translate(${dx * 1.12}px, ${dy * 1.12}px) rotate(${rotate}) scale(0.2)`, opacity: 0 },
        ],
        { duration, delay: random(0, 40), easing: "cubic-bezier(0.15, 0.75, 0.3, 1)", fill: "forwards" },
      ),
    );
  }
  cleanUp(layer, animations, duration + 60);
}

/** Scale "pop" on an element (an icon that was just chosen). Does nothing under reduced motion. */
export function pop(target: Element | null | undefined, { scale = 1.3, duration = 420 }: { scale?: number; duration?: number } = {}) {
  if (!target || !canAnimate()) return;
  target.animate(
    [
      { transform: "scale(1)" },
      { transform: `scale(${scale})`, offset: 0.35 },
      { transform: "scale(0.92)", offset: 0.68 },
      { transform: "scale(1)" },
    ],
    { duration, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" },
  );
}
