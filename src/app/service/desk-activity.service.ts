import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { deskDownSince } from '../util/desk-state';
import { ConCheckoutsService } from './con-checkouts.service';
import { libraryOpenSince } from '../util/library-time';
import { parseTteDate } from '../util/time-ago';

/** No checkout or check-in recorded for this long while the library is open = the desk isn't scanning. */
export const DESK_STALE_AFTER_MS = 30 * 60_000;
/** Timestamps further ahead than this are bad data, not activity. */
const FUTURE_SLACK_MS = 5 * 60_000;

/**
 * Whether the library desk is recording checkouts and check-ins in Tabletop.Events.
 *
 * Added 2026-11-19 (BGG.CON day 2): the desk's scanning went down and staff wrote barcodes
 * by hand for hours. Tabletop.Events still answered normally, so the app showed games as
 * Available / Out from the moment scanning stopped, with nothing saying so.
 *
 * Tabletop.Events has no "is the desk working" flag, and its sort by checkout / check-in time
 * failed during that outage, so it can't simply be asked for the latest scan. Instead this
 * keeps the newest checkout or check-in time from two places the app already has:
 * - every library game in any Tabletop.Events answer (tteResilience calls note()), and
 * - the server's "Most played" ranking, saved whenever it sees new checkouts (every 10 min).
 * Either one moving forward clears the warning, so a single working signal is enough.
 */
@Injectable({ providedIn: 'root' })
export class DeskActivity {
  private conCheckouts = inject(ConCheckoutsService);
  private seen = signal(0);
  private now = signal(Date.now());

  /** Newest checkout or check-in the app knows about (ms), or 0 if none yet. */
  readonly newest = computed(() => Math.max(this.seen(), this.conCheckouts.updatedAt() ?? 0));

  /**
   * When scanning last worked, if the library is open and nothing has been recorded for
   * DESK_STALE_AFTER_MS; otherwise null. Counted from opening time at the earliest, so the
   * quiet overnight hours never trigger it, and only once the app has some activity to go by.
   */
  readonly staleSince = computed<number | null>(() => {
    const now = this.now();
    const newest = this.newest();
    const openSince = libraryOpenSince(now);
    if (openSince == null || !newest) return null;
    return now - Math.max(newest, openSince) >= DESK_STALE_AFTER_MS ? newest : null;
  });

  constructor() {
    effect(() => deskDownSince.set(this.staleSince()));
    const tick = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  /** Reads checkout / check-in times from a Tabletop.Events answer (a list or a single game). */
  note(body: unknown): void {
    const result = (body as any)?.result;
    if (!result) return;
    const items: any[] = Array.isArray(result.items) ? result.items : [result];
    const limit = Date.now() + FUTURE_SLACK_MS;
    let newest = this.seen();
    for (const g of items) {
      if (!g || !('last_checkout_date' in g)) continue; // not a library game
      for (const v of [g.last_checkout_date, g.last_checkin_date]) {
        const t = parseTteDate(v)?.getTime() ?? 0;
        if (t > newest && t <= limit) newest = t;
      }
    }
    if (newest > this.seen()) this.seen.set(newest);
  }
}
