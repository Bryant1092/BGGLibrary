// Builds per-floor SVGs and room data from the Hyatt Regency Dallas floor-plan PDF
// (converted by pdf2svg.mjs). Rooms are the PDF's own shapes, cut along the PDF's own
// dashed dividers; BGG.CON 2026 room uses come from the con's map.
import { readFileSync, writeFileSync } from 'node:fs';

const p2 = JSON.parse(readFileSync('floors/hyatt-p2.json', 'utf8'));
const p3 = JSON.parse(readFileSync('floors/hyatt-p3.json', 'utf8'));
const beige = j => j.shapes.filter(s => s.fill === '#f0ede6').map(s => s.pts);
const R2 = beige(p2), R3 = beige(p3);

// Keep the part of a polygon on the same side of line a-b as point ref (Sutherland–Hodgman).
function clip(poly, [ax, ay, bx, by], [rx, ry]) {
  const side = (x, y) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
  const keep = Math.sign(side(rx, ry));
  const inside = p => Math.sign(side(p[0], p[1])) === keep || side(p[0], p[1]) === 0;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
    const cin = inside(cur), pin = inside(prev);
    if (cin !== pin) {
      const s1 = side(prev[0], prev[1]), s2 = side(cur[0], cur[1]); const t = s1 / (s1 - s2);
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (cin) out.push(cur);
  }
  return out;
}
const cut = (poly, cuts, ref) => cuts.reduce((p, c) => clip(p, c, ref), poly);
// A line through point p with the same direction as segment d (for parallel dividers).
const par = (p, d) => [p[0], p[1], p[0] + (d[2] - d[0]), p[1] + (d[3] - d[1])];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Dividers from the PDF (dashed lines), page coordinates.
const D = {
  bryan: [299.7, 664.85, 307.66, 648.73], moreno: [454.01, 661.42, 476.24, 648.27], reverchon: [500.14, 690.14, 522.37, 676.99],
  gaston: [424.49, 678.65, 445.53, 666.12], sanger: [471.74, 706.73, 492.36, 694.45],
  reunionEF_D: [358.52, 337.95, 377.85, 298.43], pegasus: [422.57, 361.75, 458.01, 368.53],
  marsalis: [165.19, 442.78, 183.08, 492.8], cumbBA: [337.73, 545.83, 330, 561.64],
};
// Undrawn boundaries between neighbouring rooms: parallel to the dashed dividers, halfway between them.
const morenoRev = par(mid([454.01, 661.42], [500.14, 690.14]), D.moreno);
const gastonSanger = par(mid([424.49, 678.65], [471.74, 706.73]), D.gaston);
const pryorKessler = [414, 643, 424, 623], kesslerMoreno = [430, 647, 451, 633];
const wcBaker = (x, q) => par([x, 660], [q[0][0], q[0][1], q[1][0], q[1][1]]);

// Splits a 4-point room along its long side at fraction f (for rows of rooms drawn as one shape).
function splitQuad(q, f) {
  const [a, b, c, d] = q; // a-b and d-c are the short ends for these PDF shapes
  const l = (p, r) => [p[0] + (r[0] - p[0]) * f, p[1] + (r[1] - p[1]) * f];
  const long1 = Math.hypot(b[0] - c[0], b[1] - c[1]) > Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (long1) { const m1 = l(b, c), m2 = l(a, d); return [[a, b, m1, m2], [m2, m1, c, d]]; }
  const m1 = l(a, b), m2 = l(d, c); return [[a, m1, m2, d], [m1, b, c, m2]];
}

const rooms = [];
const add = (floor, id, name, sub, kind, poly) => rooms.push({ floor, id, name, sub, kind, poly: poly.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]) });

// Third level (BGG.CON: scheduled games in the meeting parlors, open gaming in Shawnee Trail).
const [aerial, dallas] = splitQuad(R2[8], 0.5), [central, mccommas] = splitQuad(R2[7], 0.5);
add('3', 'aerial', 'Scheduled games', 'Aerial Queen · 353', 'sched', aerial);
add('3', 'dallasbelt', 'Scheduled games', 'Dallas Belt · 355', 'sched', dallas);
add('3', 'central', 'Scheduled games', 'The Central · 357', 'sched', central);
add('3', 'mccommas', 'McCommas Bluff', '359 · not used', 'other', mccommas);
add('3', 'shawnee', 'Open gaming', 'Shawnee Trail A/B · 362', 'open', R2[6]);
[[9, 'Magnolia · 388'], [10, 'Praetorian · 385'], [11, 'Sante Fe · 393'], [12, 'Mercantile · 396']].forEach(([i, n], k) => add('3', 'suite' + k, 'Hospitality suite', n, 'other', R2[i]));

