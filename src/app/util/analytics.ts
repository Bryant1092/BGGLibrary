import { getApps } from 'firebase/app';

/**
 * Starts Firebase Analytics once the app has rendered and the browser is idle.
 *
 * Why not `provideAnalytics(() => getAnalytics())` in app.config.ts: that put
 * the analytics SDK in the main bundle and started it (plus Google's gtag.js
 * download) during startup, competing with the first Tabletop.Events search
 * on slow convention Wi-Fi. Nothing in the app calls Analytics directly, so a
 * lazy chunk loaded later records the same automatic events (page views,
 * sessions) without slowing the first screen.
 *
 * Failures are ignored on purpose: an ad blocker or no connection shouldn't
 * surface an error in a library app.
 */
export function startAnalyticsWhenIdle(): void {
  const start = () => {
    import('firebase/analytics')
      .then(async ({ getAnalytics, isSupported }) => {
        // isSupported() is false where Analytics can't run (no IndexedDB or
        // cookies, e.g. some private modes); getAnalytics() would throw there.
        // getApps() is empty only if Firebase failed to initialize.
        const app = getApps()[0];
        if (app && await isSupported()) {
          getAnalytics(app);
        }
      })
      .catch(() => { /* blocked or offline: analytics is optional */ });
  };

  // Safari has no requestIdleCallback, so fall back to a short delay there.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(start, { timeout: 5000 });
  } else {
    setTimeout(start, 2000);
  }
}
