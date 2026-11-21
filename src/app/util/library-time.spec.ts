import { countdownText, dueInfo, formatDeadline, libraryStatus, prizePickupDeadline, shortDuration } from './library-time';

/**
 * Library hours, due times and prize deadlines for BGG.CON 2026 (src/app/config/conventions.ts):
 * library Wed 9 AM–midnight, Thu–Sat 8 AM–midnight, Sun 8 AM–1 PM; Exhibit Hall closes 5 PM
 * Thu–Sat, 3 PM Sun. Everything is in Dallas time whatever the phone's (or test machine's) zone.
 */

// Dallas is UTC-6 in November.
const dallas = (y: number, m: number, d: number, h: number, mi = 0) => Date.UTC(y, m - 1, d, h + 6, mi);
/** Tabletop.Events dates are "YYYY-MM-DD HH:MM:SS" in UTC. */
const tte = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
/** Intl may use a narrow no-break space before AM/PM; tests compare plain spaces. */
const plain = (s: string) => s.replace(/\s/g, ' ');

describe('dueInfo', () => {
  it('NEW shelf: due 4 hours after checkout (1:27 PM → 5:27 PM, as on the phone)', () => {
    const out = dallas(2026, 11, 19, 13, 27);
    const due = dueInfo({ is_checked_out: 1, last_checkout_date: tte(out), average_seconds_checked_out: 0, custom_fields: { Location: 'NEW' } }, out + 60_000)!;
    expect(due.dueAt).toBe(dallas(2026, 11, 19, 17, 27));
    expect(due.hours).toBe(4);
    expect(due.rule).toContain('New games');
  });

  it('CARD RACK NEW counts as new (4 hours)', () => {
    const out = dallas(2026, 11, 19, 10);
    const due = dueInfo({ is_checked_out: 1, last_checkout_date: tte(out), average_seconds_checked_out: 0, custom_fields: { Location: 'CARD RACK NEW' } }, out)!;
    expect(due.hours).toBe(4);
    expect(due.rule).toContain('New card games');
  });

  it('other shelves: 8 hours, not counting midnight to 8 AM', () => {
    const out = dallas(2026, 11, 19, 20);
    const due = dueInfo({ is_checked_out: 1, last_checkout_date: tte(out), average_seconds_checked_out: 0, custom_fields: { Location: 'B' } }, out)!;
    // 4 h until midnight, then the other 4 h from 8 AM.
    expect(due.dueAt).toBe(dallas(2026, 11, 20, 12));
    expect(due.overnight).toBeTrue();
  });

  it('never later than the final close on Sunday (1 PM)', () => {
    const out = dallas(2026, 11, 22, 10);
    const due = dueInfo({ is_checked_out: 1, last_checkout_date: tte(out), average_seconds_checked_out: 0, custom_fields: { Location: 'B' } }, out)!;
    expect(due.dueAt).toBe(dallas(2026, 11, 22, 13));
    expect(due.cappedAtFinalClose).toBeTrue();
  });

  it('shows "often back sooner" only when the average lands before the due time', () => {
    const out = dallas(2026, 11, 19, 13, 27);
    const game = { is_checked_out: 1, last_checkout_date: tte(out), average_seconds_checked_out: 3 * 3600, custom_fields: { Location: 'NEW' } };
    expect(dueInfo(game, out)!.soonerAt).toBe(dallas(2026, 11, 19, 16, 25));
    expect(dueInfo({ ...game, average_seconds_checked_out: 5 * 3600 }, out)!.soonerAt).toBeUndefined();
  });

  it('flags checkouts older than 48 hours as stale, and ignores available games', () => {
    const out = dallas(2026, 11, 18, 10);
    expect(dueInfo({ is_checked_out: 1, last_checkout_date: tte(out), average_seconds_checked_out: 0 }, dallas(2026, 11, 20, 12))!.stale).toBeTrue();
    expect(dueInfo({ is_checked_out: 0, last_checkout_date: tte(out), average_seconds_checked_out: 0 })).toBeNull();
  });
});

describe('prizePickupDeadline', () => {
  it("is the next day's Exhibit Hall close", () => {
    expect(prizePickupDeadline(dallas(2026, 11, 19, 21))).toBe(dallas(2026, 11, 20, 17));
  });

  it('counts a post before 6 AM as the previous day\'s drawing', () => {
    expect(prizePickupDeadline(dallas(2026, 11, 20, 2))).toBe(dallas(2026, 11, 20, 17));
  });

  it('uses Sunday\'s earlier close (3 PM) for Saturday\'s drawing', () => {
    expect(prizePickupDeadline(dallas(2026, 11, 21, 20))).toBe(dallas(2026, 11, 22, 15));
  });

  it('is null when the hall hours for that day are unknown', () => {
    expect(prizePickupDeadline(dallas(2026, 11, 22, 20))).toBeNull();
  });
});

describe('formatDeadline', () => {
  const fivePmFriday = dallas(2026, 11, 20, 17);
  it('says today, tomorrow, or the weekday', () => {
    expect(plain(formatDeadline(fivePmFriday, dallas(2026, 11, 20, 9)))).toBe('5 PM today');
    expect(plain(formatDeadline(fivePmFriday, dallas(2026, 11, 19, 22)))).toBe('5 PM tomorrow');
    expect(plain(formatDeadline(fivePmFriday, dallas(2026, 11, 18, 22)))).toBe('Fri 5 PM');
  });
});

describe('libraryStatus', () => {
  it('open with time left', () => {
    const s = libraryStatus(dallas(2026, 11, 20, 20))!;
    expect(s.tone).toBe('open');
    expect(s.title).toBe('Open until midnight');
    expect(s.detail).toBe('4h left');
  });

  it('closing soon in the last hour', () => {
    expect(libraryStatus(dallas(2026, 11, 20, 23, 30))!.tone).toBe('closingSoon');
  });

  it('closed before opening, with the countdown', () => {
    const s = libraryStatus(dallas(2026, 11, 20, 7, 30))!;
    expect(s.tone).toBe('closed');
    expect(s.detail).toBe('Opens in 30 min');
  });

  it('after the final close on Sunday, says the con is over', () => {
    const s = libraryStatus(dallas(2026, 11, 22, 14))!;
    expect(s.title).toBe('Closed for BGG.CON 2026');
  });

  it('upcoming before the con', () => {
    const s = libraryStatus(dallas(2026, 11, 10, 12))!;
    expect(s.tone).toBe('upcoming');
    expect(s.detail).toBe('Starts in 8 days');
  });
});

describe('durations', () => {
  it('shortDuration', () => {
    expect(shortDuration(45 * 60_000)).toBe('45m');
    expect(shortDuration(125 * 60_000)).toBe('2h 5m');
    expect(shortDuration(3 * 3600_000)).toBe('3h');
    expect(shortDuration(50 * 3600_000)).toBe('2d');
    expect(shortDuration(-5)).toBe('0m');
  });

  it('countdownText rounds up and never says 0', () => {
    expect(countdownText(10_000)).toBe('1 min');
    expect(countdownText(239 * 60_000 + 1)).toBe('4h');
    expect(countdownText(227 * 60_000)).toBe('3h 47m');
  });
});
