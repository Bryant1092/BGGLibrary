import { Convention, CONVENTIONS, LIBRARY_RULES, LibraryDay } from '../config/conventions';
import { parseTteDate } from './time-ago';

/**
 * Library schedule and due-time math, all in Dallas time.
 *
 * Everything here works in America/Chicago rather than the phone's own time
 * zone: library hours and the "midnight to 8 AM doesn't count" rule are Dallas
 * wall-clock times, and someone checking the app from another time zone (or a
 * phone that never switched) should still get correct answers. Displayed times
 * get a " CT" suffix when the phone's time zone differs from Dallas.
 */
export const LIBRARY_TIME_ZONE = 'America/Chicago';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

interface WallClock { y: number; m: number; d: number; h: number; mi: number; }

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: LIBRARY_TIME_ZONE, hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

/** Dallas wall-clock parts for an instant. */
function wallClock(ms: number): WallClock & { s: number } {
  const p: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p['year'], m: p['month'], d: p['day'], h: p['hour'] % 24, mi: p['minute'], s: p['second'] };
}

/** Dallas UTC offset (ms) at an instant; e.g. -5 h during daylight saving time. */
function offsetAt(ms: number): number {
  const w = wallClock(ms);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

/** The instant of a Dallas wall-clock time. Day/hour overflow is allowed (e.g. d + 1, h = 24). */
function fromWallClock(y: number, m: number, d: number, h = 0, mi = 0): number {
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  // Two passes so times next to a daylight-saving change use the right offset.
  const first = asUtc - offsetAt(asUtc);
  return asUtc - offsetAt(first);
}

/** YYYY-MM-DD in Dallas time. */
export function dallasDateKey(ms: number): string {
  const w = wallClock(ms);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** "HH:MM" (24-hour) in Dallas for an instant. */
export function dallasTimeKey(ms: number): string {
  const w = wallClock(ms);
  return `${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
}

function dayInstant(day: LibraryDay, time: string): number {
  const [y, m, d] = day.date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return fromWallClock(y, m, d, h, mi);
}

const clockFormatter = new Intl.DateTimeFormat('en-US', { timeZone: LIBRARY_TIME_ZONE, hour: 'numeric', minute: '2-digit' });
const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: LIBRARY_TIME_ZONE, weekday: 'short' });
const monthDayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: LIBRARY_TIME_ZONE, month: 'short', day: 'numeric' });

/** True when the phone isn't on Dallas time right now, so times need a " CT" label. */
function phoneIsNotOnDallasTime(now: number): boolean {
  return -new Date(now).getTimezoneOffset() * MINUTE !== offsetAt(now);
}

/** "3:45 PM" plus " tomorrow" / " yesterday" / " Sat" when not today, in Dallas time. */
export function formatLibraryTime(ms: number, now: number = Date.now()): string {
  let text = clockFormatter.format(new Date(ms)).replace(':00', '');
  const dayDiff = Math.round((Date.parse(dallasDateKey(ms)) - Date.parse(dallasDateKey(now))) / (24 * HOUR));
  if (dayDiff === 1) text += ' tomorrow';
  else if (dayDiff === -1) text += ' yesterday';
  // A weekday alone is ambiguous past a week (games left "checked out" since
  // the last convention would say "Mon"), so use the date instead.
  else if (Math.abs(dayDiff) > 6) text += ' ' + monthDayFormatter.format(new Date(ms));
  else if (dayDiff !== 0) text += ' ' + weekdayFormatter.format(new Date(ms));
  return phoneIsNotOnDallasTime(now) ? text + ' CT' : text;
}

/** "May 25" in Dallas time. */
export function formatLibraryDate(ms: number): string {
  return monthDayFormatter.format(new Date(ms));
}

/**
 * Checkouts older than this are treated as "probably never checked back in"
 * rather than past due. The library data still shows some games as checked
 * out months after a convention ended.
 */
export const STALE_CHECKOUT_MS = 48 * HOUR;

/** Short elapsed time for badges: "12m", "2h 5m", "3d". */
export function shortDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** "1 hr 30 min" style, rounded to 5 minutes. */
export function longDuration(ms: number): string {
  const total = Math.max(5, Math.round(ms / (5 * MINUTE)) * 5);
  const h = Math.floor(total / 60), m = total % 60;
  return [h ? `${h} hr` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

/** The convention happening now, or the next one coming up. */
/** True once the convention's library has opened for the first time. */
export function conventionStarted(con: Convention, now: number = Date.now()): boolean {
  return dayInstant(con.days[0], con.days[0].open) <= now;
}

export function currentOrNextConvention(now: number = Date.now()): Convention | undefined {
  return CONVENTIONS.find(c => dayInstant(c.days[c.days.length - 1], c.days[c.days.length - 1].close) > now);
}

/** How long after a convention's last library day a saved badge number is kept. */
export const BADGE_KEEP_MS = 14 * 24 * HOUR;

/**
 * Whether a badge number saved at `savedAt` belongs to a convention that ended more
 * than 14 days ago, so it should be cleared and the Account card starts blank for
 * the next convention (badge numbers change every convention).
 * Only the latest ended convention needs checking: CONVENTIONS always keeps it, and
 * a badge saved before an older one was also saved before it.
 * A number typed after a convention ended (for the next one) is kept.
 */
export function badgeExpired(savedAt: number, now: number = Date.now()): boolean {
  const ended = CONVENTIONS
    .map(c => dayInstant(c.days[c.days.length - 1], c.days[c.days.length - 1].close))
    .filter(end => end + BADGE_KEEP_MS <= now);
  return ended.length > 0 && savedAt <= Math.max(...ended);
}

/** The convention whose library days include this instant (Dallas date). */
function conventionOn(ms: number): Convention | undefined {
  const key = dallasDateKey(ms);
  return CONVENTIONS.find(c => c.days.some(d => d.date === key));
}

/**
 * open: green. closingSoon: amber, last hour before closing. closed: grey
 * (closing overnight is normal, so not red, which reads as an error).
 * upcoming: blue, before the convention starts.
 */
export type LibraryTone = 'open' | 'closingSoon' | 'closed' | 'upcoming';

export interface LibraryStatus {
  tone: LibraryTone;
  /** e.g. "Open until midnight", "Closed · opens 8 AM", "BGG.CON 2026 · Nov 18–22". */
  title: string;
  /** e.g. "3h 50m left", "Opens in 25 min", "Starts in 5 days". */
  detail: string;
}

/**
 * Time remaining for the status badge: "45 min" under an hour, otherwise
 * "3h 50m". Hours alone would mislead (3h 59m shown as "3 hrs"). Rounded up
 * to the minute so it never says "0 min" while the countdown is still running.
 */
export function countdownText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Whole days between two Dallas calendar dates (YYYY-MM-DD). */
function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / (24 * HOUR));
}

/** When the library opened today if it's open right now (Dallas time), otherwise null. */
export function libraryOpenSince(now: number = Date.now()): number | null {
  const today = conventionOn(now)?.days.find(d => d.date === dallasDateKey(now));
  if (!today) return null;
  const opens = dayInstant(today, today.open);
  return now >= opens && now < dayInstant(today, today.close) ? opens : null;
}

/** Library status badge for the header, or null when no convention is within 30 days. */
export function libraryStatus(now: number = Date.now()): LibraryStatus | null {
  // A convention day wins even after its final close, so the last afternoon
  // says "Closed for BGG.CON 2026" instead of jumping to the next convention.
  const convention = conventionOn(now) || currentOrNextConvention(now);
  if (!convention) return null;
  const todayKey = dallasDateKey(now);
  const today = convention.days.find(d => d.date === todayKey);

  if (!today) {
    const first = convention.days[0];
    const days = daysBetween(todayKey, first.date);
    // Far-off conventions aren't useful in the header.
    if (days > 30) return null;
    const last = convention.days[convention.days.length - 1];
    const lastDay = monthDayFormatter.format(new Date(dayInstant(last, '12:00'))).split(' ')[1];
    const range = `${monthDayFormatter.format(new Date(dayInstant(first, '12:00')))}–${lastDay}`;
    return { tone: 'upcoming', title: `${convention.name} · ${range}`, detail: days === 1 ? 'Starts tomorrow' : `Starts in ${days} days` };
  }

  const opens = dayInstant(today, today.open);
  const closes = dayInstant(today, today.close);
  if (now < opens) {
    return { tone: 'closed', title: `Closed · opens ${formatLibraryTime(opens, now)}`, detail: `Opens in ${countdownText(opens - now)}` };
  }
  if (now < closes) {
    const closeText = today.close === '24:00' ? 'midnight' : formatLibraryTime(closes, now);
    const left = closes - now;
    return { tone: left <= HOUR ? 'closingSoon' : 'open', title: `Open until ${closeText}`, detail: `${countdownText(left)} left` };
  }
  const next = convention.days[convention.days.indexOf(today) + 1];
  if (next) {
    // Only reachable if a day closes before midnight but isn't the last day.
    const nextOpen = dayInstant(next, next.open);
    return { tone: 'closed', title: `Closed · opens ${formatLibraryTime(nextOpen, now)}`, detail: `Opens in ${countdownText(nextOpen - now)}` };
  }
  const following = CONVENTIONS[CONVENTIONS.indexOf(convention) + 1];
  return { tone: 'closed', title: `Closed for ${convention.name}`, detail: following ? `Next: ${following.name}` : 'See you next time' };
}

/**
 * Adds checkout time, skipping midnight to 8 AM Dallas time, which the
 * library rules say doesn't count toward the due time.
 */
function addCountedTime(startMs: number, durationMs: number): number {
  let t = startMs;
  let left = durationMs;
  for (let i = 0; i < 30 && left > 0; i++) {
    const w = wallClock(t);
    if (w.h < LIBRARY_RULES.uncountedUntilHour) {
      t = fromWallClock(w.y, w.m, w.d, LIBRARY_RULES.uncountedUntilHour);
    }
    const day = wallClock(t);
    const midnight = fromWallClock(day.y, day.m, day.d + 1);
    const room = midnight - t;
    if (left <= room) return t + left;
    left -= room;
    t = midnight;
  }
  return t;
}

export interface DueInfo {
  checkedOutAt: number;
  dueAt: number;
  isLate: boolean;
  hours: number;
  /** e.g. "New games (blue barcode) are due in 4 hours." */
  rule: string;
  /** Typical return from the game's checkout history, only when it's before the due time. */
  soonerAt?: number;
  /** The due time is on a later day, so the overnight drop-off note applies. */
  overnight: boolean;
  /** The due time was moved up to the library's final closing time. */
  cappedAtFinalClose: boolean;
  /** Checked out more than STALE_CHECKOUT_MS ago: likely a check-in that was never recorded. */
  stale: boolean;
  finalCloseText?: string;
}

/** Fields of a Tabletop.Events game needed to work out when it's due. */
export interface DueInput {
  is_checked_out: number;
  last_checkout_date: string;
  average_seconds_checked_out: number;
  custom_fields?: { Location?: string };
}

/**
 * When a checked-out game is due back: checkout time + 4 h (NEW shelf) or 8 h
 * (everything else), not counting midnight-8 AM, and never later than the
 * library's final closing time for the convention. Returns null for games
 * that are available or have no checkout time.
 */
export function dueInfo(game: DueInput, now: number = Date.now()): DueInfo | null {
  if (!game.is_checked_out) return null;
  const checkedOut = parseTteDate(game.last_checkout_date);
  if (!checkedOut) return null;
  const checkedOutAt = checkedOut.getTime();
  const location = game.custom_fields?.Location || '';
  const shelf = location.toUpperCase();
  // Any shelf code with the word NEW is a new game (blue barcode, 4 hours):
  // "NEW" and "CARD RACK NEW" (new card games), confirmed with the user.
  const isNew = new RegExp(`\\b${LIBRARY_RULES.newGameShelf}\\b`).test(shelf);
  const isCard = shelf.includes('CARD RACK');
  const hours = isNew ? LIBRARY_RULES.newGameHours : LIBRARY_RULES.otherGameHours;
  const rule = isNew && isCard ? 'New card games (blue barcode) are due in 4 hours.'
    : isNew ? 'New games (blue barcode) are due in 4 hours.'
    : isCard ? 'Card and small box games (yellow barcode) are due in 8 hours.'
    : 'Older games (white barcode) are due in 8 hours.';

  let dueAt = addCountedTime(checkedOutAt, hours * HOUR);
  let cappedAtFinalClose = false;
  let finalCloseText: string | undefined;
  const convention = conventionOn(checkedOutAt);
  if (convention) {
    const last = convention.days[convention.days.length - 1];
    const finalClose = dayInstant(last, last.close);
    if (dueAt > finalClose && checkedOutAt < finalClose) {
      dueAt = finalClose;
      cappedAtFinalClose = true;
      finalCloseText = formatLibraryTime(finalClose, now);
    }
  }

  let soonerAt: number | undefined;
  const averageMs = (game.average_seconds_checked_out || 0) * 1000;
  if (averageMs > 0) {
    // The average includes overnight time, so it's only shown when it lands
    // before the due time and while the library is open.
    const estimate = Math.round((checkedOutAt + averageMs) / (5 * MINUTE)) * 5 * MINUTE;
    if (estimate > now && estimate < dueAt && wallClock(estimate).h >= LIBRARY_RULES.uncountedUntilHour) {
      soonerAt = estimate;
    }
  }

  const isLate = dueAt < now;
  return {
    checkedOutAt, dueAt, isLate, hours, rule, soonerAt, cappedAtFinalClose, finalCloseText,
    stale: now - checkedOutAt > STALE_CHECKOUT_MS,
    overnight: !isLate && !cappedAtFinalClose && dallasDateKey(dueAt) !== dallasDateKey(now),
  };
}
