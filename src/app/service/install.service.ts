import { Injectable, signal } from '@angular/core';

/** Chrome's install prompt event (not in TypeScript's DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Which install help to show on the Account tab, if any. */
export type InstallHelp = 'installed' | 'ios' | 'android-button' | 'in-app-browser' | 'none';

const DISMISSED_KEY = 'bgglibrary.installCardDismissed';

/**
 * Helps people add the app to their home screen. Worth it because on iPhone,
 * notifications only work for installed web apps, and Safari can clear a
 * site's saved data (bells, recently viewed) after 7 days without a visit
 * unless it's installed.
 *
 * - Android Chrome (and desktop Chrome/Edge) fire "beforeinstallprompt" once,
 *   early, when the app qualifies; it's kept so the Account tab can show a
 *   real Install button. Created at app start for that reason.
 * - iPhone has no install API (Apple doesn't allow it), so the card shows the
 *   Share > Add to Home Screen steps instead.
 * - Pages opened inside other apps (Messenger, Instagram, Discord, etc.) can't
 *   be installed, so the card says to open it in Safari or Chrome.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private promptEvent: BeforeInstallPromptEvent | null = null;
  readonly canPrompt = signal(false);
  readonly installed = signal(this.isStandalone());
  readonly dismissed = signal(this.readDismissed());
  /** The "Add to Home Screen" steps as a sheet (AppComponent), from "Show me how" anywhere. */
  readonly sheetOpen = signal(false);

  openSteps(): void { this.sheetOpen.set(true); }
  closeSteps(): void { this.sheetOpen.set(false); }

  constructor() {
    window.addEventListener('beforeinstallprompt', (event: Event) => {
      event.preventDefault(); // show our own button instead of the browser's mini-bar
      this.promptEvent = event as BeforeInstallPromptEvent;
      this.canPrompt.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.installed.set(true);
      this.canPrompt.set(false);
    });
  }

  help(): InstallHelp {
    if (this.installed()) return 'installed';
    const ua = navigator.userAgent;
    if (/FBAN|FBAV|Instagram|Line\/|Snapchat|Discord|Twitter|LinkedInApp|MicroMessenger/i.test(ua)) return 'in-app-browser';
    // iPadOS reports itself as a Mac; touch support tells them apart.
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios) return 'ios';
    if (this.canPrompt()) return 'android-button';
    return 'none'; // e.g. Firefox, or already dismissed by the browser
  }

  async install(): Promise<void> {
    if (!this.promptEvent) return;
    await this.promptEvent.prompt();
    const { outcome } = await this.promptEvent.userChoice;
    // The event can only be used once.
    this.promptEvent = null;
    this.canPrompt.set(false);
    if (outcome === 'accepted') this.installed.set(true);
  }

  /** "Not now": hide the card on this device. */
  dismiss(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch { /* storage blocked: hidden until the app is closed */ }
  }

  private isStandalone(): boolean {
    return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  }

  private readDismissed(): boolean {
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  }
}
