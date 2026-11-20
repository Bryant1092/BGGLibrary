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
  /** What to call it: "Daily drawing #2" or e.g. "Big Group Game winners". */
  label: string;
  /** The heading above the table, e.g. "Daily Prize Drawing". */
  section: string;
  /** True for the daily badge drawing (numbered); false for other prizes in the same posts. */
  daily: boolean;
  postedAt: number;
  /** BGG's own deadline when the post states one ("not picked up by 6PM on Friday"), else null. */
  statedDeadline: number | null;
  /** Your row in it, or null (no win, or no badge number to check). */
  win: PrizeWin | null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * "not picked up by 6PM on Friday" → that Friday 6 PM Dallas time (the first Friday after the
 * drawing day). null when the text gives no clock time and weekday.
 */
export function statedPickupDeadline(text: string, postedAt: number): number | null {
  const m = text.match(/\bby\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?\s+(?:on\s+)?(sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)[a-z]*/i);
  if (!m) return null;
  let hour = Number(m[1]) % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0);
  const minute = Number(m[2] || 0);
  const want = WEEKDAYS.findIndex(d => d.startsWith(m[4].toLowerCase().slice(0, 3)));
  // Walk forward from the day after the drawing (posts before 6 AM belong to the day before).
  const drawing = new Date(postedAt - 6 * 3600_000);
  for (let i = 1; i <= 7; i++) {
    const day = new Date(drawing.getTime() + i * 86_400_000);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(day);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).format(day).toLowerCase();
    if (WEEKDAYS.indexOf(weekday) !== want) continue;
    // That date at hour:minute in Dallas: start from UTC noon and correct by the zone offset.
    const [y, mo, d] = key.split('-').map(Number);
    const guess = Date.UTC(y, mo - 1, d, hour, minute);
    const offset = Date.parse(new Date(guess).toLocaleString('en-US', { timeZone: 'UTC' })) - Date.parse(new Date(guess).toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    return guess + offset;
  }
  return null;
}

/** "Winners for Today's Players of The Big Group Game at the Con are:" → "Big Group Game winners". */
function otherPrizeLabel(text: string): string {
  const phrase = text.match(/winners?\s+(?:for|of)\s+([^.:]{3,80}?)\s+(?:are|is)\s*:/i)?.[1] || '';
  const named = phrase.replace(/^(?:today'?s|tonight'?s|the)\s+/i, '').replace(/^players\s+of\s+(?:the\s+)?/i, '').replace(/\s+at\s+the\s+con$/i, '').trim();
  return named ? `${named.replace(/^the\s+/i, '')} winners` : 'Other prize';
}

/**
 * Every prize drawing BGG has posted, newest first, each with your win if any (Account lists
 * them so "no win" is visible, not just silence; added 2026-11-20).
 *
 * BGG puts more than the daily drawing under the "Daily Prize Drawing" heading: on 2026-11-19
 * the post also listed the Big Group Game winners (a different desk and a 6 PM deadline). The
 * daily drawing is the table with a Bundle column; the others are named from BGG's "Winners for
 * … are:" line. Daily drawings are numbered in the order they were posted.
 */
export function findPrizeDrawings(posts: { id: string; title: string; html: string; postedAt: number }[], badgeInput: string): PrizeDrawing[] {
  const wins = findPrizeWins(posts, badgeInput);
  const all: PrizeDrawing[] = [];
  for (const post of [...posts].sort((a, b) => a.postedAt - b.postedAt)) {
    const html = post.html || '';
    let tableNo = 0, lastEnd = 0;
    for (const table of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
      tableNo++;
      const start = table.index!;
      const context = strip(html.slice(lastEnd, start));
      lastEnd = start + table[0].length;
      const first = table[0].match(/<tr[\s\S]*?<\/tr>/i)?.[0] || '';
      const header = [...first.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => strip(c[1]));
      if (!header.some(h => /badge/i.test(h))) continue;
      const heading = [...html.slice(0, start).matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].pop();
      const section = heading ? strip(heading[1]) : 'Prize drawing';
      const other = /winners?\s+(?:for|of)\s+[^.:]{3,80}?\s+(?:are|is)\s*:/i.test(context) && !header.some(h => /bundle/i.test(h));
      const prefix = `${post.id}:${tableNo}:`;
      all.push({ key: `${post.id}:${tableNo}`, postId: post.id, postTitle: post.title, postedAt: post.postedAt, section,
        daily: !other, label: other ? otherPrizeLabel(context) : '', statedDeadline: statedPickupDeadline(context, post.postedAt),
        win: wins.find(w => w.key.startsWith(prefix)) ?? null });
    }
  }
  let n = 0;
  for (const d of all) if (d.daily) d.label = `Daily drawing #${++n}`;
  return all.reverse();
}
