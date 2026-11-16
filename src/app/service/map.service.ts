import { Injectable, signal } from '@angular/core';
import { ConventionMaps, FloorId, VENUE_MAPS } from '../config/venue-maps';
import { currentOrNextConvention } from '../util/library-time';

/**
 * What the venue map should show when it opens.
 *  - select: rooms ("room:gastonA") and/or booths ("booth:204") to highlight; the map opens on
 *    the first one's floor, zoomed to fit them.
 *  - point: a spot to circle for schedule rooms the floor plan doesn't outline (Trinity A…).
 *  - hall: open zoomed into the exhibit hall's booths.
 * With none of these it shows the whole floor (Lobby level by default: where people come in).
 */
export interface MapRequest {
  floor?: FloorId;
  select?: string[];
  point?: { floor: FloorId; x: number; y: number };
  hall?: boolean;
  /** Shown on the place card, e.g. "Gaston" or "HomeGrown playtesting rooms". */
  label?: string;
}

/** Lowercase, no accents/punctuation/company suffixes, for matching names typed slightly differently. */
function normalize(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(llc|inc|ltd|co)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Rooms used for HomeGrown (unpublished designers') playtesting at BGG.CON 2026, from the
 * schedule: Pegasus A is the HomeGrown Games Lab; Gaston tables, Bryan-Beeman B and
 * McMillan host the rest.
 */
const HOMEGROWN = ['room:pegasusA', 'room:gastonA', 'room:gastonB', 'room:bryanB', 'room:mcmillan'];

/**
 * Opens the full-screen venue map (MapViewerComponent, in the app shell) and finds where
 * schedule rooms and exhibitor booths are on it, using config/venue-maps.ts.
 */
@Injectable({ providedIn: 'root' })
export class MapService {
  readonly request = signal<MapRequest | null>(null);

  /**
   * Set by the Events tab while it's open, so the map's place card can offer
   * "Events here" / "Exhibitor details" and hand the choice back to it.
   */
  onEventsHere: ((tteRoom: string) => void) | null = null;
  onExhibitor: ((booth: string) => void) | null = null;

  /** Maps for the current/next convention, or undefined if none were added. */
  maps(): ConventionMaps | undefined {
    const convention = currentOrNextConvention();
    return convention ? VENUE_MAPS[convention.name] : undefined;
  }

  show(request: MapRequest): void {
    this.request.set(request);
  }

  close(): void {
    this.request.set(null);
  }

  /** Where a schedule room is (room names as Tabletop.Events spells them). */
  roomRequest(roomName: string, label = roomName): MapRequest | null {
    const maps = this.maps();
    if (!maps || !roomName) return null;
    const key = normalize(roomName);
    const rooms = maps.rooms.filter(r => r.tte.some(t => t === roomName || normalize(t) === key));
    if (rooms.length) return { select: rooms.map(r => 'room:' + r.id), label };
    const point = maps.points[roomName] ?? Object.entries(maps.points).find(([k]) => normalize(k) === key)?.[1];
    return point ? { point, label } : null;
  }

  /**
   * Booth number for an exhibitor name from Tabletop.Events. Names differ a
   * little from the hall map's directory ("LLC", "CGE (Czech Games Edition)"),
   * so the full name, the name without the bracketed part, and the bracketed
   * part are all tried.
   */
  boothFor(exhibitorName: string): string | null {
    const raw = exhibitorName.replace(/-[A-Z]$/, ''); // "Rock, Stone & Dice Games-A" = one of their tables
    const inBrackets = raw.match(/\(([^)]+)\)/)?.[1] || '';
    const candidates = [raw, raw.replace(/\([^)]*\)/g, ''), inBrackets].map(normalize).filter(c => c.length >= 3);
    const entry = this.maps()?.booths.find(b => {
      const name = normalize(b.name);
      return !!name && candidates.some(t => name === t || (name.length >= 5 && t.startsWith(name)) || (t.length >= 5 && name.startsWith(t)));
    });
    return entry?.num ?? null;
  }

  boothRequest(booth: string, exhibitorName?: string): MapRequest | null {
    const exists = this.maps()?.booths.some(b => b.num === booth);
    return exists ? { select: ['booth:' + booth], label: `Booth ${booth}${exhibitorName ? ' · ' + exhibitorName : ''}` } : null;
  }

  /** All HomeGrown playtesting rooms highlighted (they're on two floors; the card lists them). */
  /**
   * The BGG Prize Booth, for prize-drawing winners. BGG's BGG.CON 2026 exhibitor post
   * says it's "located up near the Registration/Information Desk" (it was in the
   * Exhibit Hall in 2025), so this circles the map's REGISTRATION label. If a future
   * map has no such label, it falls back to the exhibit hall.
   */
  prizeBoothRequest(): MapRequest | null {
    const maps = this.maps();
    if (!maps) return null;
    const reg = maps.marks.find(m => m.kind === 'text' && /^registration/i.test((m as any).text || ''));
    return reg
      ? { floor: reg.floor, point: { floor: reg.floor, x: reg.x, y: reg.y - 3 }, label: 'BGG Prize Booth (by Registration)' }
      : this.hallRequest();
  }

  homegrownRequest(): MapRequest | null {
    return this.maps() ? { select: HOMEGROWN, label: 'HomeGrown playtesting rooms' } : null;
  }

  /** The exhibit hall, zoomed into its booths. */
  hallRequest(): MapRequest | null {
    return this.maps() ? { floor: 'E', hall: true } : null;
  }
}
