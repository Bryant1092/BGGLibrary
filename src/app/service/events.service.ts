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
  /** Display text, e.g. "Reunion Ballroom · Reunion EFGH". */
  room: string;
  /** Raw Tabletop.Events names, used to find the room (or exhibitor booth) on the venue map. */
  roomName: string;
  spaceName: string;
  /** Seats in total (0 when no ticket is needed). */
  seats: number;
  seatsLeft: number;
  waitlist: number;
  ticketed: boolean;
  /**
   * Has tickets on Tabletop.Events, but the description says you don't need
   * one to get in (they only add it to your schedule), e.g. the Board Game
   * Bazaar and Virtual Flea Market. Shown as "No ticket needed" instead of seats.
   */
  ticketOptional: boolean;
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

/** An exhibitor or sponsor from Tabletop.Events. */
export interface Exhibitor {
  id: string;
  name: string;
  description: string;
  website: string;
  /** True for sponsors without a booth in the hall. */
  sponsorOnly: boolean;
}

/**
 * An unpublished game a HomeGrown designer brings to playtest. Tabletop.Events
 * lists them per convention (12 for BGG.CON 2026) but not when or where each
 * is played; HomeGrown playtesting happens in Pegasus A and a few other rooms.
 */
export interface Prototype {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  minutes: number;
  /** How finished it is, in the designer's words on Tabletop.Events. */
  stage: 'final' | 'nearly' | 'mid' | 'early';
  /** People who pressed "I'm interested" on Tabletop.Events. */
  interested: number;
  url: string;
}

/** Tabletop.Events' prototype status values, in plain words, most finished first. */
const PROTOTYPE_STAGES: Record<string, Prototype['stage']> = {
  final_testing: 'final', nearing_completion: 'nearly', middling: 'mid', new: 'early',
};

const API = 'https://tabletop.events/api';
const PAGE_SIZE = 100;
/** Seat counts change all the time during the con; anything older than this is reloaded. */
const FRESH_MS = 5 * 60_000;
const STAR_KEY = 'bgglibrary.starredEvents';
/**
 * The schedule saved on this phone, per convention. The tab shows it instantly
 * and refreshes in the background. Before, every visit waited for 4 downloads
 * (about 5 s on good Wi-Fi, far longer on crowded con Wi-Fi), because the
 * service worker only falls back to its copy after 8 s with no answer.
 * About 250 KB for BGG.CON 2026's 345 events.
 */
const SAVED_PREFIX = 'bgglibrary.events.';
/**
 * Tabletop.Events has no "ticket optional" setting, so organizers write it in
 * the description instead (Nov 2026: Board Game Bazaar and Virtual Flea Market,
 * "BUYERS **DO NOT** need a ticket to enter this event. Tickets are available
 * only as a reminder…"). Only clear phrasings match; "No ticket required for
 * spectators" (Battling Tops) doesn't, because players there still need one.
 */
