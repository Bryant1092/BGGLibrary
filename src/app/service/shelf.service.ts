import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, map, mergeMap, Observable, of, shareReplay, Subject } from 'rxjs';
import { BggItem } from '../model/bgg.model';
import { BggService } from './bgg.service';

/** One game from a shelf list (built at deploy by scripts/build-shelf-index.mjs). */
export interface ShelfGame {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  minMinutes: number;
  maxMinutes: number;
  thumb: string;
}

export interface ShelfInfo {
  shelf: string;
  slug: string;
  count: number;
}

export interface ShelfIndex {
  builtAt: string;
  total: number;
  thumbHost: string;
  shelves: ShelfInfo[];
}

/** A row's live status counts as current for this long; scrolling back to it after that re-checks. */
const FRESH_MS = 2 * 60_000;
/** Status checks in flight at once: fast enough while scrolling, gentle on Tabletop.Events. */
const PARALLEL = 4;

/**
 * "Browse a shelf" data.
 *
 * Which games are on which shelf comes from lists built at deploy
 * (public/shelves/, see scripts/build-shelf-index.mjs), because Tabletop.Events
 * can't filter by shelf. Those lists never say whether a game is checked out:
 * that's fetched live, one game at a time, only for rows that scroll into view
 * (want()), and kept for two minutes. A 700-game shelf therefore costs a
 * handful of requests, not 700.
 *
 * The shelf files are cached by the service worker after first use
 * (ngsw-config "shelves" group), so a shelf opened once also works offline.
 */
@Injectable({ providedIn: 'root' })
export class ShelfService {
  private http = inject(HttpClient);
  private bgg = inject(BggService);

  /** Live game details by id (status, due time…), filled in as rows appear. */
  readonly live = signal<Map<string, BggItem>>(new Map());
  private fetchedAt = new Map<string, number>();
  private pending = new Set<string>();
  private queue = new Subject<string>();
  private index$?: Observable<ShelfIndex | null>;
  private shelves = new Map<string, Observable<ShelfGame[] | null>>();

  constructor() {
    this.queue.pipe(
      mergeMap(id => this.bgg.getBggGameInfo(id).pipe(
        map((r: any) => r?.result as BggItem | undefined),
        catchError(() => of(undefined)),
        map(item => ({ id, item }))
      ), PARALLEL)
    ).subscribe(({ id, item }) => {
      this.pending.delete(id);
      if (!item?.id) return; // offline or failed: the row keeps "Checking…" and retries when seen again
      this.fetchedAt.set(id, Date.now());
      this.live.update(m => new Map(m).set(id, item));
    });
  }

  /** Which shelves exist (letters, NEW, racks, bins) and how many games each has. */
  index(): Observable<ShelfIndex | null> {
    // Relative URL so it works under the app's base path (/BGGLibrary/ on GitHub Pages).
    return this.index$ ??= this.http.get<ShelfIndex>('shelves/index.json').pipe(
      catchError(() => { this.index$ = undefined; return of(null); }),
      shareReplay(1)
    );
  }

  /** The games on one shelf, A–Z. */
  games(info: ShelfInfo, thumbHost: string): Observable<ShelfGame[] | null> {
    let games$ = this.shelves.get(info.slug);
    if (!games$) {
      games$ = this.http.get<{ games: [string, string, number, number, number, number, string][] }>(`shelves/${info.slug}.json`).pipe(
        map(file => file.games.map(([id, name, minPlayers, maxPlayers, minMinutes, maxMinutes, thumb]) => ({
          id, name, minPlayers, maxPlayers, minMinutes, maxMinutes,
          // "~" stands for BGG's image host (stored once to keep the files small).
          thumb: thumb.startsWith('~') ? thumbHost + thumb.slice(1) : thumb,
        }))),
        catchError(() => { this.shelves.delete(info.slug); return of(null); }),
        shareReplay(1)
      );
      this.shelves.set(info.slug, games$);
    }
    return games$;
  }

  /** Asks for a game's live status (a row came into view). Skipped if fresh or already asked. */
  want(id: string): void {
    if (this.pending.has(id) || Date.now() - (this.fetchedAt.get(id) || 0) < FRESH_MS) return;
    this.pending.add(id);
    this.queue.next(id);
  }
}
