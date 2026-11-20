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

/** Where BGG says the Prize Booth is this convention. */
export interface PrizeBoothPlace {
  /** Which map spot to show: the Registration desk, the exhibit hall, or not stated. */
  where: 'registration' | 'hall' | 'unknown';
  /** BGG's own words, e.g. "Prize Booth - located up near the Registration/Information Desk". */
  quote: string;
}

/**
 * Reads the Prize Booth's location from the convention's posts, newest first, so a
 * move announced mid-con wins. Only location wording counts ("Prize Booth (in the
 * Exhibit Hall)", "Prize Booth - located up near the Registration/Information Desk");
 * "pickup at the Prize Booth on Thursday when the Exhibit Hall opens" is about time,
 * not place, and is ignored. Checked on 2023-2026: 2023-2025 say Exhibit Hall,
 * 2026 says Registration/Information Desk.
 */
export function findPrizeBooth(posts: { html: string }[]): PrizeBoothPlace {
  const re = /prize booth\s*(?:[-–—(:,]\s*)*(?:is\s+)?(?:now\s+)?(?:located\s+)?(?:up\s+|right\s+|over\s+)?(?:near|by|next to|beside|inside|in|at)\s+(?:the\s+)?([^.)\n]{3,70})/i;
  for (const post of posts) {
    const m = strip(post.html || '').match(re);
    if (!m) continue;
    const place = m[1];
    const where = /regist|information|info desk/i.test(place) ? 'registration' : /exhibit|marsalis|hall/i.test(place) ? 'hall' : 'unknown';
    // Posts often run straight on into the next item (no full stop), so keep the
    // wording only up to the place name itself.
    const short = place.match(/^.*?(registration\s*\/\s*information desk|information desk|registration(?: desk| area)?|exhibit hall|marsalis hall [ab]?)/i)?.[0] ?? place.split(/\s+/).slice(0, 6).join(' ');
    const quote = (m[0].slice(0, m[0].length - m[1].length) + short).replace(/^prize booth\s*[-–—(:,]*\s*/i, '').replace(/\s+/g, ' ').trim();
    return { where, quote };
  }
  return { where: 'unknown', quote: '' };
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

/** One posted drawing (a table with a Badge column), with your win in it if any. */
export interface PrizeDrawing {
  key: string;
  postId: string;
  postTitle: string;
  /** The heading above the table, e.g. "Thursday Prize Drawing". */
  section: string;
  postedAt: number;
  /** Your row in it, or null (no win, or no badge number to check). */
  win: PrizeWin | null;
}

/**
 * Every prize drawing BGG has posted, newest first, each with your win if any (Account lists
 * them so "no win" is visible, not just silence; added 2026-11-20).
 */
export function findPrizeDrawings(posts: { id: string; title: string; html: string; postedAt: number }[], badgeInput: string): PrizeDrawing[] {
  const wins = findPrizeWins(posts, badgeInput);
  const drawings: PrizeDrawing[] = [];
  for (const post of [...posts].sort((a, b) => b.postedAt - a.postedAt)) {
    const html = post.html || '';
    let tableNo = 0;
    const found: PrizeDrawing[] = [];
    for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
      tableNo++;
      const first = table[0].match(/<tr[\s\S]*?<\/tr>/i)?.[0] || '';
      const header = [...first.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => strip(c[1]));
      if (!header.some(h => /badge/i.test(h))) continue;
      const heading = [...html.slice(0, table.index).matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].pop();
      const prefix = `${post.id}:${tableNo}:`;
      found.push({ key: `${post.id}:${tableNo}`, postId: post.id, postTitle: post.title, postedAt: post.postedAt,
        section: heading ? strip(heading[1]) : 'Prize drawing', win: wins.find(w => w.key.startsWith(prefix)) ?? null });
    }
    // Tables in a post read top to bottom; newest first overall means the last table first.
    drawings.push(...found.reverse());
  }
  return drawings;
}
