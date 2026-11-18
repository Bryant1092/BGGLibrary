/**
 * "Tell me when it's back", while the app is closed.
 *
 * The app's bells used to work only while the app was open (it checked every
 * 2 minutes on the phone). This scheduled job does the same check on the server
 * and sends a web push notification, so "Wingspan is back" reaches the lock
 * screen even when nobody has the app open.
 *
 * Data (written by the app, see WatchService / PushService):
 *   users/{uid}/watches/{gameId}   { name, shelf, at }   a bell that's on
 *   users/{uid}/pushSubs/{id}      { sub, at }           a phone that allowed notifications
 *
 * Every 2 minutes:
 *   1. Read ONE summary document, meta/watchIndex, listing every bell ("uid__gameId").
 *      It's kept up to date by syncWatchIndex below whenever a bell is added or
 *      removed. (Reading every bell each run cost one read per bell, ~43,000 reads
 *      a day for 10 people; the summary costs ~720.)
 *   2. Ask Tabletop.Events about each belled game once (not once per person).
 *      Those requests are free; only Firestore reads count against the quota.
 *   3. For games available again: read just those bells, notify their owners, and
 *      remove the bells (a bell fires once, like a "back in stock" alert).
 *   Paused 2-7 AM Dallas time while nothing moves at the library. 2 AM, not
 *   midnight: volunteers keep checking in and shelving returns for a while after
 *   closing, and start scanning the overnight front-desk drop-offs before opening.
 *   Event reminders (sendEventReminders) run in the same job at all hours.
 *
 * Cost (Firebase Blaze free allowance, Nov 2026): ~22,000 runs a month vs 2,000,000
 * free; one Cloud Scheduler job (3 free); ~1,500 Firestore reads a day vs 50,000
 * free. Web push itself is free (browser push services). Expected: $0.
 *
 * Web push uses the standard Push API with our own VAPID keys (no Firebase Cloud
 * Messaging SDK in the app): it's what iPhone Home Screen apps support (iOS 16.4+),
 * and Angular's service worker already shows these notifications and opens the
 * app when one is tapped.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp();

/** Private half of the push key pair. Set with: firebase functions:secrets:set VAPID_PRIVATE_KEY */
const VAPID_PRIVATE_KEY = defineSecret('VAPID_PRIVATE_KEY');
/** Public half; the same value is in the app (src/app/config/push.ts). */
const VAPID_PUBLIC_KEY = 'BFXUu1DwgPuypGBfDtIRruPRlR1XGT3b49BUQQp0QWUTWxdGeFS4Jb22EDwsm1k9OknQuCGdURx1MBiBMKRFsTY';
/** Where the app lives; also the push "subject" (a contact URL is allowed instead of an email). */
const APP_URL = 'https://bryant1092.github.io/BGGLibrary/';
const TTE_GAME = id => `https://tabletop.events/api/librarygame/${encodeURIComponent(id)}`;
/** Be gentle with Tabletop.Events: a few requests at a time. */
const PARALLEL = 4;

/** Summary of every bell: { bells: { "<uid>__<gameId>": true }, rebuiltAt }. Server-only (no client rule). */
const WATCH_INDEX = 'meta/watchIndex';
const KEY_SEP = '__';
/** Rebuild the summary from the bells themselves once a day, in case a sync was ever missed. */
const INDEX_REBUILD_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps meta/watchIndex in step with users/{uid}/watches/{gameId}: adds the key when a
 * bell appears, removes it when the bell is deleted. Writes only (no reads), a few
 * hundred runs a day at most (2,000,000 free a month).
 */
exports.syncWatchIndex = onDocumentWritten({ document: 'users/{uid}/watches/{gameId}', region: 'us-central1' }, async event => {
  const key = event.params.uid + KEY_SEP + event.params.gameId;
  const ref = admin.firestore().doc(WATCH_INDEX);
  if (event.data?.after?.exists) {
    await ref.set({ bells: { [key]: true } }, { merge: true });
  } else {
    await ref.update(new admin.firestore.FieldPath('bells', key), admin.firestore.FieldValue.delete())
      .catch(() => { /* summary doesn't exist yet: nothing to remove */ });
  }
});

/** 2:00-6:59 AM in Dallas: the library is closed and no one is shelving. */
function libraryQuietHours(now) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now));
  return hour >= 2 && hour < 7;
}

/**
 * The bells to check: from the summary (1 read). The summary is rebuilt from the bells
 * themselves when missing or a day old (one read per bell, once a day). The rebuild only
 * adds keys; stale keys are removed when their bell turns out not to exist.
 */
async function loadBellKeys(db, now) {
  const ref = db.doc(WATCH_INDEX);
  const snap = await ref.get();
  const data = snap.data() || {};
  const rebuiltAt = data.rebuiltAt?.toMillis?.() || 0;
  if (snap.exists && now - rebuiltAt < INDEX_REBUILD_MS) return Object.keys(data.bells || {});
  const all = await db.collectionGroup('watches').get();
  const bells = {};
  all.docs.forEach(d => { bells[d.ref.parent.parent.id + KEY_SEP + d.id] = true; });
  await ref.set({ bells, rebuiltAt: admin.firestore.Timestamp.fromMillis(now) }, { merge: true });
  logger.info(`watch summary rebuilt: ${all.size} bells`);
  return [...new Set([...Object.keys(data.bells || {}), ...Object.keys(bells)])];
}

