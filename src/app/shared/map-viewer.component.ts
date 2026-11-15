import { AfterViewInit, ChangeDetectionStrategy, Component, computed, effect, ElementRef, HostListener, inject, NgZone, OnDestroy, signal, untracked, viewChild } from '@angular/core';
import { FloorId, PlaceKind, Pt, VenueBooth, VenueRoom } from '../config/venue-maps';
import { EventsService } from '../service/events.service';
import { MapService } from '../service/map.service';
import { formatLibraryTime, libraryStatus } from '../util/library-time';
import { IconComponent } from './icon.component';

/** Stage pixels per PDF unit (the floor plans are in the PDF's page units). */
const U = 4;
/**
 * Colors for room uses. They echo the printed BGG.CON map so the app matches the signs at
 * the venue; every room also shows its name, so color is never the only cue.
 */
const KIND_COLORS: Record<PlaceKind, string> = {
  open: '#F2B27A', sched: '#C9A0DC', special: '#EF9A9A', exhibit: '#7FD3DA', library: '#9ED8D8', hot: '#E05A4E', quiet: '#D8E08A',
  calm: '#C6DFA0', rpg: '#C25B5B', war: '#7FAE6E', proto: '#A58AD6', service: '#CFCAC4', other: '#E6E2DC',
};
type Filter = 'all' | 'library' | 'open' | 'sched' | 'quiet';
const FILTERS: { key: Filter; label: string; kinds: PlaceKind[] | null }[] = [
  { key: 'all', label: 'Everything', kinds: null },
  { key: 'library', label: 'Library & Hot Games', kinds: ['library', 'hot'] },
  { key: 'open', label: 'Open gaming', kinds: ['open'] },
  { key: 'sched', label: 'Scheduled & events', kinds: ['sched', 'special', 'proto', 'rpg', 'war'] },
  { key: 'quiet', label: 'Quiet spaces', kinds: ['quiet', 'calm'] },
];
const MARK_NAMES = { elev: 'Elevators', esc: 'Escalator', wc: 'Restrooms' } as const;
const MARK_ICONS = { elev: 'elevator', esc: 'escalator', wc: 'restroom' } as const;

/**
 * Area centroid of a shape (where its label and the view center go). A plain average of the
 * corners leans toward curved edges, which have many points (the hall's foyer curve).
 */
