"use client";

/**
 * A short-lived, fixed, click-through overlay for particle effects. Lives on <body> so
 * nothing in the card (overflow, stacking, layout) is touched; removed when every
 * animation in it has finished (with a timer as a backstop).
 */
export function createLayer(x: number, y: number): HTMLDivElement {
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.motionLayer = "";
  Object.assign(layer.style, {
    position: "fixed",
    left: `${x}px`,
    top: `${y}px`,
    width: "0",
    height: "0",
    pointerEvents: "none",
    zIndex: "60",
    contain: "layout style",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(layer);
  return layer;
}

export function piece(layer: HTMLElement, style: Partial<CSSStyleDeclaration>): HTMLSpanElement {
  const el = document.createElement("span");
  Object.assign(el.style, { position: "absolute", left: "0", top: "0", willChange: "transform, opacity" }, style);
  layer.appendChild(el);
  return el;
}

/** Remove the layer once its animations finish (or after `maxMs`, whichever is first). */
export function cleanUp(layer: HTMLElement, animations: Animation[], maxMs: number) {
  const remove = () => layer.remove();
  const timer = window.setTimeout(remove, maxMs + 250);
  void Promise.allSettled(animations.map((a) => a.finished)).then(() => {
    window.clearTimeout(timer);
    remove();
  });
}

export const random = (min: number, max: number) => min + Math.random() * (max - min);
