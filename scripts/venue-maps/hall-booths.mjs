// BGG.CON 2026 exhibit hall: booth outlines (hall-map PDF units), the directory, and which
// extracted logo image sits in which booth.
import { readFileSync, writeFileSync } from 'node:fs';

export const DIRECTORY = {
  '100': 'Allplay', '316': 'Arcanum Ludi', '214': 'Ardonis', '307': 'Artful Creations', '210': 'Average Dude Designs', '410': 'BGG Store',
  '099': 'BoxKing Gaming', '204': 'Brookspun Games', '117': 'Captain Games', '411': 'Chain Assembly', '107': 'Common Ground Games',
  '302': 'Contention Games', '417': 'Cornerstone Games', '216': 'Craft the Crown', '201': 'Czech Games Edition', '301': 'Decision Games',
  '202': "DMDave's Books and Games", '215': 'Fratala Games', '213': 'Gameswell', '203': "Gaming at Joe's", '319': 'Geek Out', '105': 'Grey Fox Games',
  '205': 'Hairbrained Design', '207': 'Hearth and Token', '312': 'House Rules Board Games', '101': 'Indie Game Studios', '315': 'Lab 380',
  '115': 'Lucky Duck Games', '305': 'Mildly Tolerable Games', '209': 'Moon Crab Games', '308': 'New Comet Games', '317': 'Next Big Project',
  '402': 'Nexus Workshop', '119': 'Pegasus Publishing', '206': 'Piece Keepers', '306': 'Playful Otter Studios', '309': 'Really Good Game Studio',
  '303': 'Rock, Stone & Dice Games', '413': 'Savagesparrow Studios', '310': 'Scallywags International', '409': 'Sea Cow Games',
  '406': 'Speedrobo Games', '212': 'Split Decision Games', '208': 'Tabletop Gaymers', '408': 'TCG Co', '211': 'Teltaine Trading Company',
  '217': 'TerreDice Games', '219': 'The Op Games', '311': 'Uniquely Geek', '103': 'Wattsalpoag Games', '419': 'Welcome Home Creations TN',
};

// Booth rectangles [number, x, y, w, h], measured against the hall PDF's table lines and booth numbers.
export const BOOTHS = [
  ['119', 1085, 95, 160, 70], ['219', 1305, 95, 160, 70], ['319', 1530, 95, 160, 70], ['419', 1750, 95, 75, 70],
  ['117', 1085, 165, 75, 72], ['115', 1085, 237, 75, 74], ['107', 1085, 380, 75, 217], ['105', 1085, 599, 75, 71], ['103', 1085, 672, 75, 70],
  ['216', 1165, 165, 80, 72], ['214', 1165, 237, 80, 74], ['212', 1165, 311, 80, 71], ['210', 1165, 382, 80, 73], ['208', 1165, 455, 80, 72],
  ['206', 1165, 527, 80, 72], ['204', 1165, 599, 80, 73], ['202', 1165, 672, 80, 70],
  ['217', 1305, 165, 80, 72], ['215', 1305, 237, 80, 74], ['213', 1305, 311, 80, 71], ['211', 1305, 382, 80, 73], ['209', 1305, 455, 80, 72],
  ['207', 1305, 527, 80, 72], ['205', 1305, 599, 80, 73], ['203', 1305, 672, 80, 70],
  ['316', 1390, 165, 80, 72], ['312', 1390, 237, 80, 145], ['310', 1390, 382, 80, 73], ['308', 1390, 455, 80, 72], ['306', 1390, 527, 80, 72], ['302', 1390, 599, 80, 143],
  ['317', 1525, 165, 80, 72], ['315', 1525, 237, 80, 74], ['311', 1525, 311, 80, 144], ['309', 1525, 455, 80, 72], ['307', 1525, 527, 80, 72],
  ['305', 1525, 599, 80, 73], ['303', 1525, 672, 80, 70],
  ['410', 1615, 165, 80, 290], ['408', 1615, 455, 80, 72], ['406', 1615, 527, 80, 72], ['402', 1615, 599, 80, 143],
  ['417', 1745, 200, 80, 70], ['413', 1745, 330, 80, 70], ['411', 1745, 450, 80, 70], ['409', 1745, 520, 80, 80],
  ['101', 1085, 750, 160, 80], ['201', 1305, 750, 160, 80], ['301', 1530, 750, 160, 80],
  ['100', 1145, 880, 245, 125], ['099', 705, 895, 95, 85],
];

export function slug(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

if (process.argv[1].endsWith('hall-booths.mjs')) {
  const images = JSON.parse(readFileSync('logos-raw/images.json', 'utf8'));
  const assigned = {}; const unmatched = [];
  for (const im of images) {
    const [x0, y0, x1, y1] = im.box; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const booth = BOOTHS.find(([, x, y, w, h]) => cx >= x && cx <= x + w && cy >= y && cy <= y + h);
    if (!booth) { unmatched.push(im.file + ' @' + Math.round(cx) + ',' + Math.round(cy)); continue; }
    const num = booth[0];
    // A booth with two images keeps the larger one.
    const area = (x1 - x0) * (y1 - y0);
    if (!assigned[num] || assigned[num].area < area) assigned[num] = { file: im.file, area, rotated: (y1 - y0) > (x1 - x0) * 2 && im.w > im.h * 2 };
  }
  const logos = Object.entries(assigned).map(([num, a]) => ({ booth: num, name: DIRECTORY[num] || '', slug: slug(DIRECTORY[num] || 'booth-' + num), src: a.file, rotated: a.rotated }));
  writeFileSync('logos-raw/assigned.json', JSON.stringify(logos, null, 1));
  const missing = BOOTHS.map(b => b[0]).filter(n => !assigned[n]);
  console.log('logos matched to booths:', logos.length, '| booths without a logo:', missing.join(', ') || 'none');
  console.log('images not inside a booth:', unmatched.join(' | ') || 'none');
  console.log(logos.filter(l => l.rotated).map(l => 'rotated: ' + l.booth + ' ' + l.name).join('\n'));
}
