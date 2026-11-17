import { Injectable } from '@angular/core';
import { BggItem } from '../model/bgg.model';

/** Details younger than this are reused without asking the library again. */
const DETAILS_FRESH_MS = 2 * 60_000;
const STORAGE_KEY = 'bgglibrary.gameDetails';
/** About 1.6 KB each, so ~500 KB at most: well inside the ~5 MB localStorage allows. */
const MAX_SAVED = 300;
/** Older than this isn't worth showing (a different con, or long-gone checkouts). */
const MAX_SAVED_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Game details (players, time, shelf, availability), shared by My Lists and Friends' picks.
 *
 * Why: both views used to re-download every game each time they were opened. On
 * Friends' picks with a players / time filter on, that meant watching the list
 * re-filter one game at a time after every switch from My lists. Now details from
 * the last 2 minutes are reused, and older ones are shown immediately (players and
 * time never change) while fresh availability loads.
 *
 * Also saved on the phone (localStorage), so reopening the app shows My Lists right
 * away, already sorted into Available / Checked out from the last check, instead of
 * every row sitting on "Checking availability…" while each game is asked for one by
 * one (Tabletop.Events has no "these 30 games" request; reported 2026-11-16). The
 * fresh check still runs straight after, and the list shows how old the data is
 * ("Updated 3h ago") until it finishes. This is the stale-while-revalidate pattern.
 */
@Injectable({ providedIn: 'root' })
export class GameDetailsCache {
  private entries = new Map<string, { item: BggItem; at: number }>(this.load());
  /** Ids loaded from the phone's storage and not re-checked yet this session (see isFresh). */
  private fromStorage = new Set(this.entries.keys());
  private saveTimer?: ReturnType<typeof setTimeout>;

  items(): Map<string, BggItem> {
    return new Map([...this.entries].map(([id, entry]) => [id, entry.item]));
  }

  /**
   * Fetched in the last 2 minutes *while the app was open*. Details saved on the phone are
   * shown at once but never count as fresh: reopening the app always re-checks them. Without
   * this, tapping a "Kalypso is back" notification within 2 min of the last check reopened
   * My Lists still saying "Out" (found in testing, 2026-11-16).
   */
  isFresh(id: string): boolean {
    const entry = this.entries.get(id);
    return !!entry && !this.fromStorage.has(id) && Date.now() - entry.at < DETAILS_FRESH_MS;
  }

  /** When this game was last checked (ms), or undefined if never. */
  checkedAt(id: string): number | undefined {
    return this.entries.get(id)?.at;
  }

  set(id: string, item: BggItem): void {
    // Re-insert so Map order stays oldest-first, for trimming in save().
    this.entries.delete(id);
    this.fromStorage.delete(id);
    this.entries.set(id, { item, at: Date.now() });
    // A list's games arrive within a second or two: write them in one go, 1.5 s after the
    // first. Not "1.5 s after the last": in testing, steady updates kept pushing that save
    // back for 20+ s, so closing the app in that window lost the saved copy.
    if (this.saveTimer === undefined) {
      this.saveTimer = setTimeout(() => { this.saveTimer = undefined; this.save(); }, 1500);
    }
  }

  // localStorage can throw (private mode, full storage) or hold junk: never let that
  // break the lists; they just load from the library like before.
  private load(): [string, { item: BggItem; at: number }][] {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as [string, { item: BggItem; at: number }][];
      const cutoff = Date.now() - MAX_SAVED_AGE_MS;
      return Array.isArray(saved) ? saved.filter(([id, e]) => id && e?.item?.id && e.at > cutoff) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    const all = [...this.entries];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-MAX_SAVED)));
    } catch {
      // Storage full: keep only the newest half and try once more.
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-MAX_SAVED / 2))); } catch { /* fine without it */ }
    }
  }
}
