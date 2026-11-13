import { Injectable, signal } from '@angular/core';

export interface Toast {
  text: string;
  /** Optional button, e.g. "Undo" or "Sign in". */
  actionLabel?: string;
  action?: () => void;
  error?: boolean;
}

/**
 * One app-wide message bar (shown by ToastComponent above the tab bar).
 *
 * Replaces the per-page Bootstrap alerts, which appeared at the top of the
 * page (out of view once you scrolled) and couldn't offer an Undo.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly current = signal<Toast | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  show(toast: Toast, durationMs = 4000): void {
    clearTimeout(this.timer);
    this.current.set(toast);
    this.timer = setTimeout(() => this.current.set(null), durationMs);
  }

  error(text: string): void {
    this.show({ text, error: true }, 5000);
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.current.set(null);
  }

  runAction(): void {
    const action = this.current()?.action;
    this.dismiss();
    action?.();
  }
}
