/**
 * Brand illustrations and pattern (server-safe, no client JS).
 *   <Illustration name size? className? />   spot art: quiet, caught-up, no-results, drafts, questions, bookmarks, people
 *   illustrationForIcon                       EmptyState icon → illustration defaults
 *   <CaughtUpNote title? className?>text</CaughtUpNote>   compact end-of-list moment
 *   <BrandPattern tone? opacity? fade? size? className? />  absolute, click-through pattern layer
 *   <BrandCover variant="tint" | "navy" className?>…</BrandCover>  patterned placeholder (e.g. article without cover)
 *   brandPatternStyle({ fade?, size? }), BRAND_PATTERN_URL  raw style / mask url for custom surfaces
 */
export { CaughtUpNote } from "./caught-up";
export { Illustration, illustrationForIcon, type IllustrationName } from "./illustrations";
export { BRAND_PATTERN_URL, BrandCover, BrandPattern, brandPatternStyle, type PatternFade } from "./pattern";