exports.checkWatchedGames = onSchedule({
  schedule: 'every 2 minutes',
  timeZone: 'America/Chicago',
  region: 'us-central1',
  secrets: [VAPID_PRIVATE_KEY],
  memory: '256MiB',
  timeoutSeconds: 90,
  // One run at a time, so two overlapping runs can't send the same alert twice.
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  const db = admin.firestore();
  const now = Date.now();
  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.value());

  // Starred-event reminders: every run, day and night (late-night events exist).
  await sendEventReminders(db, now).catch(err => logger.error('event reminders failed', err));

  if (libraryQuietHours(now)) return;
  const keys = await loadBellKeys(db, now);
  if (!keys.length) return;

  // gameId -> uids with a bell on it (several people can watch the same game).
  const byGame = new Map();
  for (const key of keys) {
    const at = key.indexOf(KEY_SEP);
    if (at < 0) continue;
    const uid = key.slice(0, at), gameId = key.slice(at + KEY_SEP.length);
    byGame.set(gameId, [...(byGame.get(gameId) || []), uid]);
  }

  if (tteCoolingDown()) return;
  const back = await gamesBack(byGame, now);
  let sent = 0;
  for (const [gameId, game] of back) {
    {
      for (const uid of byGame.get(gameId)) {
        // Only now are the bells themselves read: one read per person to notify.
        const bell = await db.doc(`users/${uid}/watches/${gameId}`).get();
        if (!bell.exists) {
          // Already gone (removed in the app): drop the stale summary entry.
          await db.doc(WATCH_INDEX).update(new admin.firestore.FieldPath('bells', uid + KEY_SEP + gameId), admin.firestore.FieldValue.delete()).catch(() => {});
          continue;
        }
        const n = await notifyOwner(db, bell, game);
        sent += n;
        if (n === 0) {
          // No phone could be reached (e.g. the Home Screen app was re-added and has no push address
          // yet; 2026-11-17 this silently ate an alert). Keep the bell: the app shows the alert and
          // clears it when it's next opened. The checkin cursor stops it from being sent again here.
          logger.info('no push address, bell kept for the app', { uid: bell.ref.parent.parent.id, gameId: game.id });
          continue;
        }
        // Bell done: it fires once. The app sees the bell disappear and updates;
        // syncWatchIndex removes it from the summary.
        await bell.ref.delete().catch(err => logger.warn('could not remove bell', err.message));
      }
    }
  }
  if (sent) logger.info(`${byGame.size} belled games, ${back.size} back, sent ${sent} notifications`);
});

/**
 * Which belled games are available again: Map gameId -> game.
 *
 * Asking Tabletop.Events about every belled game each run was ~1,200 requests an hour
 * from one address for 10 people (2026-11-16). Tabletop.Events publishes no limit but
 * blocks "abuse" (tabletop.events/developer), so instead each run asks for the games
 * checked in since the previous run, newest first (usually one page), and keeps the
 * belled ones that are on the shelf. Same 2-minute timing, so alerts are just as quick.
 *
 * Asked about directly, one by one (the old way), only when the list can't be trusted:
 * - a bell added since the last run (its game may have come back just before), and
 * - the first run after the server starts (no "previous run" to go from) or after a
 *   failed request, so nothing returned in the meantime is missed.
 */
let checkinCursor = 0;
const knownBells = new Set();

async function gamesBack(byGame, now) {
  const back = new Map();
  const direct = checkinCursor ? [...byGame.keys()].filter(id => !knownBells.has(id)) : [...byGame.keys()];
  let ok = true;

  if (checkinCursor) {
    // A little overlap with the previous run, in case of clock differences.
    const since = checkinCursor - 3 * 60 * 1000;
    for (let page = 1; page <= 20; page++) {
      const r = await tteJson(`${LIBRARY_GAMES}?_items_per_page=100&_page_number=${page}&_order_by=last_checkin_date&_sort_order=desc`);
      if (!r?.items) { ok = false; break; }
      let older = false;
      for (const g of r.items) {
        if (tteTime(g.last_checkin_date) < since) { older = true; break; }
        if (byGame.has(g.id) && Number(g.is_checked_out) === 0) back.set(g.id, g);
      }
      if (older || r.items.length < 100) break;
    }
  }

  for (let i = 0; i < direct.length; i += PARALLEL) {
    await Promise.all(direct.slice(i, i + PARALLEL).map(async id => {
      const { status, result: game } = await fetchGame(id);
      if (status === 404) return; // gone from the library: nothing to wait for
      if (!game) { ok = false; return; }
      if (Number(game.is_checked_out) === 0) back.set(id, game);
    }));
  }

  // Only move on when everything was checked; otherwise the next run checks every bell again.
  if (ok) { checkinCursor = now; byGame.forEach((_, id) => knownBells.add(id)); }
  else checkinCursor = 0;
  return back;
}

