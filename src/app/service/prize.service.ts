import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { doc, Firestore, getDoc, serverTimestamp, setDoc, deleteDoc } from '@angular/fire/firestore';
import { ConInfoService } from './con-info.service';
import { UserService } from './user.service';
import { findPrizeBooth, findPrizeWins, normalizeBadge, PrizeBoothPlace, PrizeWin } from '../util/prize-drawing';

const BADGE_PREFIX = 'bgglibrary.badge.';
const SEEN_KEY = 'bgglibrary.prizeSeen';

/**
 * "Did I win the prize drawing?"
 *
 * You type your badge number once (Account). The app compares it with the winner
 * tables in BGG's news posts, which it already checks every 15 minutes, and shows a
 * "You won!" sheet with where to pick it up. Signed in, the number is also saved to
 * your account (prizeBadges/{uid}) so the server job sends a push notification when
 * the app is closed (functions/index.js, checkPrizeDrawings).
 *
 * The badge number is only readable by you (firestore.rules) and the server.
 */
@Injectable({ providedIn: 'root' })
export class PrizeService {
  private firestore = inject(Firestore);
  private userService = inject(UserService);
  private info = inject(ConInfoService);

  readonly badge = signal('');
  private seen = signal<Set<string>>(this.readSeen());
  private account = 'guest';

  /** Every win for your badge in this convention's posts, newest post first. */
  readonly wins = computed<PrizeWin[]>(() => findPrizeWins((this.info.posts() || []).map(p => ({ id: p.id, title: p.title, html: p.html })), this.badge()));
  /** Where BGG says the Prize Booth is this convention (newest post that says). */
  readonly booth = computed<PrizeBoothPlace>(() => findPrizeBooth(this.info.posts() || []));
  /** One line for the "You won!" sheet, in BGG's words when they gave the place. */
  readonly boothText = computed(() => {
    const b = this.booth();
    return b.quote
      ? `BGG says the Prize Booth is ${b.quote}. Bring your badge.`
      : "The Prize Booth has usually been in the Exhibit Hall. Ask at Registration if you can't find it. Bring your badge.";
  });

  /** Wins not shown yet: the first one is shown in the "You won!" sheet (AppComponent). */
  readonly unseen = computed(() => this.wins().filter(w => !this.seen().has(w.key)));

  /** Called once from AppComponent. */
  start(destroyRef: DestroyRef): void {
    this.userService.checkAuth().pipe(takeUntilDestroyed(destroyRef)).subscribe(async (user: any) => {
      this.account = user?.uid || 'guest';
      let badge = this.read(BADGE_PREFIX + this.account) || '';
      // A badge typed on another phone (same account) comes back from the account.
      if (user && !badge) {
        try {
          badge = (await getDoc(doc(this.firestore, 'prizeBadges', user.uid))).data()?.['badge'] || '';
          if (badge) this.write(BADGE_PREFIX + this.account, badge);
        } catch { /* offline: just this phone's copy */ }
      }
      this.badge.set(badge);
    });
  }

  /** Saves (or clears, with '') your badge number. */
  async setBadge(value: string): Promise<void> {
    const badge = normalizeBadge(value).slice(0, 6);
    this.badge.set(badge);
    this.write(BADGE_PREFIX + this.account, badge);
    const uid = this.userService.getCurrentUid();
    if (!uid) return;
    const ref = doc(this.firestore, 'prizeBadges', uid);
    // Keep the server's "already notified" list when the number stays the same.
    if (!badge) await deleteDoc(ref);
    else await setDoc(ref, { badge, at: serverTimestamp() }, { merge: true });
  }

  markSeen(win: PrizeWin): void {
    const next = new Set(this.seen()).add(win.key);
    this.seen.set(next);
    this.write(SEEN_KEY, JSON.stringify([...next].slice(-200)));
  }

  private readSeen(): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
  }
  private read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  private write(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* not remembered */ }
  }
}
