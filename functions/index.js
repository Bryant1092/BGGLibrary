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
