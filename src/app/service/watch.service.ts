import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, EMPTY, firstValueFrom, of, switchMap, tap } from 'rxjs';
import { collection, collectionData, deleteDoc, doc, Firestore, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { BggItem } from '../model/bgg.model';
import { BggService } from './bgg.service';
import { ToastService } from './toast.service';
import { UserService } from './user.service';
import { PushService } from './push.service';
import { parseTteDate } from '../util/time-ago';
import { formatLibraryTime } from '../util/library-time';

/** A game someone tapped the bell on, waiting for it to come back. */
export interface WatchedGame {
  id: string;
  name: string;
  shelf: string;
}

/** How often to check watched games while the app is open. */
const CHECK_EVERY_MS = 2 * 60_000;
const STORAGE_PREFIX = 'bgglibrary.watches.';
/** Per account: automatic bells for list games on/off, and games whose bell you turned off. */
const AUTO_PREFIX = 'bgglibrary.autoAlerts.';
const MUTED_PREFIX = 'bgglibrary.mutedAlerts.';
const ASK_DISMISSED_KEY = 'bgglibrary.notifyAskDismissed';

/**
 * "Notify me when it's back" bells.
 *
 * - Signed in: bells are saved to your account (users/{uid}/watches), so the
 *   server job (functions/index.js) can check them every 2 minutes and send a
 *   push notification even when the app is closed; it removes a bell once it
 *   fires, and the app sees that live. Bells saved on the phone before this
 *   are moved to the account once, then the phone copy is dropped (otherwise a
 *   bell the server already fired would be re-added from the phone).
 * - Signed out: bells stay on this device (localStorage), app-open alerts only.
 * - While the app is open, watched games are checked every 2 minutes and
 *   whenever the app comes back to the foreground.
 * - When one is available again: an in-app message, plus a phone notification
 *   if permission was given (most useful when the app is in a background tab).
 * - Each bell turns itself off after it fires, like a "back in stock" alert,
 *   so a popular game doesn't ping you every time it's returned.
 *
 * Alerts while the app is fully closed would need a server (a scheduled
 * Firebase function sending web push); these bells would carry over to that.
 */
@Injectable({ providedIn: 'root' })
export class WatchService {
  private bggService = inject(BggService);
  private userService = inject(UserService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private firestore = inject(Firestore);
  private push = inject(PushService);

  /** Watched games by id, for the signed-in account (or "guest"). */
  readonly watched = signal<Map<string, WatchedGame>>(new Map());
  /** Set while the "turn on phone notifications?" explanation sheet should show. */
  readonly askPermissionFor = signal<WatchedGame | null>(null);

  private storageKey = STORAGE_PREFIX + 'guest';
  private account = 'guest';
  /**
   * Automatic bells: a checked-out game on your lists gets a bell by itself, so you
   * hear when it's back without catching it while it's out (reported Nov 2026: list
   * games never showed a bell because they were all available). On by default;
   * Account has a switch. Games whose bell you turn off stay off (muted).
   */
  readonly autoAlerts = signal(true);
  private muted = new Set<string>();
  /** "Get notifications?" card on My Lists: shown once there's something to alert about. */
  readonly askDismissed = signal(this.readFlag(ASK_DISMISSED_KEY));
  readonly canNotify = typeof Notification !== 'undefined';
  readonly permission = signal(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  private timer?: ReturnType<typeof setInterval>;
  private checking = false;

  /** Called once from AppComponent so checks run on every tab, not just My Lists. */
  start(destroyRef: DestroyRef): void {
    this.userService.checkAuth().pipe(
      switchMap((user: any) => {
        this.storageKey = STORAGE_PREFIX + (user?.uid || 'guest');
        this.account = user?.uid || 'guest';
        this.autoAlerts.set(this.readText(AUTO_PREFIX + this.account) !== 'off');
        this.muted = new Set(this.readJson<string[]>(MUTED_PREFIX + this.account, []));
        const local = this.load();
        if (!user) {
          this.watched.set(local);
          this.check();
          return EMPTY;
        }
        let first = true;
        return collectionData(collection(this.firestore, 'users', user.uid, 'watches'), { idField: 'id' }).pipe(
          catchError(() => of(null)),
          tap(rows => {
            // Couldn't read the account's bells (offline on first start): use the phone's.
            if (rows === null) { this.watched.set(local); return; }
            const remote = new Map((rows as any[]).map(r => [r.id as string, { id: r.id, name: r.name || '', shelf: r.shelf || '' }]));
            if (first) {
              first = false;
              // One-time move of bells saved on the phone before they synced.
              for (const [id, game] of local) if (!remote.has(id)) { remote.set(id, game); this.saveRemote(game); }
              try { localStorage.removeItem(this.storageKey); } catch { /* nothing to remove */ }
              this.watched.set(remote);
              this.check();
              return;
            }
            this.watched.set(remote);
          }),
        );
      }),
      takeUntilDestroyed(destroyRef),
    ).subscribe();
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') this.check(); };
    document.addEventListener('visibilitychange', onVisible);
    destroyRef.onDestroy(() => {
      clearInterval(this.timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  isWatched(id: string): boolean {
    return this.watched().has(id);
  }

  /** The bell button. Turning a bell on may first explain and ask for notification permission. */
  toggle(game: WatchedGame): void {
    if (this.isWatched(game.id)) {
      this.update(map => map.delete(game.id));
      // Remember it, so the automatic bell doesn't switch itself back on.
      this.muted.add(game.id); this.saveMuted();
      this.toast.show({ text: `Alert off for ${game.name}` });
      return;
    }
    this.update(map => map.set(game.id, game));
    if (this.muted.delete(game.id)) this.saveMuted();
    // Ask only in response to this tap, never on page load (web.dev permission UX
    // guidance; Safari also requires a tap). One explanation sheet first, so the
    // browser's own prompt isn't a surprise.
    if (this.canAskPermission()) {
      this.askPermissionFor.set(game);
    } else {
      this.confirmOn(game);
    }
  }

  /**
   * Automatic bell for a checked-out game on one of your lists (My Lists calls this
   * as it loads availability). Quiet: no message, no permission prompt.
   */
  autoWatch(game: WatchedGame): void {
    if (!this.autoAlerts() || this.muted.has(game.id) || this.isWatched(game.id)) return;
    this.update(map => map.set(game.id, game));
  }

  setAutoAlerts(on: boolean): void {
    this.autoAlerts.set(on);
    try { localStorage.setItem(AUTO_PREFIX + this.account, on ? 'on' : 'off'); } catch { /* not remembered */ }
  }

  /** The My Lists card's "Turn on" (must run from that tap; iPhone needs the app on the Home Screen). */
  async enableNotifications(): Promise<void> {
    // Also registers this phone for push, so alerts arrive with the app closed.
    try { this.permission.set(await this.push.subscribe()); } catch { /* unsupported */ }
    this.dismissAsk();
  }

  dismissAsk(): void {
    this.askDismissed.set(true);
    try { localStorage.setItem(ASK_DISMISSED_KEY, '1'); } catch { /* shown again next time */ }
  }

  private saveMuted(): void {
    try { localStorage.setItem(MUTED_PREFIX + this.account, JSON.stringify([...this.muted])); } catch { /* not remembered */ }
  }

  private readFlag(key: string): boolean {
    try { return localStorage.getItem(key) === '1'; } catch { return false; }
  }

  private readJson<T>(key: string, fallback: T): T {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
  }

  /** "Turn on notifications" in the explanation sheet. Must run from that button's tap. */
  async requestPermission(): Promise<void> {
    const game = this.askPermissionFor();
    this.askPermissionFor.set(null);
    try {
      this.permission.set(await this.push.subscribe());
    } catch { /* unsupported: in-app alerts only */ }
    if (game) this.confirmOn(game);
  }

  /** "Not now" in the explanation sheet: keep the bell, use in-app alerts only. */
  declinePermission(): void {
    const game = this.askPermissionFor();
    this.askPermissionFor.set(null);
    if (game) this.confirmOn(game);
  }

  private confirmOn(game: WatchedGame): void {
    // Confirming every tap also catches accidental taps on the bell.
    this.toast.show({ text: `We'll tell you when ${game.name} is back` });
    this.check();
  }

  private canAskPermission(): boolean {
    return typeof Notification !== 'undefined' && Notification.permission === 'default';
  }

  /** Checks every watched game; alerts and clears the bell for any that are available again. */
  async check(): Promise<void> {
    const games = [...this.watched().values()];
    if (this.checking || games.length === 0 || !navigator.onLine) return;
    this.checking = true;
    try {
      for (const game of games) {
        const response: any = await firstValueFrom(this.bggService.getBggGameInfo(game.id).pipe(catchError(() => of(null))));
        const item = response?.result as BggItem | undefined;
        if (item && !item.is_checked_out && this.isWatched(game.id)) {
          this.update(map => map.delete(game.id));
          this.alert({ ...game, shelf: item.custom_fields?.Location || game.shelf }, item.last_checkin_date);
        }
      }
    } finally {
      this.checking = false;
    }
  }

  private alert(game: WatchedGame, checkedIn?: string): void {
    // When it was checked in, so you know how long it's been sitting there (someone may grab it).
    const t = parseTteDate(checkedIn)?.getTime();
    const when = t ? `checked in ${formatLibraryTime(t)}` : '';
    const text = `${game.name} is back${when ? ' (' + when + ')' : ''}, shelf ${game.shelf}`;
    this.toast.show({ text, actionLabel: 'My Lists', action: () => this.router.navigate(['/library/user']) }, 10_000);
    this.showPhoneNotification(`${game.name} is back`, `Available on shelf ${game.shelf}${when ? ', ' + when : ''}.`, game.id);
  }

  /**
   * Uses the service worker when there is one, because Android Chrome doesn't
   * allow `new Notification()` from a page. The onActionClick data tells
   * Angular's service worker to bring the app forward when it's tapped.
   */
  private async showPhoneNotification(title: string, body: string, tag: string): Promise<void> {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const url = new URL('library/user', document.baseURI).href;
    const options: NotificationOptions & { data: unknown } = {
      body, tag, icon: new URL('icons/icon-192x192.png', document.baseURI).href,
      data: { onActionClick: { default: { operation: 'focusLastFocusedOrOpen', url } } },
    };
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) {
        await registration.showNotification(title, options);
      } else {
        new Notification(title, options); // e.g. local development, where the service worker is off
      }
    } catch (err) {
      console.warn('Could not show notification', err);
    }
  }

  private update(change: (map: Map<string, WatchedGame>) => void): void {
    const before = this.watched();
    const next = new Map(before);
    change(next);
    this.watched.set(next);
    if (this.account !== 'guest') {
      // Signed in: the account is the source of truth (the server job reads it).
      for (const [id, game] of next) if (!before.has(id)) this.saveRemote(game);
      for (const id of before.keys()) if (!next.has(id)) {
        deleteDoc(doc(this.firestore, 'users', this.account, 'watches', id)).catch(() => { /* retried by the next change */ });
      }
      return;
    }
    try {
      localStorage.setItem(this.storageKey, JSON.stringify([...next.values()]));
    } catch { /* storage blocked: bells last until the app is closed */ }
  }

  private saveRemote(game: WatchedGame): void {
    setDoc(doc(this.firestore, 'users', this.account, 'watches', game.id), { name: (game.name || '').slice(0, 200), shelf: game.shelf || '', at: serverTimestamp() })
      .catch(() => { /* offline: Firestore queues it; rules not yet updated: app-open alerts still work */ });
  }

  private readText(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  private load(): Map<string, WatchedGame> {
    try {
      const saved: WatchedGame[] = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
      return new Map(saved.filter(g => g?.id).map(g => [g.id, g]));
    } catch {
      return new Map();
    }
  }
}
