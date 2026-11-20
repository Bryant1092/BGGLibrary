import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';

/**
 * Tapping a notification opens the page it's about (game alerts: the Alerts tab with that game;
 * event reminders: the event).
 *
 * 2026-11-20: notifications used Angular's "navigateLastFocusedOrOpen", which asks the service
 * worker to move the open app to a new page (WindowClient.navigate). iPhone Home Screen apps
 * don't do that reliably, so a tap only brought the app forward wherever it was. Now
 * notifications only bring the app forward ("focusLastFocusedOrOpen"), and the app, told of
 * the tap through SwPush.notificationClicks, goes to the notification's url itself. When the
 * app wasn't running, the service worker opens that url directly instead.
 */
@Injectable({ providedIn: 'root' })
export class NotificationTapsService {
  private router = inject(Router);

  constructor() {
    const swPush = inject(SwPush);
    if (!swPush.isEnabled) return;
    swPush.notificationClicks.subscribe(({ notification }) => {
      const url: string | undefined = (notification as any)?.data?.onActionClick?.default?.url;
      const path = url ? appPath(url) : null;
      if (path) this.router.navigateByUrl(path);
    });
  }
}

/** "https://…/BGGLibrary/alerts?game=x" → "/alerts?game=x" (null if it's not this app's page). */
function appPath(url: string): string | null {
  try {
    const base = new URL(document.baseURI);
    const target = new URL(url, base);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) return null;
    const rest = target.pathname.slice(base.pathname.length);
    return rest ? '/' + rest + target.search : null; // the bare app root: stay where you are
  } catch {
    return null;
  }
}
