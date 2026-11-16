import { Injectable } from '@angular/core';
import { BggItem } from '../model/bgg.model';

/** Details younger than this are reused without asking the library again. */
const DETAILS_FRESH_MS = 2 * 60_000;

/**
 * Game details (players, time, shelf, availability) kept while the app is open,
 * shared by My Lists and Friends' picks.
 *
 * Why: both views used to re-download every game each time they were opened. On
 * Friends' picks with a players / time filter on, that meant watching the list
 * re-filter one game at a time after every switch from My lists. Now details from
 * the last 2 minutes are reused, and older ones are shown immediately (players and
 * time never change) while fresh availability loads.
 */
@Injectable({ providedIn: 'root' })
export class GameDetailsCache {
  private entries = new Map<string, { item: BggItem; at: number }>();

  items(): Map<string, BggItem> {
    return new Map([...this.entries].map(([id, entry]) => [id, entry.item]));
  }

  isFresh(id: string): boolean {
    const entry = this.entries.get(id);
    return !!entry && Date.now() - entry.at < DETAILS_FRESH_MS;
  }

  set(id: string, item: BggItem): void {
    this.entries.set(id, { item, at: Date.now() });
  }
}