const center = (pts: Pt[]): Pt => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const k = x0 * y1 - x1 * y0; a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  if (Math.abs(a) < 1e-6) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [cx / (3 * a), cy / (3 * a)];
};
const bounds = (pts: Pt[]) => {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { x0, y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
};
/** CSS clip-path polygon for a shape, relative to its bounding box. */
const clipFor = (pts: Pt[], b: { x0: number; y0: number; w: number; h: number }) =>
  'polygon(' + pts.map(([x, y]) => `${((x - b.x0) / b.w * 100).toFixed(2)}% ${((y - b.y0) / b.h * 100).toFixed(2)}%`).join(', ') + ')';
/** "Escalators To Lobby" style for the PDF's all-caps labels. */
const tidy = (s: string) => s.toLowerCase().replace(/(^|[\s/(-])([a-zà-ü’'])/g, (_, a, b) => a + b.toUpperCase())
  .replace(/ (And|To|Of) /g, m => m.toLowerCase()).replace(/Dart/g, 'DART').replace(/’S\b/g, '’s');

/**
 * Full-screen venue map: the hotel's real floor plans with BGG.CON's rooms colored by use,
 * and the exhibit hall's booths (with exhibitor logos) on the Exhibition level.
 *
 * Follows Apple's indoor-map guidance and common map UX research (see the commit message):
 *  - a floor picker with short labels, opposite the zoom buttons;
 *  - detail grows with zoom: rooms always, then landmark icons and place names, then booths,
 *    logos and booth numbers, so the map never gets cluttered;
 *  - the selected place gets an outline in its exact shape and the rest fades; a card that
 *    doesn't block the map shows what's there now and next (from the schedule);
 *  - a searchable list of every place is the text alternative to the map;
 *  - north-up and no rotation: phones can't locate you indoors, so landmarks orient you.
 *
 * Gestures (drag, pinch, double-tap, wheel) run outside Angular's change detection and write
 * the transform straight to the element, so moving the map stays smooth on phones. Only
 * crossing a zoom step (for the detail levels above) updates the template.
 */
@Component({
  selector: 'app-map-viewer',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { position: fixed; inset: 0; z-index: 70; display: flex; flex-direction: column; background: var(--bl-surface); color: var(--bl-text); font-family: var(--bl-font); }
    button { font: inherit; cursor: pointer; }
    button:focus-visible, input:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    .top { flex: none; padding: calc(8px + env(safe-area-inset-top)) 12px 8px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--bl-hair); background: var(--bl-surface); z-index: 3; }
    .vm-row { display: flex; align-items: center; gap: 6px; }
    .icon-btn { width: 44px; height: 44px; flex: none; border: 0; background: transparent; color: var(--bl-text); display: flex; align-items: center; justify-content: center; border-radius: 12px; }
    .search { flex: 1; min-width: 0; height: 44px; border-radius: 12px; border: 1px solid var(--bl-hair); background: var(--bl-field); color: var(--bl-muted); display: flex; align-items: center; gap: 8px; padding: 0 12px; font-size: 15px; text-align: left; }
    .search input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--bl-text); font: inherit; font-size: 16px; outline: none; }
    .chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; margin: 0 -12px; padding: 0 12px; }
    .chips::-webkit-scrollbar { display: none; }
    .chip { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 12px; border-radius: 20px; font-size: 14px; font-weight: 600; white-space: nowrap; border: 1.5px solid var(--bl-hair); background: var(--bl-surface); color: var(--bl-text); }
    .chip.on { border-color: var(--bl-accent); background: var(--bl-accent); color: #fff; }
    .chip .dot { width: 10px; height: 10px; border-radius: 5px; border: 1px solid rgba(0, 0, 0, .25); }

    .viewport { position: relative; flex: 1; overflow: hidden; touch-action: none; background: var(--bl-surface); cursor: grab; }
    .stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
    .floor-img { position: absolute; inset: 0; width: 100%; height: 100%; user-select: none; -webkit-user-drag: none; pointer-events: none; }
    /* Dark mode: the plans are drawn dark-on-white, so they're inverted (hue kept) rather than redrawn. */
    :host-context([data-theme="dark"]) .floor-img { filter: invert(.9) hue-rotate(180deg) brightness(.95); }
    .shape { position: absolute; }
    .shape button { display: block; width: 100%; height: 100%; padding: 0; border: 0; }
    .booth-logo { position: absolute; object-fit: contain; pointer-events: none; }
    :host-context([data-theme="dark"]) .booth-logo { background: #fff; }
    /* Labels sit inside the zoomed map but are scaled back by 1/zoom (--inv), so they stay readable. */
    .label { position: absolute; transform: translate(-50%, -50%) scale(var(--inv, 1)); pointer-events: none; text-align: center; white-space: nowrap; font-size: 12.5px; line-height: 14px; font-weight: 800; color: var(--bl-text);
      text-shadow: 0 0 3px var(--bl-surface), 0 0 3px var(--bl-surface), 0 0 3px var(--bl-surface); }
    .label small { display: block; font-size: 10.5px; font-weight: 600; }
    .label.on { color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, .6); }
    .label.place { font-size: 11px; font-weight: 700; color: var(--bl-due-fg); }
    .label.num { font-size: 10px; line-height: 11px; }
    .vm-mark { position: absolute; width: 26px; height: 26px; border-radius: 13px; transform: translate(-50%, -50%) scale(var(--inv, 1)); display: flex; align-items: center; justify-content: center; color: #fff; background: #3a3632; box-shadow: 0 0 0 2px var(--bl-surface); pointer-events: none; }
    .vm-mark.wc { background: #2d5a8a; }
    .pin { position: absolute; width: 44px; height: 44px; border-radius: 50%; transform: translate(-50%, -50%) scale(var(--inv, 1)); border: 3px solid var(--bl-accent); box-shadow: 0 0 0 3px #fff; pointer-events: none; }
    .pin::after { content: ''; position: absolute; inset: -3px; border-radius: 50%; border: 3px solid var(--bl-accent); animation: pulse 1.6s ease-out infinite; }
    @keyframes pulse { to { transform: scale(1.8); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .pin::after { animation: none; } }
    .floor-name { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); padding: 5px 12px; border-radius: 14px; font-size: 13px; font-weight: 700; white-space: nowrap; background: var(--bl-toast-bg); color: var(--bl-toast-fg); box-shadow: 0 1px 6px rgba(0, 0, 0, .2); z-index: 2; pointer-events: none; }
    .floors { position: absolute; left: 12px; display: flex; flex-direction: column; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 10px rgba(0, 0, 0, .25); background: var(--bl-surface); z-index: 2; }
    .floors button { position: relative; width: 48px; height: 48px; border: 0; font-size: 17px; font-weight: 800; background: var(--bl-surface); color: var(--bl-text); }
    .floors button.on { background: var(--bl-accent); color: #fff; }
    /* A selected place on another floor: a dot on that floor's button. */
    .floors button .has { position: absolute; top: 7px; right: 7px; width: 8px; height: 8px; border-radius: 4px; background: var(--bl-accent); box-shadow: 0 0 0 2px var(--bl-surface); }
    .zoom { position: absolute; right: 12px; display: flex; flex-direction: column; gap: 8px; z-index: 2; }
    .zoom button { width: 48px; height: 48px; border-radius: 24px; border: 0; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; background: var(--bl-surface); color: var(--bl-text); box-shadow: 0 2px 8px rgba(0, 0, 0, .25); }

    /* "vm-" names: Bootstrap (loaded globally) styles .card, .card-title, .row and .mark. */
    .vm-card { position: absolute; left: 0; right: 0; bottom: 0; z-index: 4; border-radius: 20px 20px 0 0; padding: 8px 16px calc(16px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; background: var(--bl-surface); box-shadow: 0 -6px 24px rgba(0, 0, 0, .18); }
    .grab { align-self: center; width: 40px; height: 5px; border-radius: 3px; background: var(--bl-hair); }
    .vm-card-head { display: flex; align-items: flex-start; gap: 12px; }
    .swatch { flex: none; width: 36px; height: 36px; border-radius: 10px; margin-top: 2px; border: 2px solid var(--bl-accent); box-sizing: border-box; overflow: hidden; }
    .swatch.logo { width: 52px; height: 52px; padding: 4px; background: #fff; }
    .swatch img { width: 100%; height: 100%; object-fit: contain; }
    .vm-card-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .vm-card-title strong { font-size: 19px; line-height: 23px; }
    .vm-card-title span { font-size: 14px; color: var(--bl-muted); }
    .vm-lines { display: flex; flex-direction: column; gap: 4px; font-size: 15px; }
    .vm-lines div { display: flex; gap: 8px; align-items: baseline; }
    .vm-lines b { flex: none; min-width: 52px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--bl-muted); }
    .vm-lines b.live { color: var(--bl-avail-text); }
    .vm-floor-links { display: flex; flex-wrap: wrap; gap: 6px; }
    .vm-floor-links button { height: 36px; padding: 0 12px; border-radius: 18px; border: 1.5px solid var(--bl-hair); background: var(--bl-surface); color: var(--bl-text); font-size: 14px; font-weight: 600; }
    .vm-floor-links button.on { border-color: var(--bl-accent); color: var(--bl-accent-text); }
    .vm-actions { display: flex; gap: 8px; }
    .vm-actions button { flex: 1; height: 44px; border-radius: 12px; font-size: 15px; font-weight: 700; border: 1.5px solid var(--bl-accent); background: transparent; color: var(--bl-accent-text); }
    .vm-actions button:first-child { background: var(--bl-accent); color: #fff; }

    .list { position: absolute; inset: 0; z-index: 5; overflow-y: auto; background: var(--bl-surface); padding-bottom: env(safe-area-inset-bottom); }
    .list h3 { margin: 0; padding: 14px 16px 6px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--bl-muted); }
    .list button { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 6px 16px; border: 0; border-bottom: 1px solid var(--bl-hair); background: transparent; color: var(--bl-text); text-align: left; }
    .list .sw { flex: none; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; color: #1c1b1a; border: 1px solid rgba(0, 0, 0, .2); overflow: hidden; background: #fff; }
    .list .sw img { width: 100%; height: 100%; object-fit: contain; }
    .list .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .list .tx strong { font-size: 16px; }
    .list .tx span { font-size: 14px; color: var(--bl-muted); }
    .list .empty { padding: 32px 16px; text-align: center; color: var(--bl-muted); }
  `,
  template: `
    <div class="top">
      <div class="vm-row">
        <button type="button" class="icon-btn" aria-label="Close map" (click)="close()"><bl-icon name="close" [size]="22" /></button>
        @if (listOpen()) {
          <label class="search">
            <bl-icon name="search" [size]="18" />
            <span class="visually-hidden">Find a room, booth or exhibitor</span>
            <input #searchBox type="search" placeholder="Room, booth or exhibitor" autocomplete="off" enterkeyhint="search"
                   [value]="query()" (input)="query.set(searchBox.value)">
          </label>
        } @else {
          <button type="button" class="search" (click)="openList()"><bl-icon name="search" [size]="18" /> Find a room, booth or exhibitor</button>
        }
        <button type="button" class="icon-btn" [attr.aria-label]="listOpen() ? 'Show the map' : 'Show places as a list'" [attr.aria-pressed]="listOpen()" (click)="listOpen() ? listOpen.set(false) : openList()">
          <bl-icon [name]="listOpen() ? 'map' : 'list'" [size]="22" />
        </button>
      </div>
      @if (!listOpen()) {
        <div class="chips" role="radiogroup" aria-label="Highlight">
          @for (f of filters; track f.key) {
            <button type="button" class="chip" role="radio" [class.on]="filter() === f.key" [attr.aria-checked]="filter() === f.key" (click)="setFilter(f.key)">
              @if (f.kinds) { <span class="dot" aria-hidden="true" [style.background]="kindColor(f.kinds[0])"></span> }
              {{ f.label }}
            </button>
          }
        </div>
      }
    </div>

    <div #viewport class="viewport" role="region" [attr.aria-label]="floor().name + ' map'">
      <div #stage class="stage" [style.width.px]="stageW()" [style.height.px]="stageH()">
        <img class="floor-img" [src]="floor().src" alt="" draggable="false" (load)="onLoad()">
        @for (r of roomViews(); track r.id) {
          <div class="shape" [style.left.px]="r.x" [style.top.px]="r.y" [style.width.px]="r.w" [style.height.px]="r.h" [style.z-index]="r.on ? 3 : 1" [style.filter]="r.outline">
            <button type="button" [attr.aria-label]="r.aria" [attr.aria-pressed]="r.on" (click)="selectRoom(r.id)"
                    [style.clip-path]="r.clip" [style.background]="r.fill" [style.opacity]="r.opacity"></button>
          </div>
        }
        @for (b of boothViews(); track b.num) {
          <div class="shape" [style.left.px]="b.x" [style.top.px]="b.y" [style.width.px]="b.w" [style.height.px]="b.h" [style.z-index]="b.on ? 5 : 2" [style.filter]="b.outline">
            <button type="button" [attr.aria-label]="b.aria" [attr.aria-pressed]="b.on" (click)="selectBooth(b.num)"
                    [style.clip-path]="b.clip" [style.background]="b.fill"></button>
          </div>
          @if (b.logo) {
            <img class="booth-logo" [src]="b.logo" alt="" loading="lazy" [style.left.px]="b.lx" [style.top.px]="b.ly" [style.width.px]="b.ls" [style.height.px]="b.ls" [style.z-index]="b.on ? 6 : 3" [style.border-radius.px]="b.ls * 0.08">
          }
          @if (b.showNum) {
            <span class="label num" aria-hidden="true" [style.left.px]="b.nx" [style.top.px]="b.ny" [style.z-index]="7">{{ b.num }}</span>
          }
        }
        @for (m of markViews(); track $index) {
          <span class="vm-mark" [class.wc]="m.kind === 'wc'" role="img" [attr.aria-label]="m.name" [style.left.px]="m.x" [style.top.px]="m.y" [style.z-index]="6"><bl-icon [name]="m.icon" [size]="15" [stroke]="2.2" /></span>
        }
        @for (l of labelViews(); track $index) {
          <span class="label" aria-hidden="true" [class.on]="l.on" [class.place]="l.place" [style.left.px]="l.x" [style.top.px]="l.y" [style.z-index]="8">{{ l.text }}@if (l.sub) {<small>{{ l.sub }}</small>}</span>
        }
        @if (pinView(); as p) { <span class="pin" aria-hidden="true" [style.left.px]="p.x" [style.top.px]="p.y" [style.z-index]="9"></span> }
      </div>

      <div class="floor-name">{{ floor().name }}</div>
      <div class="floors" role="radiogroup" aria-label="Floor" [style.bottom.px]="controlsBottom()">
        @for (f of maps.floors; track f.id) {
          <button type="button" role="radio" [class.on]="f.id === floorId()" [attr.aria-checked]="f.id === floorId()" [attr.aria-label]="f.name + (floorsWithSelection().has(f.id) && f.id !== floorId() ? ', has a highlighted place' : '')" (click)="switchFloor(f.id)">
            {{ f.short }}
            @if (floorsWithSelection().has(f.id) && f.id !== floorId()) { <span class="has" aria-hidden="true"></span> }
          </button>
        }
      </div>
      <div class="zoom" [style.bottom.px]="controlsBottom()">
        <button type="button" aria-label="Zoom in" (click)="zoomBy(1.6)">+</button>
        <button type="button" aria-label="Zoom out" (click)="zoomBy(1 / 1.6)">−</button>
        <button type="button" [attr.aria-label]="card() ? 'Center on ' + card()!.title : 'Show the whole floor'" (click)="card() ? focusSelection() : fitFloor()">
          <bl-icon [name]="card() ? 'pin' : 'fit'" [size]="20" [stroke]="2.2" />
        </button>
      </div>

      @if (card(); as c) {
        <section #cardEl class="vm-card" [attr.aria-label]="c.title">
          <div class="grab" aria-hidden="true"></div>
          <div class="vm-card-head">
            <span class="swatch" [class.logo]="!!c.logo" aria-hidden="true" [style.background]="c.logo ? '#fff' : c.color">@if (c.logo) { <img [src]="c.logo" alt=""> }</span>
            <div class="vm-card-title"><strong>{{ c.title }}</strong><span>{{ c.where }}</span></div>
            <button type="button" class="icon-btn" aria-label="Close details" (click)="clearSelection()" style="margin: -8px -10px 0 0"><bl-icon name="close" [size]="20" /></button>
          </div>
          @if (c.lines.length) {
            <div class="vm-lines">
              @for (l of c.lines; track $index) { <div><b [class.live]="l.live">{{ l.tag }}</b><span>{{ l.text }}</span></div> }
            </div>
          }
          @if (c.floorLinks.length > 1) {
            <!-- Selected places on more than one floor (e.g. HomeGrown rooms): jump between them. -->
            <div class="vm-floor-links">
              @for (fl of c.floorLinks; track fl.id) {
                <button type="button" [class.on]="fl.id === floorId()" (click)="switchFloor(fl.id, true)">{{ fl.text }}</button>
              }
            </div>
          }
          @if (c.actions.length) {
            <div class="vm-actions">
              @for (a of c.actions; track a.label) { <button type="button" (click)="a.run()">{{ a.label }}</button> }
            </div>
          }
        </section>
      }

      @if (listOpen()) {
        <!-- Every place as text: the accessible alternative to the map, and often the quickest way to find something. -->
        <div class="list" role="region" aria-label="Places">
          @for (g of listGroups(); track g.title) {
            <h3>{{ g.title }}</h3>
            @for (p of g.items; track p.key) {
              <button type="button" (click)="pickFromList(p.key)">
                <span class="sw" aria-hidden="true" [style.background]="p.logo ? '#fff' : p.color">@if (p.logo) { <img [src]="p.logo" alt="" loading="lazy"> } @else { {{ p.short }} }</span>
                <span class="tx"><strong>{{ p.title }}</strong><span>{{ p.sub }}</span></span>
                <bl-icon name="pin" [size]="18" />
              </button>
            }
          } @empty {
            <p class="empty">No rooms or exhibitors match “{{ query() }}”.</p>
          }
        </div>
      }
    </div>
  `,
})
export class MapViewerComponent implements AfterViewInit, OnDestroy {
  service = inject(MapService);
  private events = inject(EventsService);
  private zone = inject(NgZone);
  private viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private stage = viewChild<ElementRef<HTMLElement>>('stage');
  private cardEl = viewChild<ElementRef<HTMLElement>>('cardEl');
  private searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  /** Only created when a request is set for a convention with maps (see AppComponent). */
  readonly maps = this.service.maps()!;
  readonly filters = FILTERS;

  floorId = signal<FloorId>('L');
  /** Highlighted places: "room:<id>" and "booth:<num>". */
  selection = signal<string[]>([]);
  /** Text for the card when the selection came from elsewhere (e.g. "HomeGrown playtesting rooms"). */
  private selectionLabel = signal<string | undefined>(undefined);
  private point = signal<{ floor: FloorId; x: number; y: number } | null>(null);
  filter = signal<Filter>('all');
  listOpen = signal(false);
  query = signal('');
  /** Zoom relative to "whole floor fits", in quarter steps: drives which details are drawn. */
  private zoomStep = signal(1);
  private fitScale = signal(1);
  private now = signal(Date.now());

  floor = computed(() => this.maps.floors.find(f => f.id === this.floorId())!);
  stageW = computed(() => this.floor().crop[2] * U);
  stageH = computed(() => this.floor().crop[3] * U);
  /** PDF units -> stage pixels for the current floor. */
  private P = computed(() => { const [cx, cy] = this.floor().crop; return ([x, y]: Pt): Pt => [(x - cx) * U, (y - cy) * U]; });
  private floorRooms = computed(() => this.maps.rooms.filter(r => r.floor === this.floorId()));
  private hallRoom = computed(() => this.floorRooms().find(r => r.id === 'hallA'));
  /** Zoom (relative to fit) at which the exhibit hall fills the screen. */
  private hallZoom = computed(() => {
    const hall = this.hallRoom(); const el = this.viewport()?.nativeElement;
    if (!hall || !el) return 4;
    const b = bounds(hall.poly.map(this.P()));
    return Math.min(el.clientWidth * 0.98 / b.w, (el.clientHeight - this.cardHeight()) * 0.98 / b.h) / this.fitScale();
  });
  private boothsVisible = computed(() => !!this.hallRoom() && this.zoomStep() >= this.hallZoom() * 0.55);
  floorsWithSelection = computed(() => new Set(this.selectedRooms().map(r => r.floor).concat(this.selectedBooths().length ? ['E' as FloorId] : [])));
  private selectedRooms = computed(() => { const ids = this.selection(); return this.maps.rooms.filter(r => ids.includes('room:' + r.id)); });
  private selectedBooths = computed(() => { const ids = this.selection(); return this.maps.booths.filter(b => ids.includes('booth:' + b.num)); });
  private cardHeight = signal(0);
  controlsBottom = computed(() => this.cardHeight() + 14);

  roomViews = computed(() => {
    const P = this.P(); const sel = new Set(this.selection()); const kinds = FILTERS.find(f => f.key === this.filter())!.kinds;
    const anySel = this.selection().length > 0; const o = 2.5 / (this.fitScale() * this.zoomStep());
    return this.floorRooms().map(r => {
      const pts = r.poly.map(P); const b = bounds(pts); const on = sel.has('room:' + r.id);
      const faded = kinds ? !kinds.includes(r.kind) : anySel && !on;
      return {
        id: r.id, x: b.x0, y: b.y0, w: b.w, h: b.h, on, clip: clipFor(pts, b),
        aria: `${r.name}, ${r.sub}${on ? ', selected' : ''}`,
        fill: on ? 'var(--bl-accent)' : KIND_COLORS[r.kind],
        // With booths showing, the hall's own tint fades back so they read clearly.
        opacity: r.id === 'hallA' && this.boothsVisible() ? 0.22 : on ? 1 : faded ? 0.3 : 0.88,
        // The outline is drop-shadows on an unclipped wrapper, so it follows the exact shape.
        outline: on ? `drop-shadow(${o}px 0 0 var(--bl-text)) drop-shadow(-${o}px 0 0 var(--bl-text)) drop-shadow(0 ${o}px 0 var(--bl-text)) drop-shadow(0 -${o}px 0 var(--bl-text))` : null,
      };
    });
  });

  boothViews = computed(() => {
    if (!this.boothsVisible()) return [];
    const P = this.P(); const sel = new Set(this.selection()); const scale = this.fitScale() * this.zoomStep(); const o = 2.5 / scale;
    return this.maps.booths.map(bt => {
      const pts = bt.poly.map(P); const b = bounds(pts); const [cx, cy] = center(pts); const on = sel.has('booth:' + bt.num);
      const side = Math.min(b.w, b.h); const screen = side * scale; const ls = side * 0.66;
      // Logos once a booth is ~18px on screen, numbers once it's ~34px (or when there's no logo).
      const logo = screen >= 18 && bt.logo ? bt.logo : '';
      return {
        num: bt.num, x: b.x0, y: b.y0, w: b.w, h: b.h, on, clip: clipFor(pts, b),
        aria: `Booth ${bt.num}${bt.name ? ', ' + bt.name : ''}${on ? ', selected' : ''}`,
        fill: on ? 'var(--bl-accent-soft)' : 'var(--bl-surface)',
        outline: on ? `drop-shadow(${o}px 0 0 var(--bl-accent)) drop-shadow(-${o}px 0 0 var(--bl-accent)) drop-shadow(0 ${o}px 0 var(--bl-accent)) drop-shadow(0 -${o}px 0 var(--bl-accent))` : null,
        logo, lx: cx - ls / 2, ly: cy - ls / 2 - side * 0.06, ls,
        showNum: screen >= 34 || (screen >= 14 && !logo), nx: cx, ny: cy + (logo ? side * 0.36 : 0),
      };
    });
  });

  labelViews = computed(() => {
    const P = this.P(); const sel = new Set(this.selection()); const kinds = FILTERS.find(f => f.key === this.filter())!.kinds;
    const scale = this.fitScale() * this.zoomStep(); const labels: { text: string; sub: string; x: number; y: number; on: boolean; place: boolean }[] = [];
    for (const r of this.floorRooms()) {
      const pts = r.poly.map(P); const b = bounds(pts); const on = sel.has('room:' + r.id); const w = b.w * scale;
      if ((!on && w < 46) || (kinds && !kinds.includes(r.kind) && !on) || (r.id === 'hallA' && this.boothsVisible())) continue;
      // Meeting rooms read best by their own name ("Gaston A"); big areas by what they're for ("Open gaming").
      const byRoom = r.kind === 'sched' || r.kind === 'other';
      const [x, y] = center(pts);
      labels.push({ text: byRoom ? r.sub.split(' · ')[0] : r.name, sub: on || (!byRoom && w > 110) ? (byRoom ? r.name : r.sub.split(' · ')[0]) : '', x, y, on, place: false });
    }
    if (this.zoomStep() >= 1.5) {
      for (const m of this.maps.marks) {
        if (m.floor !== this.floorId() || m.kind !== 'text' || !m.text || m.text.length > 34) continue;
        const [x, y] = P([m.x, m.y]);
        labels.push({ text: tidy(m.text), sub: '', x, y, on: false, place: true });
      }
    }
    return labels;
  });

  markViews = computed(() => {
    if (this.zoomStep() < 1.5) return [];
    const P = this.P(); const seen: { kind: string; x: number; y: number }[] = [];
    return this.maps.marks.filter(m => m.floor === this.floorId() && m.kind !== 'text').filter(m => {
      // The PDF labels men's and women's rooms separately; one icon per spot is enough.
      const near = seen.some(q => q.kind === m.kind && Math.hypot(q.x - m.x, q.y - m.y) < 9);
      if (!near) seen.push(m);
      return !near;
    }).map(m => { const [x, y] = P([m.x, m.y]); const k = m.kind as 'elev' | 'esc' | 'wc'; return { kind: k, x, y, name: MARK_NAMES[k], icon: MARK_ICONS[k] }; });
  });

  pinView = computed(() => {
    const p = this.point();
    if (!p || p.floor !== this.floorId()) return null;
    const [x, y] = this.P()([p.x, p.y]);
    return { x, y };
  });

  /** The place card: what's selected, what's there now/next, and what you can do. */
  card = computed(() => {
    const booths = this.selectedBooths(); const rooms = this.selectedRooms(); const now = this.now();
    const floorName = (id: FloorId) => this.maps.floors.find(f => f.id === id)!.name;
    const actions: { label: string; run: () => void }[] = [];
    if (booths.length) {
      const b = booths[0];
      if (this.service.onExhibitor) actions.push({ label: 'Exhibitor details', run: () => { this.service.onExhibitor?.(b.num); this.close(); } });
      return { title: b.name || 'Booth ' + b.num, where: `Booth ${b.num} · Exhibit hall (Marsalis A)`, logo: b.logo, color: '#fff', lines: this.boothLines(b, now), floorLinks: [], actions };
    }
    if (rooms.length) {
      const first = rooms[0]; const tte = [...new Set(rooms.flatMap(r => r.tte))];
      const floors = [...new Set(rooms.map(r => r.floor))];
      const sameUse = rooms.every(r => r.name === first.name);
      const title = this.selectionLabel() || (sameUse ? first.name : rooms.map(r => r.sub.split(' · ')[0]).join(', '));
      const where = [...new Set(rooms.map(r => r.sub.split(' · ')[0]))].join(' · ') + (floors.length === 1 ? ' · ' + floorName(floors[0]) : '');
      if (first.id === 'hallA' && rooms.length === 1) actions.push({ label: 'See the booths', run: () => this.zoomToHall() });
      if (tte.length && this.service.onEventsHere) actions.push({ label: 'Events here', run: () => { this.service.onEventsHere?.(tte[0]); this.close(); } });
      return {
        title, where, logo: '', color: KIND_COLORS[first.kind], lines: this.roomLines(rooms, tte, now), actions,
        floorLinks: floors.map(id => { const here = rooms.filter(r => r.floor === id); return { id, text: floorName(id).replace(/ \(.*\)/, '') + ' · ' + (here.length === 1 ? here[0].sub.split(' · ')[0] : here.length + ' rooms') }; }),
      };
    }
    const p = this.point();
    if (p) {
      const label = this.selectionLabel() || 'Here';
      if (this.service.onEventsHere && this.selectionLabel()) actions.push({ label: 'Events here', run: () => { this.service.onEventsHere?.(label); this.close(); } });
      return { title: label, where: floorName(p.floor), logo: '', color: 'var(--bl-accent)', lines: [], floorLinks: [], actions };
    }
    return null;
  });

  /** Search results / the list view: rooms by floor, then exhibitors. */
  listGroups = computed(() => {
    const q = this.query().trim().toLowerCase();
    const match = (...s: string[]) => !q || s.some(v => v.toLowerCase().includes(q));
    const groups = this.maps.floors.map(f => ({
      title: f.name,
      items: this.maps.rooms.filter(r => r.floor === f.id && r.kind !== 'other' && match(r.name, r.sub, ...r.tte))
        .map(r => ({ key: 'room:' + r.id, title: r.name, sub: r.sub, color: KIND_COLORS[r.kind], short: f.short, logo: '' })),
    }));
    const exhibitors = this.maps.booths.filter(b => match(b.name, 'booth ' + b.num, b.num))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(b => ({ key: 'booth:' + b.num, title: b.name || 'Booth ' + b.num, sub: 'Booth ' + b.num + ' · Exhibit hall', color: '#fff', short: b.num, logo: b.logo }));
    return [...groups, { title: 'Exhibitors', items: exhibitors }].filter(g => g.items.length);
  });

  private scale = 1;
  private x = 0;
  private y = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastTap = 0;
  private cleanup: (() => void)[] = [];
  private returnFocusTo = document.activeElement as HTMLElement | null;
  private ticker = setInterval(() => this.now.set(Date.now()), 60_000);
  /**
   * Set when the map moves to a selection by itself (a request, a list pick, a tap from far out);
   * the card appearing then re-centers above it. Cleared as soon as the user touches the map.
   */
  private refocusOnCard = false;
  /** What to do once the floor image has loaded and been measured. */
  private pendingView: 'selection' | 'hall' | 'fit' = 'fit';

  constructor() {
    // A new request (another "Show on map" while the map is open) re-targets the map.
    effect(() => {
      const req = this.service.request();
      if (!req) return;
      untracked(() => {
        const select = req.select ?? [];
        const firstRoom = this.maps.rooms.find(r => select.includes('room:' + r.id));
        const floor = req.floor ?? (select.some(k => k.startsWith('booth:')) ? 'E' : firstRoom?.floor) ?? req.point?.floor ?? 'L';
        this.selection.set(select);
        this.selectionLabel.set(req.label && (select.length > 1 || req.point || select.some(k => k.startsWith('room:'))) ? req.label : undefined);
        this.point.set(req.point ?? null);
        this.filter.set('all');
        this.listOpen.set(false);
        this.pendingView = req.hall ? 'hall' : select.length || req.point ? 'selection' : 'fit';
        this.refocusOnCard = this.pendingView === 'selection';
        if (floor !== this.floorId()) this.floorId.set(floor);
        else requestAnimationFrame(() => this.applyPendingView());
      });
    });
    // Keep the zoom buttons and floor picker above the card, whatever its height.
    effect(() => {
      const el = this.cardEl()?.nativeElement;
      if (!el) { this.cardHeight.set(0); return; }
      const ro = new ResizeObserver(() => {
        this.cardHeight.set(el.offsetHeight);
        if (this.refocusOnCard) requestAnimationFrame(() => { if (this.refocusOnCard) this.focusSelection(); });
      });
      ro.observe(el);
      this.cleanup.push(() => ro.disconnect());
    });
  }

  ngAfterViewInit(): void {
    document.body.style.overflow = 'hidden';
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    this.zone.runOutsideAngular(() => {
      const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
        el.addEventListener(type, fn as EventListener, opts);
        this.cleanup.push(() => el.removeEventListener(type, fn as EventListener));
      };
      on('pointerdown', e => this.onDown(e));
      on('pointermove', e => this.onMove(e));
      on('pointerup', e => this.onUp(e));
      on('pointercancel', e => this.onUp(e));
      on('wheel', e => { e.preventDefault(); const p = this.pt(e); this.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y); }, { passive: false });
      const resize = () => { this.measureFit(); this.apply(); };
      window.addEventListener('resize', resize);
      this.cleanup.push(() => window.removeEventListener('resize', resize));
    });
  }

  ngOnDestroy(): void {
    this.cleanup.forEach(fn => fn());
    clearInterval(this.ticker);
    document.body.style.overflow = '';
    this.returnFocusTo?.focus?.({ preventScroll: true });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { if (this.listOpen()) this.listOpen.set(false); else this.close(); }
    else if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    else if (e.key === '+' || e.key === '=') this.zoomBy(1.6);
    else if (e.key === '-') this.zoomBy(1 / 1.6);
  }

  close(): void {
    this.service.close();
  }

  kindColor(kind: PlaceKind): string {
    return KIND_COLORS[kind];
  }

  onLoad(): void {
    // Wait a frame so the new floor's stage size is laid out before positioning.
    requestAnimationFrame(() => this.applyPendingView());
  }

  setFilter(f: Filter): void {
    this.filter.set(f);
    this.selection.set([]); this.point.set(null); this.selectionLabel.set(undefined);
  }

  openList(): void {
    this.listOpen.set(true);
    setTimeout(() => this.searchBox()?.nativeElement.focus());
  }

  pickFromList(key: string): void {
    const room = key.startsWith('room:') ? this.maps.rooms.find(r => 'room:' + r.id === key) : null;
    this.listOpen.set(false);
    this.select([key], room ? room.floor : 'E');
  }

  /** Tapping a place keeps the view, unless the map is so far out the place would stay tiny. */
  selectRoom(id: string): void {
    this.select(['room:' + id], this.floorId(), this.scale < this.fitScale() * 1.6);
  }

  selectBooth(num: string): void {
    this.select(['booth:' + num], 'E', false);
  }

  clearSelection(): void {
    this.selection.set([]); this.point.set(null); this.selectionLabel.set(undefined);
  }

  /** Shows a floor; "keepView" (from the card's floor buttons) zooms to the selection on it. */
  switchFloor(id: FloorId, keepView = false): void {
    if (id === this.floorId()) { if (keepView) this.focusSelection(); return; }
    const hasSelection = this.floorsWithSelection().has(id);
    // Picking a floor with nothing highlighted on it starts fresh there, so a card from another
    // floor (e.g. Gaston while looking at the exhibit hall) doesn't linger.
    if (!hasSelection && !keepView) this.clearSelection();
    this.pendingView = keepView || hasSelection ? 'selection' : 'fit';
    this.floorId.set(id);
  }

  zoomBy(factor: number): void {
    const el = this.viewport()?.nativeElement;
    if (el) this.zoomAt(factor, el.clientWidth / 2, (el.clientHeight - this.cardHeight()) / 2);
  }

  fitFloor(): void {
    this.refocusOnCard = false;
    this.scale = this.fitScale();
    this.centerOn(this.stageW() / 2, this.stageH() / 2);
  }

  zoomToHall(): void {
    const hall = this.hallRoom();
    if (!hall) return;
    this.refocusOnCard = false;
    this.selection.set([]); this.selectionLabel.set(undefined);
    const [cx, cy] = center(hall.poly.map(this.P()));
    this.scale = this.fitScale() * this.hallZoom();
    this.centerOn(cx, cy);
  }

  /** Zooms so the highlighted places on this floor fit comfortably, and centers them. */
  focusSelection(): void {
    const P = this.P(); const el = this.viewport()?.nativeElement;
    const pts: Pt[] = [
      ...this.selectedRooms().filter(r => r.floor === this.floorId()).flatMap(r => r.poly.map(P)),
      ...(this.floorId() === 'E' ? this.selectedBooths().flatMap(b => b.poly.map(P)) : []),
    ];
    const p = this.pinView();
    if (!el || (!pts.length && !p)) return this.fitFloor();
    if (!pts.length && p) { this.scale = this.fitScale() * 3; return this.centerOn(p.x, p.y); }
    const b = bounds(pts);
    const visH = el.clientHeight - this.cardHeight();
    const booth = this.selectedBooths().length > 0;
    const want = Math.min(el.clientWidth * (booth ? 0.3 : 0.5) / b.w, visH * (booth ? 0.3 : 0.5) / b.h);
    this.scale = Math.max(this.fitScale(), Math.min(this.maxScale(), want));
    this.centerOn(b.x0 + b.w / 2, b.y0 + b.h / 2);
  }

  private select(keys: string[], floor: FloorId, refocus = true): void {
    this.selection.set(keys); this.point.set(null); this.selectionLabel.set(undefined); this.filter.set('all');
    this.refocusOnCard = refocus || floor !== this.floorId();
    if (floor !== this.floorId()) { this.pendingView = 'selection'; this.floorId.set(floor); }
    // Checked again when it runs: a newer view change (See the booths, fit, a drag) cancels it.
    else if (refocus) requestAnimationFrame(() => { if (this.refocusOnCard) this.focusSelection(); });
  }

  private applyPendingView(): void {
    this.measureFit();
    if (this.pendingView === 'hall') this.zoomToHall();
    else if (this.pendingView === 'selection') this.focusSelection();
    else this.fitFloor();
    this.pendingView = 'fit';
  }

  private measureFit(): void {
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    this.fitScale.set(Math.min(el.clientWidth / this.stageW(), (el.clientHeight - this.cardHeight()) / this.stageH()) * 0.96);
  }

  private maxScale(): number {
    return this.fitScale() * Math.max(12, this.hallZoom() * 4);
  }

  /** Centers a stage point in the part of the map not covered by the card. */
  private centerOn(sx: number, sy: number): void {
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    this.x = el.clientWidth / 2 - sx * this.scale;
    this.y = (el.clientHeight - this.cardHeight()) / 2 - sy * this.scale;
    this.apply();
  }

  private zoomAt(factor: number, px: number, py: number): void {
    const next = Math.min(this.maxScale(), Math.max(this.fitScale(), this.scale * factor));
    const f = next / this.scale;
    // Keep the point under the fingers/cursor fixed while zooming.
    this.x = px - (px - this.x) * f;
    this.y = py - (py - this.y) * f;
    this.scale = next;
    this.apply();
  }

  /**
   * Keeps the map from being dragged away (Apple: "limit scrolling outside your venue"),
   * writes the transform, and updates the detail level when the zoom crosses a step.
   */
  private apply(): void {
    const el = this.viewport()?.nativeElement;
    const stage = this.stage()?.nativeElement;
    if (!el || !stage) return;
    const w = this.stageW() * this.scale, h = this.stageH() * this.scale;
    const clamp = (pos: number, size: number, view: number) => {
      const slack = view * 0.3;
      return size <= view ? Math.min(Math.max(pos, -size * 0.2), view - size * 0.8) : Math.min(slack, Math.max(view - size - slack, pos));
    };
    this.x = clamp(this.x, w, el.clientWidth);
    this.y = clamp(this.y, h, el.clientHeight);
    stage.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    stage.style.setProperty('--inv', String(1 / this.scale));
    const step = Math.round(this.scale / this.fitScale() * 4) / 4;
    if (step !== this.zoomStep()) this.zone.run(() => this.zoomStep.set(step));
  }

  private boothLines(b: VenueBooth, now: number): { tag: string; text: string; live: boolean }[] {
    const demos = (this.events.events() || []).filter(e => !e.info && e.roomName === 'Marsalis' && e.end > now && this.service.boothFor(e.spaceName) === b.num);
    if (!demos.length) return [{ tag: 'Hall', text: 'Thu–Sat 10 AM–5 PM · Sun 10 AM–3 PM', live: false }];
    const next = demos[0];
    const live = next.start <= now;
    return [{ tag: live ? 'Now' : 'Demo', text: `${next.name} · ${live ? 'until ' + this.clock(next.end) : this.clock(next.start)}${demos.length > 1 ? ` (${demos.length} sessions)` : ''}`, live }];
  }

  private roomLines(rooms: VenueRoom[], tte: string[], now: number): { tag: string; text: string; live: boolean }[] {
    if (rooms.some(r => r.kind === 'library')) {
      const s = libraryStatus(now);
      if (s) return [{ tag: s.tone === 'open' || s.tone === 'closingSoon' ? 'Open' : 'Hours', text: `${s.title} · ${s.detail}`, live: s.tone === 'open' || s.tone === 'closingSoon' }];
    }
    const all = (this.events.events() || []).filter(e => tte.includes(e.roomName) && e.end > now && !e.cancelled);
    if (!this.events.events()) return tte.length ? [{ tag: 'Events', text: 'Open the schedule to see what’s on here', live: false }] : [];
    const nowOn = all.filter(e => e.start <= now && !e.info);
    const next = all.filter(e => e.start > now && !e.info);
    const lines: { tag: string; text: string; live: boolean }[] = [];
    if (nowOn.length) lines.push({ tag: 'Now', text: nowOn[0].name + (nowOn.length > 1 ? ` + ${nowOn.length - 1} more` : ''), live: true });
    if (next.length) lines.push({ tag: 'Next', text: `${next[0].name} · ${this.clock(next[0].start)}`, live: false });
    if (!lines.length && tte.length) lines.push({ tag: 'Events', text: 'Nothing else scheduled here', live: false });
    return lines;
  }

  private clock(ms: number): string {
    const t = formatLibraryTime(ms, this.now());
    return t.replace(/^12 AM/, 'midnight');
  }

  /**
   * Pointer position relative to the viewport. (offsetX/Y would be relative to
   * whichever element is under the finger, including the scaled map itself.)
   */
  private pt(e: MouseEvent): { x: number; y: number } {
    const rect = this.viewport()!.nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onDown(e: PointerEvent): void {
    // Taps on buttons (rooms, booths, controls, card) are presses, not the start of a drag.
    // Rooms and booths still pan when dragged: see onMove.
    const target = e.target as Element;
    if (target.closest('.floors, .zoom, .vm-card, .list')) return;
    this.refocusOnCard = false;
    // No pointer capture: it would retarget the tap away from the room/booth button underneath.
    const p = this.pt(e);
    this.pointers.set(e.pointerId, p);
    this.moved = false;
    if (this.pointers.size === 1) {
      // Double-tap: zoom in where tapped (or back out when fully zoomed).
      const now = Date.now();
      if (now - this.lastTap < 300) {
        if (this.scale >= this.maxScale() * 0.9) this.zone.run(() => this.fitFloor()); else this.zoomAt(2, p.x, p.y);
        this.lastTap = 0;
      } else {
        this.lastTap = now;
      }
    }
  }

  private moved = false;

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const p = this.pt(e);
    const pts = [...this.pointers.values()];
    if (this.pointers.size === 1) {
      if (Math.hypot(p.x - prev.x, p.y - prev.y) > 3) this.moved = true;
      this.x += p.x - prev.x;
      this.y += p.y - prev.y;
      this.pointers.set(e.pointerId, p);
      this.apply();
    } else if (this.pointers.size === 2) {
      this.moved = true;
      const other = pts.find(q => q !== prev)!;
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(p.x - other.x, p.y - other.y);
      this.pointers.set(e.pointerId, p);
      if (before > 0) this.zoomAt(after / before, (p.x + other.x) / 2, (p.y + other.y) / 2);
    }
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    // A drag that started on a room shouldn't also select it when the finger lifts.
    if (this.moved) {
      const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
    }
  }
}
