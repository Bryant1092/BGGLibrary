import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, map, mergeMap, of, Subject } from 'rxjs';
import { BggItem } from '../model/bgg.model';
import { BggService } from '../service/bgg.service';
import { ConCheckoutsService, ConGame } from '../service/con-checkouts.service';
import { GameDetailsCache } from '../service/game-details-cache';
import { CONVENTIONS } from '../config/conventions';
import { fitsPlayers, fitsPlayTime, minutesText, PlayTimeChoice, playersText, shelfText, statusText } from '../util/game-format';
import { isHotGame } from '../util/hot-games';
import { currentOrNextConvention, dallasDateKey, shortDuration } from '../util/library-time';
import { deskDownSince } from '../util/desk-state';
import { IconComponent } from './icon.component';
import { InViewDirective } from './in-view.directive';
import { ThumbComponent } from './thumb.component';
import { NoticeTagComponent } from './notice-tag.component';

const COLLAPSED_KEY = 'bgglibrary.conTopCollapsed';

/**
 * "Most played this con" on the Library tab, from ConCheckoutsService.
 *
 * - mode "card": Top 5 on the Library home. Collapsible (remembered on this phone),
 *   so people who don't want it can fold it to one line (feedback 2026-11-16).
 *   "See all" switches the Library to the full list.
 * - mode "list": the Library's "Most played this con" sort: every game with checkouts
 *   this con, most first, with the Library's search and filters applied.
 *
 * Copies of a game count together; a game shows Available (with that copy's shelf) if
 * any copy is on the shelf, Out only when every copy is out. Status, shelf, players and
 * time come from the library, fetched only for rows on screen (shared details cache).
 */
