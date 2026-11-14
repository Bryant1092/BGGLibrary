import { Injectable, signal } from '@angular/core';
import { BggItem } from '../model/bgg.model';

export interface RecentGame {
  item: BggItem;
  viewedAt: number;
}

const STORAGE_KEY = 'bgglibrary.recentlyViewed';
/** Enough to cover the handful of games people keep re-checking at a con. */
const MAX_RECENT = 8;

/**
 * Games the user opened recently, shown at the top of the Library while the
 * search box is empty, because at a con people keep re-checking the same few
 * games ("is Ark Nova back yet?").
 *
 * Saved on this device (localStorage) with the game's last known details, so
 * the list appears instantly; the Library re-checks their status when shown.
 */
@Injectable({ providedIn: 'root' })
export class RecentService {
  readonly games = signal<RecentGame[]>(this.load());

  /** Called when a game's details are opened. Moves it to the top if already there. */
  add(item: BggItem): void {
    const rest = this.games().filter(g => g.item.id !== item.id);
    this.save([{ item, viewedAt: Date.now() }, ...rest].slice(0, MAX_RECENT));
  }

  /** Swaps in freshly fetched details without changing the order or "viewed" times. */
  refresh(item: BggItem): void {
    if (this.games().some(g => g.item.id === item.id)) {
      this.save(this.games().map(g => g.item.id === item.id ? { ...g, item } : g));
    }
  }

  clear(): void {
    this.save([]);
  }

  private save(games: RecentGame[]): void {
    this.games.set(games);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
    } catch { /* storage blocked: the list lasts until the app is closed */ }
  }

  private load(): RecentGame[] {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter(g => g?.item?.id).slice(0, MAX_RECENT) : [];
    } catch {
      return [];
    }
  }
}
