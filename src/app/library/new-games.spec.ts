import { addedText, weekLabel } from './library.component';

// "New in the library" groups and labels (2026-11-23). Now = Wed Nov 25 2026, noon Central.
describe('New in the library', () => {
  const now = Date.parse('2026-11-25T18:00:00Z');
  const at = (iso: string) => Date.parse(iso);

  it('groups by Monday-to-Sunday weeks in Central time', () => {
    expect(weekLabel(at('2026-11-23T07:00:00Z'), now)).toBe('This week'); // Mon 1 AM Central
    expect(weekLabel(at('2026-11-23T05:00:00Z'), now)).toBe('Last week'); // Sun 11 PM Central
    expect(weekLabel(at('2026-11-11T18:00:00Z'), now)).toBe('Nov 9–15');
    expect(weekLabel(at('2026-10-28T18:00:00Z'), now)).toBe('Oct 26 – Nov 1');
    expect(weekLabel(0, now)).toBe('Earlier');
  });

  it('says the weekday this week and the date before, plus copies', () => {
    expect(addedText({ date_created: '2026-11-24 18:00:00' }, now, 1)).toBe('Added Tue');
    expect(addedText({ date_created: '2026-11-18 18:00:00' }, now, 2)).toBe('Added Nov 18 · 2 copies');
    expect(addedText({ date_created: '' }, now, 1)).toBe('');
  });
});
