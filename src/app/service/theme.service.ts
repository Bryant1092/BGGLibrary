import { Injectable, signal } from '@angular/core';

/** "system" follows the phone's light/dark setting; the others override it. */
export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'bgglibrary.theme';

/**
 * Light/dark mode choice from the Account tab. Saved on this device and
 * applied by window.blApplyTheme (defined in index.html, which also applies
 * the saved choice before the app starts so there's no flash of the wrong theme).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly choice = signal<ThemeChoice>(this.read());

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch { /* storage blocked: applies until the app is closed */ }
    (window as any).blApplyTheme?.(choice);
  }

  private read(): ThemeChoice {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'system';
    } catch {
      return 'system';
    }
  }
}
