import { DestroyRef, inject, Injectable } from '@angular/core';
import { disableNetwork, enableNetwork, Firestore } from '@angular/fire/firestore';

/** Background longer than this counts as "the connection may be stale" on return. */
const STALE_AFTER_HIDDEN_MS = 60_000;

export class FirestoreTimeout extends Error {
  constructor() { super('firestore-timeout'); }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FirestoreTimeout()), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Keeps Firestore's connection usable in the iPhone Home Screen app.
 *
 * Why: iOS freezes a Home Screen app while it's in the background. On return,
 * Firestore can still believe its old connection is open, and reads then wait on a
 * dead connection with no time limit. Seen 2026-11-16: "Add friend" looked stuck
 * after reopening the app and only worked after switching tabs a few times.
 *
 * - start(): on coming back after a minute or more, drop and reopen the connection
 *   (disableNetwork + enableNetwork, Firebase's supported way to force a reconnect).
 *   Live lists keep showing cached data meanwhile, and queued writes are kept.
 * - read(): a one-off read with a time limit; if it times out, reconnect and try once
 *   more, then give up with FirestoreTimeout so the page can say what happened.
 */
@Injectable({ providedIn: 'root' })
export class FirestoreConnection {
  private firestore = inject(Firestore);
  private hiddenAt = 0;
  private cycling: Promise<void> | null = null;

  /** Called once from AppComponent. */
  start(destroyRef: DestroyRef): void {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { this.hiddenAt = Date.now(); return; }
      if (this.hiddenAt && Date.now() - this.hiddenAt >= STALE_AFTER_HIDDEN_MS) this.reconnect();
      this.hiddenAt = 0;
    };
    document.addEventListener('visibilitychange', onVisibility);
    destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onVisibility));
  }

  /** Drops and reopens the connection (one at a time). */
  reconnect(): Promise<void> {
    this.cycling ??= disableNetwork(this.firestore)
      .then(() => enableNetwork(this.firestore))
      .catch(() => { /* already reconnecting or offline: Firestore retries on its own */ })
      .finally(() => { this.cycling = null; });
    return this.cycling;
  }

  /** A read that can't hang: 6 s, then reconnect and one more try of 10 s. */
  async read<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await withTimeout(run(), 6_000);
    } catch (err) {
      if (!(err instanceof FirestoreTimeout)) throw err;
      await this.reconnect();
      return withTimeout(run(), 10_000);
    }
  }

  /**
   * Waits for a write the server must confirm. Not retried (that could send it
   * twice): Firestore keeps the write queued, so on timeout it reconnects and waits
   * a little longer, then throws FirestoreTimeout; the write still goes through
   * once the connection is back.
   */
  async write(pending: Promise<void>): Promise<void> {
    try {
      await withTimeout(pending, 6_000);
    } catch (err) {
      if (!(err instanceof FirestoreTimeout)) throw err;
      await this.reconnect();
      await withTimeout(pending, 10_000);
    }
  }
}
