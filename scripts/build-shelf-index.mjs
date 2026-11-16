#!/usr/bin/env node
/**
 * Builds the shelf lists used by "Browse a shelf" on the Library page:
 *   public/shelves/index.json        which shelves exist and how many games each has
 *   public/shelves/<shelf>.json      the games on one shelf, A–Z
 *
 * Why this exists: Tabletop.Events can't filter or sort the library by shelf
 * (the "Location" field). Checked Nov 2026: `custom_fields.Location=…`,
 * `Location=…` and `_order_by=Location` are all ignored or rejected. The only
 * way to know which games are on, say, CARD RACK is to download the whole
 * catalog (~9,000 games, ~90 requests) and look. That's too slow for a phone
 * on convention Wi-Fi, so it's done here, once per deploy, and the app ships
 * the result (~1 MB in total, split per shelf so a shelf loads ~10–90 KB).
 *
 * The lists hold only what rarely changes (name, players, time, thumbnail).
 * Whether a game is checked out is always fetched live when its row appears.
 * Games added to the library after this ran won't be listed until the next
 * deploy, so run it again shortly before and during the convention:
 *
 *   npm run shelves        (then build and deploy as usual)
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';

const LIBRARY = 'https://tabletop.events/api/library/0AEB11DA-2B7D-11EC-B400-855F800FD618/librarygames';
const PAGE_SIZE = 100; // Tabletop.Events' maximum; larger values silently fall back to 25.
const PARALLEL = 4;    // Be gentle with Tabletop.Events' servers.
const OUT = new URL('../public/shelves/', import.meta.url);
/**
 * 99% of thumbnails are on BGG's image host; storing that start once (as "~")
 * instead of 9,000 times makes the files about a quarter smaller. The app
 * puts it back (ShelfService).
 */
const THUMB_HOST = 'https://cf.geekdo-images.com/';

async function getPage(page, attempt = 1) {
  const params = new URLSearchParams({
    _items_per_page: PAGE_SIZE, _page_number: page, _order_by: 'name', is_in_circulation: '1', _include: 'bgg_icon_uri',
  });
  try {
    const res = await fetch(`${LIBRARY}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.result;
  } catch (err) {
    if (attempt >= 3) throw new Error(`Page ${page} failed: ${err.message}`);
    await new Promise(r => setTimeout(r, 1500 * attempt));
    return getPage(page, attempt + 1);
  }
}

/** File name for a shelf: "CARD RACK NEW" -> "card-rack-new", "#" -> "num". */
export function shelfSlug(shelf) {
  return shelf === '#' ? 'num' : shelf.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
}

/**
 * Shelf order: the library files games ignoring leading punctuation ("¡Adiós
 * Calavera!" is on A) and a leading "A", "An" or "The" ("A Carnivore Did It!"
 * is on C). Must match letterOf() in shelf-list.component.ts.
 */
function sortKey(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^[^a-z0-9]+/i, '').replace(/^(the|an|a)\s+/i, '').toLowerCase();
}

const first = await getPage(1);
const pages = Number(first.paging.total_pages) || 1;
const items = [...first.items];
console.log(`Downloading ${first.paging.total_items} games (${pages} pages)…`);
for (let start = 2; start <= pages; start += PARALLEL) {
  const batch = [];
  for (let p = start; p < start + PARALLEL && p <= pages; p++) batch.push(getPage(p));
  for (const result of await Promise.all(batch)) items.push(...result.items);
  process.stdout.write(`\r  ${Math.min(start + PARALLEL - 1, pages)}/${pages} pages`);
}
console.log();

const byShelf = new Map();
for (const g of items) {
  const shelf = (g.custom_fields?.Location || '').trim() || 'Unknown';
  if (!byShelf.has(shelf)) byShelf.set(shelf, []);
  // Compact rows: [id, name, minPlayers, maxPlayers, minMinutes, maxMinutes, thumbnail]
  byShelf.get(shelf).push([
    g.id, (g.name || '').trim(), Number(g.min_players) || 0, Number(g.max_players) || 0,
    Number(g.min_play_time) || 0, Number(g.max_play_time) || 0, (g.bgg_icon_uri || '').replace(THUMB_HOST, '~'),
  ]);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const builtAt = new Date().toISOString();
const shelves = [];
for (const [shelf, games] of byShelf) {
  games.sort((a, b) => sortKey(a[1]).localeCompare(sortKey(b[1])));
  const slug = shelfSlug(shelf);
  shelves.push({ shelf, slug, count: games.length });
  await writeFile(new URL(`${slug}.json`, OUT), JSON.stringify({ shelf, builtAt, games }));
}
shelves.sort((a, b) => a.shelf.localeCompare(b.shelf));
await writeFile(new URL('index.json', OUT), JSON.stringify({ builtAt, total: items.length, thumbHost: THUMB_HOST, shelves }, null, 1));

/*
 * search.json: every game in one file, for the Library's search box (LocalSearchService).
 *
 * Why: Tabletop.Events' name search took 11-60 s per search on 2026-11-16 (simple
 * requests stayed under 0.5 s), and con Wi-Fi is often overloaded. Searching this list
 * on the phone is instant and works offline; each row still gets its live status
 * (Available / Out) from Tabletop.Events, one fast request per game on screen.
 * The service worker downloads it in the background at install/update
 * (ngsw-config "search" group), so it's on the phone before anyone searches.
 *
 * Rows: [id, name, minPlayers, maxPlayers, minMinutes, maxMinutes, thumbnail, shelf,
 *        added (Unix seconds; for "Newest"), all-time checkouts (for "Most played")]
 */
const tteSeconds = value => value ? Math.round(new Date(String(value).trim().replace(' ', 'T') + 'Z').getTime() / 1000) || 0 : 0;
const searchRows = items.map(g => [
  g.id, (g.name || '').trim(), Number(g.min_players) || 0, Number(g.max_players) || 0,
  Number(g.min_play_time) || 0, Number(g.max_play_time) || 0, (g.bgg_icon_uri || '').replace(THUMB_HOST, '~'),
  (g.custom_fields?.Location || '').trim(), tteSeconds(g.date_created), Number(g.checkout_count) || 0,
]).sort((a, b) => sortKey(a[1]).localeCompare(sortKey(b[1])));
await writeFile(new URL('search.json', OUT), JSON.stringify({ builtAt, thumbHost: THUMB_HOST, games: searchRows }));
console.log(`Wrote search.json (${searchRows.length} games)`);
console.log(`Wrote ${shelves.length} shelves (${items.length} games) to public/shelves/:`);
console.log(shelves.map(s => `${s.shelf}=${s.count}`).join(', '));