/**
 * Starred-event reminders.
 *
 * The app writes users/{uid}/eventStars/{eventId} { name, start, room, remindAt, at }
 * for each starred event, with remindAt = start minus the person's reminder time
 * (10/15/30 min; no remindAt when reminders are off). Each run asks only for
 * reminders that are due (remindAt <= now), so it costs one read when none are,
 * then clears remindAt so each reminder is sent once (Apple: don't send several
 * notifications about the same thing).
 *
 * Skipped (cleared without sending) when the event started more than 5 minutes ago,
 * e.g. the phone had no connection when it was due: a late "starting soon" is noise.
 * Needs the collection-group index on eventStars.remindAt (firestore.indexes.json).
 */
async function sendEventReminders(db, now) {
  const due = await db.collectionGroup('eventStars')
    .where('remindAt', '<=', admin.firestore.Timestamp.fromMillis(now))
    .limit(200).get();
  if (due.empty) return;
  let sent = 0;
  for (const star of due.docs) {
    const data = star.data();
    const start = data.start?.toMillis?.() || 0;
    if (start && start > now - 5 * 60 * 1000) sent += await remindOwner(db, star, start, now);
    await star.ref.update({ remindAt: admin.firestore.FieldValue.delete() }).catch(() => {});
  }
  logger.info(`event reminders: ${due.size} due, ${sent} notifications sent`);
}

async function remindOwner(db, star, start, now) {
  const uid = star.ref.parent.parent.id;
  const subs = await db.collection('users').doc(uid).collection('pushSubs').get();
  if (subs.empty) return 0;
  const data = star.data();
  const minutes = Math.round((start - now) / 60000);
  const time = new Date(start).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  const when = minutes > 0 ? `Starts in ${minutes} min (${time})` : `Starting now (${time})`;
  const payload = JSON.stringify({
    notification: {
      // Apple: put the event name in the title; keep the body short and complete.
      title: data.name || 'Your starred event',
      body: `${when}${data.room ? ` · ${data.room}` : ''}.`,
      icon: `${APP_URL}icons/icon-192x192.png`,
      tag: `event-${star.id}`,
      // Opens the event's details in the Events tab.
      data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: `${APP_URL}events?event=${encodeURIComponent(star.id)}` } } },
    },
  });
  let sent = 0;
  await Promise.all(subs.docs.map(async sub => {
    try {
      // TTL: no point delivering a "starts in 15 min" after the event began.
      await webpush.sendNotification(sub.data().sub, payload, { TTL: 20 * 60, urgency: 'high' });
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) await sub.ref.delete().catch(() => {});
      else logger.warn('reminder push failed', err.statusCode);
    }
  }));
  return sent;
}

/** The game from Tabletop.Events, or null if the request failed (tried again next run). */
/**
 * Every server request to Tabletop.Events goes through here.
 * - Names the app in the User-Agent (no personal details), so if Tabletop.Events looks
 *   at its traffic it can see what this is.
 * - Backs off: if Tabletop.Events answers 429 (too many requests) or 503 (overloaded),
 *   all requests from this server pause for 10 minutes instead of retrying.
 * Returns { status, result } (result null when the request failed).
 */
const TTE_HEADERS = { 'User-Agent': 'BGGLibraryFanApp/1.0 (convention library helper)' };
const TTE_COOLDOWN_MS = 10 * 60 * 1000;
let tteCooldownUntil = 0;

function tteCoolingDown() {
  return Date.now() < tteCooldownUntil;
}

async function tteGet(url, ms = 20000) {
  if (tteCoolingDown()) return { status: 0, result: null };
  try {
    const res = await fetch(url, { headers: TTE_HEADERS, signal: AbortSignal.timeout(ms) });
    if (res.status === 429 || res.status === 503) {
      tteCooldownUntil = Date.now() + TTE_COOLDOWN_MS;
      logger.warn(`Tabletop.Events answered ${res.status}: pausing requests for 10 minutes`);
    }
    if (!res.ok) return { status: res.status, result: null };
    return { status: res.status, result: (await res.json())?.result || null };
  } catch {
    return { status: 0, result: null };
  }
}

/** One library game: { status, result }; 404 = no longer in the library. */
function fetchGame(id) {
  return tteGet(TTE_GAME(id), 15000);
}

