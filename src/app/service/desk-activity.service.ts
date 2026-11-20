import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { deskDownSince, deskManual } from '../util/desk-state';
import { NoticeService } from './notice.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { doc, docData, Firestore } from '@angular/fire/firestore';
import { catchError, Observable, of } from 'rxjs';
import { ConCheckoutsService } from './con-checkouts.service';
import { libraryOpenSince } from '../util/library-time';
import { parseTteDate } from '../util/time-ago';

interface DeskStatusDoc { lastScanAt?: { toMillis(): number }; catchUpUntil?: { toMillis(): number }; outageFrom?: { toMillis(): number } }

/** Alerts during catch-up wait this long after the check-in, like the server (functions ALERT_HOLD_MS). */
export const ALERT_HOLD_MS = 10 * 60_000;

/** The server's catch-up window after an outage (functions CATCH_UP_MS). */
const CATCH_UP_MS = 90 * 60_000;
/** Copies not scanned since an outage are flagged for this long after it (one con day). */
const UNCONFIRMED_FOR_MS = 12 * 3600_000;

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
 * keeps the newest checkout or check-in time from three places the app already has:
 * - every library game in any Tabletop.Events answer (tteResilience calls note()), and
 * - the server's "Most played" ranking, saved whenever it sees new checkouts (every 10 min).
 * - the server's desk watcher (meta/deskStatus), which needs no sorting: added the same evening.
 * Any one moving forward clears the warning, so a single working signal is enough.
 */
@Injectable({ providedIn: 'root' })
export class DeskActivity {
  private conCheckouts = inject(ConCheckoutsService);
  private notice = inject(NoticeService);
  /** Owner's manual desk-down switch is on (different wording: no reliable "as of" time). */
  readonly manual = computed(() => this.notice.deskDownSince() != null);
  private seen = signal(0);
  /** meta/deskStatus (functions/index.js, checkDesk): when the server last saw the checked-out count change. */
  private status = toSignal(
    (docData(doc(inject(Firestore), 'meta', 'deskStatus')) as Observable<DeskStatusDoc | undefined>)
      .pipe(catchError(() => of(undefined))),
  );
  private serverScan = computed(() => this.status()?.lastScanAt?.toMillis?.() ?? 0);
  /**
   * End of the server's catch-up window after an outage (0 if none): check-ins typed in from the
   * backlog. WatchService waits ALERT_HOLD_MS before alerting on those, like the server.
   */
  readonly catchUpUntil = computed(() => this.status()?.catchUpUntil?.toMillis?.() ?? 0);
  private outageFrom = computed(() => this.status()?.outageFrom?.toMillis?.() ?? 0);

  /**
   * Copies whose last scan (check-in or checkout) is older than this may not be where Tabletop.Events
   * says: during the outage, checkouts and returns went on paper and not all were typed in
   * (2026-11-19: three "available" copies weren't on the shelf). A copy scanned after scanning
   * came back is confirmed. While the desk is down that's every copy (now). After an outage, the
   * time scanning came back, for UNCONFIRMED_FOR_MS; null otherwise.
   */
  readonly unconfirmedBefore = computed<number | null>(() => {
    const now = this.now();
    if (this.staleSince() != null) return now;
    const until = this.catchUpUntil();
    if (!this.outageFrom() || !until) return null;
    const back = until - CATCH_UP_MS; // the server's catch-up window starts when scanning resumes
    return back > this.outageFrom() && now - back < UNCONFIRMED_FOR_MS ? back : null;
  });
  private now = signal(Date.now());

  /** Newest checkout or check-in the app knows about (ms), or 0 if none yet. */
  readonly newest = computed(() => Math.max(this.seen(), this.conCheckouts.updatedAt() ?? 0, this.serverScan()));

  /**
   * When scanning last worked, if the library is open and nothing has been recorded for
   * DESK_STALE_AFTER_MS; otherwise null. Counted from opening time at the earliest, so the
   * quiet overnight hours never trigger it, and only once the app has some activity to go by.
   */
  readonly staleSince = computed<number | null>(() => {
    // The owner's switch wins: Tabletop.Events can look live while staff type in a paper backlog.
    const manual = this.notice.deskDownSince();
    if (manual != null) return manual;
    const now = this.now();
    const newest = this.newest();
    const openSince = libraryOpenSince(now);
    if (openSince == null || !newest) return null;
    return now - Math.max(newest, openSince) >= DESK_STALE_AFTER_MS ? newest : null;
  });

  constructor() {
    effect(() => deskDownSince.set(this.staleSince()));
    effect(() => deskManual.set(this.notice.deskDownSince() != null));
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