// [*\s]+ because descriptions use Markdown bold: "**DO NOT** need".
const TICKET_OPTIONAL = /\b(do not|don't|no)[*\s]+need (a )?tickets? to (enter|attend)|\btickets? (are|is) not required|\btickets? (are |is )?(available )?only (as )?a reminder/i;

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
  readonly exhibitors = signal<Exhibitor[] | null>(null);
  readonly prototypes = signal<Prototype[] | null>(null);
  private prototypesFor = '';
  private exhibitorsFor = '';
  private loadedFor = '';

  /** Loads the schedule unless a recent copy is already here (force = refresh button). */
  /**
   * Resolves when this load finishes: true if the schedule came back, false if it
   * failed or nothing was loaded (the refresh button uses it to say what happened).
   */
  load(convention: Convention, force = false): Promise<boolean> {
    return new Promise(resolve => this.loadInner(convention, force, resolve));
  }

  private loadInner(convention: Convention, force: boolean, done: (ok: boolean) => void): void {
    const id = convention.tteConventionId;
    if (!id || this.loading()) { done(false); return; }
    if (this.loadedFor !== id) this.showSaved(id);
    const fresh = this.loadedFor === id && Date.now() - (this.loadedAt() || 0) < FRESH_MS;
    if (fresh && !force) { done(true); return; }
    this.loading.set(true);
    this.error.set(false);
    forkJoin({ types: this.fetchTypes(id), raw: this.fetchAllEvents(id) }).subscribe({
      next: ({ types, raw }) => {
        this.events.set(raw.map(e => this.toEvent(e, types)).filter((e): e is ConEvent => !!e)
          .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name)));
        this.loadedFor = id;
        this.loadedAt.set(Date.now());
        this.loading.set(false);
        this.save(id, this.events()!);
        done(true);
      },
      error: err => {
        console.error('Failed to load events', err);
        this.error.set(true);
        this.loading.set(false);
        done(false);
      },
    });
  }

  /**
   * Exhibitors and sponsors (public; 56 for BGG.CON 2026, one request). Their
   * booth numbers come from the hall map's directory instead (MapService),
   * because Tabletop.Events only shows booth assignments to logged-in staff.
   */
  loadExhibitors(convention: Convention): void {
    const id = convention.tteConventionId;
    if (!id || this.exhibitorsFor === id) return;
    this.exhibitorsFor = id;
    // Same paging as events: 100 per page is Tabletop.Events' maximum (asking for
    // more silently returns its default of 25).
    this.fetchAllPages(`${API}/convention/${id}/exhibitors`, new HttpParams()).pipe(
      map(items => items
        .filter((x: any) => (x.status || 'approved') === 'approved')
        .map((x: any): Exhibitor => ({
          id: x.id,
          name: (x.name || '').trim(),
          description: (x.description || '').trim(),
          website: /^https?:\/\//.test(x.website_uri || '') ? x.website_uri : '',
          sponsorOnly: x.sponsor_only == 1,
        }))
        .sort((a: Exhibitor, b: Exhibitor) => a.name.localeCompare(b.name))),
      catchError(err => {
        console.error('Failed to load exhibitors', err);
        this.exhibitorsFor = ''; // allow a retry next time
        return of(null);
      })
    ).subscribe(list => { if (list) this.exhibitors.set(list); });
  }

  /**
   * HomeGrown playtest prototypes (public, one request). Sorted by how many
   * people are interested, then by how finished they are, so the ones worth a
   * look come first.
   */
  loadPrototypes(convention: Convention): void {
    const id = convention.tteConventionId;
    if (!id || this.prototypesFor === id) return;
    this.prototypesFor = id;
    this.fetchAllPages(`${API}/convention/${id}/prototypes`, new HttpParams()).pipe(
      map(items => items.map((p: any): Prototype => ({
        id: p.id,
        name: (p.name || '').trim(),
        description: (p.description || p.synopsis || '').trim(),
        minPlayers: Number(p.min_players) || 0,
        maxPlayers: Number(p.max_players) || 0,
        minutes: Number(p.play_time) || 0,
        stage: PROTOTYPE_STAGES[p.status] || 'early',
        interested: Number(p.interested_count) || 0,
        url: p.view_uri ? `https://tabletop.events${p.view_uri}` : '',
      }))
        .filter((p: Prototype) => p.name)
        .sort((a: Prototype, b: Prototype) => b.interested - a.interested
          || Object.values(PROTOTYPE_STAGES).indexOf(a.stage) - Object.values(PROTOTYPE_STAGES).indexOf(b.stage)
          || a.name.localeCompare(b.name))),
      catchError(err => {
        console.error('Failed to load prototypes', err);
        this.prototypesFor = ''; // allow a retry next time
        return of(null);
      })
    ).subscribe(list => { if (list) this.prototypes.set(list); });
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

  private fetchAllEvents(conventionId: string): Observable<any[]> {
    return this.fetchAllPages(`${API}/convention/${conventionId}/events`, new HttpParams().set('_order_by', 'start_date'));
  }

  /** Loads every page of a list endpoint: page 1 says how many pages there are; the rest load in parallel. */
  private fetchAllPages(url: string, params: HttpParams): Observable<any[]> {
    const page = (n: number) => this.http.get<any>(url, { params: params.set('_items_per_page', PAGE_SIZE).set('_page_number', n) });
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
    const description = [e.description, e.long_description].map((s: string) => (s || '').trim()).filter(Boolean).join('\n\n');
    const ticketOptional = seats > 1 && TICKET_OPTIONAL.test(description);
    return {
      id: e.id,
      name: (e.name || '').trim(),
      type,
      start,
      end,
      day: dallasDateKey(start),
      durationMin: Number(e.duration) || Math.round((end - start) / 60_000),
      room: this.roomText(e.room_name, e.space_name),
      roomName: (e.room_name || '').trim(),
      spaceName: (e.space_name || '').trim(),
      seats: seats > 1 ? seats : 0,
      seatsLeft: Math.max(0, Number(e.available_quantity) || 0),
      waitlist: Number(e.wait_count) || 0,
      // Hours entries (Library, Exhibit Hall…) and walk-up events have a single placeholder "seat".
      ticketed: seats > 1 && !ticketOptional,
      ticketOptional,
      info: type === 'General Information',
      cancelled: e.is_cancelled == 1,
      age: e.age_range === 'drinking_age' ? '21+' : e.age_range === 'adult' ? '18+' : '',
      description,
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

  /** Shows the saved schedule (if any) while the fresh one loads. "Updated … ago" stays truthful. */
  private showSaved(id: string): void {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_PREFIX + id) || 'null');
      if (Array.isArray(saved?.events) && saved.at) {
        this.events.set(saved.events);
        this.loadedFor = id;
        this.loadedAt.set(saved.at);
      }
    } catch { /* unreadable copy: just load normally */ }
  }

  private save(id: string, events: ConEvent[]): void {
    try {
      // One convention at a time: drop other conventions' copies first.
      Object.keys(localStorage).filter(k => k.startsWith(SAVED_PREFIX) && k !== SAVED_PREFIX + id).forEach(k => localStorage.removeItem(k));
      localStorage.setItem(SAVED_PREFIX + id, JSON.stringify({ at: Date.now(), events }));
    } catch { /* storage full or blocked: the app still works, it just waits next time */ }
  }

  private readStars(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(STAR_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }
}
