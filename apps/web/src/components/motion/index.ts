/**
 * Motion helpers for the member app. Everything here is decorative and honours
 * prefers-reduced-motion (effects switch off; CSS entrances become a plain fade).
 *
 * Imperative (call from event handlers):
 *   burst(el, { colors, count?, radius?, duration?, size? })  ring + sparks around an element
 *   pop(el, { scale?, duration? })                            scale pop of an icon
 *   confetti(el, { count?, duration?, colors? })              light shower out of a banner
 * React:
 *   <TickNumber value className? />                           count that ticks when it changes
 *   useReducedMotion(), prefersReducedMotion()
 * CSS utilities (apps/web/src/app/globals.css):
 *   motion-arrive (new card + fading ring), motion-fade-up (appended card), motion-pop,
 *   motion-shimmer (skeleton bone), motion-rise / motion-twinkle (illustrations),
 *   motion-tick-up / motion-tick-down. Use staggerStyle(i) for a staggered animation-delay.
 */
export { burst, pop, type BurstOptions } from "./burst";
export { BRAND_CONFETTI, confetti, type ConfettiOptions } from "./confetti";
export { canAnimate, prefersReducedMotion, useReducedMotion } from "./reduced-motion";
export { TickNumber } from "./tick-number";

/** `style` for the i-th item of a staggered entrance. */
export function staggerStyle(index: number, { step = 60, start = 0, max = 8 }: { step?: number; start?: number; max?: number } = {}) {
  return { animationDelay: `${start + Math.min(index, max) * step}ms` };
}
