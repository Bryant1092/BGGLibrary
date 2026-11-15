// Writes src/app/config/venue-maps.ts from the generated floor data.
import { readFileSync, writeFileSync } from 'node:fs';
const out = process.argv[2];
const floors = JSON.parse(readFileSync('floors/floors.json', 'utf8'));
const booths = JSON.parse(readFileSync('floors/hall-booths.json', 'utf8'));

// Tabletop.Events room_name (exact spelling, typos included) -> room shapes on the map.
const TTE = {
  'Gaston': ['gastonA', 'gastonB'], 'Moreno': ['morenoA', 'morenoB'], 'Kessler': ['kessler'], 'McMillan': ['mcmillan'],
  'Pryor-Crockett': ['pryor'], 'Bryan Beeman': ['bryanA', 'bryanB'], 'Cotton Bowl': ['cotton'],
  'Reverchon A - RPG Room': ['reverchonA'], 'Reverchon B - WarGamers HQ': ['reverchonB'], 'Sanger A - Quiet Games': ['sangerA'],
  'Ariel Queen': ['aerial'], 'Dallas Belt': ['dallasbelt'], 'The Central': ['central'], 'Shawnee Trail': ['shawnee'],
  'Reunion Ballroom': ['reunionSE', 'reunionOG'], 'Pegasus A': ['pegasusA'], 'Pegagus B': ['pegasusB'],
  'Cumberland IJKL': ['library'], 'Cumberland EFGH': ['hot'], 'Marsalis': ['hallA'],
};
// Schedule rooms with no outlined room on the plan: a point to circle instead (Hyatt PDF units).
const POINTS = {
  'Trinity A': { floor: 'L', x: 264, y: 341 },
  'Reunion Lobby': { floor: 'L', x: 352, y: 352 },
  'Centennial Restaurant': { floor: 'A', x: 216, y: 579 },
};
const files = { '3': 'floor-third.svg', A: 'floor-atrium.svg', L: 'floor-lobby.svg', E: 'floor-exhibition.svg' };
const shorts = { '3': '3', A: 'A', L: 'L', E: 'E' };
const tteOf = id => Object.entries(TTE).filter(([, ids]) => ids.includes(id)).map(([n]) => n);

const data = {
  floors: floors.map(f => ({ id: f.id, short: shorts[f.id], name: f.name, src: `maps/bggcon-2026/${files[f.id]}`, crop: f.crop })),
  rooms: floors.flatMap(f => f.rooms.map(r => ({ id: r.id, floor: f.id, name: r.name, sub: r.sub, kind: r.kind, poly: r.poly, tte: tteOf(r.id) }))),
  booths: booths.map(b => ({ num: b.num, name: b.name, logo: b.logo ? `maps/logos/${b.logo}` : '', poly: b.poly })),
  marks: floors.flatMap(f => f.marks.map(m => ({ floor: f.id, kind: m.kind, x: m.x, y: m.y, ...(m.text ? { text: m.text } : {}) }))),
  points: POINTS,
};
const json = JSON.stringify(data);
const ts = `/**
 * Venue maps (generated; see scripts/venue-maps/README.md to rebuild).
 *
 * Floors are the Hyatt Regency Dallas floor-plan PDF's own vector drawing, one SVG per
 * level in public/maps/<convention>/. Coordinates below are that PDF's page units.
 *  - rooms: the PDF's room shapes, cut along its own dashed dividers (Gaston A/B, Marsalis
 *    A/B…), with BGG.CON's use of each (from the con's map). \`tte\` lists the Tabletop.Events
 *    room names (exact spelling, typos included) that should circle the room.
 *  - booths: the exhibit hall's booths from BGG.CON's hall-map PDF, placed into the Hyatt plan
 *    with a perspective transform fitted on the hall's corners. Booth assignments come from that
 *    map's directory because Tabletop.Events only shows them to logged-in staff.
 *  - logos: extracted from the hall-map PDF and saved by exhibitor name in public/maps/logos,
 *    so a later year can reuse a logo when the exhibitor's name matches (logos/index.json).
 *  - marks: elevators, escalators, restrooms and place names from the PDF's labels.
 *  - points: schedule rooms the plan doesn't outline, circled at a spot instead.
 * For another convention, add an entry built the same way.
 */
export type FloorId = '3' | 'A' | 'L' | 'E';
export type PlaceKind = 'open' | 'sched' | 'special' | 'exhibit' | 'library' | 'hot' | 'quiet' | 'calm' | 'rpg' | 'war' | 'proto' | 'service' | 'other';
export type Pt = [number, number];

export interface VenueFloor { id: FloorId; short: string; name: string; src: string; crop: [number, number, number, number]; }
export interface VenueRoom { id: string; floor: FloorId; name: string; sub: string; kind: PlaceKind; poly: Pt[]; tte: string[]; }
export interface VenueBooth { num: string; name: string; logo: string; poly: Pt[]; }
export interface VenueMark { floor: FloorId; kind: 'elev' | 'esc' | 'wc' | 'text'; x: number; y: number; text?: string; }
export interface ConventionMaps {
  floors: VenueFloor[];
  rooms: VenueRoom[];
  booths: VenueBooth[];
  marks: VenueMark[];
  points: Record<string, { floor: FloorId; x: number; y: number }>;
}

export const VENUE_MAPS: Record<string, ConventionMaps> = {
  'BGG.CON 2026': ${json} as ConventionMaps,
};
`;
writeFileSync(out, ts);
console.log('wrote', out, Math.round(ts.length / 1024) + ' KB', '| rooms', data.rooms.length, '| with schedule names', data.rooms.filter(r => r.tte.length).length, '| booths', data.booths.length, '| marks', data.marks.length);
