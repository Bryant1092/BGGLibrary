import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { NetworkHealth } from '../service/network-health';
import { DeskActivity } from '../service/desk-activity.service';
import { formatLibraryTime } from '../util/library-time';

/**
 * Connection bar inside the page header. Two cases:
 *
 * - Offline: the phone itself says it has no connection (airplane mode, no signal).
 * - Struggling: the phone says it's online but Tabletop.Events requests keep
 *   failing even after retries (NetworkHealth). That's crowded convention Wi-Fi,
 *   or Wi-Fi that's "connected" with no internet. Before, nothing showed in that
 *   case and the app just seemed broken. It clears on the next answer that gets
 *   through.
 *
 * Neither claims how old the shown data is: saved results from the service
 * worker look exactly like fresh ones, so the app can't tell.
 *
 * The cellular tip is the one thing people can do about crowded Wi-Fi; phones
 * often hang on to a bad Wi-Fi network instead of switching on their own.
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
    } @else if (health.struggling()) {
      <div class="bar" role="status">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.6a10 10 0 0 1 14 0M8.6 16.4a5 5 0 0 1 6.8 0M12 20h.01M2 8.8a15 15 0 0 1 20 0"/></svg>
        <!-- Hotel Wi-Fi often needs a sign-in page first; until then every request fails while
             the phone still shows full Wi-Fi bars (captive portal). -->
        <span><strong>Wi-Fi is struggling.</strong> Showing saved info where we have it. Just joined the hotel Wi-Fi? Open Safari to finish signing in. Turning off Wi-Fi to use cellular often helps too.</span>
      </div>
    } @else if (deskSince()) {
      <!-- The desk stopped scanning (DeskActivity): Tabletop.Events still answers, but its
           Available / Out is frozen at the last scan. -->
      <div class="bar" role="status">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
        <span><strong>Library check-in/out isn't updating.</strong> Nothing scanned since {{ sinceText(deskSince()!) }}, so Available / Out may be wrong. Check at the library desk.</span>
      </div>
    }
  `,
})
export class OfflineBarComponent {
  readonly online = signal(navigator.onLine);
  readonly health = inject(NetworkHealth);
  readonly desk = inject(DeskActivity);
  /** Show the "check-in/out isn't updating" case (off on Events, which shows no availability). */
  readonly library = input(true);
  readonly deskSince = computed(() => this.library() ? this.desk.staleSince() : null);
  readonly sinceText = (ms: number) => formatLibraryTime(ms);

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
