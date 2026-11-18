# BGG Library

A phone app (installable web app) for the **BoardGameGeek convention library** at BGG.CON and
BGG.Spring. It shows every game in the library with live availability, lets a group of friends keep
shared "want to play" lists, and sends alerts when a checked-out game comes back.

- **Live test site (this fork):** https://bryant1092.github.io/BGGLibrary/
- **How it all fits together:** [ARCHITECTURE.md](ARCHITECTURE.md) (start there when something breaks)
- **Venue map tooling:** [scripts/venue-maps/README.md](scripts/venue-maps/README.md)

> This is a fork of [billythekid664/BGGLibrary](https://github.com/billythekid664/BGGLibrary).
> It uses its **own Firebase project** (`bgg-library-test`) and deploys to its **own** GitHub Pages
> site, so nothing here touches the original app or its users. See [Deploying](#deploying).

## Contents

- [What the app does](#what-the-app-does)
- [Tech at a glance](#tech-at-a-glance)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Keeping library data fresh](#keeping-library-data-fresh)
- [Deploying](#deploying)
- [Server jobs (Cloud Functions)](#server-jobs-cloud-functions)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Costs and limits](#costs-and-limits)
- [After the convention](#after-the-convention)

## What the app does

| Tab | For the person using it |
|---|---|
| **Library** | Search all ~9,000 library games (instant, works offline), browse a shelf in shelf order, see Available / Out and due times, players, play time, Hot Games tags, missing-pieces warnings, and "Most played this con". Tap **+** to add to a list. |
| **My Lists** | Lists of games to play (shareable, editable together), Played / Liked / Want to buy, players and time filters, select several to remove, bells for "tell me when it's back". **Friends' picks** combines the whole group's lists ("4 of 6 want this"); **Buy list** is a shopping list. |
| **Events** | The convention schedule with seats left, starred events with reminders, an "Up next" card, BGG's news posts, exhibitors and an indoor venue map. |
| **Account** | Sign in, Meeple code to add friends, alert and reminder settings, prize-drawing badge number, appearance, offline status, library hours, app version. |

Notifications (game is back, event reminder, prize won) work with the app closed when it was added
to the Home Screen and notifications were allowed.

## Tech at a glance

| Part | What | Where |
|---|---|---|
| App | Angular 19 (standalone components, signals), installable PWA with Angular's service worker | `src/` |
| Library and schedule data | [Tabletop.Events](https://tabletop.events) public API, read live from the phone (no login) | `src/app/service/bgg.service.ts`, `events.service.ts` |
| Accounts, lists, friends | Firebase Auth + Cloud Firestore | `src/app/service/*.ts`, `firestore.rules` |
| Notifications and "Most played" | Firebase Cloud Functions (2nd gen, Node 22) + Web Push (VAPID) | `functions/index.js` |
| Search list and shelf lists | Pre-built JSON shipped with the app | `public/shelves/`, `scripts/build-shelf-index.mjs` |
| Hosting | GitHub Pages (`gh-pages` branch of the fork) | built output only |

## Getting started

Requirements: **Node 22** (same as the server functions), npm, and the Angular CLI that comes with
the project (`npx ng …`). The Firebase CLI is only needed for server work.

```bash
npm install
npx ng serve            # http://localhost:4200, uses the friend's production Firebase (environment.ts)
npx ng serve --configuration fork   # same, against this fork's test Firebase (bgg-library-test)
```

`localhost` is an authorized sign-in domain in both Firebase projects, so email/password sign-in
works locally. The service worker is off in development (`isDevMode()`), so offline behaviour and
the update bar can only be tried on a production build.

## Configuration

| What | File | Notes |
|---|---|---|
| Firebase project | `src/environments/environment*.ts` | `environment.ts` / `.prod.ts` = original project `bgg-library`; `environment.fork.ts` = `bgg-library-test`. The web API key in these files is public by design; access is controlled by `firestore.rules`. |
| Convention dates and library hours | `src/app/config/conventions.ts` | Fallback values. At startup the app looks up current conventions on Tabletop.Events (`service/convention-sync.ts`) and keeps a copy on the phone. Per-year exceptions go in `CONVENTION_OVERRIDES`. |
| Venue map | `src/app/config/venue-maps.ts` + `public/maps/` | Generated; see [scripts/venue-maps/README.md](scripts/venue-maps/README.md). |
| Push key (public half) | `src/app/config/push.ts` | The private half is a Firebase secret (`VAPID_PRIVATE_KEY`), never in the repo. |
| Offline caching | `ngsw-config.json` | What the service worker saves; see [ARCHITECTURE.md](ARCHITECTURE.md#offline). |
| Database rules and index | `firestore.rules`, `firestore.indexes.json` | Deploy these **before** app code that needs them. |

## Keeping library data fresh

The on-phone search and shelf browsing use lists built ahead of time (Tabletop.Events can't filter
by shelf, and its name search took 11–60 s at con time). Availability is never stored there; it's
always fetched live.

```bash
npm run shelves   # downloads every game (~91 requests, a few minutes), rewrites public/shelves/
```

Run it, then build and deploy, **the night before the con and once mid-con** (the library adds
games right up to and during the convention). Games added after the last run still appear in
Tabletop.Events' own search; they just aren't instant until the next refresh.

## Deploying

**Never run `npm run deploy`.** That script publishes to the *original* repository's site.

Deploys are done from **PowerShell** (Git Bash rewrites `/BGGLibrary/` into a Windows path and
produces a blank page):

```powershell
$out = "$env:TEMP\bgglibrary-build"
$ms  = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

# 1. Build against the fork's Firebase, stamped with the build time (shown on Account as "Version …").
npx ng build --configuration production,fork --base-href=/BGGLibrary/ --define "BUILD_TIME=$ms" --output-path="$out"

# 2. STOP here if the build printed any ERROR. Publishing after a failed build publishes an
#    empty folder and takes the site down. Then check the base href (a wrong one = blank site):
Select-String -Path "$out\browser\index.html" -Pattern '<base href="/BGGLibrary/">'

# 3. Keep files byte-for-byte (otherwise git turns CRLF into LF, the service worker's
#    file hashes stop matching, and offline mode silently switches off).
Set-Content -Encoding ascii -Path "$out\browser\.gitattributes" -Value '* -text'

# 4. Publish to the fork's gh-pages branch.
$env:CACHE_DIR = "$env:TEMP\bgglibrary-ghpages-cache"
npx ng deploy --no-build --dir="$out\browser" --repo=https://github.com/Bryant1092/BGGLibrary.git
```

GitHub Pages takes about 30 seconds to publish. Open phones then show **"A new version of the app
is ready · Update"**.

Order matters when a change needs new database rules or server code:
1. `firebase deploy --only firestore` (rules and index)
2. `firebase deploy --only functions` (if the server changed)
3. Build and deploy the app

## Server jobs (Cloud Functions)

All in `functions/index.js`; details in [ARCHITECTURE.md](ARCHITECTURE.md#server-jobs).

| Function | When | Does |
|---|---|---|
| `checkWatchedGames` | every 2 min | "Game is back" push for bells; event reminders. Library part paused 2–7 AM Dallas time. |
| `checkPrizeDrawings` | every 10 min | Prize-drawing win alerts by badge number; tracks "Most played this con". |
| `syncWatchIndex` | on each bell change | Keeps the one-document bell summary (`meta/watchIndex`) in step. |

```bash
cd functions && npm install && cd ..
firebase functions:secrets:set VAPID_PRIVATE_KEY   # once per project
firebase deploy --only functions
```

The project must be on the **Blaze** plan for scheduled functions (usage stays inside the free
allowance; a $1 budget alert is set). See [After the convention](#after-the-convention).

## Testing

- `npx ng test` runs the few Karma unit tests (`*.spec.ts`).
- Features were verified end to end on the live test site with Playwright scripts driving WebKit in
  iPhone mode, checking results against the real data (Tabletop.Events, Firestore), not just the
  screen. Those scripts aren't in the repo; the approach is described in
  [ARCHITECTURE.md](ARCHITECTURE.md#testing-approach).
- Things only a real iPhone can confirm: push notifications, Home Screen install, and reopening the
  app in Airplane Mode.

## Troubleshooting

Start from what you see, then check the place listed.

| Symptom | Likely cause | Where to look |
|---|---|---|
| Blank white page after a deploy | Wrong base href (built from Git Bash) | `<base href>` in the built `index.html`; rebuild from PowerShell |
| Works online but not offline; Account never says "Ready offline" | Service worker degraded: file hashes don't match (line endings) or a file failed to download | Open `/BGGLibrary/ngsw/state` on the site: `Driver state` must be `NORMAL`. Redeploy with step 3 above |
| Old version keeps showing | Phone hasn't fetched the update yet | Account → **Check for updates**; the bar waits while the "New from BGG" message is open |
| Search finds nothing for a brand-new game | Search list older than the game | `npm run shelves`, rebuild, deploy (Tabletop.Events' own search still finds it) |
| Statuses stuck on "Checking…" / "Wi-Fi is struggling" | Tabletop.Events slow, down or rate-limiting; captive hotel Wi-Fi | Browser network tab for `tabletop.events/api`; `service/network-health.ts` |
| Lists, friends or stars don't save ("Check your connection") | Firestore unreachable, or a rule rejects the write | Browser console for `permission-denied`; compare with `firestore.rules`; were the rules deployed first? |
| No "game is back" notification | No push subscription, bell missing, or the job didn't run | `users/{uid}/pushSubs` and `users/{uid}/watches` in Firestore; `meta/watchIndex`; function logs for `checkWatchedGames` (Google Cloud console → Logging; `firebase functions:log` can lag hours) |
| No event reminder | Star saved without `remindAt`, reminders set to Off, or event started > 5 min ago | `users/{uid}/eventStars/{eventId}`; Account → Reminders |
| "Most played this con" never appears | Shown from the first checkout of a con until the next con opens | `meta/conCheckouts` (public read); `checkPrizeDrawings` logs |
| Missing-pieces note shows a name or staff code | Note cleaning missed a pattern | `src/app/util/game-notice.ts` (`cleanNote`) |
| Friend circle colors look wrong in one mode | Token not defined for that mode | `--bl-pN-*` in `src/styles.css` (light block and `[data-theme="dark"]` block) |

## Costs and limits

- **Firestore** free allowance: 50,000 reads/day. Estimated use for ~10 people: 14–35k/day. The
  biggest savers: one summary document for bells, listeners kept alive per session, and saved game
  details on the phone.
- **Cloud Functions** free allowance: 2M invocations/month; these jobs use ~25k.
- **Tabletop.Events** has no published rate limit. The app keeps requests modest (4–6 at a time,
  live status only for rows on screen) and the server backs off for 10 minutes on a 429/503. Please keep
  it that way; being blocked would break the app for everyone.

## After the convention

1. Delete the three functions (`checkWatchedGames`, `checkPrizeDrawings`, `syncWatchIndex`) and
   downgrade the Firebase project from Blaze to Spark.
2. Clear server-only state in `meta/` and old `eventStars`.
3. Prize badge numbers clear themselves 14 days after the con.
4. For the next con: run `npm run shelves`, check the convention appears (it's looked up
   automatically), rebuild the venue map if the hall changed, and re-enable the functions.
