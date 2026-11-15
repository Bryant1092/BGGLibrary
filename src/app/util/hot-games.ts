import { currentOrNextConvention } from './library-time';

/**
 * Hot Games matching. The list comes from BGG's news post (see
 * hotGamesFromPosts), plus any titles typed into config/conventions.ts, while library titles carry edition text, e.g.
 * "Black Rose Wars: Rebirth (English edition)". Normalizing both sides
 * (lowercase, no accents, no punctuation, no bracketed edition text) lets the
 * short title match the library one.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // é -> e
    .toLowerCase()
    .replace(/[([][^)\]]*[)\]]/g, ' ')                // drop "(English edition)"
    .replace(/[^\p{L}\p{N}]+/gu, ' ')                 // punctuation -> space
    .trim();
}

/** Titles read from the convention's news feed (set by ConInfoService). */
let newsHotGames: string[] = [];

export function setNewsHotGames(titles: string[]): void {
  newsHotGames = titles;
}

/**
 * Finds the Hot Games list in the convention's news posts, newest post first.
 *
 * BGG posts the final list on Tabletop.Events a few days before BGG.CON. In
 * 2025 it was in "We're so close, it's Scary!!!!" (Nov 18): a "Hot Games"
 * heading, two notes, then a bulleted list of titles linked to BGG. So: find a
 * heading that says Hot Games, then the first bulleted list after it and before
 * the next heading or divider, with at least 5 entries (shorter lists are
 * likely something else, e.g. a table of contents). Returns [] until it's posted.
 */
export function hotGamesFromPosts(posts: { html: string }[]): string[] {
  if (typeof DOMParser === 'undefined') return [];
  const parser = new DOMParser();
  for (const post of posts) {
    if (!/hot games/i.test(post.html)) continue;
    // DOMParser builds an inert document: no scripts run and no images load.
    const doc = parser.parseFromString(post.html, 'text/html');
    for (const heading of Array.from(doc.querySelectorAll('h1, h2, h3, h4'))) {
      if (!/hot games/i.test(heading.textContent || '')) continue;
      for (let el = heading.nextElementSibling; el && !/^(H[1-4]|HR)$/.test(el.tagName); el = el.nextElementSibling) {
        const list = el.matches('ul, ol') ? el : el.querySelector('ul, ol');
        const titles = list ? Array.from(list.querySelectorAll('li'))
          .map(li => (li.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(t => t.length > 1 && t.length < 120) : [];
        if (titles.length >= 5) return titles;
      }
    }
  }
  return [];
}

function hotGameTitles(now: number): string[] {
  const convention = currentOrNextConvention(now);
  if (!convention?.hasHotGames) return [];
  // News list plus any titles added by hand in config/conventions.ts.
  return [...newsHotGames, ...(convention.hotGames || [])];
}

/** Hot Games whose title contains the search (3+ characters), at most 3. */
export function matchHotGames(query: string, now: number = Date.now()): string[] {
  const q = normalizeTitle(query);
  if (q.length < 3) return [];
  return hotGameTitles(now).filter(title => normalizeTitle(title).includes(q)).slice(0, 3);
}

/** True when a library game is also on the Hot Games tables. */
export function isHotGame(libraryTitle: string, now: number = Date.now()): boolean {
  const name = normalizeTitle(libraryTitle);
  return hotGameTitles(now).some(title => normalizeTitle(title) === name);
}
