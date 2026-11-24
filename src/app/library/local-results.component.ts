import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { NetworkHealth } from '../service/network-health';
import { timeout } from 'rxjs';
import { deskManual } from '../util/desk-state';
import { GameDetailsCache } from '../service/game-details-cache';
import { BggItem } from '../model/bgg.model';
import { BggService, LibrarySort, PlayTimeFilter } from '../service/bgg.service';
import { SearchGame } from '../service/local-search.service';
import { ShelfService } from '../service/shelf.service';
import { ToastService } from '../service/toast.service';
import { IconComponent } from '../shared/icon.component';
import { InViewDirective } from '../shared/in-view.directive';
import { ThumbComponent } from '../shared/thumb.component';
import { fitsPlayers, fitsPlayTime, statusText } from '../util/game-format';
import { isHotGame } from '../util/hot-games';
import { NoticeTagComponent } from '../shared/notice-tag.component';

/** Rows drawn at first; more as the end of the list scrolls into view. */
const PAGE = 40;
/** "Available now" / "Available first" need every match's status: at most this many. */
const STATUS_ALL_MAX = 120;

/**
 * Library search results found on the phone (LocalSearchService), so typing never waits
 * on Tabletop.Events. Players, play time, name and the A–Z / Newest / Most played sorts
 * work instantly from the saved list. Status (Available / Out) is live: fetched for rows
 * on screen (ShelfService, shared with Browse a shelf), or for every match (up to 120)
 * when "Available now" or "Available first" needs it.
 */
