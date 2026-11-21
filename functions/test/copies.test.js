// Run: node --test functions/test   (also runs before every deploy)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { copyKey, matchCheckins } = require('../copies');

const tteTime = v => v ? new Date(String(v).trim().replace(' ', 'T') + 'Z').getTime() : 0;
const at = s => tteTime(s);

// Hell of a Deal on 2026-11-20 (Tabletop.Events, UTC): five copies, all very busy.
const HOAD = 'Hell of a Deal (English edition)';
const copy = (id, checkin, out) => ({ id, name: HOAD, last_checkin_date: checkin, is_checked_out: out ? 1 : 0, custom_fields: { Location: 'NEW' } });

test('copyKey ignores case and outer spaces but keeps the edition', () => {
  assert.equal(copyKey('  Hell of a Deal (English edition) '), copyKey('hell of a deal (english edition)'));
  assert.notEqual(copyKey('Azul (English edition)'), copyKey('Azul (German edition)'));
  assert.equal(copyKey(''), '');
});

test('another copy coming back answers the bell (the BGG-260038 case)', () => {
  // Bell on copy 260039 (on your list). 260038 is checked in and still on the shelf.
  const bells = new Map([['C260039', copyKey(HOAD)]]);
  const items = [copy('C260038', '2026-11-21 03:41:57', false)];
  const { back } = matchCheckins(items, bells, at('2026-11-21 03:40:00'), tteTime);
  assert.equal(back.get('C260039')?.id, 'C260038');
});

test('a copy taken again before the check sends nothing (65 s on the shelf)', () => {
  const bells = new Map([['C260039', copyKey(HOAD)]]);
  const items = [copy('C260038', '2026-11-21 03:41:57', true)];
  assert.equal(matchCheckins(items, bells, at('2026-11-21 03:40:00'), tteTime).back.size, 0);
});

test('the newest copy back wins when several came back', () => {
  const bells = new Map([['C260039', copyKey(HOAD)]]);
  const items = [copy('C260040', '2026-11-21 03:42:30', false), copy('C260611', '2026-11-21 03:41:10', false)];
  assert.equal(matchCheckins(items, bells, at('2026-11-21 03:40:00'), tteTime).back.get('C260039').id, 'C260040');
});

test('the bell\'s own copy still counts, even before its name is known', () => {
  const bells = new Map([['C260039', '']]);
  const items = [copy('C260039', '2026-11-21 03:41:57', false)];
  assert.equal(matchCheckins(items, bells, at('2026-11-21 03:40:00'), tteTime).back.get('C260039').id, 'C260039');
});

test('a different edition does not answer the bell', () => {
  const bells = new Map([['A1', copyKey('Azul (English edition)')]]);
  const items = [{ id: 'A2', name: 'Azul (German edition)', last_checkin_date: '2026-11-21 03:41:57', is_checked_out: 0 }];
  assert.equal(matchCheckins(items, bells, at('2026-11-21 03:40:00'), tteTime).back.size, 0);
});

test('several people with bells on different copies all hear about it', () => {
  const bells = new Map([['C260039', copyKey(HOAD)], ['C260077', copyKey(HOAD)], ['X', copyKey('Heat')]]);
  const items = [copy('C260038', '2026-11-21 03:41:57', false)];
  const { back } = matchCheckins(items, bells, at('2026-11-21 03:40:00'), tteTime);
  assert.deepEqual([...back.keys()].sort(), ['C260039', 'C260077']);
});

test('stops at check-ins older than the last run', () => {
  const bells = new Map([['C260039', copyKey(HOAD)]]);
  const items = [copy('C260040', '2026-11-21 03:02:08', false)];
  const r = matchCheckins(items, bells, at('2026-11-21 03:40:00'), tteTime);
  assert.equal(r.back.size, 0);
  assert.equal(r.older, true);
});
