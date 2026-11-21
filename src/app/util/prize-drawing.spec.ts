import { findPrizeBooth, findPrizeDrawings, findPrizeWins, normalizeBadge, statedPickupDeadline } from './prize-drawing';

/**
 * Prize drawings, built from the shape of BGG's real BGG.CON 2026 news posts. The 2026-11-19 post
 * put the Big Group Game winners under the same "Daily Prize Drawing" heading, which made the app
 * show two drawings for one day; these tests keep that from coming back.
 */

// Dallas is UTC-6 in November.
const dallas = (y: number, m: number, d: number, h: number, mi = 0) => Date.UTC(y, m - 1, d, h + 6, mi);

const dailyTable = (rows: [string, string, string][]) =>
  `<table><tr><th>Bundle #</th><th>Badge #</th><th>Name</th></tr>${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</table>`;

const day1Post = {
  id: 'P1', title: 'Day 1 updates', postedAt: dallas(2026, 11, 18, 21),
  html: `<h3>Daily Prize Drawing</h3><p>Wednesday Drawing Winners go to the Prize Booth on Thursday during Exhibit Hall hours. Bundles not picked up by the end of the Exhibit Hall hours will be cycled into the next day's drawing.</p>`
    + dailyTable([['1', '0512', 'A. Player'], ['2', '1188', 'B. Player']]),
};

const day2Post = {
  id: 'P2', title: 'Day 2 updates', postedAt: dallas(2026, 11, 19, 22),
  html: `<h3>Daily Prize Drawing</h3><p>Thursday Drawing Winners go to the Prize Booth on Friday during Exhibit Hall hours.</p>`
    + dailyTable([['1', '0973', 'C. Player'], ['2', '2001', 'D. Player']])
    + `<p>Winners for Today's Players of The Big Group Game at the Con are: (prizes must be picked up at the Info Desk by 6PM on Friday)</p>`
    + `<table><tr><th>Badge #</th><th>Name</th></tr><tr><td>1188</td><td>B. Player</td></tr></table>`,
};

describe('normalizeBadge', () => {
  it('keeps digits and drops leading zeros, so 0973 and 973 match', () => {
    expect(normalizeBadge('0973')).toBe('973');
    expect(normalizeBadge(' #973 ')).toBe('973');
    expect(normalizeBadge('0')).toBe('0');
    expect(normalizeBadge('')).toBe('');
  });
});

describe('findPrizeWins', () => {
  it('finds your row by badge number, with bundle, heading and pickup sentence', () => {
    const wins = findPrizeWins([day2Post], '973');
    expect(wins.length).toBe(1);
    expect(wins[0].bundle).toBe('1');
    expect(wins[0].section).toBe('Daily Prize Drawing');
    expect(wins[0].pickup).toContain('Winners go to the Prize Booth on Friday');
  });

  it('finds a win in another prize table in the same post', () => {
    const wins = findPrizeWins([day1Post, day2Post], '1188');
    expect(wins.map(w => w.key)).toEqual(['P1:1:1', 'P2:2:0']);
  });

  it('finds nothing without a badge number or without a match', () => {
    expect(findPrizeWins([day2Post], '')).toEqual([]);
    expect(findPrizeWins([day2Post], '4444')).toEqual([]);
  });

  it('ignores tables without a Badge column', () => {
    const post = { id: 'P', title: 'T', html: '<table><tr><th>Room</th><th>Event</th></tr><tr><td>973</td><td>Demo</td></tr></table>' };
    expect(findPrizeWins([post], '973')).toEqual([]);
  });
});

describe('findPrizeDrawings', () => {
  const drawings = findPrizeDrawings([day2Post, day1Post], '973');

  it('numbers only the daily drawings, one per day, in posting order', () => {
    expect(drawings.filter(d => d.daily).map(d => d.label)).toEqual(['Daily drawing #2', 'Daily drawing #1']);
  });

  it('names the other prize from BGG\'s "Winners for … are:" line instead of counting it as a drawing', () => {
    const other = drawings.find(d => !d.daily)!;
    expect(other.label).toBe('Big Group Game winners');
    expect(other.postId).toBe('P2');
  });

  it('lists newest first', () => {
    expect(drawings.map(d => d.key)).toEqual(['P2:2', 'P2:1', 'P1:1']);
  });

  it('attaches your win only to the drawing it is in', () => {
    expect(drawings.find(d => d.key === 'P2:1')!.win?.badge).toBe('973');
    expect(drawings.filter(d => d.win).length).toBe(1);
  });

  it("reads the other prize's stated deadline (6 PM Friday)", () => {
    expect(drawings.find(d => !d.daily)!.statedDeadline).toBe(dallas(2026, 11, 20, 18));
  });
});

describe('statedPickupDeadline', () => {
  const thursdayNight = dallas(2026, 11, 19, 22);

  it('finds the first matching weekday after the drawing day', () => {
    expect(statedPickupDeadline('picked up by 6PM on Friday', thursdayNight)).toBe(dallas(2026, 11, 20, 18));
    expect(statedPickupDeadline('by 6:30 p.m. Saturday', thursdayNight)).toBe(dallas(2026, 11, 21, 18, 30));
  });

  it('treats a post before 6 AM as the previous day\'s drawing', () => {
    expect(statedPickupDeadline('by 6PM on Friday', dallas(2026, 11, 20, 2))).toBe(dallas(2026, 11, 20, 18));
  });

  it('returns null without both a time and a weekday', () => {
    expect(statedPickupDeadline('during Exhibit Hall hours', thursdayNight)).toBeNull();
    expect(statedPickupDeadline('by Friday', thursdayNight)).toBeNull();
  });
});

describe('findPrizeBooth', () => {
  it('reads the 2026 location (Registration/Information Desk)', () => {
    const place = findPrizeBooth([{ html: '<p>Prize Booth - located up near the Registration/Information Desk</p>' }]);
    expect(place.where).toBe('registration');
    expect(place.quote).toContain('Registration/Information Desk');
  });

  it('reads the older Exhibit Hall wording', () => {
    expect(findPrizeBooth([{ html: '<p>Prize Booth (in the Exhibit Hall)</p>' }]).where).toBe('hall');
  });

  it('ignores sentences about pickup time, not place', () => {
    expect(findPrizeBooth([{ html: '<p>Pickup at the Prize Booth on Thursday when the Exhibit Hall opens.</p>' }]).where).toBe('unknown');
  });

  it('uses the newest post that says where', () => {
    const place = findPrizeBooth([
      { html: '<p>Prize Booth - located up near the Registration/Information Desk</p>' },
      { html: '<p>Prize Booth (in the Exhibit Hall)</p>' },
    ]);
    expect(place.where).toBe('registration');
  });
});
