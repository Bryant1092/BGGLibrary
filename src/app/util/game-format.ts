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

/** Link for "View on BoardGameGeek". */
export function bggUrl(game: Pick<BggItem, 'bgg_id'>): string {
  return `https://boardgamegeek.com/boardgame/${game.bgg_id}`;
}
