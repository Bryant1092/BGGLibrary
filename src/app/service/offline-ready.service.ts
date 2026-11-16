import { DestroyRef, Injectable, inject, isDevMode, signal } from '@angular/core';
import { ToastService } from './toast.service';

/**
 * 'saving'  = some of the files the app keeps for offline use are still downloading.
 * 'ready'   = all of them are on the phone (search, maps, the app itself).
 * 'unknown' = can't tell (no service worker, dev build, or nothing is moving): show nothing.
 */
export type OfflineState = 'unknown' | 'saving' | 'ready';

const READY_KEY = 'bgglibrary.offlineReady';
const POLL_MS = 3000;
/** Stop checking if nothing new was saved for this long (e.g. a browser that never caches). */
const STALL_MS = 2 * 60 * 1000;

/**
 * Tells people when the phone has everything it needs to work without a signal.
 *
 * Why: the service worker downloads the app, the search list and all venue maps in
 * the background (ngsw-config.json, the "prefetch" groups). That's invisible, so nobody
 * knew if their phone was ready before losing signal in the convention hall.
 * Research (Nielsen Norman Group response times; Apple HIG; offline-first guides) says
 * background work shouldn't block or nag, but people should be told when offline use is
 * ready. So: a quiet status line on the Account tab, plus one toast the first time.
 * No "don't close the app" warning: closing only pauses the download, and it carries
 * on the next time the app is opened.
 *
 * How it measures: the service worker's own file list (ngsw.json) names every
 * prefetch file; we count how many are already in the phone's Cache Storage.
 * ngsw has no progress events, so counting saved files is the only way to show progress.
 */
@Injectable({ providedIn: 'root' })
export class OfflineReadyService {
  private toast = inject(ToastService);
  readonly state = signal<OfflineState>('unknown');
  readonly saved = signal(0);
  readonly total = signal(0);

  private urls: string[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private lastProgressAt = 0;

  start(destroyRef: DestroyRef): void {
    if (isDevMode() || !('serviceWorker' in navigator) || !('caches' in window)) return;
    // Shown right away from last time, so the Account tab doesn't flash "Saving…" offline.
    if (this.readFlag()) this.state.set('ready');
    const onVisible = () => { if (document.visibilityState === 'visible') this.check(); };
    document.addEventListener('visibilitychange', onVisible);
    destroyRef.onDestroy(() => { document.removeEventListener('visibilitychange', onVisible); clearTimeout(this.timer); });
    this.check();
  }

  /** Reloads the file list (it changes with each app update), then counts saved files. */
  private async check(): Promise<void> {
    clearTimeout(this.timer);
    try {
      // ngsw-bypass: ask the server, not the service worker, so a new app version is seen.
      const res = await fetch(new URL(`ngsw.json?ngsw-cache-bust=${Date.now()}`, document.baseURI).href,
        { headers: { 'ngsw-bypass': 'true' }, cache: 'no-store' });
      const manifest = await res.json();
      this.urls = (manifest.assetGroups as { installMode: string; urls: string[] }[])
        .filter(g => g.installMode === 'prefetch')
        .flatMap(g => g.urls)
        .map(u => new URL(u, location.origin).href);
    } catch {
      // Offline (or the server is down): keep the last answer; it was right when last online.
      if (!this.urls.length) return;
    }
    this.lastProgressAt = Date.now();
    this.count();
  }

  private async count(): Promise<void> {
    const found = await Promise.all(this.urls.map(u => caches.match(u).then(r => !!r).catch(() => false)));
    const saved = found.filter(Boolean).length;
    if (saved > this.saved()) this.lastProgressAt = Date.now();
    this.saved.set(saved);
    this.total.set(this.urls.length);
    if (saved >= this.urls.length) {
      if (!this.readFlag()) {
        // Once per phone; later app updates download quietly without another message.
        this.toast.show({ text: 'Saved for offline use. Search and maps now work without a signal.' }, 6000);
        this.writeFlag();
      }
      this.state.set('ready');
      return;
    }
    if (Date.now() - this.lastProgressAt > STALL_MS) {
      // Nothing is downloading (closed browser storage, private browsing…): don't show
      // a "Saving…" that never finishes. We look again when the app is next opened.
      if (this.state() === 'saving') this.state.set('unknown');
      return;
    }
    this.state.set('saving');
    this.timer = setTimeout(() => this.count(), POLL_MS);
  }

  // localStorage can throw (private mode, blocked storage); the status still works without it.
  private readFlag(): boolean {
    try { return localStorage.getItem(READY_KEY) === '1'; } catch { return false; }
  }
  private writeFlag(): void {
    try { localStorage.setItem(READY_KEY, '1'); } catch { /* fine without it */ }
  }
}
