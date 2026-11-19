import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';

/**
 * Owner's announcement ("Library desk is down, ask staff") at the top of Library, My Lists
 * and Events. Added 2026-11-19 after the desk outage, so there's a way to tell everyone
 * something without shipping a new version.
 *
 * Lives in public/notice.json on the site, not Firestore: Firestore's meta/ documents are
 * server-only (firestore.rules), and a rules change needs a Firebase deploy. To post, edit
 * public/notice.json on the feature/redesign branch (GitHub works from a phone); the deploy
 * workflow publishes it in about 2 minutes. Empty "message" = nothing shown.
 *   { "message": "Library desk is down. Ask staff before walking to a shelf.", "until": "2026-11-19T23:59:00-06:00" }
 * "until" (optional) hides it after that time, so a stale note never lingers.
 *
 * Fetched past the service worker (ngsw-bypass) and with a unique query so neither the
 * worker nor GitHub Pages' cache serves an old copy. Checked at startup, when the app comes
 * back to the foreground, and every 5 minutes. Fails quietly: no notice is the safe default.
 */
interface Notice { message?: string; until?: string; }

const POLL_MS = 5 * 60_000;
const DISMISSED_KEY = 'bgg-notice-dismissed';

@Injectable({ providedIn: 'root' })
export class NoticeService {
  private notice = signal<Notice | null>(null);
  private dismissed = signal(readDismissed());
  private now = signal(Date.now());

  /** The message to show, or '' for none. */
  readonly message = computed(() => {
    const n = this.notice();
    const text = (n?.message || '').trim();
    if (!text || text === this.dismissed()) return '';
    const until = n?.until ? Date.parse(n.until) : NaN;
    return !isNaN(until) && this.now() > until ? '' : text;
  });

  constructor() {
    this.load();
    const timer = setInterval(() => this.load(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') this.load(); };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  /** Hides this message on this phone; a different message shows again. */
  dismiss(): void {
    const text = this.message();
    this.dismissed.set(text);
    try { localStorage.setItem(DISMISSED_KEY, text); } catch { /* private mode: dismiss for this session only */ }
  }

  private async load(): Promise<void> {
    this.now.set(Date.now());
    try {
      const url = new URL(`notice.json?t=${Date.now()}`, document.baseURI);
      const res = await fetch(url, { cache: 'no-store', headers: { 'ngsw-bypass': 'true' } });
      if (res.ok) this.notice.set(await res.json());
    } catch { /* offline or bad JSON: keep what we had */ }
  }
}

function readDismissed(): string {
  try { return localStorage.getItem(DISMISSED_KEY) || ''; } catch { return ''; }
}
