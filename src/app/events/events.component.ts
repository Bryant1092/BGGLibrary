import { AfterViewInit, ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { CONVENTIONS, Convention } from '../config/conventions';
import { ConEvent, EventsService, Exhibitor } from '../service/events.service';
import { MapRequest, MapService } from '../service/map.service';
import { ToastService } from '../service/toast.service';
import { IconComponent } from '../shared/icon.component';
import { OfflineBarComponent } from '../shared/offline-bar.component';
import { SheetComponent } from '../shared/sheet.component';
import { currentOrNextConvention, dallasDateKey, formatLibraryTime, shortDuration } from '../util/library-time';

/**
 * Colors for event types: a small dot next to the type name (the name is always
 * shown too, so color is never the only cue). Unknown types fall back to grey.
 */
const TYPE_COLORS: Record<string, string> = {
  'Board/Card Games': '#c2410c',
  'Exhibitor Events': '#1d4ed8',
  'Role Playing Games': '#7c3aed',
  'Game Design Track': '#0f766e',
  'BGG Sponsored Events': '#b45309',
  'War Games': '#4d7c0f',
  'Party Games': '#be185d',
  '18xx': '#475569',
};

/** Page choices kept while the app is open, so switching tabs doesn't reset them. */
const pageState = { view: 'schedule' as 'schedule' | 'exhibitors', exhibitorQuery: '', day: '', query: '', hasSeats: true, starredOnly: false, types: [] as string[], showEarlier: false };

interface EventRow {
  event: ConEvent;
  timeText: string;
  seatsText: string;
  seatsTone: 'open' | 'few' | 'full' | 'none';
  color: string;
  starred: boolean;
  /** Names of other starred events this one overlaps with. */
  overlaps: string[];
}

/**
 * Events tab: the convention schedule from Tabletop.Events.
 *
 * Layout follows common conference-app guidance (sources in the commit
 * message): day tabs that open on today, events grouped under pinned start-time
 * headers, "Happening now" first and finished events hidden (a top complaint
 * about other con apps is scrolling past what already happened), filters for
 * open seats / starred / type, a starred personal schedule with overlaps
 * flagged, and times in Dallas time. The Library/Hot Games/Exhibit Hall/
 * Registration "events" are really opening hours, so they're a compact
 * "Hours" panel instead of 24 rows in the list.
 */
@Component({
  selector: 'app-events',
  standalone: true,
  imports: [IconComponent, SheetComponent, OfflineBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './events.component.html',
  styleUrl: './events.component.css',
})
export class EventsComponent implements OnInit, AfterViewInit, OnDestroy {
  service = inject(EventsService);
  mapService = inject(MapService);
  private toast = inject(ToastService);
  private header = viewChild.required<ElementRef<HTMLElement>>('header');
  private resize?: ResizeObserver;

  now = signal(Date.now());
  private clock = setInterval(() => this.now.set(Date.now()), 60_000);
  /** Seat counts change quickly at the con: refresh every 5 minutes while visible. */
  private refresher = setInterval(() => {
    if (document.visibilityState === 'visible' && this.convention()) this.service.load(this.convention()!);
  }, 5 * 60_000);

  convention = signal<Convention | undefined>(currentOrNextConvention() ?? CONVENTIONS[CONVENTIONS.length - 1]);
  day = signal(pageState.day);
  query = signal(pageState.query);
  hasSeats = signal(pageState.hasSeats);
  starredOnly = signal(pageState.starredOnly);
  types = signal<Set<string>>(new Set(pageState.types));
  showEarlier = signal(pageState.showEarlier);
  sheet = signal<'event' | 'types' | 'exhibitor' | null>(null);
  selected = signal<ConEvent | null>(null);
  /** Schedule or the exhibitor list (both come from Tabletop.Events). */
  view = signal(pageState.view);
  exhibitorQuery = signal(pageState.exhibitorQuery);
  selectedExhibitor = signal<Exhibitor | null>(null);
  /** The convention has venue maps (config/venue-maps.ts). */
  hasMaps = computed(() => !!this.mapService.maps());

  /** Day tabs from the convention's dates, e.g. { key: '2026-11-20', label: 'Fri', date: '20' }. */
  days = computed(() => (this.convention()?.days || []).map(d => {
    const noon = new Date(`${d.date}T12:00:00Z`);
    return {
      key: d.date,
      label: noon.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      date: String(noon.getUTCDate()),
    };
  }));

  /** All event types present this convention, for the Type filter. */
  allTypes = computed(() => [...new Set((this.service.events() || []).filter(e => !e.info).map(e => e.type))].sort());

  private dayEvents = computed(() => (this.service.events() || []).filter(e => e.day === this.day()));

  /** "Hours" panel: Library, Hot Games, Exhibit Hall, Registration and the prize drawing for the selected day. */
  hours = computed(() => {
    const byName = new Map<string, { spans: string[]; place: MapRequest | null }>();
    for (const e of this.dayEvents().filter(ev => ev.info)) {
      const span = e.durationMin <= 60 ? this.clockText(e.start) : `${this.clockText(e.start)} – ${this.clockText(e.end)}`;
      const entry = byName.get(e.name) || { spans: [], place: this.placeFor(e, e.name) };
      entry.spans.push(span);
      byName.set(e.name, entry);
    }
    return [...byName].map(([name, { spans, place }]) => ({ name, text: spans.join(', '), place }));
  });

  /** Starred events (all days), for overlap checks. */
  private starredEvents = computed(() => (this.service.events() || []).filter(e => this.service.starred().has(e.id) && !e.info));

  private rows = computed<EventRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    const types = this.types();
    const starred = this.service.starred();
    const now = this.now();
    return this.dayEvents()
      .filter(e => !e.info)
      .filter(e => !q || e.name.toLowerCase().includes(q) || e.room.toLowerCase().includes(q) || e.type.toLowerCase().includes(q))
      .filter(e => !types.size || types.has(e.type))
      .filter(e => !this.starredOnly() || starred.has(e.id))
      .map(e => this.toRow(e, now, starred));
  });

  /**
   * Full events hidden by "Has seats" (shown in the summary so nothing silently
   * disappears). Only counts ones that would otherwise be visible, not finished ones.
   */
  hiddenFull = computed(() => this.hasSeats()
    ? this.rows().filter(r => r.seatsTone === 'full' && (this.showEarlier() || r.event.end > this.now())).length
    : 0);
  /** Events that already ended today (hidden unless "Show earlier"). */
  earlierCount = computed(() => this.rows().filter(r => r.event.end <= this.now()).length);

  /** Visible rows grouped: "Happening now" first, then by start time. */
  groups = computed(() => {
    const now = this.now();
    const rows = this.rows()
      .filter(r => !this.hasSeats() || r.seatsTone !== 'full')
      .filter(r => this.showEarlier() || r.event.end > now);
    const groups: { title: string; now: boolean; rows: EventRow[] }[] = [];
    const happening = rows.filter(r => r.event.start <= now && r.event.end > now);
    if (happening.length) groups.push({ title: 'Happening now', now: true, rows: happening });
    for (const r of rows.filter(r => !happening.includes(r))) {
      const title = this.clockText(r.event.start);
      const last = groups[groups.length - 1];
      if (last && !last.now && last.title === title) last.rows.push(r);
      else groups.push({ title, now: false, rows: [r] });
    }
    return groups;
  });

  visibleCount = computed(() => this.groups().reduce((n, g) => n + g.rows.length, 0));
  typeChip = computed(() => {
    const t = [...this.types()];
    return !t.length ? 'Type' : t.length === 1 ? t[0] : `${t.length} types`;
  });
  updatedText = computed(() => {
    const at = this.service.loadedAt();
    if (!at) return '';
    const ago = this.now() - at;
    return ago < 60_000 ? 'Updated just now' : `Updated ${shortDuration(ago)} ago`;
  });
  selectedRow = computed(() => {
    const e = this.selected();
    return e ? this.toRow(e, this.now(), this.service.starred()) : null;
  });

  /** Exhibitors with their booth from the hall map's directory, filtered by search. */
  exhibitorRows = computed(() => {
    const q = this.exhibitorQuery().trim().toLowerCase();
    return (this.service.exhibitors() || [])
      .filter(x => !q || x.name.toLowerCase().includes(q) || x.description.toLowerCase().includes(q))
      .map(x => ({ exhibitor: x, booth: this.mapService.boothFor(x.name) }))
      // Booths first (A–Z), then sponsors without a booth.
      .sort((a, b) => Number(!a.booth) - Number(!b.booth) || a.exhibitor.name.localeCompare(b.exhibitor.name));
  });

  /** For the exhibitor sheet: their booth and their events at the booth (room Marsalis, space = exhibitor). */
  exhibitorDetail = computed(() => {
    const x = this.selectedExhibitor();
    if (!x) return null;
    const booth = this.mapService.boothFor(x.name);
    // Demos usually repeat all day (one booth had 15 "Clandestine - Demo" sessions),
    // so sessions with the same name become one line pointing at the next one.
    const now = this.now();
    const sessions = (this.service.events() || [])
      .filter(e => !e.info && e.roomName === 'Marsalis' && !!booth && this.mapService.boothFor(e.spaceName) === booth);
    const byName = new Map<string, ConEvent[]>();
    for (const e of sessions) byName.set(e.name, [...(byName.get(e.name) || []), e]);
    const events = [...byName].map(([name, all]) => {
      const next = all.find(e => e.end > now) || all[all.length - 1];
      const count = all.length > 1 ? `${all.length} sessions · ` : '';
      return { name, event: next, when: count + (next.end > now ? 'next ' : 'last ') + this.whenText(next) };
    });
    return { exhibitor: x, booth, events };
  });

  /**
   * Where an event is on the venue maps: an exhibitor's demo table goes to their
   * booth on the hall map; the Exhibit Hall itself opens the hall map; other
   * rooms are circled on the hotel map. Null when the room isn't on a map.
   */
  placeFor(e: ConEvent, label?: string): MapRequest | null {
    if (!this.hasMaps()) return null;
    if (e.roomName === 'Marsalis') {
      const booth = this.mapService.boothFor(e.spaceName);
      if (booth) return this.mapService.boothRequest(booth, e.spaceName.replace(/-[A-Z]$/, ''));
      return { map: 'hall', label: label || 'Exhibit hall' };
    }
    return this.mapService.roomRequest(e.roomName, label || e.room);
  }

  showPlace(place: MapRequest | null): void {
    if (place) this.mapService.show(place);
  }

  openMaps(): void {
    this.mapService.show({ map: this.view() === 'exhibitors' ? 'hall' : 'hotel' });
  }

  setView(view: 'schedule' | 'exhibitors'): void {
    this.view.set(view);
    window.scrollTo(0, 0);
    const convention = this.convention();
    if (view === 'exhibitors' && convention) this.service.loadExhibitors(convention);
  }

  openExhibitor(x: Exhibitor): void {
    this.selectedExhibitor.set(x);
    this.sheet.set('exhibitor');
  }

  openEventFromExhibitor(e: ConEvent): void {
    this.selected.set(e);
    this.sheet.set('event');
  }

  ngOnInit(): void {
    // Open on today during the con; otherwise the first day (or the day last viewed).
    const today = dallasDateKey(Date.now());
    const keys = this.days().map(d => d.key);
    if (keys.includes(today) && !pageState.day) this.day.set(today);
    else if (!keys.includes(this.day())) this.day.set(keys[0] || '');
    const convention = this.convention();
    if (convention) this.service.load(convention);
    if (convention && this.view() === 'exhibitors') this.service.loadExhibitors(convention);
  }

  ngAfterViewInit(): void {
    // Time headers pin just below the page header, whose height changes with
    // text size and filters, so measure it rather than guessing.
    const el = this.header().nativeElement;
    this.resize = new ResizeObserver(() => el.parentElement?.style.setProperty('--events-header-h', `${el.offsetHeight}px`));
    this.resize.observe(el);
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    clearInterval(this.refresher);
    this.resize?.disconnect();
    Object.assign(pageState, {
      view: this.view(), exhibitorQuery: this.exhibitorQuery(),
      day: this.day(), query: this.query(), hasSeats: this.hasSeats(), starredOnly: this.starredOnly(),
      types: [...this.types()], showEarlier: this.showEarlier(),
    });
  }

  refresh(): void {
    const convention = this.convention();
    if (convention) this.service.load(convention, true);
  }

  selectDay(key: string): void {
    this.day.set(key);
    window.scrollTo(0, 0);
  }

  toggleType(type: string): void {
    this.types.update(set => {
      const next = new Set(set);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  clearTypes(): void {
    this.types.set(new Set());
  }

  typeColor(type: string): string {
    return TYPE_COLORS[type] || '#78716c';
  }

  open(event: ConEvent): void {
    this.selected.set(event);
    this.sheet.set('event');
  }

  toggleStar(event: ConEvent): void {
    const on = this.service.toggleStar(event.id);
    this.toast.show({ text: on ? `Starred ${event.name}` : `Removed ${event.name} from your stars` });
  }

  /** Long date and time for the details sheet, e.g. "Fri, Nov 20 · 10 AM – 11 AM (1 hr)". */
  whenText(e: ConEvent): string {
    const date = new Date(e.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
    return `${date} · ${this.clockText(e.start)} – ${this.clockText(e.end)} (${this.durationText(e.durationMin)})`;
  }

  private toRow(e: ConEvent, now: number, starred: Set<string>): EventRow {
    let seatsText: string;
    let seatsTone: EventRow['seatsTone'];
    if (e.cancelled) {
      seatsText = 'Cancelled'; seatsTone = 'full';
    } else if (!e.ticketed) {
      seatsText = 'No ticket needed'; seatsTone = 'none';
    } else if (e.seatsLeft <= 0) {
      seatsText = e.waitlist ? `Full · ${e.waitlist} on waitlist` : 'Full'; seatsTone = 'full';
    } else if (e.seatsLeft <= 5 || e.seatsLeft / e.seats <= 0.1) {
      seatsText = `${e.seatsLeft} ${e.seatsLeft === 1 ? 'seat' : 'seats'} left`; seatsTone = 'few';
    } else {
      seatsText = `${e.seatsLeft} of ${e.seats} seats left`; seatsTone = 'open';
    }
    const running = e.start <= now && e.end > now;
    const timeText = running
      ? `Until ${this.clockText(e.end)} · ends in ${shortDuration(e.end - now)}`
      : `Until ${this.clockText(e.end)} · ${this.durationText(e.durationMin)}`;
    const isStarred = starred.has(e.id);
    const overlaps = isStarred
      ? this.starredEvents().filter(o => o.id !== e.id && o.start < e.end && e.start < o.end).map(o => o.name)
      : [];
    return { event: e, timeText, seatsText, seatsTone, color: this.typeColor(e.type), starred: isStarred, overlaps };
  }

  /** "2:30 PM", or "midnight" (most events and the library run until midnight; "12 AM" reads ambiguously). */
  private clockText(ms: number): string {
    const text = formatLibraryTime(ms, ms).replace(' CT', '');
    return text === '12 AM' ? 'midnight' : text;
  }

  private durationText(min: number): string {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }
}
