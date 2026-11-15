import { Injectable, signal } from '@angular/core';
import { ConventionMaps, MapSpot, VENUE_MAPS, VenueMap } from '../config/venue-maps';
import { currentOrNextConvention } from '../util/library-time';

export interface MapRequest {
  map: VenueMap['id'];
  /** Place to circle and center on; omitted to just browse the map. */
  spot?: MapSpot;
  /** Shown in the viewer's top bar, e.g. "Gaston" or "Booth 204 · Brookspun Games". */
  label?: string;
}

/** Lowercase, no accents/punctuation/company suffixes, for matching names typed slightly differently. */
function normalize(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(llc|inc|ltd|co)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Opens the full-screen venue map (MapViewerComponent, in the app shell) and
 * finds where rooms and exhibitor booths are on it, using config/venue-maps.ts.
 */
@Injectable({ providedIn: 'root' })
export class MapService {
  readonly request = signal<MapRequest | null>(null);

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

  /** Where a schedule room is on the hotel map (room names as Tabletop.Events spells them). */
  roomRequest(roomName: string, label = roomName): MapRequest | null {
    const rooms = this.maps()?.rooms;
    if (!rooms || !roomName) return null;
    const spot = rooms[roomName] ?? Object.entries(rooms).find(([key]) => normalize(key) === normalize(roomName))?.[1];
    return spot ? { map: 'hotel', spot, label } : null;
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
    const entry = this.maps()?.directory.find(d => {
      const name = normalize(d.name);
      return candidates.some(t => name === t || (name.length >= 5 && t.startsWith(name)) || (t.length >= 5 && name.startsWith(t)));
    });
    return entry?.booth ?? null;
  }

  boothRequest(booth: string, exhibitorName?: string): MapRequest | null {
    const spot = this.maps()?.booths[booth];
    if (!spot) return null;
    return { map: 'hall', spot, label: `Booth ${booth}${exhibitorName ? ' · ' + exhibitorName : ''}` };
  }
}
