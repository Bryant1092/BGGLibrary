import { currentOrNextConvention } from './library-time';

/**
 * Hot Games matching. The list in config/conventions.ts is typed in by hand
 * from the BGG.CON page, while library titles carry edition text, e.g.
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

function hotGameTitles(now: number): string[] {
  const convention = currentOrNextConvention(now);
  return convention?.hasHotGames ? convention.hotGames || [] : [];
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
