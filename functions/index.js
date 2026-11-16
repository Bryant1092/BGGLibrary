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
 *   1. Read every bell (one collection-group query).
 *   2. Ask Tabletop.Events about each belled game once (not once per person).
 *   3. For games available again: notify everyone with a bell on it, then remove
 *      those bells (a bell fires once, like a "back in stock" alert).
 *
 * Cost (Firebase Blaze free allowance, Nov 2026): ~22,000 runs a month vs 2,000,000
 * free; one Cloud Scheduler job (3 free); a few thousand Firestore reads a day vs
 * 50,000 free. Web push itself is free (browser push services). Expected: $0.
 *
 * Web push uses the standard Push API with our own VAPID keys (no Firebase Cloud
 * Messaging SDK in the app): it's what iPhone Home Screen apps support (iOS 16.4+),
 * and Angular's service worker already shows these notifications and opens the
 * app when one is tapped.
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
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
  const bells = await db.collectionGroup('watches').get();
  if (bells.empty) return;

  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.value());

  // gameId -> the bells on it (several people can watch the same game).
  const byGame = new Map();
  for (const doc of bells.docs) {
    const list = byGame.get(doc.id) || [];
    list.push(doc);
    byGame.set(doc.id, list);
  }

  const gameIds = [...byGame.keys()];
  let sent = 0;
  for (let i = 0; i < gameIds.length; i += PARALLEL) {
    await Promise.all(gameIds.slice(i, i + PARALLEL).map(async gameId => {
      const game = await fetchGame(gameId);
      if (!game || Number(game.is_checked_out) !== 0) return;
      for (const bell of byGame.get(gameId)) {
        sent += await notifyOwner(db, bell, game);
        // Bell done: it fires once. The app sees the bell disappear and updates.
        await bell.ref.delete().catch(err => logger.warn('could not remove bell', err.message));
      }
    }));
  }
  logger.info(`checked ${gameIds.length} belled games, sent ${sent} notifications`);
});

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
  const con = await activeConvention();
  if (!con) return;
  const db = admin.firestore();
  const people = await db.collection('prizeBadges').get();
  if (people.empty) return;
  const updates = await tteJson(`https://tabletop.events/api/convention/${con.id}/updates?_items_per_page=100`);
  const posts = (updates?.items || []).filter(u => Number(u.published) === 1)
    .map(u => ({ id: u.id, title: (u.name || '').trim(), html: u.body_html || '' }));
  if (!posts.length) return;

  webpush.setVapidDetails(APP_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.value());
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
          body: `Badge #${win.badge}: ${win.section}${win.bundle ? `, bundle ${win.bundle}` : ''}. Pick it up at the BGG Prize Booth (by Registration) the next day, or it goes back into the drawing.`,
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

/** The BGG convention happening now (or within 2 days), or null. */
async function activeConvention() {
  const now = Date.now(), slack = 2 * 24 * 3600 * 1000;
  for (const q of ['BGG.CON', 'BGG.Spring']) {
    const res = await tteJson(`https://tabletop.events/api/convention?query=${encodeURIComponent(q)}&_items_per_page=50`);
    for (const c of res?.items || []) {
      if (c.library_id !== BGG_LIBRARY_ID || Number(c.cancelled) === 1) continue;
      const start = new Date(c.start_date.replace(' ', 'T') + 'Z').getTime();
      const end = new Date(c.end_date.replace(' ', 'T') + 'Z').getTime();
      if (now >= start - slack && now <= end + slack) return c;
    }
  }
  return null;
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
