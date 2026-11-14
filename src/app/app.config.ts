import { ApplicationConfig, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { REMOVE_STYLES_ON_COMPONENT_DESTROY } from '@angular/platform-browser';

import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import { initializeFirestore, provideFirestore } from '@angular/fire/firestore';
// AngularFire doesn't re-export the cache settings helpers, so they come from
// the Firebase SDK directly (declared in package.json so this import doesn't
// rely on AngularFire's transitive copy).
import { persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { environment } from '../environments/environment';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { provideServiceWorker } from '@angular/service-worker';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    /*
     * Offline caching of Tabletop.Events responses lives in ngsw-config.json
     * (JSON can't hold comments, so the reasoning is here):
     *
     * - dataGroup "tabletop-events-api" uses the `freshness` strategy: always try
     *   the network first, because checkout availability changes minute to minute
     *   at a convention. Only if the network fails, or takes longer than the
     *   timeout (8s: a normal search returns in 1-3s, so 8s means the convention
     *   hall Wi-Fi is effectively down), is the last cached copy of that exact
     *   request served. Cached availability may then be out of date; shelf
     *   locations, player counts, etc. stay accurate.
     * - maxAge 7d covers a full convention plus travel; maxSize 500 entries fits
     *   many searches plus one entry per game on the User page (~1-20 KB each).
     * - Game thumbnails (cf.geekdo-images.com) are deliberately NOT cached by the
     *   service worker. That host sends no CORS headers, so the SW could only
     *   store opaque responses, which browsers pad heavily against the storage
     *   quota (often ~7 MB each in Chrome). They already send
     *   `Cache-Control: max-age=157680000` (5 years), so the browser's normal
     *   HTTP cache keeps any thumbnail that has been seen before.
     */
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    }),
    // Keep component styles on the page after a component closes. A closing
    // sheet leaves a copy of itself sliding away (SheetComponent), and without
    // this the copy lost its styles mid-animation. The styles are small.
    { provide: REMOVE_STYLES_ON_COMPONENT_DESTROY, useValue: false },
    provideHttpClient(),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    /*
     * Persistent (IndexedDB) Firestore cache so saved lists still load with no
     * signal, and so they render instantly from cache on startup before the
     * server catches up. The multi-tab manager lets several open tabs/windows
     * share the cache; the single-tab default would throw in the second tab.
     * If IndexedDB is unavailable (e.g. some private-browsing modes), the SDK
     * logs a warning and falls back to the in-memory cache, so nothing breaks.
     *
     * Known trade-off: adding/removing a game uses a transaction
     * (FirestoreService.transactUpdate), and transactions need the server, so
     * those actions still fail offline and show their error message, rather
     * than being queued and possibly overwriting a friend's changes later.
     */
    provideFirestore(() => initializeFirestore(getApp(), {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })),
    // Analytics is started lazily after the first render; see util/analytics.ts.
  ]
};