// Atrium level (second floor).
add('A', 'cotton', 'Special events', 'Cotton Bowl', 'special', R2[0]);
const wcb = R2[1];
add('A', 'windsor', 'Open gaming', 'Windsor', 'open', cut(wcb, [wcBaker(167, wcb)], [149, 665]));
add('A', 'cockrell', 'Open gaming', 'Cockrell', 'open', cut(wcb, [wcBaker(167, wcb), wcBaker(201, wcb)], [186, 674]));
add('A', 'baker', 'Open gaming', 'Baker', 'open', cut(wcb, [wcBaker(201, wcb)], [215, 677]));
add('A', 'bryanA', 'Special events', 'Bryan-Beeman A', 'special', cut(R2[2], [D.bryan], [289, 654]));
add('A', 'bryanB', 'HomeGrown playtests', 'Bryan-Beeman B', 'proto', cut(R2[2], [D.bryan], [317, 664]));
add('A', 'mcmillan', 'Scheduled games', 'McMillan', 'sched', R2[4]);
add('A', 'pryor', 'Scheduled games', 'Pryor-Crockett', 'sched', cut(R2[5], [pryorKessler], [404, 628]));
add('A', 'kessler', 'Scheduled games', 'Kessler', 'sched', cut(R2[5], [pryorKessler, kesslerMoreno], [432, 637]));
add('A', 'morenoA', 'Scheduled games', 'Moreno A', 'sched', cut(R2[5], [kesslerMoreno, D.moreno], [450, 645]));
add('A', 'morenoB', 'Scheduled games', 'Moreno B', 'sched', cut(R2[5], [D.moreno, morenoRev], [474, 660]));
add('A', 'reverchonA', 'RPGs', 'Reverchon A', 'rpg', cut(R2[5], [morenoRev, D.reverchon], [498, 675]));
add('A', 'reverchonB', 'WarGamers HQ', 'Reverchon B', 'war', cut(R2[5], [D.reverchon], [521, 688]));
add('A', 'gastonA', 'Scheduled games', 'Gaston A', 'sched', cut(R2[3], [D.gaston], [424, 664]));
add('A', 'gastonB', 'Scheduled games', 'Gaston B', 'sched', cut(R2[3], [D.gaston, gastonSanger], [448, 679]));
add('A', 'sangerA', 'Quiet games', 'Sanger A', 'quiet', cut(R2[3], [gastonSanger, D.sanger], [472, 694]));
add('A', 'sangerB', 'The Sanctuary', 'Sanger B · sensory-friendly room', 'calm', cut(R2[3], [D.sanger], [495, 707]));

// Lobby level.
add('L', 'landmark', 'Open gaming', 'Landmark Ballroom A–D', 'open', R3[0]);
add('L', 'reunionSE', 'Special events', 'Reunion Ballroom E–H', 'special', cut(R3[1], [D.reunionEF_D], [330, 312]));
add('L', 'reunionOG', 'Open gaming', 'Reunion Ballroom A–D', 'open', cut(R3[1], [D.reunionEF_D], [400, 320]));
add('L', 'pegasusB', 'Special events', 'Pegasus B', 'special', cut(R3[2], [D.pegasus], [442, 357]));
add('L', 'pegasusA', 'Protoalley (HomeGrown)', 'Pegasus A', 'proto', cut(R3[2], [D.pegasus], [437, 371]));

// Exhibition level.
add('E', 'hallB', 'Open gaming', 'Marsalis Hall B · from Wed noon', 'open', cut(R3[4], [D.marsalis], [136, 474]));
add('E', 'hallA', 'Exhibit hall', 'Marsalis Hall A · 51 booths', 'exhibit', cut(R3[4], [D.marsalis], [217, 460]));
// R3[7]: the beige list skips one green shape, so Cumberland I–L is index 7 here (8 in the raw shape list).
add('E', 'library', 'Library', 'Cumberland I–L', 'library', R3[7]);
add('E', 'hot', 'Hot Games', 'Cumberland E–H', 'hot', R3[5]);
add('E', 'exlounge', 'Exhibitor lounge', 'Cumberland B–C', 'service', cut(R3[6], [D.cumbBA], [320, 550]));
add('E', 'teamgeek', 'Team Geek lounge', 'Cumberland A', 'service', cut(R3[6], [D.cumbBA], [342, 554]));

