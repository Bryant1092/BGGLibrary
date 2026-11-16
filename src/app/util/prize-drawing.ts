/**
 * Finds prize-drawing winners in BGG's news posts.
 *
 * Every BGG.CON since 2023 (and BGG.Spring) posts a "Daily Prize Drawing" each day
 * as an HTML table: Bundle # | Badge # | Name (checked against the 2023-2026 posts).
 * Winners must pick up the next day before the Exhibit Hall closes, or the prize
 * goes back into the drawing, and a winner's line is easy to miss in a long post.
 * Other tables with a Badge column (e.g. coloring-contest or big-group-game
 * winners) are prizes too, so any table with a Badge column counts.
 *
 * Plain string parsing (no DOM) so the same logic runs in the app and in the
 * server job (functions/index.js keeps a copy; change both together).
 */

export interface PrizeWin {
  /** Unique per post + table + row, for "already shown / already notified". */
  key: string;
  postId: string;
  postTitle: string;
  badge: string;
  /** "4" (bundle number) or the first column's value. */
  bundle: string;
  /** The heading above the table, e.g. "Daily Prize Drawing". */
  section: string;
  /** BGG's pickup sentence, e.g. "Thursday Drawing Winners go to the Prize Booth ... on Friday ...". */
  pickup: string;
}

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();

/** Badge numbers as printed (digits only, no leading zeros), so "0973" and "973" match. */
export function normalizeBadge(value: string): string {
  return (value || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

export function findPrizeWins(posts: { id: string; title: string; html: string }[], badgeInput: string): PrizeWin[] {
  const badge = normalizeBadge(badgeInput);
  if (!badge) return [];
  const wins: PrizeWin[] = [];
  for (const post of posts) {
    const html = post.html || '';
    let tableNo = 0;
    for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
      tableNo++;
      const rows = [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(r => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => strip(c[1])));
      if (rows.length < 2) continue;
      const header = rows[0];
      const badgeCol = header.findIndex(h => /badge/i.test(h));
      if (badgeCol < 0) continue;
      const bundleCol = header.findIndex(h => /bundle|prize|place|game\s*#/i.test(h));
      const before = html.slice(0, table.index);
      const heading = [...before.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].pop();
      const section = heading ? strip(heading[1]) : 'Prize drawing';
      const between = strip(heading ? before.slice(heading.index! + heading[0].length) : before.slice(-1500));
      const pickup = (between.match(/[^.]*\bwinners? go to the prize booth[^.]*\.(?:[^.]*\bnot picked up[^.]*\.)?/i)?.[0]
        || between.match(/[^.]*\bpick(?:ed)?\s*-?\s*up[^.]*\./i)?.[0] || '').trim();
      rows.slice(1).forEach((cells, i) => {
        if (normalizeBadge(cells[badgeCol] || '') !== badge) return;
        wins.push({
          key: `${post.id}:${tableNo}:${i}`,
          postId: post.id,
          postTitle: post.title,
          badge,
          bundle: (bundleCol >= 0 ? cells[bundleCol] : cells[0] !== cells[badgeCol] ? cells[0] : '') || '',
          section,
          pickup,
        });
      });
    }
  }
  return wins;
}
