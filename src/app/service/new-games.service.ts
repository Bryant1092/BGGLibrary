import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal, computed } from '@angular/core';
import { BggItem } from '../model/bgg.model';
import { parseTteDate } from '../util/time-ago';

/**
 * "New in the library" (asked 2026-11-23; mockup row 10 on the canvas). BGG adds games in batches
 * 1–2 months before each con (Sep 2026: 772 copies, Nov 2026: 571, almost nothing Dec–Apr), so
 * between cons this shows what arrived since you last looked, to plan lists early.
 *
 * - The Library's "New" chip is the existing "Newest" sort (date added), grouped by week.
 * - "Since your last visit" is per phone (localStorage), like Alerts: no account writes.
 *   The count = different games (copies of one game count once) added after you last opened
 *   the New view. Opening it marks everything seen; this visit still tags them NEW.
 * - One small request (100 newest copies) at most every 30 minutes, straight to Tabletop.Events
 *   from the phone: free on the Spark plan, no server.
 */
const SEEN_KEY = 'bl.newGamesSeenAt';
const CHECK_EVERY_MS = 30 * 60 * 1000;
/** First time on this phone: count the last week, so the feature isn't empty on day one. */
const FIRST_LOOK_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class NewGamesService {
  private http = inject(HttpClient);
  private url = 'https://tabletop.events/api/library/0AEB11DA-2B7D-11EC-B400-855F800FD618/librarygames';

  /** When the New view was last opened on this phone (ms). */
  readonly seenAt = signal(this.readSeen());
  /** seenAt as it was before this visit's opening of the New view: rows added after it get the NEW tag. */
  readonly tagSince = signal(this.seenAt());
  private newest = signal<BggItem[]>([]);
  private lastCheck = 0;

  /** Different games (copies once) added since the last visit. */
  readonly count = computed(() => {
    const since = this.seenAt();
    const names = new Set<string>();
    for (const g of this.newest()) {
      if ((parseTteDate(g.date_created)?.getTime() || 0) > since) names.add((g.name || '').trim().toLowerCase());
    }
    return names.size;
  });

  /** Asks Tabletop.Events for the newest copies, unless it did in the last 30 minutes. */
  refresh(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastCheck < CHECK_EVERY_MS) return;
    this.lastCheck = now;
    const params = new HttpParams()
      .append('_order_by', 'date_created').append('_sort_order', 'desc')
      .append('_items_per_page', '100').append('is_in_circulation', '1');
    this.http.get<any>(this.url, { params }).subscribe({
      next: r => this.newest.set(r?.result?.items || []),
      error: () => { this.lastCheck = 0; }, // try again next time instead of waiting 30 minutes
    });
  }

  /** Opening the New view: keep this visit's NEW tags, and count from now next time. */
  markSeen(): void {
    this.tagSince.set(this.seenAt());
    const now = Date.now();
    this.seenAt.set(now);
    try { localStorage.setItem(SEEN_KEY, String(now)); } catch { /* private mode: count resets */ }
  }

  private readSeen(): number {
    try {
      const saved = Number(localStorage.getItem(SEEN_KEY));
      if (saved > 0) return saved;
    } catch { /* ignore */ }
    return Date.now() - FIRST_LOOK_MS;
  }
}
