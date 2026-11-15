import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { Convention } from '../config/conventions';
import { dallasDateKey } from '../util/library-time';
import { parseTteDate } from '../util/time-ago';

/** One convention event, already cleaned up for display. */
export interface ConEvent {
  id: string;
  name: string;
  type: string;
  /** Start/end instants (ms). Tabletop.Events dates are UTC. */
  start: number;
  end: number;
  /** YYYY-MM-DD in Dallas time, for the day tabs. */
  day: string;
  durationMin: number;
  room: string;
  /** Seats in total (0 when no ticket is needed). */
  seats: number;
  seatsLeft: number;
  waitlist: number;
  ticketed: boolean;
  /** Library/Hot Games/Exhibit Hall/Registration hours etc.: shown as "Today's hours", not as events. */
  info: boolean;
  cancelled: boolean;
  /** '18+' / '21+' or '' for all ages. */
  age: string;
  description: string;
  /** Tabletop.Events page for this event, where tickets are claimed. */
  ticketUrl: string;
  /** Usually a BGG forum thread about the event. */
  moreInfoUrl: string;
}

const API = 'https://tabletop.events/api';
const PAGE_SIZE = 100;
/** Seat counts change all the time during the con; anything older than this is reloaded. */
const FRESH_MS = 5 * 60_000;
const STAR_KEY = 'bgglibrary.starredEvents';

/**
 * Loads a convention's event schedule from Tabletop.Events (public API, CORS
 * open). Checked Nov 2026 for BGG.CON 2026: 345 events, 4 pages of 100 that
 * load in parallel in about 3 s (~175 KB compressed). The API ignores
 * seat-count filters, so filtering happens here. Offline, the service
 * worker's cached copy is used (ngsw-config dataGroup for tabletop.events/api).
 *
 * Starred events are saved on this device, like bells.
 */
@Injectable({ providedIn: 'root' })
export class EventsService {
  private http = inject(HttpClient);

  readonly events = signal<ConEvent[] | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly loadedAt = signal<number | null>(null);
  readonly starred = signal<Set<string>>(this.readStars());
  private loadedFor = '';

  /** Loads the schedule unless a recent copy is already here (force = refresh button). */
  load(convention: Convention, force = false): void {
    const id = convention.tteConventionId;
    if (!id || this.loading()) return;
    const fresh = this.loadedFor === id && Date.now() - (this.loadedAt() || 0) < FRESH_MS;
    if (fresh && !force) return;
    this.loading.set(true);
    this.error.set(false);
    forkJoin({ types: this.fetchTypes(id), raw: this.fetchAllEvents(id) }).subscribe({
      next: ({ types, raw }) => {
        this.events.set(raw.map(e => this.toEvent(e, types)).filter((e): e is ConEvent => !!e)
          .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name)));
        this.loadedFor = id;
        this.loadedAt.set(Date.now());
        this.loading.set(false);
      },
      error: err => {
        console.error('Failed to load events', err);
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  isStarred(id: string): boolean {
    return this.starred().has(id);
  }

  toggleStar(id: string): boolean {
    const next = new Set(this.starred());
    const on = !next.has(id);
    if (on) next.add(id); else next.delete(id);
    this.starred.set(next);
    try {
      localStorage.setItem(STAR_KEY, JSON.stringify([...next]));
    } catch { /* storage blocked: stars last until the app is closed */ }
    return on;
  }

  /** Page 1 tells us how many pages there are; the rest load in parallel. */
  private fetchAllEvents(conventionId: string): Observable<any[]> {
    const page = (n: number) => this.http.get<any>(`${API}/convention/${conventionId}/events`, {
      params: new HttpParams().set('_items_per_page', PAGE_SIZE).set('_page_number', n).set('_order_by', 'start_date'),
    });
    return page(1).pipe(
      switchMap(first => {
        const pages = Number(first?.result?.paging?.total_pages) || 1;
        const rest = Array.from({ length: pages - 1 }, (_, i) => page(i + 2));
        return (rest.length ? forkJoin(rest) : of([])).pipe(
          map(others => [first, ...others].flatMap(r => r?.result?.items || []))
        );
      })
    );
  }

  /** Event type names (e.g. "Board/Card Games"); events only carry a type id. */
  private fetchTypes(conventionId: string): Observable<Map<string, string>> {
    return this.http.get<any>(`${API}/convention/${conventionId}/eventtypes`, { params: new HttpParams().set('_items_per_page', 100) }).pipe(
      map(r => new Map<string, string>((r?.result?.items || []).map((t: any) => [t.id, t.name]))),
      catchError(() => of(new Map<string, string>()))
    );
  }

  private toEvent(e: any, types: Map<string, string>): ConEvent | null {
    const start = parseTteDate(e.start_date)?.getTime();
    const end = parseTteDate(e.end_date)?.getTime();
    // Private, unpublished or trashed events aren't on the public schedule.
    if (!start || !end || e.private == 1 || e.published_to_schedule == 0 || e.trashed == 1) return null;
    const type = types.get(e.type_id) || 'Other';
    const seats = Number(e.max_quantity) || 0;
    return {
      id: e.id,
      name: (e.name || '').trim(),
      type,
      start,
      end,
      day: dallasDateKey(start),
      durationMin: Number(e.duration) || Math.round((end - start) / 60_000),
      room: this.roomText(e.room_name, e.space_name),
      seats: seats > 1 ? seats : 0,
      seatsLeft: Math.max(0, Number(e.available_quantity) || 0),
      waitlist: Number(e.wait_count) || 0,
      // Hours entries (Library, Exhibit Hall…) and walk-up events have a single placeholder "seat".
      ticketed: seats > 1,
      info: type === 'General Information',
      cancelled: e.is_cancelled == 1,
      age: e.age_range === 'drinking_age' ? '21+' : e.age_range === 'adult' ? '18+' : '',
      description: [e.description, e.long_description].map((s: string) => (s || '').trim()).filter(Boolean).join('\n\n'),
      ticketUrl: e.view_uri ? `https://tabletop.events${e.view_uri}` : '',
      moreInfoUrl: /^https?:\/\//.test(e.more_info_uri || '') ? e.more_info_uri : '',
    };
  }

  /**
   * Room plus the specific space inside it, e.g. "Reunion Ballroom · Reunion EFGH".
   * When the space name already includes the room ("Pegasus A - HomeGrown
   * Playtesting" in "Pegasus A"), only the space is shown to avoid repeating it.
   */
  private roomText(room?: string, space?: string): string {
    room = (room || '').trim();
    space = (space || '').trim();
    if (!space || space === room) return room;
    if (!room || space.toLowerCase().startsWith(room.toLowerCase())) return space;
    return `${room} · ${space}`;
  }

  private readStars(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(STAR_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }
}