@Component({
  selector: 'app-con-popular',
  standalone: true,
  imports: [NoticeTagComponent, IconComponent, InViewDirective, ThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .cp { margin: 14px 16px 6px; border-radius: 16px; background: var(--bl-accent-soft); border: 1.5px solid var(--bl-accent-text); color: var(--bl-text); }
    .cp-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 12px 12px 10px 14px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .cp-head .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .kicker { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--bl-accent-text); }
    .title { font-size: 17px; font-weight: 700; }
    .sub { font-size: 12.5px; color: var(--bl-muted); }
    .chev { color: var(--bl-accent-text); transition: transform .2s; flex: none; }
    .chev.up { transform: rotate(180deg); }
    .teaser { font-size: 13.5px; color: var(--bl-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .teaser b { color: var(--bl-text); }
    .cp-row { width: 100%; display: grid; grid-template-columns: 22px 40px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 14px; border: 0; border-top: 1px solid var(--bl-hair);
      background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .rank { font-weight: 800; font-size: 16px; color: var(--bl-accent-text); text-align: center; font-variant-numeric: tabular-nums; }
    .name { font-weight: 600; font-size: 15px; line-height: 19px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .line { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--bl-muted); }
    .avail { color: var(--bl-avail-text); font-weight: 700; }
    .out { color: var(--bl-muted); font-weight: 700; }
    .line .bl-shelf { font-size: 13px; color: var(--bl-text); }
    .n { font-weight: 800; font-size: 16px; font-variant-numeric: tabular-nums; }
    .n small { font-weight: 600; font-size: 12px; color: var(--bl-muted); }
    .see-all { display: block; width: 100%; border: 0; border-top: 1px solid var(--bl-hair); background: transparent; color: var(--bl-accent-text); font: inherit; font-weight: 700; font-size: 15px; padding: 11px 0; cursor: pointer; }
    .rank-tag { font-size: 13px; font-weight: 700; color: var(--bl-accent-text); }
    .note { padding: 14px 16px; text-align: center; }
  `,
  template: `
    @if (mode() === 'card') {
      @if (games().length) {
        <section class="cp" aria-label="Most played this con">
          <button type="button" class="cp-head" [attr.aria-expanded]="!collapsed()" (click)="toggleCollapsed()">
            <span class="text">
              <span class="kicker">{{ kicker() }}</span>
              <span class="title">Most played this con</span>
              @if (collapsed()) {
                <span class="teaser">#1 <b>{{ games()[0].name }}</b> · {{ games()[0].count }}×</span>
              } @else if (updatedText()) {
                <span class="sub">{{ updatedText() }}</span>
              }
            </span>
            <bl-icon name="chevronDown" [size]="20" [stroke]="2.4" class="chev" [class.up]="!collapsed()" />
          </button>
          @if (!collapsed()) {
            @for (g of top5(); track g.name; let i = $index) {
              <button type="button" class="cp-row" (blInView)="want(g)" (click)="openGame(g)">
                <span class="rank">{{ i + 1 }}</span>
                <app-thumb [src]="g.thumb" [name]="g.name" [size]="40" [radius]="8" />
                <span style="min-width: 0">
                  <span class="name" style="display: block">{{ g.name }}</span>
                  <span class="line">
                    @if (best(g); as item) {
                      <span [class.avail]="!item.is_checked_out" [class.out]="item.is_checked_out">{{ item.is_checked_out ? 'Out' : 'Available' }}</span>
                      <span class="bl-shelf"><bl-icon name="pin" [size]="13" [stroke]="2.2" /><span class="visually-hidden">Shelf</span>{{ shelf(item) }}</span>
                    } @else {
                      <span>Checking…</span>
                    }
                  </span>
                </span>
                <span class="n" [attr.aria-label]="g.count + ' checkouts this con'">{{ g.count }}<small>×</small></span>
              </button>
            }
            <button type="button" class="see-all" (click)="seeAll.emit()">See all ›</button>
          }
        </section>
      }
    } @else {
      <h2 class="bl-section">Most played this con{{ updatedText() ? ' · ' + updatedText() : '' }}</h2>
      @for (r of rows(); track r.game.name) {
        <div class="bl-row" (blInView)="want(r.game)">
          <button type="button" class="bl-row-main" (click)="openGame(r.game)">
            <app-thumb [src]="r.item?.bgg_icon_uri || r.game.thumb" [name]="r.game.name" />
            <span class="bl-row-text">
              <span class="bl-name">{{ r.game.name }}</span>
              <span class="rank-tag">#{{ r.rank }} · Checked out {{ r.game.count }}× this con</span>
              @if (r.item; as item) {
                <span class="bl-status-line">
                  <span class="bl-pill" [class.out]="item.is_checked_out">{{ status(item) }}</span>
                  <span class="bl-shelf"><bl-icon name="pin" [size]="14" [stroke]="2.2" /><span class="visually-hidden">Shelf</span>{{ shelf(item) }}</span>
                  @if (hot(r.game)) { <span class="bl-hot-tag"><bl-icon name="flame" [size]="13" />Hot Games</span> }
                  <!-- All copies: "1 of 2 copies: missing pieces" when only some have a problem. -->
                  <app-notice-tag [copies]="copyDetails(r.game.ids)" />
                </span>
                <span class="bl-meta">
                  <span><bl-icon name="users" [size]="15" /><span class="visually-hidden">Players</span>{{ playersOf(item) }}</span>
                  <span><bl-icon name="clock" [size]="15" />{{ minutesOf(item) }} min</span>
                </span>
              } @else {
                <span class="bl-status-line"><span class="bl-pill checking">Checking…</span></span>
              }
            </span>
          </button>
          <!-- Shown at once (it used to pop in once details arrived); a tap before then fetches them first (addTap). -->
          <button type="button" class="bl-add" [class.on]="!!r.item && inList().has(r.item.id)" [disabled]="(!!r.item && busy().has(r.item.id)) || fetching().has(r.game.name)"
                  [attr.aria-label]="(r.item && inList().has(r.item.id) ? 'Remove ' : 'Add ') + r.game.name" (click)="addTap(r.game, r.item)">
            <bl-icon [name]="r.item && inList().has(r.item.id) ? 'check' : 'plus'" [stroke]="2.5" />
          </button>
        </div>
      } @empty {
        @if (!checkingCount()) {
          <div class="bl-empty">
            <p class="title">{{ games().length ? 'No games match' : 'No checkouts yet this con' }}</p>
            <p class="body">{{ games().length ? 'Try clearing the search or filters.' : 'This fills in as games are checked out, every 10 minutes.' }}</p>
          </div>
        }
      }
      @if (checkingCount(); as n) {
        <p class="bl-sheet-note note" role="status">Checking {{ n }} more {{ n === 1 ? 'game' : 'games' }}…</p>
      }
    }
  `,
})
export class ConPopularComponent {
  private con = inject(ConCheckoutsService);
  private bgg = inject(BggService);
  private cache = inject(GameDetailsCache);
  private destroyRef = inject(DestroyRef);

  mode = input<'card' | 'list'>('card');
  /** List mode: the Library's search and filters. */
  query = input('');
  availableOnly = input(false);
  players = input<number | null>(null);
  playTime = input<PlayTimeChoice | null>(null);
  /** Library copies on the current list, and copies being added/removed (for the + button). */
  inList = input<Set<string>>(new Set());
  busy = input<Set<string>>(new Set());

  open = output<BggItem>();
  toggle = output<BggItem>();
  seeAll = output<void>();

  games = this.con.games;
  top5 = computed(() => this.games().slice(0, 5));
  collapsed = signal(this.readCollapsed());
  private details = signal<Map<string, BggItem>>(this.cache.items());
  private requested = new Set<string>();
  private queue = new Subject<string>();
  private now = signal(Date.now());

  kicker = computed(() => {
    const con = currentOrNextConvention(this.now()) ?? CONVENTIONS[0];
    const day = con ? con.days.findIndex(d => d.date === dallasDateKey(this.now())) + 1 : 0;
    return con ? `${con.name}${day > 0 ? ' · Day ' + day : ''}` : '';
  });

  updatedText = computed(() => {
    const at = this.con.updatedAt();
    if (!at) return '';
    // Desk not scanning: "updated 1h 50m ago" would look like the app is broken.
    if (deskDownSince()) return 'paused · library desk isn\'t scanning';
    const ago = this.now() - at;
    return ago < 60_000 ? 'updated just now' : `updated ${shortDuration(ago)} ago`;
  });

  private filtering = computed(() => !!(this.query().trim() || this.availableOnly() || this.players() || this.playTime()));

  /** List rows (rank is the game's place in the whole ranking, not after filtering). */
  rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const players = this.players(), time = this.playTime(), availableOnly = this.availableOnly();
    return this.games()
      .map((game, i) => ({ game, rank: i + 1, item: this.best(game) }))
      .filter(r => !q || r.game.name.toLowerCase().includes(q))
      .filter(r => {
        if (!players && !time && !availableOnly) return true;
        // With a filter on, a game shows once its details say it fits (counted below meanwhile).
        return !!r.item && fitsPlayers(r.item, players) && fitsPlayTime(r.item, time) && (!availableOnly || !r.item.is_checked_out);
      });
  });

  checkingCount = computed(() => {
    if (!this.players() && !this.playTime() && !this.availableOnly()) return 0;
    const q = this.query().trim().toLowerCase();
    return this.games().filter(g => (!q || g.name.toLowerCase().includes(q)) && !this.best(g)).length;
  });

  constructor() {
    this.queue.pipe(
      mergeMap(id => this.bgg.getBggGameInfo(id).pipe(map((r: any) => ({ id, item: r?.result as BggItem | undefined })), catchError(() => of({ id, item: undefined }))), 4),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ id, item }) => {
      if (!item?.id) { this.requested.delete(id); return; }
      this.cache.set(item.id, item);
      this.details.update(m => new Map(m).set(item.id, item));
    });
    // With a filter on, every game's details are needed to know whether it fits.
    effect(() => {
      if (this.mode() === 'list' && this.filtering() && !this.query().trim()) this.games().forEach(g => this.want(g));
    });
    const timer = setInterval(() => this.now.set(Date.now()), 60_000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  /** Looks up a game's copies (each once per visit unless checked in the last 2 minutes). */
  want(g: ConGame): void {
    for (const id of g.ids) {
      if (this.requested.has(id) || this.cache.isFresh(id)) continue;
      this.requested.add(id);
      this.queue.next(id);
    }
  }

  /** An available copy if any copy is on the shelf; otherwise the first copy once all are known. */
  best(g: ConGame): BggItem | undefined {
    const loaded = g.ids.map(id => this.details().get(id)).filter((i): i is BggItem => !!i);
    return loaded.find(i => !i.is_checked_out) ?? (loaded.length === g.ids.length ? loaded[0] : undefined);
  }

  openGame(g: ConGame): void {
    const item = this.best(g);
    if (item) { this.open.emit(item); return; }
    this.bgg.getBggGameInfo(g.ids[0]).subscribe({ next: (r: any) => { if (r?.result?.id) this.open.emit(r.result); }, error: () => { /* offline: nothing to show */ } });
  }

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* this session only */ }
  }

  status(item: BggItem): string { return statusText(item, this.now()); }

  /** Games whose details are being fetched because + was tapped before they arrived. */
  fetching = signal<Set<string>>(new Set());

  /** The + button: adds now if the details are here, otherwise fetches the first copy, then adds. */
  addTap(game: ConGame, item: BggItem | undefined): void {
    if (item) { this.toggle.emit(item); return; }
    const mark = (on: boolean) => this.fetching.update(s => { const n = new Set(s); if (on) n.add(game.name); else n.delete(game.name); return n; });
    mark(true);
    this.bgg.getBggGameInfo(game.ids[0]).subscribe({
      next: (r: any) => { mark(false); if (r?.result?.id) this.toggle.emit(r.result); },
      error: () => mark(false),
    });
  }
  /**
   * Every copy's loaded record (for the missing-pieces tag; unloaded copies are skipped).
   * The same array is returned until details change, so the tag isn't handed a "new"
   * input on every redraw of the page.
   */
  copyDetails(ids: string[]): (BggItem | undefined)[] {
    const details = this.details();
    if (details !== this.copyCacheFor) { this.copyCache = new WeakMap(); this.copyCacheFor = details; }
    let copies = this.copyCache.get(ids);
    if (!copies) { copies = ids.map(id => details.get(id)); this.copyCache.set(ids, copies); }
    return copies;
  }
  private copyCache = new WeakMap<object, (BggItem | undefined)[]>();
  private copyCacheFor?: Map<string, BggItem>;
  shelf(item: BggItem): string { return shelfText(item); }
  playersOf(item: BggItem): string { return playersText(item); }
  minutesOf(item: BggItem): string { return minutesText(item); }
  hot(g: ConGame): boolean { return isHotGame(g.name, this.now()); }

  private readCollapsed(): boolean {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  }
}