/** Sends "X is back" to every phone of the bell's owner; returns how many were sent. */
async function notifyOwner(db, bell, game) {
  const uid = bell.ref.parent.parent.id;
  const subs = await db.collection('users').doc(uid).collection('pushSubs').get();
  if (subs.empty) return 0;
  const name = bell.data().name || game.name;
  const shelf = game.custom_fields?.Location || bell.data().shelf || '';
  const when = checkedInTime(game.last_checkin_date);
  // Angular's service worker shows `notification`; the tag replaces the in-app alert's
  // notification for the same game. On tap it opens that game's details (?game=, the same
  // link as sharing a game; 2026-11-18, it used to open My Lists). "navigate…" rather than
  // "focus…": if the app is still open in the background, it's sent to the game too,
  // instead of just coming forward wherever it was.
  const payload = JSON.stringify({
    notification: {
      title: `${name} is back`,
      body: `Available${shelf ? ` on shelf ${shelf}` : ''}${when ? `, checked in ${when}` : ''}.`,
      icon: `${APP_URL}icons/icon-192x192.png`,
      tag: bell.id,
      data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: `${APP_URL}library/home?game=${encodeURIComponent(bell.id)}` } } },
    },
  });
  let sent = 0;
  await Promise.all(subs.docs.map(async sub => {
    try {
      await webpush.sendNotification(sub.data().sub, payload, { TTL: 60 * 60, urgency: 'high' });
      sent++;
    } catch (err) {
      // 404/410: the phone unsubscribed or the app was removed. Forget that phone.
      if (err.statusCode === 404 || err.statusCode === 410) await sub.ref.delete().catch(() => {});
      else logger.warn('push failed', err.statusCode, err.body);
    }
  }));
  return sent;
}

/** "7:51 PM" in Dallas time from a Tabletop.Events UTC timestamp. */
function checkedInTime(value) {
  if (!value) return '';
  const date = new Date(String(value).trim().replace(' ', 'T') + 'Z');
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Prize drawings: "You won!" even when the app is closed.
//
// Every BGG.CON since 2023 (and BGG.Spring) posts the day's prize-drawing winners
// in the news as a table: Bundle # | Badge # | Name. Winners must pick up the next
// day or the prize goes back into the drawing. People who saved their badge number
// in the app (prizeBadges/{uid}) get a push notification when it appears.
//
// Every 10 minutes, but it only reads the news while a BGG convention is on (from
// 2 days before to 2 days after); otherwise it stops after one small lookup.
// Cost: ~4,300 runs a month (2,000,000 free) and one more Cloud Scheduler job
// (3 free). Expected: $0.
// ---------------------------------------------------------------------------
const BGG_LIBRARY_ID = '0AEB11DA-2B7D-11EC-B400-855F800FD618';

exports.checkPrizeDrawings = onSchedule({
  schedule: 'every 10 minutes',
  timeZone: 'America/Chicago',
  region: 'us-central1',
  secrets: [VAPID_PRIVATE_KEY],
  memory: '256MiB',
  timeoutSeconds: 300, // the first run downloads every game's count (~91 requests)
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  // Paused 2-7 AM Dallas like the game alerts: no drawings, checkouts or news then, and
  // it spares Tabletop.Events overnight. The 7 AM run catches up from where it stopped.
  if (libraryQuietHours(Date.now()) || tteCoolingDown()) return;
  const { active: con, lastEnd } = await conventionWindow();
  const db = admin.firestore();
  if (!con) {
    // Between conventions: badge numbers change every convention, so 14 days after
    // the last one ended, numbers saved before its end are deleted. This catches
    // people who never open the app again (the app clears its own copy on open,
    // PrizeService.start). Usually an empty query: one read per run.
    if (lastEnd && Date.now() >= lastEnd + BADGE_KEEP_MS) {
      const old = await db.collection('prizeBadges').where('at', '<=', new Date(lastEnd)).limit(400).get();
      if (!old.empty) {
        const batch = db.batch();
        old.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        logger.info(`prize badges cleared after the convention: ${old.size}`);
      }
    }
    return;
  }
  // "Most played this con" rides along on this job (already con-only, every 10 min).
  await trackConCheckouts(db, con).catch(err => logger.error('con checkouts failed', err));
  const people = await db.collection('prizeBadges').get();
  if (people.empty) return;
  const updates = await tteJson(`https://tabletop.events/api/convention/${con.id}/updates?_items_per_page=100`);
  const posts = (updates?.items || []).filter(u => Number(u.published) === 1)
    .map(u => ({ id: u.id, title: (u.name || '').trim(), html: u.body_html || '', date: u.date_posted || '' }));
  if (!posts.length) return;

  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.value());
  // Where BGG says the booth is this convention, in their words (newest post first).
  const newestFirst = [...posts].sort((a, b) => b.date.localeCompare(a.date));
  const booth = findPrizeBooth(newestFirst);
  const where = booth.quote ? `at the BGG Prize Booth, ${booth.quote},` : 'at the BGG Prize Booth';
  let sent = 0;
  for (const person of people.docs) {
    const { badge, notified = [] } = person.data();
    const fresh = findPrizeWins(posts, badge).filter(w => !notified.includes(w.key));
    if (!fresh.length) continue;
    const subs = await db.collection('users').doc(person.id).collection('pushSubs').get();
    for (const win of fresh) {
      const payload = JSON.stringify({
        notification: {
          title: '🎉 You won a BGG prize drawing!',
          body: `Badge #${win.badge}: ${win.section}${win.bundle ? `, bundle ${win.bundle}` : ''}. Pick it up ${where} the next day, or it goes back into the drawing.`,
          icon: `${APP_URL}icons/icon-192x192.png`,
          tag: `prize-${win.key}`,
          requireInteraction: true,
          data: { onActionClick: { default: { operation: 'focusLastFocusedOrOpen', url: APP_URL } } },
        },
      });
      await Promise.all(subs.docs.map(async sub => {
        try { await webpush.sendNotification(sub.data().sub, payload, { TTL: 24 * 60 * 60, urgency: 'high' }); sent++; }
        catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) await sub.ref.delete().catch(() => {});
          else logger.warn('prize push failed', err.statusCode);
        }
      }));
    }
    // Remember them even with no phone registered: the app shows "You won!" when opened.
    await person.ref.update({ notified: admin.firestore.FieldValue.arrayUnion(...fresh.map(w => w.key)) });
  }
  logger.info(`prize check: ${con.name}, ${posts.length} posts, ${people.size} badges, ${sent} notifications`);
});