@Component({
  selector: 'app-local-results',
  standalone: true,
  imports: [NoticeTagComponent, IconComponent, InViewDirective, ThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .note { padding: 14px 16px; text-align: center; }
    .more { height: 1px; }
  `,
  template: `
    @for (g of shown(); track g.id) {
      <div class="bl-row" (blInView)="shelf.want(g.id)">
        <button type="button" class="bl-row-main" (click)="openGame(g)">
          <app-thumb [src]="g.thumb" [name]="g.name" />
          <span class="bl-row-text">
            <span class="bl-name">{{ g.name }}</span>
            <span class="bl-status-line">
              @if (live().get(g.id); as item) {
                <span class="bl-pill" [class.out]="item.is_checked_out">{{ status(item) }}</span>
              } @else if (down()) {
                <!-- Tabletop.Events down: the last status this phone saw ("Likely…"), else unknown. -->
                @if (details.items().get(g.id); as saved) {
                  <span class="bl-pill" [class.out]="saved.is_checked_out">{{ status(saved) }}</span>
                } @else {
                  <span class="bl-pill checking">Status unknown</span>
                }
              } @else {
                <span class="bl-pill checking">Checking…</span>
              }
              <span class="bl-shelf"><bl-icon name="pin" [size]="14" [stroke]="2.2" /><span class="visually-hidden">Shelf</span>{{ g.shelf || '?' }}</span>
              @if (hot(g)) { <span class="bl-hot-tag"><bl-icon name="flame" [size]="13" />Hot Games</span> }
              <!-- From the live record, once it has loaded (util/game-notice.ts). -->
              <app-notice-tag [game]="live().get(g.id)" />
            </span>
            <span class="bl-meta">
              <span><bl-icon name="users" [size]="15" /><span class="visually-hidden">Players</span>{{ range(g.minPlayers, g.maxPlayers) }}</span>
              <span><bl-icon name="clock" [size]="15" />{{ range(g.minMinutes, g.maxMinutes) }} min</span>
            </span>
          </span>
        </button>
        <!--
          Shown at once, not after the live record arrives: rows used to appear without
          their + and it popped in half a second later (reported 2026-11-16). A tap before
          the record has arrived fetches it first (addTap).
        -->
        <button type="button" class="bl-add" [class.on]="listIds().has(g.id)" [disabled]="busyIds().has(g.id) || fetching().has(g.id)"
                [attr.aria-label]="(listIds().has(g.id) ? 'Remove ' : 'Add ') + g.name + (listName() ? (listIds().has(g.id) ? ' from ' : ' to ') + listName() : '')"
                (click)="addTap(g)">
          <bl-icon [name]="listIds().has(g.id) ? 'check' : 'plus'" [stroke]="2.5" />
        </button>
      </div>
    } @empty {
      @if (!checkingCount()) {
        <div class="bl-empty">
          <p class="title">No games match</p>
          <p class="body">Try fewer filters or a different spelling.</p>
        </div>
      }
    }
    @if (filtered().length > shown().length) {
      <div class="more" (blInView)="showMore()"></div>
    }
    @if (checkingCount(); as n) {
      <p class="bl-sheet-note note" role="status">Checking {{ n }} more {{ n === 1 ? 'game' : 'games' }}…</p>
    }
  `,
})
export class LocalResultsComponent {
  shelf = inject(ShelfService);
  private bgg = inject(BggService);
  private toast = inject(ToastService);
  readonly details = inject(GameDetailsCache);
  private health = inject(NetworkHealth);
  /** Tabletop.Events known to be down: rows stop waiting for a live status. */
  readonly down = computed(() => deskManual() || this.health.struggling());

  /** Matches for the search, A–Z (LocalSearchService.search). */
  games = input.required<SearchGame[]>();
  sort = input<LibrarySort>('name');
  availableOnly = input(false);
  players = input<number | null>(null);
  playTime = input<PlayTimeFilter | null>(null);
  now = input(Date.now());
  listIds = input<Set<string>>(new Set());
  busyIds = input<Set<string>>(new Set());
  listName = input<string | undefined>(undefined);

  open = output<BggItem>();
  toggle = output<BggItem>();

  live = this.shelf.live;
  private limit = signal(PAGE);

  /** Needs every match's status: "Available now" or the "Available first" sort. */
  private needsAllStatus = computed(() => this.availableOnly() || this.sort() === 'availability');

  /** Players / play time (instant, from the saved list), then "Available now" (live). */
  filtered = computed(() => {
    const players = this.players(), time = this.playTime(), live = this.live();
    let list = this.games().filter(g =>
      fitsPlayers({ min_players: g.minPlayers, max_players: g.maxPlayers }, players)
      && fitsPlayTime({ max_play_time: g.maxMinutes }, time));
    // Tabletop.Events sends is_checked_out as 0 / 1.
    if (this.availableOnly()) list = list.filter(g => { const i = live.get(g.id); return !!i && !Number(i.is_checked_out); });
    switch (this.sort()) {
      case 'nameDesc': return [...list].reverse();
      case 'newest': return [...list].sort((a, b) => b.added - a.added);
      case 'popular': return [...list].sort((a, b) => b.checkouts - a.checkouts);
      case 'availability': {
        // Available, then not checked yet, then checked out; A–Z within each.
        const rank = (g: SearchGame) => { const i = live.get(g.id); return !i ? 1 : Number(i.is_checked_out) ? 2 : 0; };
        return [...list].sort((a, b) => rank(a) - rank(b));
      }
      default: return list;
    }
  });

  shown = computed(() => this.filtered().slice(0, this.limit()));

  /** "Available now": matches whose status hasn't arrived yet (shown once they're known). */
  checkingCount = computed(() => {
    if (!this.availableOnly()) return 0;
    const live = this.live();
    return this.games().slice(0, STATUS_ALL_MAX).filter(g => !live.has(g.id)).length;
  });

  constructor() {
    // A new search starts from the top.
    effect(() => { this.games(); this.limit.set(PAGE); });
    // "Available now" / "Available first": ask for every match's status (up to 120).
    effect(() => {
      if (this.needsAllStatus()) this.games().slice(0, STATUS_ALL_MAX).forEach(g => this.shelf.want(g.id));
    });
  }

  showMore(): void {
    this.limit.update(n => n + PAGE);
  }

  openGame(g: SearchGame): void {
    const item = this.live().get(g.id);
    if (item) { this.open.emit(item); return; }
    // Tabletop.Events down (switch on) or no connection: open right away from what the phone
    // has. Before 2026-11-21 the tap fetched first and did nothing when that failed.
    if (deskManual() || !navigator.onLine) { this.open.emit(this.offlineItem(g)); return; }
    this.bgg.getBggGameInfo(g.id).pipe(timeout(3000)).subscribe({
      next: (r: any) => this.open.emit(r?.result?.id ? r.result : this.offlineItem(g)),
      error: () => this.open.emit(this.offlineItem(g)),
    });
  }

  /** The last saved details for this game, or one built from the on-phone search list. */
  private offlineItem(g: SearchGame): BggItem {
    const saved = this.details.items().get(g.id);
    if (saved) return saved;
    return {
      id: g.id, name: g.name, bgg_icon_uri: g.thumb,
      min_players: g.minPlayers, max_players: g.maxPlayers, min_play_time: g.minMinutes, max_play_time: g.maxMinutes,
      custom_fields: { Location: g.shelf } as BggItem['custom_fields'],
      checkout_count: g.checkouts, is_checked_out: 0, last_checkout_date: '', last_checkin_date: '',
      status_unknown: true,
    } as BggItem;
  }

  /** Games whose record is being fetched because + was tapped before it arrived. */
  fetching = signal<Set<string>>(new Set());

  /**
   * The + button. Adding saves the game's BoardGameGeek id too (Friends' picks groups
   * copies by it), which the on-phone search list doesn't have, so a tap before the live
   * record arrives fetches that one game first (about 0.3 s), then adds.
   */
  addTap(g: SearchGame): void {
    const item = this.live().get(g.id);
    if (item) { this.toggle.emit(item); return; }
    const mark = (on: boolean) => this.fetching.update(s => { const n = new Set(s); if (on) n.add(g.id); else n.delete(g.id); return n; });
    mark(true);
    this.bgg.getBggGameInfo(g.id).subscribe({
      next: (r: any) => { mark(false); if (r?.result?.id) this.toggle.emit(r.result); },
      error: () => { mark(false); this.toast.error("Couldn't add the game. Check your connection."); },
    });
  }

  status(item: BggItem): string { return statusText(item, this.now()); }
  hot(g: SearchGame): boolean { return isHotGame(g.name, this.now()); }
  range(min: number, max: number): string { return min === max ? `${min}` : `${min}–${max}`; }
}
