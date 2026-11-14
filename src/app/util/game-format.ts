import { BggItem } from '../model/bgg.model';
import { parseTteDate } from './time-ago';
import { formatLibraryDate, shortDuration, STALE_CHECKOUT_MS } from './library-time';

/** Shared wording for game details, so the Library, My Lists and details sheet all match. */

/** "2–4" (or "2" when min and max match). */
export function playersText(game: Pick<BggItem, 'min_players' | 'max_players'>): string {
  return game.min_players === game.max_players ? `${game.min_players}` : `${game.min_players}–${game.max_players}`;
}

/** "30–45" minutes (or "30"). */
export function minutesText(game: Pick<BggItem, 'min_play_time' | 'max_play_time'>): string {
  return game.min_play_time === game.max_play_time ? `${game.min_play_time}` : `${game.min_play_time}–${game.max_play_time}`;
}

/** Shelf code such as "A", "NEW" or "CARD RACK". Players find the game (and reshelve it) by this. */
export function shelfText(game: Pick<BggItem, 'custom_fields'>): string {
  return game.custom_fields?.Location || '?';
}

/** "Available", or "Out 45m" using the time since checkout. */
export function statusText(game: Pick<BggItem, 'is_checked_out' | 'last_checkout_date'>, now: number = Date.now()): string {
  if (!game.is_checked_out) {
    return 'Available';
  }
  const checkedOut = parseTteDate(game.last_checkout_date);
  if (!checkedOut) {
    return 'Checked out';
  }
  const elapsed = now - checkedOut.getTime();
  // "Out since May 25" reads as old data; "Out 172d" looks like someone has had it for months.
  return elapsed > STALE_CHECKOUT_MS ? `Out since ${formatLibraryDate(checkedOut.getTime())}` : `Out ${shortDuration(elapsed)}`;
}

/**
 * "Watch how to play": a YouTube search, not a specific video. Edition text in
 * brackets is dropped and "board game how to play" added, so short titles like
 * "Heat" find teaching videos rather than unrelated ones (not guaranteed).
 */
export function howToPlayUrl(game: Pick<BggItem, 'name'>): string {
  const title = game.name.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} board game how to play`)}`;
}

/**
 * Games just added to the library are recorded as "checked in" at the moment
 * they're added, so a check-in time equal to the added time (within a minute)
 * means it's a new arrival that has never been checked out, not a return.
 */
export function isNewArrival(game: Pick<BggItem, 'last_checkin_date' | 'date_created'>): boolean {
  const checkin = parseTteDate(game.last_checkin_date);
  const created = parseTteDate(game.date_created);
  return !!checkin && !!created && Math.abs(checkin.getTime() - created.getTime()) <= 60_000;
}

/** "Back 12m ago" for the Just returned sort; older returns just say "Available". */
export function returnedText(game: Pick<BggItem, 'last_checkin_date'>, now: number = Date.now()): string {
  const checkin = parseTteDate(game.last_checkin_date);
  if (!checkin || now - checkin.getTime() > STALE_CHECKOUT_MS) return 'Available';
  return `Back ${shortDuration(now - checkin.getTime())} ago`;
}

/** Link for "View on BoardGameGeek". */
export function bggUrl(game: Pick<BggItem, 'bgg_id'>): string {
  return `https://boardgamegeek.com/boardgame/${game.bgg_id}`;
}
