import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { correctRow } from '../util/game-corrections';

/** One game in the saved search list (public/shelves/search.json). */
export interface SearchGame {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  minMinutes: number;
  maxMinutes: number;
  thumb: string;
  shelf: string;
  /** When it was added to the library (ms), for "Newest". */
  added: number;
  /** All-time checkouts, for "Most played (all time)". */
  checkouts: number;
  /** Name for matching: no accents or punctuation, lowercase, padded with spaces. */
  key: string;
}

/** "Ádiós, Calavera!" -> " adios calavera ": accents, case and punctuation don't matter. */
export function searchKey(text: string): string {
  return ' ' + text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

/**
 * The Library's search box, searched on the phone.
 *
 * Why (2026-11-16): Tabletop.Events' name search took 11-60 s per search while simple
 * requests stayed under 0.5 s, and con Wi-Fi is often overloaded. Offline-first apps
 * read from a local copy and use the network to add live details; results within
 * 0.1 s feel instant (Nielsen's response-time limits). Matching 9,000 names here takes
 * a few milliseconds, so no search library is needed.
 *
 * The list (search.json, built with the shelf lists by scripts/build-shelf-index.mjs)
 * is downloaded by the service worker in the background at install/update, so it's
 * on the phone before the first search and works with no signal. Live status
 * (Available / Out) still comes from Tabletop.Events per game on screen (ShelfService).
 */
@Injectable({ providedIn: 'root' })
export class LocalSearchService {
  private http = inject(HttpClient);
  private games: SearchGame[] = [];
  /** The list is loaded and searchable. */
  readonly ready = signal(false);
  private loading = false;

  constructor() {
    this.load();
  }

  /** Loads the list once (again later if it failed, e.g. offline before it was ever saved). */
  load(): void {
    if (this.ready() || this.loading) return;
    this.loading = true;
    // Relative URL so it works under the app's base path (/BGGLibrary/ on GitHub Pages).
    this.http.get<{ thumbHost: string; games: [string, string, number, number, number, number, string, string, number, number][] }>('shelves/search.json')
      .subscribe({
        next: file => {
          // correctRow: fills player counts / times the library left blank (util/game-corrections.ts).
          this.games = file.games.map(([id, name, minPlayers, maxPlayers, minMinutes, maxMinutes, thumb, shelf, added, checkouts]) => correctRow({
            id, name, minPlayers, maxPlayers, minMinutes, maxMinutes, shelf,
            thumb: thumb.startsWith('~') ? file.thumbHost + thumb.slice(1) : thumb,
            added: (added || 0) * 1000, checkouts: checkouts || 0, key: searchKey(name),
          }));
          this.loading = false;
          this.ready.set(true);
        },
        error: () => { this.loading = false; },
      });
  }

  /**
   * Games whose name contains every word typed, in any order ("dragon dice" finds
   * "Dice & Dragons"). A–Z, the same order as the saved list.
   */
  /** Every saved game, A–Z: the Library list while Tabletop.Events can't be reached. */
  all(): SearchGame[] {
    return this.ready() ? this.games : [];
  }

  search(query: string): SearchGame[] {
    const words = searchKey(query).trim().split(' ').filter(Boolean);
    if (!words.length || !this.ready()) return [];
    return this.games.filter(g => words.every(w => g.key.includes(w)));
  }
}
