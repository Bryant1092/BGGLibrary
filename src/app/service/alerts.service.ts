import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, of, switchMap } from 'rxjs';
import { collection, collectionData, doc, Firestore, limit, orderBy, query, setDoc, where } from '@angular/fire/firestore';
import { UserService } from './user.service';

/**
 * One "game is back" alert, kept for the Alerts tab (added 2026-11-20).
 * id = `${gameId}_${checkedInAt}`: the server and the app both save the same check-in under the
 * same id, so it's listed once whichever of them sent it (and a re-check never adds it again).
 */
export interface GameAlert {
  id: string;
  gameId: string;
  name: string;
  shelf: string;
  /** When the library recorded the check-in (ms). */
  checkedInAt: number;
  /** When the alert was sent (ms): what the badge counts and the list is sorted by. */
  createdAt: number;
  /** The check-in was typed in after a desk outage. */
  late?: boolean;
}

/** Alerts are kept this long (a convention, with room to spare) and at most MAX_ALERTS. */
export const ALERTS_KEEP_MS = 7 * 86_400_000;
const MAX_ALERTS = 100;
const SEEN_PREFIX = 'bgglibrary.alertsSeen.';
const GUEST_KEY = 'bgglibrary.alerts.guest';

/**
 * History of "game is back" alerts for the Alerts tab, and the tab's unread badge.
 *
 * Research behind it (2026-11-20, NN/g, Apple HIG, Material, design-system guidance):
 * - The badge counts only alerts not seen yet, and opening the tab clears it (no tapping each one).
 * - Only these alerts raise it, so it keeps meaning something ("red dot blindness").
 * - Items that arrived since you last looked keep a "new" dot until you leave the tab.
 *
 * Signed in: saved in users/{uid}/alerts (rules: create once, owner only), by the server when
 * it sends a push and by the app when it shows its own alert. Not signed in: on this phone.
 * "Seen" is per phone (localStorage): enough for a personal app, no extra writes.
 */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  private firestore = inject(Firestore);
  private account = 'guest';
  private guest = signal<GameAlert[]>(readJson<GameAlert[]>(GUEST_KEY, []));
  /** Newest first, last 7 days. */
  readonly alerts = signal<GameAlert[]>([]);
  /** createdAt of the newest alert seen when the Alerts tab was last opened. */
  readonly seenUntil = signal(0);
  readonly unseen = computed(() => this.alerts().filter(a => a.createdAt > this.seenUntil()).length);

  constructor() {
    inject(UserService).checkAuth().pipe(
      switchMap((user: any) => {
        this.account = user?.uid || 'guest';
        this.seenUntil.set(Number(readText(SEEN_PREFIX + this.account)) || 0);
        if (!user) return of(null);
        const since = Date.now() - ALERTS_KEEP_MS;
        return (collectionData(query(collection(this.firestore, 'users', user.uid, 'alerts'),
          where('createdAt', '>', since), orderBy('createdAt', 'desc'), limit(MAX_ALERTS)), { idField: 'id' }) as any)
          .pipe(catchError(() => of([])));
      }),
    ).subscribe((list: unknown) => {
      this.alerts.set((list as GameAlert[] | null) ?? this.recentGuest());
    });
  }

  /**
   * Saves an alert the app is showing (WatchService.alert). The server saves the ones it pushes;
   * the same id means each check-in is kept once. Never throws.
   */
  record(alert: Omit<GameAlert, 'id' | 'createdAt'>): void {
    const id = `${alert.gameId}_${alert.checkedInAt || 0}`;
    const full: GameAlert = { ...alert, id, createdAt: Date.now() };
    if (this.account === 'guest') {
      if (this.guest().some(a => a.id === id)) return;
      this.guest.set([full, ...this.guest()].slice(0, MAX_ALERTS));
      writeJson(GUEST_KEY, this.guest());
      this.alerts.set(this.recentGuest());
      return;
    }
    const { id: _, ...data } = full;
    // Create only: if the server already saved this check-in, the rules refuse the overwrite,
    // so it keeps its original time and isn't counted as new again.
    setDoc(doc(this.firestore, 'users', this.account, 'alerts', id), { ...data, late: !!data.late }).catch(() => { /* already saved */ });
  }

  /** Opening the Alerts tab: everything listed now counts as seen (clears the badge). */
  markSeen(): void {
    const newest = this.alerts()[0]?.createdAt ?? 0;
    if (newest <= this.seenUntil()) return;
    this.seenUntil.set(newest);
    writeText(SEEN_PREFIX + this.account, String(newest));
  }

  private recentGuest(): GameAlert[] {
    const since = Date.now() - ALERTS_KEEP_MS;
    return this.guest().filter(a => a.createdAt > since).sort((a, b) => b.createdAt - a.createdAt);
  }
}

function readText(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeText(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}
function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}
