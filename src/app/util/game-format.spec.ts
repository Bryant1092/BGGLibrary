import { checkedInText, fitsPlayers, fitsPlayTime, howToPlayUrl, statusText } from './game-format';
import { deskDownSince, deskManual } from './desk-state';
import { shortGameName } from '../service/watch.service';

/**
 * Status wording, including during a desk outage (2026-11-19: scanning was down for hours and a
 * running "Out 4h 20m" kept growing for games that may have been back).
 */

// Dallas is UTC-6 in November.
const dallas = (y: number, m: number, d: number, h: number, mi = 0) => Date.UTC(y, m - 1, d, h + 6, mi);
const tte = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
/** Narrow no-break spaces → spaces, and drop " CT" (added when the machine isn't on Dallas time). */
const plain = (s: string) => s.replace(/\s/g, ' ').replace(/ CT\b/, '');

describe('statusText', () => {
  const now = dallas(2026, 11, 19, 15);
  const out45m = { is_checked_out: 1, last_checkout_date: tte(now - 45 * 60_000) };
  const available = { is_checked_out: 0, last_checkout_date: '' };

  afterEach(() => {
    deskDownSince.set(null);
    deskManual.set(false);
  });

  it('normal: Available / Out with time since checkout', () => {
    expect(statusText(available, now)).toBe('Available');
    expect(statusText(out45m, now)).toBe('Out 45m');
  });

  it('desk down: "as of" the last scan instead of a growing timer', () => {
    deskDownSince.set(dallas(2026, 11, 19, 13, 39));
    expect(plain(statusText(available, now))).toBe('Available as of 1:39 PM');
    expect(plain(statusText(out45m, now))).toBe('Out as of 1:39 PM');
  });

  it('manual switch on: "Likely", because entries are typed in from paper', () => {
    deskDownSince.set(dallas(2026, 11, 19, 13, 39));
    deskManual.set(true);
    expect(statusText(available, now)).toBe('Likely available');
    expect(statusText(out45m, now)).toBe('Likely out');
  });

  it('a checkout older than 48 hours says "Out since", not "Out 50h"', () => {
    const old = { is_checked_out: 1, last_checkout_date: tte(now - 50 * 3600_000) };
    expect(statusText(old, now)).toMatch(/^Out since Nov 17/);
  });

  it('a missing checkout time says just "Checked out"', () => {
    expect(statusText({ is_checked_out: 1, last_checkout_date: '' }, now)).toBe('Checked out');
  });
});

describe('checkedInText', () => {
  const now = dallas(2026, 11, 19, 15);

  it('a recent return shows its time and age', () => {
    const game = { is_checked_out: 0, last_checkin_date: tte(now - 12 * 60_000), date_created: '2026-01-05 10:00:00' };
    expect(plain(checkedInText(game, now))).toBe('Checked in 2:48 PM · 12m ago');
  });

  it('a new arrival (check-in = date added) shows nothing', () => {
    const added = tte(now - 30 * 60_000);
    expect(checkedInText({ is_checked_out: 0, last_checkin_date: added, date_created: added }, now)).toBe('');
  });

  it('a checked-out game shows nothing', () => {
    expect(checkedInText({ is_checked_out: 1, last_checkin_date: tte(now - 60_000), date_created: '' }, now)).toBe('');
  });
});

describe('filters', () => {
  it('players, with 10 meaning 10 or more', () => {
    expect(fitsPlayers({ min_players: 2, max_players: 4 }, 3)).toBeTrue();
    expect(fitsPlayers({ min_players: 2, max_players: 4 }, 5)).toBeFalse();
    expect(fitsPlayers({ min_players: 3, max_players: 12 }, 10)).toBeTrue();
    expect(fitsPlayers({ min_players: 2, max_players: 4 }, null)).toBeTrue();
  });

  it('play time by the longest time', () => {
    expect(fitsPlayTime({ max_play_time: 30 }, 'upTo30')).toBeTrue();
    expect(fitsPlayTime({ max_play_time: 45 }, 'upTo30')).toBeFalse();
    expect(fitsPlayTime({ max_play_time: 90 }, 'over60')).toBeTrue();
    expect(fitsPlayTime({ max_play_time: 0 }, 'upTo60')).toBeFalse();
  });
});

describe('game names', () => {
  it('notification titles drop trailing edition notes so "is back" fits', () => {
    expect(shortGameName('Night at the Zoo (Capstone English edition)')).toBe('Night at the Zoo');
    expect(shortGameName('Root (2nd ed) (Promo)')).toBe('Root');
    expect(shortGameName('Panda Royale')).toBe('Panda Royale');
    expect(shortGameName('(Weird)')).toBe('(Weird)');
  });

  it('how-to-play search drops the edition too', () => {
    expect(howToPlayUrl({ name: 'Heat (English edition)' })).toContain(encodeURIComponent('Heat board game how to play'));
  });
});
