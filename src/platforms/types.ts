import type { Platform, PostState } from "../shared/types.ts";

/**
 * Everything that differs between two feeds, behind one interface.
 *
 * The content script owns the scan loop, the verdict application, and the messaging; an
 * adapter only answers "where are the posts, what is this one, and which element do I
 * decorate".
 */
export interface PlatformAdapter {
  readonly id: Platform;

  /**
   * Every post currently in the DOM.
   *
   * `container` is what gets the placeholder and the hide class — on X that is the
   * virtualized cell, on LinkedIn the update card. `article` is what gets scraped and
   * carries the badge.
   */
  findPosts(): { container: HTMLElement; article: HTMLElement }[];

  /**
   * Stable identity for this post, independent of the DOM node.
   *
   * Must survive node recycling: X reuses timeline cells for different posts as you
   * scroll, so anything derived from the element itself is wrong.
   */
  idOf(article: HTMLElement): string | null;

  scrape(article: HTMLElement, id: string): PostState;

  /** True for ads. Skipped entirely — never sent to the API. */
  isPromoted(article: HTMLElement): boolean;
}

export function cleanText(t: string): string {
  return t
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(…|\.\.\.)?\s*(see more|show more|…\s*more|more)\s*$/i, "")
    .trim();
}
