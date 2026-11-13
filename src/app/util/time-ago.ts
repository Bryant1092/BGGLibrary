/**
 * "5 minutes ago"-style formatting using the browser's built-in
 * Intl.RelativeTimeFormat.
 *
 * This replaces moment + moment-timezone, which were only used to produce this
 * text but added ~700 KB of timezone data to the app bundle (about half of the
 * main JS file). The thresholds below mirror moment's fromNow() so the wording
 * users see stays the same.
 */

const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30.4 * DAY; // average month length, same approximation moment uses
const YEAR = 365 * DAY;

/**
 * Parses Tabletop.Events timestamps ("2026-09-19 21:51:49").
 *
 * They carry no timezone, and the previous code treated them as UTC
 * (moment.tz(value, 'UTC')), so this keeps that assumption. If times turn out
 * to be off by a few hours at a convention, this is the one place to change.
 */
export function parseTteDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value.trim().replace(' ', 'T') + 'Z');
  return isNaN(date.getTime()) ? null : date;
}

/** Returns e.g. "just now", "5 minutes ago", "yesterday", "6 months ago", or "" if the date is missing/invalid. */
export function timeAgo(value: string | null | undefined, now: number = Date.now()): string {
  const date = parseTteDate(value);
  if (!date) {
    return '';
  }
  // Clamp to 0 so slight clock differences between the server and the phone
  // never produce "in 2 minutes".
  const elapsed = Math.max(0, now - date.getTime());

  if (elapsed < 45 * SECOND) {
    return 'just now';
  }
  if (elapsed < 45 * MINUTE) {
    return formatter.format(-Math.max(1, Math.round(elapsed / MINUTE)), 'minute');
  }
  if (elapsed < 22 * HOUR) {
    return formatter.format(-Math.max(1, Math.round(elapsed / HOUR)), 'hour');
  }
  if (elapsed < 26 * DAY) {
    return formatter.format(-Math.max(1, Math.round(elapsed / DAY)), 'day');
  }
  if (elapsed < 11 * MONTH) {
    return formatter.format(-Math.max(1, Math.round(elapsed / MONTH)), 'month');
  }
  return formatter.format(-Math.max(1, Math.round(elapsed / YEAR)), 'year');
}