// ---------------------------------------------------------------------------
// "Most played this con" (Library tab: Top 5 card and a sort option).
//
// Tabletop.Events only has each game's ALL-TIME checkout_count (individual checkouts
// aren't public). So: save every game's count just before the library opens
// (meta/conCheckoutBaseline, server-only), and during the con "this con" = current
// count - saved count. Each run only reads the games checked out since then (the API
// can sort by last_checkout_date), adds copies of the same game together (bgg_id),
// and saves the top 100 to meta/conCheckouts, which the app reads (one document).
// Staff scans that don't raise the count (e.g. intake on 2026-11-15) don't count.
// Cost: Tabletop.Events requests are free; one Firestore write per change.
// ---------------------------------------------------------------------------
const LIBRARY_GAMES = `https://tabletop.events/api/library/${BGG_LIBRARY_ID}/librarygames`;
const CON_BASELINE = 'meta/conCheckoutBaseline';
const CON_TOP = 'meta/conCheckouts';
/** The starting counts are taken again this long before opening, so pre-con staff scans aren't counted. */
const BASELINE_REFRESH_MS = 40 * 60 * 1000;
let baselineCache = null;
let openCache = null;
let lastWritten = '';

const tteTime = value => value ? new Date(String(value).trim().replace(' ', 'T') + 'Z').getTime() : 0;

/** When the library first opens: BGG lists the library's hours as "Library" events. */
async function libraryOpens(con) {
  if (openCache?.conId === con.id) return openCache.at;
  const res = await tteJson(`https://tabletop.events/api/convention/${con.id}/events?_items_per_page=100&_order_by=start_date`);
  const first = (res?.items || []).find(e => /^library$/i.test((e.name || '').trim()));
  const at = first ? tteTime(first.start_date) : tteTime(con.start_date);
  openCache = { conId: con.id, at };
  return at;
}

/** Every in-circulation game's checkout_count right now ({ id: count }), or null if a page failed. */
async function allCheckoutCounts() {
  const url = page => `${LIBRARY_GAMES}?_items_per_page=100&_page_number=${page}&_order_by=name&is_in_circulation=1`;
  const first = await tteJson(url(1));
  if (!first?.items) return null;
  const pages = Number(first.paging?.total_pages) || 1;
  const counts = {};
  first.items.forEach(g => { counts[g.id] = Number(g.checkout_count) || 0; });
  for (let p = 2; p <= pages; p += PARALLEL) {
    const batch = await Promise.all(Array.from({ length: Math.min(PARALLEL, pages - p + 1) }, (_, i) => tteJson(url(p + i))));
    if (batch.some(r => !r?.items)) return null;
    batch.forEach(r => r.items.forEach(g => { counts[g.id] = Number(g.checkout_count) || 0; }));
  }
  return counts;
}

async function conBaseline(db, con, open, now) {
  let base = baselineCache?.conId === con.id ? baselineCache : (await db.doc(CON_BASELINE).get()).data();
  const missing = !base || base.conId !== con.id;
  // Retake once in the last 40 minutes before opening (counts may have moved since).
  const refresh = !missing && now < open && now >= open - BASELINE_REFRESH_MS && base.takenAt < open - BASELINE_REFRESH_MS;
  if (missing || refresh) {
    const counts = await allCheckoutCounts();
    if (!counts) return base?.conId === con.id ? base : null; // try again next run
    base = { conId: con.id, conName: con.name, takenAt: now, open, counts };
    await db.doc(CON_BASELINE).set(base);
    logger.info(`con checkouts: starting counts saved for ${Object.keys(counts).length} games${now > open ? ' (after opening: late start)' : ''}`);
  }
  baselineCache = base;
  return base;
}

/**
 * Progress between runs (meta/conCheckoutState, server-only): which games have checkouts
 * this con, and the newest checkout already processed. Tabletop.Events took ~10 s per
 * page when tested (2026-11-16), so each run only fetches what's new since the last one
 * (usually 1-3 pages) instead of everything since the start.
 */
