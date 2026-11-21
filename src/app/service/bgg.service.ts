import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BggItem } from '../model/bgg.model';
import { PLAYERS_TOP } from '../util/game-format';
import { correctGame } from '../util/game-corrections';
import { map, Observable, shareReplay, tap } from 'rxjs';

export interface SearchResult {
  result: {
    items: BggItem[];
    paging: { total_items: number; page_number: number; total_pages: number; next_page_number: number };
  }
}

/**
 * Sort choices. Tabletop.Events sorts by a single field only (no tiebreaker),
 * so e.g. "Available first" isn't alphabetical within each group. Each was
 * checked against the live API. Play time sorts were left out: the data has
 * placeholder values (1 minute, 1200 minutes) that would fill the top of the list.
 */
export type LibrarySort = 'name' | 'nameDesc' | 'availability' | 'popular' | 'newest' | 'returned';

const SORT_PARAMS: Record<LibrarySort, { orderBy: string; order: 'asc' | 'desc' }> = {
  name: { orderBy: 'name', order: 'asc' },
  nameDesc: { orderBy: 'name', order: 'desc' },
  availability: { orderBy: 'is_checked_out', order: 'asc' },
  // How many times the game has been checked out across past conventions.
  popular: { orderBy: 'checkout_count', order: 'desc' },
  // When the game was added to the library, so new arrivals come first.
  newest: { orderBy: 'date_created', order: 'desc' },
  // Most recently checked in first. Games just added to the library count as
  // "checked in" when added; the Library page labels those as new arrivals.
  returned: { orderBy: 'last_checkin_date', order: 'desc' },
};

/** Play-time filter choices; each maps to a Tabletop.Events `max_play_time` condition. */
export type PlayTimeFilter = 'upTo30' | 'upTo60' | 'over60';

export interface LibrarySearch {
  query: string;
  page: number;
  pageSize: number;
  /** Only games that can be checked out right now. */
  availableOnly: boolean;
  /** Only games that support exactly this many players. */
  players: number | null;
  playTime: PlayTimeFilter | null;
  sort: LibrarySort;
}

/**
 * Filters are sent to Tabletop.Events rather than applied to the loaded page,
 * so they cover the whole 8,500-game library, not just the 25 games on screen.
 * Each condition was checked against the live API:
 *  - preferred_players=N   games whose player range includes N
 *  - max_play_time=<=30    games that finish within 30 minutes
 *  - availability=available excludes checked-out games
 *  - _order_by=is_checked_out puts available games first
 */
const PLAY_TIME_CONDITIONS: Record<PlayTimeFilter, string> = {
  upTo30: '<=30',
  upTo60: '<=60',
  over60: '>60',
};

/** How long a game's live record is shared between callers (getBggGameInfo). */
const GAME_INFO_TTL_MS = 90_000;

@Injectable({
  providedIn: 'root'
})
export class BggService {

  libraryUrl = 'https://tabletop.events/api/library/0AEB11DA-2B7D-11EC-B400-855F800FD618/librarygames';
  itemUrl = (id: string) => `https://tabletop.events/api/librarygame/${id}`;

  constructor(private http: HttpClient) { }

  // Note: `_include_options=1` is not requested. It added the list of allowed
  // values for every field (~35% of each response), and the app never reads it.
  searchLibrary(search: LibrarySearch) {
    const sort = SORT_PARAMS[search.sort] || SORT_PARAMS.name;
    let params = new HttpParams()
        .append('_include', 'bgg_icon_uri')
        .append('_items_per_page', search.pageSize)
        .append('_order_by', sort.orderBy)
        .append('_page_number', search.page)
        .append('_sort_order', sort.order)
        .append('is_in_circulation', '1')
        .append('query', search.query || '');
    // "Just returned" is about what's on the shelf now, so games checked out
    // again since their return are left out even without "Available now".
    if (search.availableOnly || search.sort === 'returned') {
      params = params.append('availability', 'available');
    }
    if (search.players) {
      // "10+" = plays with 10 or more (max_players >= 10), so games for 12+ aren't left out.
      params = Number(search.players) >= PLAYERS_TOP
        ? params.append('max_players', `>=${PLAYERS_TOP}`)
        : params.append('preferred_players', search.players);
    }
    if (search.playTime) {
      params = params.append('max_play_time', PLAY_TIME_CONDITIONS[search.playTime]);
    }
    // correctGame: fills player counts / times the library left blank (util/game-corrections.ts).
    return this.http.get<SearchResult>(this.libraryUrl, {params}).pipe(
      map((r: any) => r?.result?.items ? { ...r, result: { ...r.result, items: r.result.items.map(correctGame) } } : r));
  }

  /**
   * Every copy of a game in the library (same name, exact), barcode order. For the Copies list in
   * game details (added 2026-11-19, after a desk outage left some copies' status unconfirmed).
   */
  copiesOf(game: Pick<BggItem, 'name'>): Observable<BggItem[]> {
    const name = (game.name || '').trim();
    const params = new HttpParams().append('query', name).append('_items_per_page', '50').append('is_in_circulation', '1');
    const same = (n?: string) => (n || '').trim().toLowerCase() === name.toLowerCase();
    return this.http.get<SearchResult>(this.libraryUrl, { params }).pipe(
      map((r: any) => ((r?.result?.items || []) as BggItem[]).filter(g => same(g.name))
        .sort((a, b) => (a.catalog_number || '').localeCompare(b.catalog_number || '', undefined, { numeric: true }))));
  }

  // Only the game's own fields are used. The related library object and
  // relationship links that were also requested made each response ~2.5x larger
  // (about 1.9 KB -> 0.76 KB), which adds up because the lists page requests one per game.
  /**
   * One game's live record. Answers are shared for GAME_INFO_TTL_MS: My Lists re-checks its
   * checked-out games every 2 minutes and the bell watcher checks the same games on its own
   * 2-minute timer, so without sharing the same game was often fetched twice (~100 requests
   * per 2 minutes on a 50-out list, 2026-11-20). A request already in flight is shared too.
   * Failed requests aren't kept. `forgetGameInfo()` drops everything (the refresh button).
   */
  getBggGameInfo(id: string): Observable<any> {
    const now = Date.now();
    const hit = this.gameInfo.get(id);
    if (hit && now - hit.at < GAME_INFO_TTL_MS) return hit.req;
    const params = new HttpParams()
        .append('_include', 'bgg_icon_uri');
    const req = this.http.get<BggItem>(this.itemUrl(id), {params}).pipe(
      map((r: any) => r?.result ? { ...r, result: correctGame(r.result) } : r),
      tap({ error: () => { if (this.gameInfo.get(id)?.req === req) this.gameInfo.delete(id); } }),
      shareReplay({ bufferSize: 1, refCount: false }));
    if (this.gameInfo.size > 400) {
      for (const [key, v] of this.gameInfo) if (now - v.at >= GAME_INFO_TTL_MS) this.gameInfo.delete(key);
    }
    this.gameInfo.set(id, { at: now, req });
    return req;
  }

  /** Next lookups go to Tabletop.Events again (a tap on "Refresh" wants it fresh). */
  forgetGameInfo(): void {
    this.gameInfo.clear();
  }

  private readonly gameInfo = new Map<string, { at: number; req: Observable<any> }>();
}
