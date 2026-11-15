// Puts the BGG.CON exhibit hall (booth tables and booths from the hall-map PDF) into the
// Hyatt Exhibition-level plan, so zooming into Marsalis Hall A on the floor map shows the
// booths in place. The two PDFs are lined up with a perspective transform fitted on the
// hall's four corners (fit-homography.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { CORNERS, homography } from './fit-homography.mjs';
import { BOOTHS, DIRECTORY } from './hall-booths.mjs';

// Hall map -> Hyatt plan. A perspective transform (the Hyatt plan is drawn at a slight angle),
// exact at the hall's four corners; see fit-homography.mjs.
const toHyatt = homography(CORNERS);
const SCALE = 0.095; // hall-map units -> Hyatt units, for line widths
// Moves every point of a path (absolute M/L/C/S/Z commands, as pdf2svg writes them).
const mapPath = d => d.replace(/([MLCS])([^MLCSZ]+)/g, (m0, cmd, nums) => {
  const v = nums.trim().split(/[\s,]+/).map(Number); const out = [];
  for (let i = 0; i < v.length; i += 2) { const [x, y] = toHyatt([v[i], v[i + 1]]); out.push(r1(x) + ' ' + r1(y)); }
  return cmd + out.join(' ');
});
const r1 = n => Math.round(n * 10) / 10;

// Hall-map drawing to keep: wall outlines and booth tables inside Hall A, the Uniquely Geek
// area and BoxKing's booth in the foyer. Fills (green floor, white logo panels, black backing)
// and the hall map's own lettering are left out; the app draws its own.
const hall = JSON.parse(readFileSync('floors/hall-con.json', 'utf8'));
const lines = hall.paths.filter(p => {
  const [x0, y0, x1, y1] = p.bbox;
  if (x0 <= 0 && y0 <= 0 && x1 >= 1920 && y1 >= 1080) return false;
  const strokeOnly = /fill="none"/.test(p.svg);
  // The hall map draws the movable wall to Hall B a few units off from the Hyatt plan; keep the Hyatt one.
  if (/stroke-dasharray/.test(p.svg) && x0 < 1035) return false;
  if (x0 >= 1020 && strokeOnly) return true;                               // Hall A walls + tables
  if (/fill="#b3db83"/.test(p.svg)) return true;                            // Uniquely Geek area
  if (strokeOnly && x0 > 690 && x1 < 820 && y0 > 870 && y1 < 1000) return true; // BoxKing booth (099)
  return false;
}).map(p => p.svg
  .replace(/<\/?g[^>]*>/g, '') // clip masks were for the hall map's page; not needed here
  .replace(/d="([^"]+)"/, (m0, dd) => `d="${mapPath(dd)}"`)
  .replace(/stroke-width="([\d.]+)"/, (m0, w) => `stroke-width="${r1(Math.max(0.35, w * SCALE))}"`)
  .replace(/stroke-dasharray="([^"]+)"/, (m0, da) => `stroke-dasharray="${da.split(' ').map(v => r1(v * SCALE)).join(' ')}"`)
  .replace(/stroke="#(231f20|000000)"/g, 'stroke="#3a3632"').replace(/fill="#b3db83"/, 'fill="#b3db83" fill-opacity=".55"'));

const floorSvg = readFileSync('floors/floor-exhibition.svg', 'utf8');
const merged = floorSvg.replace('</svg>', `${lines.join('')}</svg>`);
writeFileSync('floors/floor-exhibition-hall.svg', merged);

const logos = Object.fromEntries(JSON.parse(readFileSync('logos/index.json', 'utf8')).map(l => [l.booth2026, l.file]));
const booths = BOOTHS.map(([num, x, y, w, h]) => ({
  num, name: DIRECTORY[num] || '', logo: logos[num] || '',
  // Booths become parallelograms in the Hyatt plan's drawing angle.
  poly: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(toHyatt).map(([px, py]) => [r1(px), r1(py)]),
}));
writeFileSync('floors/hall-booths.json', JSON.stringify(booths));
console.log('hall lines', lines.length, '| booths', booths.length, '| svg', merged.length, 'bytes');
console.log('booth 204 in Hyatt units:', JSON.stringify(booths.find(b => b.num === '204').poly));