const CON_STATE = 'meta/conCheckoutState';
let stateCache = null;

async function trackConCheckouts(db, con) {
  const now = Date.now();
  const open = await libraryOpens(con);
  const base = await conBaseline(db, con, open, now);
  if (!base || now < open) return;

  let state = stateCache?.conId === con.id ? stateCache : (await db.doc(CON_STATE).get()).data();
  if (!state || state.conId !== con.id || state.takenAt !== base.takenAt) state = { conId: con.id, takenAt: base.takenAt, seenUntil: base.takenAt, perId: {} };
  // A little overlap, in case two checkouts share a timestamp across runs.
  const cutoff = state.seenUntil - 5 * 60 * 1000;

  // Games checked out since the last run, newest first; 4 pages at a time; stop at older ones.
  const url = page => `${LIBRARY_GAMES}?_items_per_page=100&_page_number=${page}&_order_by=last_checkout_date&_sort_order=desc&_include=bgg_icon_uri`;
  const recent = [];
  let newest = state.seenUntil, done = false;
  for (let page = 1; !done && page <= 80; page += PARALLEL) {
    const batch = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => tteJson(url(page + i))));
    for (const r of batch) {
      if (!r?.items) return; // Tabletop.Events unreachable: keep the last list, try again next run
      for (const g of r.items) {
        const at = tteTime(g.last_checkout_date);
        if (at < cutoff) { done = true; break; }
        newest = Math.max(newest, at);
        recent.push(g);
      }
      if (done || r.items.length < 100) { done = true; break; }
    }
  }

  // Update each recently checked-out game's count for this con.
  for (const g of recent) {
    const before = base.counts[g.id] ?? (tteTime(g.date_created) > base.takenAt ? 0 : null); // added during the con: from 0
    if (before == null) continue;
    const delta = (Number(g.checkout_count) || 0) - before;
    if (delta > 0) state.perId[g.id] = { c: delta, n: String(g.name || '').trim(), b: g.bgg_id || null, t: g.bgg_icon_uri || '' };
    else delete state.perId[g.id];
  }
  state.seenUntil = newest;
  stateCache = state;
  // Same checkouts feed this con's play-time / shelf-time averages (own state, own document).
  await trackPlayTimes(db, con, base, recent).catch(err => logger.error('play times failed', err));

  // Add copies of the same game together, most checkouts first.
  const byGame = new Map();
  for (const [id, g] of Object.entries(state.perId)) {
    const key = g.b ? `bgg:${g.b}` : `name:${g.n.toLowerCase()}`;
    const entry = byGame.get(key) || { name: g.n, ids: [], count: 0, thumb: '', bggId: g.b };
    entry.ids.push(id);
    entry.count += g.c;
    if (!entry.thumb && g.t) entry.thumb = g.t;
    if (g.n.length < entry.name.length) entry.name = g.n; // "Heat" over "Heat (English edition)"
    byGame.set(key, entry);
  }
  const games = [...byGame.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 100);
  const snapshot = JSON.stringify(games);
  if (snapshot === lastWritten) return; // nothing changed: no writes, so phones don't re-read it
  await db.doc(CON_STATE).set(state);
  await db.doc(CON_TOP).set({
    conId: con.id, conName: con.name, games,
    countingSince: admin.firestore.Timestamp.fromMillis(base.takenAt),
    updatedAt: admin.firestore.Timestamp.fromMillis(now),
  });
  lastWritten = snapshot;
  logger.info(`con checkouts: ${games.length} games ranked (${recent.length} checked out since the last run)`);
}

// ---------------------------------------------------------------------------
// This con's real play time and shelf time per game (asked for 2026-11-18 at the con).
//
// The library's own average_seconds_checked_out covers every past con and was often
// off. Tabletop.Events keeps only each copy's latest checkout and check-in time, so
// this job records each one as it happens:
// - Time out: when a copy comes back, its check-in minus its checkout.
// - Time on the shelf: when a copy goes out, its checkout minus its previous check-in
//   (only if that check-in was during this con).
// Hours the library is closed (midnight-8 AM Dallas) don't count, so a game out
// overnight isn't counted as 8 hours of play.
// Results go to meta/conPlayTimes (public, one document; the app switches from the
// library's average to this one once a game has PLAY_MIN_SAMPLES plays).
// Cost: 1-2 extra Tabletop.Events pages per 10-minute run (recent check-ins); two
// Firestore writes per run, only when something changed.
// ---------------------------------------------------------------------------
const PLAY_STATE = 'meta/conPlayState';
const PLAY_TIMES = 'meta/conPlayTimes';
let playCache = null;

/**
 * Milliseconds between a and b with the library's closed hours (midnight-8 AM Dallas)
 * left out. Dallas is UTC-6 for the whole of BGG.CON (November, standard time) and
 * UTC-5 for BGG.Spring (daylight time), so the closed window is 06:00-14:00 or
 * 05:00-13:00 UTC; the offset is read from the date itself.
 */
