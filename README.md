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
- [Checks before deploy](#checks-before-deploy)
- [Server jobs (Cloud Functions)](#server-jobs-cloud-functions)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Costs and limits](#costs-and-limits)
- [Outages and worst cases](#outages-and-worst-cases)
- [After the convention](#after-the-convention)
- [Changes during BGG.CON 2026](#changes-during-bggcon-2026)

## What the app does

| Tab | For the person using it |
|---|---|
| **Library** | Search all ~9,000 library games (instant, works offline), browse a shelf in shelf order, see Available / Out and due times, players, play time, Hot Games tags, missing-pieces warnings, and "Most played this con". Tap **+** to add to a list (a toast names the game and offers Undo). Only the title row stays pinned; search and filters scroll away, and a search button in the title row brings them back. A "You won!" banner shows until a prize's pickup deadline. |
| **Game details** (sheet) | Location (tap for the library on the map), players, time, due-back estimate, this con's play stats, every copy with its last scan, and a bar pinned to the bottom with **Add to list** and the **bell**. |
| **My Lists** | Lists of games to play (shareable, editable together), Played / Liked / Marked to buy, players and time filters, select several to remove, bells for "tell me when it's back". Ticked-off games collapse into a **Played** section with history. **Friends' picks** combines the whole group's lists ("4 of 6 want this"); **Buy list** is a shopping list. |
| **Events** | The convention schedule with seats left, starred events with reminders, an "Up next" card, BGG's news posts, exhibitors and an indoor venue map. |
| **Alerts** | Notification center: every "game is back" alert from the last 7 days (up to 100), grouped by time, with a badge on the tab for unseen ones. Tapping a phone notification opens here. |
| **Account** | Prize drawings first during the con (each drawing, win or not, pickup deadline and countdown), sign in, Meeple code to add friends, alert and reminder settings, appearance, offline status, library hours, app version. |

Notifications (game is back, event reminder, prize won) work with the app closed when it was added
to the Home Screen and notifications were allowed. A bell answers to **any copy** of the game (same
name, so other editions don't count): the push says "Copy BGG-260038 available…" when it's not the
copy on your list. After an alert, the automatic bell for that game waits 15 minutes before coming
back. A copy checked in and out again between two 2-minute checks is not reported. iPhone shows web-app notifications as text with
the app icon only (no game covers); the in-app "is back" toast does show the cover. Titles drop
trailing edition notes ("Night at the Zoo is back") so "is back" isn't cut off; the full name
leads the body.

When the library desk stops scanning (an outage), the app and server notice: a banner says
statuses may be wrong, "back" alerts wait 10 minutes and re-check instead of firing in a flood,
and `public/notice.json` can force the banner on by hand (`deskDown: true`). Details in
[ARCHITECTURE.md](ARCHITECTURE.md).

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

**Normal way (since Nov 2026): push to `feature/redesign`.** GitHub Actions does the rest:

| Workflow | Runs | Does |
|---|---|---|
| `deploy-pages.yml` | every push to `feature/redesign` (not for `.md`-only or server-only changes) | [Checks](#checks-before-deploy), then builds `production,fork` and publishes to `gh-pages`. About 2 minutes. |
| `deploy-firebase.yml` | by hand (Actions tab → Run workflow, or `gh workflow run deploy-firebase.yml --ref feature/redesign -f target=functions`) | Checks the functions load, then deploys `firestore` rules, `functions`, or both, using the `FIREBASE_SERVICE_ACCOUNT` secret. |
| `read-logs.yml`, `tte-lookup.yml`, `prize-posts.yml` | by hand | Read function logs, look up library copies on Tabletop.Events, list prize posts. |

Manual workflows also need a copy on `main` for GitHub to show the Run button. All workflows are
guarded with `if: github.repository == 'Bryant1092/BGGLibrary'`.

**By hand (fallback),** from **PowerShell** (Git Bash rewrites `/BGGLibrary/` into a Windows path and
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

## Checks before deploy

Added 2026-11-20 in **gentle mode** (the con was on, so a stuck deploy was the bigger risk).
The `checks` job in `deploy-pages.yml` runs first; the deploy only starts if it passes.

| Check | Command | Blocks the deploy? |
|---|---|---|
| Lint (TypeScript + templates, incl. accessibility rules) | `npm run lint` | **Errors** block. Rules in the `GENTLE` list in `eslint.config.js` only warn for now. |
| Build (TypeScript `strict`, `strictTemplates`) | `ng build` in the deploy job | Yes |
| Functions syntax | `node --check functions/index.js` | Yes (and `deploy-firebase.yml` also checks the file loads) |
| Functions tests | `node --test "functions/test/*.test.js"` | Yes (8 tests for bells on any copy) |
| Unit tests | `npx ng test --watch=false --browsers=ChromeHeadless` | **No, report only** (for the con): 55 tests, all passing, covering prize parsing and deadlines, library hours and due times, status wording during desk outages, filters, notification titles and `BggService` sharing |
| Security audit of dependencies | `npm audit --omit=dev --audit-level=high` (app and `functions/`) | **No, report only**: on 2026-11-20 the app had 25 known issues (2 critical, 9 high) and the server 8 moderate; most need a newer Angular |

**Secrets** are not checked by the deploy: GitHub **secret scanning with push protection** is on
for this repo and rejects a push containing known key formats before it lands. Real secrets live
only in Firebase secrets (`VAPID_PRIVATE_KEY`) and GitHub Secrets (`FIREBASE_SERVICE_ACCOUNT`).
The Firebase web `apiKey` in `src/environments/` is public by design; `firestore.rules` is what
protects people's data.

Run `npm run lint` before pushing; `npx eslint --fix` fixes some warnings automatically.
Selector prefixes: `app-` for screens and features, `bl-` for small shared pieces (`bl-icon`,
`[blInView]`). See [After the convention](#after-the-convention) for making the checks strict.

## Server jobs (Cloud Functions)

All in `functions/index.js`; details in [ARCHITECTURE.md](ARCHITECTURE.md#server-jobs).

| Function | When | Does |
|---|---|---|
| `checkWatchedGames` | every 2 min | "Game is back" push for bells; event reminders. Library part paused 2–7 AM Dallas time. |
| `checkPrizeDrawings` | every 10 min | Prize-drawing win alerts by badge number; tracks "Most played this con" and this con's average time out / on the shelf per game (`meta/conPlayTimes`). |
| `syncWatchIndex` | on each bell change | Keeps the one-document bell summary (`meta/watchIndex`) in step. |

```bash
cd functions && npm install && cd ..
firebase functions:secrets:set VAPID_PRIVATE_KEY   # once per project
firebase deploy --only functions
```

The project must be on the **Blaze** plan for scheduled functions (usage stays inside the free
allowance; a $1 budget alert is set). See [After the convention](#after-the-convention).

## Testing

- `npx ng test` runs the Karma unit tests (55, all passing; `util/*.spec.ts`, `service/bgg.service.spec.ts`). They use this con's real cases (two prize tables in one post, 1:27 PM → 5:27 PM due time, the Nov 19 outage wording) and pass in any time zone. They
  don't block deploys yet; see [Checks before deploy](#checks-before-deploy).
- `npm run lint` runs ESLint (angular-eslint) on TypeScript and templates.
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

## Outages and worst cases

Everything that went wrong at BGG.CON 2026 outside our code (Tabletop.Events, the library desk,
BGG's posts, iPhone, Wi-Fi), what the app does about it now, and what to build so the next con
keeps working. **Goal: when anything upstream breaks, the app degrades and says why; it never
just stops.**

### What happened

| When | What broke | What users saw before the fix | Handled now by |
|---|---|---|---|
| Nov 19, ~1:39–9:10 PM | **Library desk stopped scanning** (Tabletop.Events itself was up). Staff wrote checkouts on paper, then typed the backlog in; every typed entry got the typing time, not the real time. Tabletop.Events' "newest check-ins" sort was unreliable during the catch-up. | Statuses frozen with no warning; a flood of wrong "is back" alerts when the backlog was typed in; wrong play times. | Server desk watcher (`checkDesk`, `meta/deskStatus`), desk banners, "as of" / "Likely" wording, alerts held 10 min during catch-up and bursts (`heldBack`), late-typed check-ins skipped for play times (`typedLate`), out-of-order lists distrusted with a direct-check fallback, manual switch in `public/notice.json`. |
| Nov 21, ~1:05–1:30 PM | **Tabletop.Events stopped answering entirely** (library and convention API timed out after 45 s, from GitHub and from the server). Scanning down too. | **No banner at all** (the desk detector needs data to notice scans stopped); every screen spun ~50 s; "Couldn't reach the game library"; tapping a search result did nothing; "Wi-Fi is struggling" blamed the phone. Server checks hit their 90 s limit every run (~3,400 vCPU-s per hour of outage vs ~60 normally). | Manual switch turned on by hand (1:20 PM) and off when it recovered (2:00 PM, `deskBackAt` 1:30 PM); offline fixes the same day: games open from saved data ("Status unknown"), Library lists all saved games, one 9 s try instead of ~50 s of retries, no Wi-Fi blame while the switch is on. Remaining items are in "To do during the con" below. |
| Nov 19 | **BGG's news post put two prize tables under one heading** (daily drawing + Big Group Game). | "Yesterday" shown twice; wrong pickup deadline. | Parser names non-daily tables from "Winners for … are:"; tests in `util/prize-drawing.spec.ts`. |
| Nov 20 | **Popular games turned over in seconds** (a Hell of a Deal copy was on the shelf 65 s, another 20 s); bells only watched one copy of five. | Missed alerts. | Bells answer to any copy (`functions/copies.js`). Still missed: anything checked in and out between two 2-minute checks. |
| All con | **iPhone quirks**: notification taps ignore the service worker's `navigate`; sticky bars stop short of a scroller's padding; focus left in a closed keyboard hides the tab bar; web pushes are text + app icon only. | Taps opened the wrong page; floating bar; missing tab bar. | `notification-taps.service.ts`, `.bl-sheet:has(.action-bar)`, visualViewport blur fix. |
| All con | **Crowded hotel Wi-Fi / sign-in pages** (captive portal). | Long spinners. | Timeouts + retries (`network-health.ts`), service worker serves saved API answers after 8 s, on-phone search list, saved schedule. |

### Playbook: what to do when…

| Situation | How you'll know | Do this |
|---|---|---|
| **Desk not scanning, Tabletop.Events up** | Desk banner appears on its own after 30 min without scans (9 AM–11 PM) | Usually nothing. If staff confirm paper checkouts, set `"deskDown": true` and `"deskDownSince"` in `public/notice.json` and push (~3 min); set it back and fill `"deskBackAt"` when scanning resumes. |
| **Tabletop.Events not answering** | No banner yet (see "Build before next con"). Signs: server logs show `maximum request timeout`; Actions → "TTE lookup" prints `HEALTH 000` | Turn the switch on with a `"message"` saying Tabletop.Events is down (as on Nov 21). The app then fails fast, shows saved data and holds alerts. Server keeps trying every 2 min (costs CPU but stays free; check "Usage audit"). |
| **Firebase down** (rare) | Sign-in / lists fail | Lists show from the phone's Firestore cache; alerts stop. Nothing to do but wait. |
| **GitHub Pages down** | App won't update | Installed app keeps running from the service worker; no action. |
| **Need to check free-tier usage** | Any time | Actions → "Usage today" (totals) or "Usage audit" (breakdown). |
| **A bad deploy** | Something broke after a push | App: revert the commit and push. Server: Actions → deploy Firebase from the previous commit (~4 min; each server deploy adds ~50 MB of stored images, free limit 0.5 GB). |

### Build before the next con

Ordered by how much they'd have helped this time:

- [ ] **Detect "Tabletop.Events down" automatically.** Server: when its own calls fail or time
      out (e.g. 3 runs in a row), write `tteDownSince` to `meta/deskStatus`; the app shows the
      outage banner and fast-fail mode from that, no manual switch needed. Clear it on the first
      success.
- [ ] **Server circuit breaker.** Short fetch timeout (~10 s) and back off to one probe every few
      minutes while Tabletop.Events is down, so an outage doesn't burn ~3,400 vCPU-s an hour.
- [ ] **Offline-first everywhere**: finish the "To do during the con" list (shelf rows, one
      banner, add from search, copies message), save Exhibitors on the phone, and prefetch the
      whole schedule when the app is installed, not only when Events is opened.
- [ ] **Outage drill in CI**: a Playwright test that blocks `tabletop.events` and checks every
      tab still renders, game details open, search works and nothing spins longer than ~10 s.
- [ ] **Faster, more complete alerts**: the 30-second watcher reading both check-ins and
      checkouts, per-game copy counts, "back briefly" entries, one grouped push per check (plan
      from Nov 21; deploy when Tabletop.Events is stable, during closed hours).
- [ ] **Replace the deprecated `/librarygames` endpoint** and re-test sorting by check-in time.
- [ ] **Before each con:** run `npm run shelves` (search list + shelf order), check the convention
      is found, rebuild the map if the hall changed, set the $1 budget alert, and run the outage
      drill.
- [ ] **Ask the BGG library desk** how returns are handled (scanned at the counter and shelved
      later?) and whether there's a contact for outages, so the banner text can be accurate.

## After the convention

**Shut down (Sunday night, Nov 22 2026)**

1. Delete the three functions (`checkWatchedGames`, `checkPrizeDrawings`, `syncWatchIndex`) and
   downgrade the Firebase project from Blaze to Spark.
2. Clear server-only state in `meta/` and old `eventStars`.
3. Prize badge numbers clear themselves 14 days after the con.
4. Delete the deploy service account's key in Google Cloud (IAM → Service accounts → Keys) and
   the `FIREBASE_SERVICE_ACCOUNT` secret in the GitHub repo settings.
5. For the next con: run `npm run shelves`, check the convention appears (it's looked up
   automatically), rebuild the venue map if the hall changed, and re-enable the functions.

**To do during the con: offline fixes not built yet** (from the Nov 21 Tabletop.Events outage
check; 1, 2 and 4 of that list were built first)

- [ ] Shelf rows stuck on "Checking…" forever: show "Status unknown" once Tabletop.Events is
      down or the desk-down switch is on.
- [ ] Two banners say the same thing when the switch is on (the `notice.json` message and the
      built-in "writing check-ins by hand" bar): show only one.
- [ ] Adding a game from search fails while Tabletop.Events is down ("Couldn't add the game"):
      add it from the on-phone data (`bgg_id` is optional; fill it in later).
- [ ] Game details: the copies list silently disappears when Tabletop.Events fails; say
      "Copies unavailable while Tabletop.Events is down".
- [ ] After the con: show the outage banner automatically when Tabletop.Events stops answering
      (today only the manual switch can, because the detector needs data to notice scans
      stopped), and save the Exhibitors list on the phone like the schedule.

**To do after the con (code quality)**

Background for these: the [UX/UI audit](https://claude.ai/artifact/4NaKjszMag4BVq8yHxmbVc) and the
[code quality and structure review](https://claude.ai/artifact/D1WJiA8ZNDyawBwWwjKJkz) (Nov 20 2026;
private to the repo owner, so other contributors will need them shared).

- [ ] Fix the lint warnings (`npm run lint` lists them; ~130 on 2026-11-20, mostly `any` in
      Tabletop.Events responses: give those responses proper types), then delete the `GENTLE`
      block in `eslint.config.js` so every rule blocks deploys.
- [ ] Make the unit tests blocking: remove `continue-on-error` from the test step (55 tests for
      prize parsing, library time, status wording and lookups were added 2026-11-20 and pass).
      Then add tests for `DeskActivity` and the remaining default specs (guards, 404 page).
- [ ] Upgrade Angular (19 → current) and the Firebase libraries (`@angular/fire`,
      `firebase-admin`, `firebase-functions`), retest on an iPhone, then remove
      `continue-on-error` from the security audit step so high and critical issues block deploys.
- [ ] Turn on Dependabot **alerts** (Settings → Code security) after the upgrade, so the first
      emails are about new issues, not the known backlog.
- [ ] Add ESLint for `functions/index.js` and a small test for its alert rules (`heldBack`,
      late check-ins).
- [ ] Replace Tabletop.Events' deprecated `/librarygames` endpoint and test it before the next con.
- [x] ~~Monitoring Viewer role~~: not needed; the deploy account can already read usage
      (Actions → "Usage today" / "Usage audit").
- [ ] **Speed:** remove Bootstrap's CSS (232 KB, ~4 classes still used: `visually-hidden`,
      `card`, `spinner`, `row`) and `@ng-bootstrap/ng-bootstrap` (unused). Bootstrap's base styles
      touch every screen, so check each one on an iPhone after. Bootstrap Icons is already gone.
- [ ] **Speed:** load Firebase's database code only when needed. It's most of the biggest file
      loaded at launch (487 KB of 1.4 MB), yet the Library tab and search don't need it.
- [ ] **Speed:** switch to Angular's zoneless change detection (`provideZonelessChangeDetection`,
      drop `zone.js`). 32 of 35 components are already OnPush with signals; convert the last
      three (`app`, `login`, `page-not-fount`) first.
- [ ] **Structure** (from the code review, in this order):
      1. A `common/` folder shared by the app and `functions/`: move prize parsing, Dallas time
         math, `shortGameName` and the alert-hold rules there (today they're copied and kept in
         step by hand).
      2. Convert `functions/index.js` to TypeScript and split it (desk, alerts, reminders, prizes,
         con stats, Tabletop.Events client); save the 429 backoff in Firestore.
      3. Feature folders (`core/`, `common/`, `ui/`, `library/`, `lists/`, `events/`, `alerts/`,
         `account/`), one commit per folder, and rename `page-not-fount`.
      4. One `ClockService` and one background scheduler instead of 20 timers.
      5. One game repository: typed `bgg.game(id)`, an app-wide request queue, merged caches.
      6. Split `lists`, `library`, `events` and `map-viewer` into a store plus smaller views.
      7. Font sizes as rem tokens (also unlocks Dynamic Type); styles next to their components.
- [ ] From the UX audit, not built yet: Dynamic Type (iPhone Text Size), 11pt minimum text,
      Clear all on Alerts, unread dot on Events → Info, pull-to-refresh on My Lists, shorter
      add/remove button label in the game sheet.

## Changes during BGG.CON 2026

Built from an iPhone during the con (Nov 18–22). Newest first; the commit history has details.

| Date | Change |
|---|---|
| Nov 20 | Bells answer to any copy of a game (5-copy games like Hell of a Deal); 15-minute quiet period for automatic bells |
| Nov 20 | Pre-deploy checks (lint, functions syntax, tests report-only) in gentle mode |
| Nov 20 | Notification titles drop edition notes so "is back" fits |
| Nov 20 | Game sheet action bar pinned to the bottom (fixed iPhone gap); "is back" toast with cover and location pin |
| Nov 20 | UX audit fixes: scroll-away headers on Library and My Lists, named add/remove toasts, map link on Location, prize card first and win banner, one-field Name and no confirm-password on sign-up, always-enabled submit buttons, "Marked to buy" |
| Nov 20 | Prize drawings: each drawing numbered with win / no win, pickup deadline and countdown |
| Nov 20 | Alerts tab (notification center) with badge; notification taps open it |
| Nov 19–20 | Copies list in game details (last scan per copy, "may be out / may be back") |
| Nov 19 | Desk-outage handling: watcher on the server, banner, held-back alerts, manual switch in `notice.json` |
| Nov 19 | Played section with history in My Lists; bell off for ticked games |
| Nov 18–19 | Deploys moved to GitHub Actions; Firebase deploys via a service account |
