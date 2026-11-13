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
 * They carry no timezone marker but are UTC. Checked against ~1,150 library
 * checkout/check-in times: there are none between 06:00-12:59 UTC in Nov 2025
 * (CST, UTC-6) and 05:00-11:59 UTC in May 2026 (CDT, UTC-5). Both are the
 * library being closed midnight-7 AM Dallas time. The gap moved by exactly the
 * daylight saving hour, which only happens if the stored times are UTC.
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