function openMs(a, b) {
  if (!(b > a)) return 0;
  let closed = 0;
  const day = 24 * 3600 * 1000;
  for (let d = Math.floor(a / day) * day - day; d <= b; d += day) {
    const offsetH = dallasUtcOffsetHours(d + 12 * 3600 * 1000);
    const start = d + offsetH * 3600 * 1000, end = start + 8 * 3600 * 1000; // local 00:00-08:00
    closed += Math.max(0, Math.min(b, end) - Math.max(a, start));
  }
  return b - a - closed;
}

/** Hours Dallas is behind UTC at that moment (6 in winter, 5 in summer). */
function dallasUtcOffsetHours(ms) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)));
  return (new Date(ms).getUTCHours() - h + 24) % 24;
}

/** Same grouping as the ranking: copies of a game count together. */
const playKey = g => g.bgg_id ? `bgg:${g.bgg_id}` : `name:${String(g.name || '').trim().toLowerCase()}`;

async function trackPlayTimes(db, con, base, recentCheckouts) {
  let state = playCache?.conId === con.id ? playCache : (await db.doc(PLAY_STATE).get()).data();
  if (!state || state.conId !== con.id) {
    // lastIn / lastOut: the check-in / checkout already counted per copy, so the overlap
    // between runs (and copies seen twice) never counts one twice.
    state = { conId: con.id, inSeenUntil: base.open, lastIn: {}, lastOut: {}, sums: {} };
  }
  let changed = false;
  const add = (g, field, ms) => {
    const k = playKey(g);
    const s = state.sums[k] || (state.sums[k] = { o: 0, on: 0, s: 0, sn: 0 });
    s[field] += ms; s[field + 'n'] += 1;
    changed = true;
  };

  /** One play (checkout -> check-in) of a copy, counted once per check-in (lastIn). */
  const play = (g, out, back) => {
    if (!out || !(back > out) || state.lastIn[g.id] === back) return;
    state.lastIn[g.id] = back;
    (state.inAt ||= {})[g.id] = Math.max(state.inAt[g.id] || 0, back);
    // A real play this con: checked out after opening. Over 10 open hours is a check-in
    // that was never scanned, not a play.
    const ms = openMs(out, back);
    if (out >= base.open && ms > 0 && ms <= 10 * 3600 * 1000) add(g, 'o', ms);
  };

  // Copies that went out since the last run. Tabletop.Events keeps only each copy's latest
  // checkout and check-in, so between two runs (10 min) a copy can be in three states, all
  // handled here (logic re-checked 2026-11-18 after Hell of a Deal showed 2 plays, 8 pickups):
  // - Still out (check-in older than this checkout): that check-in ended its previous play
  //   (from outAt, the checkout we saw last time) and started its shelf time.
  // - Already back (a quick game): this checkout -> check-in is the play. Its shelf time
  //   started at the check-in we saw before (inAt), since Tabletop.Events has replaced it.
  // - Back and out again more than once between runs: the middle plays can't be recovered.
  // The check-in scan below also counts plays; lastIn stops the same play counting twice.
  for (const g of recentCheckouts) {
    const out = tteTime(g.last_checkout_date), back = tteTime(g.last_checkin_date);
    if (state.lastOut[g.id] === out) continue;
    const prevOut = state.outAt?.[g.id];
    let shelfFrom;
    if (back < out) {
      if (prevOut && prevOut < back) play(g, prevOut, back);
      shelfFrom = back;
    } else {
      // Read the earlier check-in first: play() records this new one in inAt.
      shelfFrom = state.inAt?.[g.id] && state.inAt[g.id] < out ? state.inAt[g.id] : 0;
      play(g, out, back);
    }
    (state.outAt ||= {})[g.id] = out;
    state.lastOut[g.id] = out;
    // Shelf time only from a check-in during this con (not the pre-con intake scan).
    if (shelfFrom >= base.open && shelfFrom < out) add(g, 's', openMs(shelfFrom, out));
  }

  // Time out: copies checked in since the last run, newest first; stop at older ones.
  const cutoff = state.inSeenUntil - 5 * 60 * 1000;
  const url = page => `${LIBRARY_GAMES}?_items_per_page=100&_page_number=${page}&_order_by=last_checkin_date&_sort_order=desc&is_checked_out=0`;
  let newest = state.inSeenUntil;
  outer: for (let page = 1; page <= 40; page++) {
    const r = await tteJson(url(page));
    if (!r?.items) return; // Tabletop.Events unreachable: nothing saved, try again next run
    for (const g of r.items) {
      const back = tteTime(g.last_checkin_date), out = tteTime(g.last_checkout_date);
      if (back < cutoff) break outer;
      newest = Math.max(newest, back);
      play(g, out, back);
    }
    if (r.items.length < 100) break;
  }
  state.inSeenUntil = newest;
  // Drop old marks to keep the saved state small all con. Kept 12 hours, not 1: a copy can sit
  // on the shelf for hours, and when it goes out again its check-in mark (lastIn) stops that
  // play being counted twice, and outAt is where its play started. Longer than a con day's
  // 10 counted hours, so nothing still needed is dropped.
  const keep = Date.now() - 12 * 3600 * 1000;
  for (const m of [state.lastIn, state.lastOut, state.outAt || {}, state.inAt || {}]) for (const id of Object.keys(m)) if (m[id] < keep) delete m[id];
  playCache = state;
  if (!changed) {
    // No new averages, but new checkouts were noted (outAt): save those so a server restart
    // doesn't forget where those plays started. One small server-only write; phones don't read it.
    if (recentCheckouts.length) await db.doc(PLAY_STATE).set(state);
    return;
  }

  // Public summary, per game: [avg minutes out, plays, avg minutes on the shelf, times].
  const games = {};
  for (const [k, s] of Object.entries(state.sums)) {
    games[k] = [s.on ? Math.round(s.o / s.on / 60000) : 0, s.on, s.sn ? Math.round(s.s / s.sn / 60000) : 0, s.sn];
  }
  await db.doc(PLAY_STATE).set(state);
  await db.doc(PLAY_TIMES).set({ conId: con.id, conName: con.name, games, updatedAt: admin.firestore.Timestamp.fromMillis(Date.now()) });
  logger.info(`play times: ${Object.keys(games).length} games`);
}

