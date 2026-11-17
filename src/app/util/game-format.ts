import { BggItem } from '../model/bgg.model';
import { parseTteDate } from './time-ago';
import { formatLibraryDate, formatLibraryTime, shortDuration, STALE_CHECKOUT_MS } from './library-time';

/** Shared wording for game details, so the Library, My Lists and details sheet all match. */

/** "2–4" (or "2" when min and max match). */
export function playersText(game: Pick<BggItem, 'min_players' | 'max_players'>): string {
  return game.min_players === game.max_players ? `${game.min_players}` : `${game.min_players}–${game.max_players}`;
}

/**
 * Players / play time filters, shared by the Library (shelf lists), My Lists and Friends'
 * picks so "4 players" and "Up to 1 hour" mean the same everywhere. Play time goes by the
 * box's longest time (max_play_time), as the Library's server-side filter does; 0 means
 * the library has no time for the game, so it matches no play-time choice.
 */
export type PlayTimeChoice = 'upTo30' | 'upTo60' | 'over60';
export const PLAY_TIME_CHOICES: { value: PlayTimeChoice; label: string }[] = [
  { value: 'upTo30', label: 'Up to 30 min' },
  { value: 'upTo60', label: 'Up to 1 hour' },
  { value: 'over60', label: 'Over 1 hour' },
];
export const PLAYER_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * The last choice is "10+": games that play with 10 or more. Plain "10" only matched games
 * whose range includes exactly 10, so a game for 12–20 players would fit no choice at all
 * (none in the library on 2026-11-17, but new arrivals could). Same top label as BGG uses.
 */
export const PLAYERS_TOP = 10;
export function playerChoiceText(n: number): string { return n >= PLAYERS_TOP ? `${PLAYERS_TOP}+` : `${n}`; }
/** "1 player", "4 players", "10+ players". */
export function playersFilterText(n: number): string { return `${playerChoiceText(n)} ${n === 1 ? 'player' : 'players'}`; }

/** True when the game plays with this many people (min ≤ n ≤ max), or for "10+", with 10 or more. */
export function fitsPlayers(game: Pick<BggItem, 'min_players' | 'max_players'>, players: number | null): boolean {
  if (!players) return true;
  if (players >= PLAYERS_TOP) return Number(game.max_players) >= PLAYERS_TOP;
  return game.min_players <= players && players <= game.max_players;
}

export function fitsPlayTime(game: Pick<BggItem, 'max_play_time'>, choice: PlayTimeChoice | null): boolean {
  if (!choice) return true;
  const max = Number(game.max_play_time) || 0;
  return choice === 'upTo30' ? max > 0 && max <= 30 : choice === 'upTo60' ? max > 0 && max <= 60 : max > 60;
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

/**
 * "Checked in 2:14 PM · 12m ago" for an available game that came back in the last
 * 48 hours, so people know it was just returned (and roughly how fresh the shelf
 * spot is). '' for new arrivals (their "check-in" is just when they were added),
 * older returns, and checked-out games.
 */
export function checkedInText(game: Pick<BggItem, 'is_checked_out' | 'last_checkin_date' | 'date_created'>, now: number = Date.now()): string {
  if (game.is_checked_out || isNewArrival(game)) return '';
  const checkin = parseTteDate(game.last_checkin_date)?.getTime();
  if (!checkin || now - checkin > STALE_CHECKOUT_MS || checkin > now + 60_000) return '';
  return `Checked in ${formatLibraryTime(checkin, now)} · ${shortDuration(Math.max(60_000, now - checkin))} ago`;
}

/** Link for "View on BoardGameGeek". */
export function bggUrl(game: Pick<BggItem, 'bgg_id'>): string {
  return `https://boardgamegeek.com/boardgame/${game.bgg_id}`;
}
