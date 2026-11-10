/*
 * Articles are written on their own page (/articles/new), not in the create-post dialog.
 * These helpers build its address and carry over what a member had already typed in the dialog.
 */

/** The writing page: a new article, or an article draft (or scheduled article) to keep editing. */
export const writeArticleHref = (draftId?: string) => (draftId ? `/articles/new?draft=${draftId}` : "/articles/new");

const SEED_KEY = "cm:article-seed";

export type ArticleSeed = { text: string; pageId?: string };

/** Remember text typed in the post dialog, so the writing page can start from it. */
export function stashArticleSeed(seed: ArticleSeed) {
  try {
    if (seed.text || seed.pageId) sessionStorage.setItem(SEED_KEY, JSON.stringify(seed));
    else sessionStorage.removeItem(SEED_KEY);
  } catch {
    // Private browsing or storage turned off: the article simply starts empty.
  }
}

/** Reads the stashed text once (it is cleared, so a later visit starts empty). */
export function takeArticleSeed(): ArticleSeed | null {
  try {
    const raw = sessionStorage.getItem(SEED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SEED_KEY);
    const seed = JSON.parse(raw) as Partial<ArticleSeed>;
    return typeof seed.text === "string" ? { text: seed.text, pageId: typeof seed.pageId === "string" ? seed.pageId : undefined } : null;
  } catch {
    return null;
  }
}
