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
   * The BGG Prize Booth, for prize-drawing winners. Where it is comes from BGG's own
   * posts each convention (findPrizeBooth): 2023-2025 "in the Exhibit Hall", 2026
   * "near the Registration/Information Desk".
   * - registration: circles the map's REGISTRATION label.
   * - hall: the booth itself if that year's hall map lists a Prize Booth, else the hall.
   * - unknown (BGG didn't say): the exhibit hall, where it has been most years.
   * Falls back to the hall when the map has no matching spot.
   */
  prizeBoothRequest(where: 'registration' | 'hall' | 'unknown'): MapRequest | null {
    const maps = this.maps();
    if (!maps) return null;
    if (where === 'registration') {
      const reg = maps.marks.find(m => m.kind === 'text' && /^registration/i.test(m.text || ''));
      if (reg) return { floor: reg.floor, point: { floor: reg.floor, x: reg.x, y: reg.y - 3 }, label: 'BGG Prize Booth (by Registration)' };
    }
    const booth = maps.booths.find(b => /prize/i.test(b.name));
    if (booth) return this.boothRequest(booth.num, booth.name);
    return this.hallRequest();
  }

  /**
   * The Hot Games room (BGG.CON: Cumberland E–H on the Exhibition level), for the
   * "Show on map" buttons next to Hot Games notes. Uses the room marked kind "hot" in
   * this convention's map, so next year's map only needs that room drawn.
   */
  hotGamesRequest(): MapRequest | null {
    const room = this.maps()?.rooms.find(r => r.kind === 'hot');
    return room ? { select: ['room:' + room.id], label: `Hot Games tables · ${room.sub}` } : null;
  }

  /**
   * Where an event is: its room, or for exhibit-hall events the exhibitor's booth (or
   * the hall). Shared by the Events tab and the "Up next" card.
   */
  eventRequest(e: { roomName: string; spaceName: string; room: string }, label?: string): MapRequest | null {
    if (!this.maps()) return null;
    if (e.roomName === 'Marsalis') {
      const booth = this.boothFor(e.spaceName);
      if (booth) return this.boothRequest(booth, e.spaceName.replace(/-[A-Z]$/, ''));
      return this.hallRequest();
    }
    return this.roomRequest(e.roomName, label || e.room);
  }

  homegrownRequest(): MapRequest | null {
    return this.maps() ? { select: HOMEGROWN, label: 'HomeGrown playtesting rooms' } : null;
  }

  /** The exhibit hall, zoomed into its booths. */
  hallRequest(): MapRequest | null {
    return this.maps() ? { floor: 'E', hall: true } : null;
  }
}
