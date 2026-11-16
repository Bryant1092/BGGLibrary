import { AfterViewInit, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, OnDestroy, OnInit, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { RichTextComponent } from '../shared/rich-text.component';
import { ConHtmlComponent } from '../shared/con-html.component';
import { plainText } from '../util/rich-text';
import { ConInfoService, GuidePage, NewsPost } from '../service/con-info.service';
import { CONVENTIONS, Convention } from '../config/conventions';
import { ConEvent, EventsService, Exhibitor, Prototype } from '../service/events.service';
import { MapRequest, MapService } from '../service/map.service';
import { ToastService } from '../service/toast.service';
import { IconComponent } from '../shared/icon.component';
import { UpNextComponent } from '../shared/up-next.component';
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

type EventsView = 'schedule' | 'exhibitors' | 'info';

/** Prototype stages in plain words (Tabletop.Events says "final_testing", "middling"…). */
const STAGE_TEXT: Record<Prototype['stage'], string> = { final: 'Final testing', nearly: 'Nearly done', mid: 'Mid-design', early: 'Early idea' };

/** Page choices kept while the app is open, so switching tabs doesn't reset them. */
const pageState = { view: 'schedule' as EventsView, exhibitorMode: 'exhibitors' as 'exhibitors' | 'playtest', exhibitorQuery: '', day: '', query: '', hasSeats: true, starredOnly: false, types: [] as string[], showEarlier: false };

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
  imports: [IconComponent, SheetComponent, OfflineBarComponent, RichTextComponent, ConHtmlComponent, UpNextComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './events.component.html',
  styleUrl: './events.component.css',
})
export class EventsComponent implements OnInit, AfterViewInit, OnDestroy {
  service = inject(EventsService);
  mapService = inject(MapService);
  info = inject(ConInfoService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
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
  sheet = signal<'event' | 'types' | 'exhibitor' | 'post' | 'page' | 'prototype' | null>(null);
  selected = signal<ConEvent | null>(null);
  /** Schedule, the exhibitor list, or Info (BGG's news posts and con guide); all from Tabletop.Events. */
  view = signal<EventsView>(pageState.view);
  /** The Exhibitors view also lists the HomeGrown playtest prototypes. */
  exhibitorMode = signal(pageState.exhibitorMode);
  exhibitorQuery = signal(pageState.exhibitorQuery);
  selectedExhibitor = signal<Exhibitor | null>(null);
  selectedPost = signal<NewsPost | null>(null);
  selectedPage = signal<GuidePage | null>(null);
  selectedPrototype = signal<Prototype | null>(null);
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
      // preview: one-line text for the list, without the Markdown asterisks/brackets.
      .map(x => ({ exhibitor: x, booth: this.mapService.boothFor(x.name), preview: plainText(x.description) }))
      // Booths first (A–Z), then sponsors without a booth.
      .sort((a, b) => Number(!a.booth) - Number(!b.booth) || a.exhibitor.name.localeCompare(b.exhibitor.name));
  });

  /** Prototypes matching the search (same box as exhibitors), most interest first. */
  prototypeRows = computed(() => {
    const q = this.exhibitorQuery().trim().toLowerCase();
    return (this.service.prototypes() || [])
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
      .map(p => ({ proto: p, meta: this.prototypeMeta(p), stage: STAGE_TEXT[p.stage], done: p.stage === 'final' || p.stage === 'nearly', preview: plainText(p.description) }));
  });

  /**
   * For the prototype sheet: scheduled sessions of this game, matched by name
   * (e.g. "Isle of Trez 3 - PLAYTEST" for Isle of Trez), next one first.
   */
  prototypeDetail = computed(() => {
    const p = this.selectedPrototype();
    if (!p) return null;
    const key = p.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const now = this.now();
    const sessions = key.length < 4 ? [] : (this.service.events() || [])
      .filter(e => !e.info && e.end > now && e.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().startsWith(key))
      .map(e => ({ event: e, when: this.whenText(e), room: e.room }));
    return { proto: p, meta: this.prototypeMeta(p), stage: STAGE_TEXT[p.stage], sessions };
  });

  /** News posts with their display text, newest first. */
  postRows = computed(() => {
    const now = this.now();
    return (this.info.posts() || []).map(p => ({
      post: p,
      when: this.info.postedText(p.postedAt, now),
      unread: !this.info.isRead(p.id),
      preview: p.topics.length ? p.topics.slice(0, 3).join(' · ') : p.snippet,
    }));
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
   * Where an event is on the venue map: an exhibitor's demo table highlights their
   * booth; anything else in the exhibit hall zooms into its booths; other rooms are
   * highlighted on their floor. Null when the room isn't on the map.
   */
  placeFor(e: ConEvent, label?: string): MapRequest | null {
    if (!this.hasMaps()) return null;
    return this.mapService.eventRequest(e, label);
  }

  showPlace(place: MapRequest | null): void {
    if (place) this.mapService.show(place);
  }

  /** The title-row map button: the exhibit hall from Exhibitors, the HomeGrown rooms from Playtest, else the Lobby level. */
  openMaps(): void {
    if (this.view() === 'exhibitors' && this.exhibitorMode() === 'playtest') this.showHomegrown();
    else if (this.view() === 'exhibitors') this.showPlace(this.mapService.hallRequest());
    else this.mapService.show({});
  }

  /** Every HomeGrown playtesting room highlighted on the map. */
  showHomegrown(): void {
    this.showPlace(this.mapService.homegrownRequest());
  }

  setView(view: EventsView): void {
    this.view.set(view);
    window.scrollTo(0, 0);
    this.loadForView();
  }

  setExhibitorMode(mode: 'exhibitors' | 'playtest'): void {
    this.exhibitorMode.set(mode);
    window.scrollTo(0, 0);
    this.loadForView();
  }

  /** Exhibitors, prototypes and the guide load only when their view is opened. */
  private loadForView(): void {
    const convention = this.convention();
    if (!convention) return;
    if (this.view() === 'exhibitors') {
      if (this.exhibitorMode() === 'playtest') this.service.loadPrototypes(convention);
      else this.service.loadExhibitors(convention);
    }
    if (this.view() === 'info') {
      this.info.checkNews();
      this.info.loadPages();
    }
  }

  /**
   * Searches the schedule for "playtest", which finds the HomeGrown Playtesting
   * room and the games named "... - PLAYTEST" (the chosen day only, like any search).
   */
  showPlaytestSessions(): void {
    this.query.set('playtest');
    this.sheet.set(null);
    this.setView('schedule');
  }

  openPrototype(p: Prototype): void {
    this.selectedPrototype.set(p);
    this.sheet.set('prototype');
    // Sessions come from the schedule, which may not be loaded if Events opened on Exhibitors.
    const convention = this.convention();
    if (convention) this.service.load(convention);
  }

  /** Opening a post marks it read, which lowers the number on the Events tab. */
  openPost(post: NewsPost): void {
    this.selectedPost.set(post);
    this.sheet.set('post');
    this.info.markRead(post.id);
  }

  openPage(page: GuidePage): void {
    if (page.link) {
      window.open(page.link, '_blank', 'noopener');
      return;
    }
    this.selectedPage.set(page);
    this.sheet.set('page');
  }

  openExhibitor(x: Exhibitor): void {
    this.selectedExhibitor.set(x);
    this.sheet.set('exhibitor');
  }

  openEventFromExhibitor(e: ConEvent): void {
    this.selected.set(e);
    this.sheet.set('event');
  }

  /** Event to open from a link (?event=), waiting for the schedule to load. */
  private pendingEvent = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.pendingEvent();
      const event = id ? (this.service.events() || []).find(e => e.id === id) : undefined;
      if (!event) return;
      untracked(() => {
        this.pendingEvent.set(null);
        this.day.set(event.day);
        this.open(event);
      });
    });
    // While the news list is on screen there's nothing left to announce, so the
    // "New from BGG" message is dismissed (posts stay unread until opened).
    effect(() => {
      const pending = this.info.toAnnounce();
      if (this.view() === 'info' && pending.length) untracked(() => this.info.dismissAnnouncement(pending.map(p => p.id)));
    });
  }

  ngOnInit(): void {
    // The new-post message's "Read" opens /events?view=info&post=<id>. Watched
    // (not read once) because the page may already be open when it's tapped.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      // /events?event=<id>: from the "Up next" card or a reminder notification. Opened
      // once the schedule is here (see the effect in the constructor).
      const eventId = params.get('event');
      if (eventId) {
        this.setView('schedule');
        this.pendingEvent.set(eventId);
        this.router.navigate([], { queryParams: { event: null }, queryParamsHandling: 'merge', replaceUrl: true });
        return;
      }
      if (params.get('view') !== 'info') return;
      this.setView('info');
      const id = params.get('post');
      const post = id ? (this.info.posts() || []).find(p => p.id === id) : undefined;
      if (post) this.openPost(post);
      this.router.navigate([], { queryParams: { view: null, post: null }, queryParamsHandling: 'merge', replaceUrl: true });
    });
    // Open on today during the con; otherwise the first day (or the day last viewed).
    const today = dallasDateKey(Date.now());
    const keys = this.days().map(d => d.key);
    if (keys.includes(today) && !pageState.day) this.day.set(today);
    else if (!keys.includes(this.day())) this.day.set(keys[0] || '');
    const convention = this.convention();
    if (convention) this.service.load(convention);
    this.loadForView();
    // The venue map's place card hands its buttons back here while this tab is open:
    // "Events here" filters the schedule to that room; "Exhibitor details" opens their sheet.
    this.mapService.onEventsHere = room => {
      this.sheet.set(null);
      this.query.set(room);
      this.setView('schedule');
    };
    this.mapService.onExhibitor = booth => {
      this.exhibitorMode.set('exhibitors');
      this.setView('exhibitors');
      this.pendingBooth.set(booth);
    };
  }

  /** A booth picked on the map, opened once the exhibitor list has loaded. */
  private pendingBooth = signal<string | null>(null);
  private openPendingBooth = effect(() => {
    const booth = this.pendingBooth(); const list = this.service.exhibitors();
    if (!booth || !list) return;
    const x = list.find(e => this.mapService.boothFor(e.name) === booth);
    untracked(() => { this.pendingBooth.set(null); if (x) this.openExhibitor(x); });
  });

  ngAfterViewInit(): void {
    // Time headers pin just below the page header, whose height changes with
    // text size and filters, so measure it rather than guessing.
    const el = this.header().nativeElement;
    this.resize = new ResizeObserver(() => el.parentElement?.style.setProperty('--events-header-h', `${el.offsetHeight}px`));
    this.resize.observe(el);
  }

  ngOnDestroy(): void {
    this.mapService.onEventsHere = null;
    this.mapService.onExhibitor = null;
    clearInterval(this.clock);
    clearInterval(this.refresher);
    this.resize?.disconnect();
    Object.assign(pageState, {
      view: this.view(), exhibitorMode: this.exhibitorMode(), exhibitorQuery: this.exhibitorQuery(),
      day: this.day(), query: this.query(), hasSeats: this.hasSeats(), starredOnly: this.starredOnly(),
      types: [...this.types()], showEarlier: this.showEarlier(),
    });
  }

  /** The title-row refresh button: re-downloads whatever the current view shows. */
  /** True while a refresh the person asked for is running (spins the button). */
  refreshing = signal(false);

  /**
   * The refresh button. Reported (Nov 2026): tapping it looked like nothing happened,
   * especially when nothing had changed. Now the icon spins while checking, then a short
   * message says the result: what changed, or that it's already up to date. It stays
   * spinning for at least ~0.6 s so a fast answer still registers.
   */
  async refresh(): Promise<void> {
    const convention = this.convention();
    if (this.refreshing()) return;
    this.refreshing.set(true);
    const minSpin = new Promise(r => setTimeout(r, 600));
    let text: string;
    if (this.view() === 'info') {
      const before = this.info.unreadCount();
      this.info.loadPages(true);
      const ok = await this.info.checkNews();
      const added = this.info.unreadCount() - before;
      text = !ok ? "Couldn't check for news. Check your connection."
        : added > 0 ? `${added} new ${added === 1 ? 'post' : 'posts'} from BGG` : 'No new posts';
    } else if (convention) {
      const before = new Map((this.service.events() || []).map(e => [e.id, e.seatsLeft]));
      const ok = await this.service.load(convention, true);
      const after = this.service.events() || [];
      const changed = after.filter(e => before.has(e.id) && before.get(e.id) !== e.seatsLeft).length;
      const added = after.filter(e => !before.has(e.id)).length;
      text = !ok ? "Couldn't refresh. Showing the last saved schedule."
        : changed || added ? ['Schedule updated', changed ? `seats changed on ${changed} ${changed === 1 ? 'event' : 'events'}` : '', added ? `${added} new` : ''].filter(Boolean).join(' · ')
        : 'Schedule is up to date';
    } else {
      text = 'Nothing to refresh yet';
    }
    await minSpin;
    this.refreshing.set(false);
    this.toast.show({ text });
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

  /** "2–4 players · 60 min" */
  private prototypeMeta(p: Prototype): string {
    const players = !p.minPlayers ? ''
      : p.minPlayers === p.maxPlayers || !p.maxPlayers ? `${p.minPlayers} ${p.minPlayers === 1 ? 'player' : 'players'}`
      : `${p.minPlayers}–${p.maxPlayers} players`;
    return [players, p.minutes ? `${p.minutes} min` : ''].filter(Boolean).join(' · ');
  }

  private durationText(min: number): string {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }
}