// Landmark labels (PDF text merged into lines), per floor, and restroom (W/M) icons.
function lines(j) {
  const items = j.text.map(t => ({ s: t.str.trim(), x: t.x + t.w / 2, y: t.y - t.size / 3 })).filter(t => t.s);
  const out = [];
  for (const t of items) {
    const prev = out.find(o => Math.abs(o.x - t.x) < 12 && t.y - o.y2 > 0 && t.y - o.y2 < 7.5);
    if (prev) { prev.s += ' ' + t.s; prev.y2 = t.y; prev.y = (prev.y1 + t.y) / 2; } else out.push({ s: t.s, x: t.x, y: t.y, y1: t.y, y2: t.y });
  }
  return out;
}
const want = {
  '3': /^(STAY FIT GYM|BROWDER SPRINGS|THE OVERLOOK|HOSPITALITY SUITES|ELEVATORS)/,
  'A': /^(ELEVATORS|CENTENNIAL|PARRINO|MONDUEL|CRUTCHFIELD|BOGEL|POINT OF VIEW|THORNTON)/,
  'L': /^(REGISTRATION|HOTEL ENTRANCE|ESCALATOR|ELEVATORS|COFFEE|VALET|LANDMARK CIRCLE|TRINITY CROSSING|GUEST SERVICES|SKYLINE)/,
  'E': /^(ESCALATORS|REUNION TOWER (ELEVATORS|GIFT)|MARSALIS FOYER|THE CONNECTION|BUSINESS|UNION STATION DART|EXECUTIVE|DART$)/,
};
const floorOf = (page, x, y) => page === 2 ? (y < 480 ? '3' : 'A') : (y < 428 || (x > 380 && y < 465) ? 'L' : 'E');
const marks = [];
for (const [page, j] of [[2, p2], [3, p3]]) {
  for (const l of lines(j)) {
    if (l.y < 200) continue;
    const f = floorOf(page, l.x, l.y);
    if (l.s === 'W' || l.s === 'M') { marks.push({ floor: f, kind: 'wc', x: l.x, y: l.y }); continue; }
    if (/^ELEVATORS|REUNION TOWER ELEVATORS/.test(l.s)) marks.push({ floor: f, kind: 'elev', x: l.x, y: l.y - 7 });
    if (/^ESCALATOR/.test(l.s)) marks.push({ floor: f, kind: 'esc', x: l.x, y: l.y - 8 });
    if (want[f]?.test(l.s)) marks.push({ floor: f, kind: 'text', text: l.s.replace(/\s+/g, ' ').replace(/ ,/g, ','), x: l.x, y: l.y });
  }
}

// Floors: crop boxes (page units) and which PDF paths belong to each.
const floors = [
  { id: '3', name: 'Third level', page: 2, crop: [100, 270, 400, 195] },
  { id: 'A', name: 'Atrium level (2nd floor)', page: 2, crop: [70, 560, 490, 195] },
  { id: 'L', name: 'Lobby level', page: 3, crop: [85, 225, 485, 235] },
  { id: 'E', name: 'Exhibition level', page: 3, crop: [80, 420, 545, 215] },
];
for (const f of floors) {
  const j = f.page === 2 ? p2 : p3;
  const paths = j.paths.filter(p => {
    const [x0, y0, x1, y1] = p.bbox; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (cy < 200 || x1 < 45) return false; // page header, logo and the decorative tab
    if (/stroke-dasharray/.test(p.svg) && (x1 - x0) > 60) return false; // "Founder's Wing" dashed outline
    // The Reunion Tower column (grey gradient slices, dark grid ball) is a not-to-scale
    // illustration that covers rooms; the app marks the tower elevators instead.
    const fill = (p.svg.match(/fill="(#[0-9a-f]{6})"/) || [])[1];
    if (fill && fill !== '#ffffff' && fill !== '#f0ede6' && fill !== '#e8e5de') {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(fill.slice(i, i + 2), 16));
      if (Math.max(r, g, b) - Math.min(r, g, b) < 18 && r < 200) return false;
    }
    if (f.page === 3 && x0 > 95 && x1 < 180 && y0 > 220 && y1 < 270) return false; // tower ball and its callout line
    return floorOf(f.page, cx, cy) === f.id;
  }).map(p => p.svg
    // Room fills come from the app (BGG.CON uses); the PDF's beige stays only as a light floor tint.
    .replace(/fill="#f0ede6"/g, 'fill="#f4f2ee"')
    .replace(/stroke="#a9aaad"/g, 'stroke="#8d8a86"'));
  const [x, y, w, h] = f.crop;
  writeFileSync(`floors/floor-${f.id === '3' ? 'third' : f.id === 'A' ? 'atrium' : f.id === 'L' ? 'lobby' : 'exhibition'}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w * 4}" height="${h * 4}" stroke-linejoin="round" stroke-linecap="round">${paths.join('')}</svg>`);
  f.paths = paths.length;
}
const data = floors.map(f => ({
  id: f.id, name: f.name, crop: f.crop,
  rooms: rooms.filter(r => r.floor === f.id).map(({ floor, ...r }) => r),
  marks: marks.filter(m => m.floor === f.id).map(({ floor, ...m }) => ({ ...m, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10 })),
}));
writeFileSync('floors/floors.json', JSON.stringify(data));
for (const f of floors) console.log(f.id, f.name, 'paths', f.paths, 'rooms', data.find(d => d.id === f.id).rooms.length, 'marks', data.find(d => d.id === f.id).marks.length);
console.log(data.map(d => d.id + ': ' + d.marks.filter(m => m.kind === 'text').map(m => m.text).join(' | ')).join('\n'));
