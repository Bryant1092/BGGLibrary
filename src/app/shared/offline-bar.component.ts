import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';

/**
 * "You're offline" bar, shown inside the page header only while the phone
 * itself says it has no connection (airplane mode, no signal).
 *
 * Deliberately limited: on convention Wi-Fi that's "connected" with no
 * internet, the phone still reports online and saved results come back from
 * the service worker looking like fresh ones, so the app can't reliably tell
 * when results are old, or how old. Rather than a bar that's sometimes wrong,
 * this one only appears when it's certainly right, and it doesn't claim a time.
 */
@Component({
  selector: 'app-offline-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .bar {
      display: flex; align-items: center; gap: 10px; margin: 0 -16px -10px; padding: 9px 16px;
      background: var(--bl-late-bg); color: var(--bl-late-fg); border-top: 1px solid var(--bl-late-border);
      font-size: 14px; line-height: 19px;
    }
    svg { flex: none; }
  `,
  template: `
    @if (!online()) {
      <div class="bar" role="status">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.8a15 15 0 0 1 4.2-2.6M9.5 5.3a15 15 0 0 1 12.5 3.5M5 12.6a10 10 0 0 1 3.2-2M12.6 10a10 10 0 0 1 6.4 2.6M8.6 16.4a5 5 0 0 1 6.8 0M12 20h.01M2 2l20 20"/></svg>
        <span><strong>You're offline.</strong> Availability may be out of date.</span>
      </div>
    }
  `,
})
export class OfflineBarComponent {
  readonly online = signal(navigator.onLine);

  constructor() {
    const update = () => this.online.set(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    });
  }
}
