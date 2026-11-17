import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/**
 * Build time in ms, stamped in by the build: `ng build --define BUILD_TIME=<ms>`.
 * Missing in plain `ng build` / `ng serve` builds; the version line then says "Development build".
 */
declare const BUILD_TIME: number;

/** Look for a new version at most this often (each check is one small ngsw.json request). */
const CHECK_EVERY_MS = 15 * 60_000;

/**
 * New-version handling: the "A new version is ready" bar and the version line on Account.
 *
 * Why: the service worker downloads a new version in the background, but only switches
 * to it after the app is fully closed and reopened. On iPhone almost nobody does that
 * (swiping home only pauses the app), so people could run an old version for days,
 * including library refreshes deployed during the con. Common practice for web apps
 * (Angular's SwUpdate docs, web.dev "handling service worker updates"): when the new
 * version is fully downloaded, offer a one-tap reload and never force it mid-task.
 *
 * Checks happen when the app opens, when it comes back from the background (the
 * usual case on iPhone, where the app stays "open" for days), and every 15 min.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private sw = inject(SwUpdate);
  /** A new version is downloaded and ready; a reload switches to it. */
  readonly ready = signal(false);
  /** Hidden with × for now; shows again if yet another version arrives. */
  readonly dismissed = signal(false);
  /** For the Account tab's "Check for updates": 'checking' | 'latest' | ''. */
  readonly checkState = signal<'' | 'checking' | 'latest'>('');
  readonly builtAt: number | null = typeof BUILD_TIME === 'number' ? BUILD_TIME : null;
  readonly enabled = this.sw.isEnabled;
  private lastCheck = 0;

  start(destroyRef: DestroyRef): void {
    if (!this.sw.isEnabled) return;
    const sub = this.sw.versionUpdates.subscribe(e => {
      if (e.type === 'VERSION_READY') { this.ready.set(true); this.dismissed.set(false); }
    });
    // The cached app is broken (files evicted by the phone): a reload gets a clean copy.
    const broken = this.sw.unrecoverable.subscribe(() => { this.ready.set(true); this.dismissed.set(false); });
    const onVisible = () => { if (document.visibilityState === 'visible') this.check(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(onVisible, CHECK_EVERY_MS);
    // Our own check on open too, not only the service worker's message (see check()). 10 s
    // in, after the service worker is registered (registerWhenStable:5000, app.config.ts).
    const first = setTimeout(onVisible, 10_000);
    destroyRef.onDestroy(() => { sub.unsubscribe(); broken.unsubscribe(); clearInterval(timer); clearTimeout(first); document.removeEventListener('visibilitychange', onVisible); });
  }

  /** Asks the server for a new version (throttled unless the person tapped "Check for updates"). */
  async check(byPerson = false): Promise<void> {
    if (!this.sw.isEnabled || (!byPerson && Date.now() - this.lastCheck < CHECK_EVERY_MS)) return;
    this.lastCheck = Date.now();
    if (byPerson) this.checkState.set('checking');
    // checkForUpdate resolves true once a new version is downloaded. VERSION_READY normally
    // fires too, but not if this page's own version never finished saving (seen in testing
    // when GitHub Pages answered one file with a 503 mid-deploy), so trust the answer here.
    const found = await this.sw.checkForUpdate().catch(() => false);
    if (found) { this.ready.set(true); this.dismissed.set(false); }
    if (byPerson) this.checkState.set(found || this.ready() ? '' : 'latest');
  }

  /** Switches to the new version: activates it, then reloads (about a second). */
  async update(): Promise<void> {
    await this.sw.activateUpdate().catch(() => undefined);
    // Back to the top first: reloading while scrolled down (Update is at the bottom of
    // Account) left the iPhone Home Screen app blank until touched (see index.html).
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    location.reload();
  }

  /** "Version Nov 16, 4:10 PM": the build's date, so newer is obvious without a number to look up. */
  versionText(): string {
    if (!this.builtAt) return 'Development build';
    return 'Version ' + new Date(this.builtAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}