/** Saved badge numbers are kept this long after a convention's last day. */
const BADGE_KEEP_MS = 14 * 24 * 3600 * 1000;

/**
 * active: the BGG convention happening now (or within 2 days), or null.
 * lastEnd: when the most recent finished one ended (ms), for clearing old badges.
 */
async function conventionWindow() {
  const now = Date.now(), slack = 2 * 24 * 3600 * 1000;
  let lastEnd = 0;
  for (const q of ['BGG.CON', 'BGG.Spring']) {
    const res = await tteJson(`https://tabletop.events/api/convention?query=${encodeURIComponent(q)}&_items_per_page=50`);
    for (const c of res?.items || []) {
      if (c.library_id !== BGG_LIBRARY_ID || Number(c.cancelled) === 1) continue;
      const start = new Date(c.start_date.replace(' ', 'T') + 'Z').getTime();
      const end = new Date(c.end_date.replace(' ', 'T') + 'Z').getTime();
      if (now >= start - slack && now <= end + slack) return { active: c, lastEnd };
      // end_date is the last day at 00:00; +1 day covers that whole day.
      const lastDayOver = end + 24 * 3600 * 1000;
      if (lastDayOver < now) lastEnd = Math.max(lastEnd, lastDayOver);
    }
  }
  return { active: null, lastEnd };
}

async function tteJson(url) {
  return (await tteGet(url, 20000)).result;
}

// Same parser as the app's src/app/util/prize-drawing.ts (keep them in step).
function findPrizeBooth(posts) {
  const re = /prize booth\s*(?:[-–—(:,]\s*)*(?:is\s+)?(?:now\s+)?(?:located\s+)?(?:up\s+|right\s+|over\s+)?(?:near|by|next to|beside|inside|in|at)\s+(?:the\s+)?([^.)\n]{3,70})/i;
  for (const post of posts) {
    const m = strip(post.html || '').match(re);
    if (!m) continue;
    const place = m[1];
    const short = place.match(/^.*?(registration\s*\/\s*information desk|information desk|registration(?: desk| area)?|exhibit hall|marsalis hall [ab]?)/i)?.[0] ?? place.split(/\s+/).slice(0, 6).join(' ');
    const quote = (m[0].slice(0, m[0].length - m[1].length) + short).replace(/^prize booth\s*[-–—(:,]*\s*/i, '').replace(/\s+/g, ' ').trim();
    return { quote };
  }
  return { quote: '' };
}
const strip = html => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
const normalizeBadge = v => String(v || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
function findPrizeWins(posts, badgeInput) {
  const badge = normalizeBadge(badgeInput);
  if (!badge) return [];
  const wins = [];
  for (const post of posts) {
    let tableNo = 0;
    for (const table of post.html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
      tableNo++;
      const rows = [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(r => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => strip(c[1])));
      if (rows.length < 2) continue;
      const badgeCol = rows[0].findIndex(h => /badge/i.test(h));
      if (badgeCol < 0) continue;
      const bundleCol = rows[0].findIndex(h => /bundle|prize|place|game\s*#/i.test(h));
      const heading = [...post.html.slice(0, table.index).matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].pop();
      const section = heading ? strip(heading[1]) : 'Prize drawing';
      rows.slice(1).forEach((cells, i) => {
        if (normalizeBadge(cells[badgeCol]) !== badge) return;
        wins.push({ key: `${post.id}:${tableNo}:${i}`, badge, section,
          bundle: (bundleCol >= 0 ? cells[bundleCol] : cells[0] !== cells[badgeCol] ? cells[0] : '') || '' });
      });
    }
  }
  return wins;
}
