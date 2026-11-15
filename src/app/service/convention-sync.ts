import { HttpClient, HttpParams } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, firstValueFrom, forkJoin, map, of, timeout } from 'rxjs';
import { BGG_LIBRARY_ID, Convention, CONVENTION_OVERRIDES, CONVENTIONS, LIBRARY_HOURS, LibraryDay } from '../config/conventions';
import { dallasDateKey, dallasTimeKey } from '../util/library-time';
import { parseTteDate } from '../util/time-ago';

/**
 * Keeps CONVENTIONS up to date from Tabletop.Events, so nobody has to type in
 * next year's dates, hours or convention id (the app developer's request: plug
 * into their API instead of editing the app twice a year).
 *
 * How:
 * - Searches Tabletop.Events for "BGG.CON" and "BGG.Spring" (2 small requests)
 *   and keeps those that use the BGG library and aren't cancelled. Checked Nov
 *   2026: the search returns every year back to 2021 with exact dates; the
 *   `library_id` filter is ignored by the API, so it's checked here instead.
 * - Library days come from the convention's start and end (UTC, converted to
 *   Dallas time) with the LIBRARY_HOURS pattern; CONVENTION_OVERRIDES wins.
 * - The result replaces the contents of CONVENTIONS in place, so every existing
 *   caller (status badge, due times, Events tab) sees it without changes.
 * - A copy is kept on the phone. Startup uses that copy immediately and
 *   refreshes in the background; only a phone with no copy waits (at most 2.5 s)
 *   so the first screen already shows the right convention.
 */

const API = 'https://tabletop.events/api/convention';
const CACHE_KEY = 'bgglibrary.conventions';
/** Searched names. Both events are run by BGG with the same library. */
const SERIES = ['BGG.CON', 'BGG.Spring'];
/** Past conventions older than this are dropped (the most recent one is always kept). */
const KEEP_PAST_MS = 30 * 24 * 60 * 60_000;

interface TteConvention {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  library_id: string | null;
  cancelled: number | string;
}

/** Turns Tabletop.Events conventions into the app's library schedule. Exported for tests. */
export function conventionsFromTte(items: TteConvention[], now = Date.now()): Convention[] {
  const built = items
    .filter(c => c.library_id === BGG_LIBRARY_ID && Number(c.cancelled) !== 1 && SERIES.some(s => c.name?.startsWith(s)))
    .map(c => {
      const start = parseTteDate(c.start_date)?.getTime();
      const end = parseTteDate(c.end_date)?.getTime();
      if (!start || !end || end < start) return null;
      const convention: Convention = {
        name: c.name.trim(),
        tteConventionId: c.id,
        // Only BGG.CON has the Hot Games room (BGG.Spring's library page doesn't list it).
        hasHotGames: c.name.startsWith('BGG.CON'),
        days: libraryDays(start, end),
      };
      return { ...convention, ...CONVENTION_OVERRIDES[convention.name] };
    })
    .filter((c): c is Convention => !!c && c.days.length > 0)
    .sort((a, b) => a.days[0].date.localeCompare(b.days[0].date));

  // Keep upcoming conventions, ones that ended recently, and always the latest past one
  // (the Account tab and the "See you next time" status fall back to it).
  const todayKey = dallasDateKey(now);
  const recentKey = dallasDateKey(now - KEEP_PAST_MS);
  const past = built.filter(c => c.days[c.days.length - 1].date < todayKey);
  return built.filter(c => c.days[c.days.length - 1].date >= recentKey || c === past[past.length - 1]);
}

/** One library day per Dallas calendar day from the convention's start to its end. */
function libraryDays(start: number, end: number): LibraryDay[] {
  const first = dallasDateKey(start);
  const last = dallasDateKey(end);
  const days: LibraryDay[] = [];
  // Date-only arithmetic in UTC avoids daylight-saving surprises.
  for (let d = new Date(first + 'T12:00:00Z'); days.length < 14; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    if (date > last) break;
    days.push({
      date,
      open: date === first ? dallasTimeKey(start) : LIBRARY_HOURS.otherDaysOpen,
      close: date === last ? LIBRARY_HOURS.lastDayClose : LIBRARY_HOURS.close,
    });
  }
  return days;
}

/** Swaps the list's contents, keeping the same array that every caller imported. */
function apply(list: Convention[]): void {
  if (!list.length) return;
  CONVENTIONS.splice(0, CONVENTIONS.length, ...list);
}

function readCache(): Convention[] | null {
  try {
    const list = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return Array.isArray(list) && list.every(c => c?.name && Array.isArray(c.days) && c.days.length) ? list : null;
  } catch {
    return null;
  }
}

function writeCache(list: Convention[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch { /* storage full or blocked: the fallback list still works */ }
}

/**
 * App initializer (app.config.ts). Overrides are re-applied to the saved copy
 * too, so an override added in a new release takes effect right away.
 */
export function syncConventions(): Promise<void> {
  const http = inject(HttpClient);
  const cached = readCache();
  if (cached) apply(cached.map(c => ({ ...c, ...CONVENTION_OVERRIDES[c.name] })));

  const request = forkJoin(SERIES.map(query => http.get<any>(API, {
    params: new HttpParams().set('query', query).set('_items_per_page', 50),
  }).pipe(map(r => (r?.result?.items || []) as TteConvention[])))).pipe(
    map(lists => conventionsFromTte(lists.flat())),
    timeout(cached ? 20_000 : 2_500),
    // Offline or Tabletop.Events down: keep the saved copy or the built-in list.
    catchError(() => of([] as Convention[])),
  );
  const done = firstValueFrom(request).then(list => {
    if (!list.length) return;
    apply(list);
    writeCache(list);
  });
  // With a saved copy, startup doesn't wait; the refresh lands in the background.
  return cached ? Promise.resolve() : done;
}
