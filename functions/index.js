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

  const gameIds = [...byGame.keys()];
  let sent = 0;
  for (let i = 0; i < gameIds.length; i += PARALLEL) {
    await Promise.all(gameIds.slice(i, i + PARALLEL).map(async gameId => {
      const game = await fetchGame(gameId);
      if (!game || Number(game.is_checked_out) !== 0) return;
      for (const uid of byGame.get(gameId)) {
        // Only now are the bells themselves read: one read per person to notify.
        const bell = await db.doc(`users/${uid}/watches/${gameId}`).get();
        if (!bell.exists) {
          // Already gone (removed in the app): drop the stale summary entry.
          await db.doc(WATCH_INDEX).update(new admin.firestore.FieldPath('bells', uid + KEY_SEP + gameId), admin.firestore.FieldValue.delete()).catch(() => {});
          continue;
        }
        sent += await notifyOwner(db, bell, game);
        // Bell done: it fires once. The app sees the bell disappear and updates;
        // syncWatchIndex removes it from the summary.
        await bell.ref.delete().catch(err => logger.warn('could not remove bell', err.message));
      }
    }));
  }
  if (sent) logger.info(`checked ${gameIds.length} belled games, sent ${sent} notifications`);
});

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
async function fetchGame(id) {
  try {
    const res = await fetch(TTE_GAME(id), { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return (await res.json())?.result || null;
  } catch {
    return null;
  }
}

/** Sends "X is back" to every phone of the bell's owner; returns how many were sent. */
async function notifyOwner(db, bell, game) {
  const uid = bell.ref.parent.parent.id;
  const subs = await db.collection('users').doc(uid).collection('pushSubs').get();
  if (subs.empty) return 0;
  const name = bell.data().name || game.name;
  const shelf = game.custom_fields?.Location || bell.data().shelf || '';
  const when = checkedInTime(game.last_checkin_date);
  // Angular's service worker shows `notification` and, on tap, opens My Lists
  // (onActionClick); the tag replaces the in-app alert's notification for the same game.
  const payload = JSON.stringify({
    notification: {
      title: `${name} is back`,
      body: `Available${shelf ? ` on shelf ${shelf}` : ''}${when ? `, checked in ${when}` : ''}.`,
      icon: `${APP_URL}icons/icon-192x192.png`,
      tag: bell.id,
      data: { onActionClick: { default: { operation: 'focusLastFocusedOrOpen', url: `${APP_URL}library/user` } } },
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
  timeoutSeconds: 120,
  maxInstances: 1,
  retryCount: 0,
}, async () => {
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
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    return res.ok ? (await res.json()).result : null;
  } catch {
    return null;
  }
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
