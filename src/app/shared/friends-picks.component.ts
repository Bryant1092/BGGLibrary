import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, mergeMap, of, Subject } from 'rxjs';
import { BggItem } from '../model/bgg.model';
import { Game } from '../model/game.model';
import { BggService } from '../service/bgg.service';
import { UserGameListRef } from '../model/user-gamelist-ref.model';
import { FriendsService, GamePick } from '../service/friends.service';
import { GameService } from '../service/game.service';
import { GameDetailsCache } from '../service/game-details-cache';
import { isHotGame } from '../util/hot-games';
import { UserService } from '../service/user.service';
import { WatchService } from '../service/watch.service';
import { ToastService } from '../service/toast.service';
import { fitsPlayers, fitsPlayTime, minutesText, PlayTimeChoice, playersText, shelfText, statusText } from '../util/game-format';
import { PlayFiltersComponent } from './play-filters.component';
import { GameSheetComponent } from './game-sheet.component';
import { ListPickerSheetComponent } from './list-picker-sheet.component';
import { RatingControlsComponent } from './rating-controls.component';
import { InViewDirective } from './in-view.directive';
import { ThumbComponent } from './thumb.component';
import { IconComponent } from './icon.component';
import { NoticeTagComponent } from './notice-tag.component';
import { PersonBadgeComponent } from './person-badge.component';

type Filter = 'all' | 'most' | 'any';

/**
 * Friends' picks (inside My Lists, so the tab bar stays at four tabs): every game
 * you or your friends want, most-wanted first, with who wants it and whether it's
 * on the shelf right now. Answers the group's question at the library: "what
 * should we grab first?"
 *
 * Each person counts once per game. Friends' games come only from lists they've
 * set to "Friends can see". Availability is fetched only for rows that scroll
 * into view (like Browse a shelf), 4 at a time.
 */
@Component({
  selector: 'app-friends-picks',
  standalone: true,
  imports: [PersonBadgeComponent, NoticeTagComponent, RouterLink, InViewDirective, ThumbComponent, IconComponent, GameSheetComponent, ListPickerSheetComponent, RatingControlsComponent, PlayFiltersComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* margin 0: .bl-chips normally bleeds into the header's padding; here there's none. */
    /* Slightly tighter than other chip rows so label + three chips fit on one iPhone line (375pt+). */
    .chips { padding: 12px 16px 0; margin: 0; align-items: center; gap: 6px; }
    .chips .bl-chip { padding: 0 11px; }
    /* A caption, not a button: small, muted, never wraps. */
    .chips-label { flex: none; font-size: 13px; font-weight: 600; color: var(--bl-muted); white-space: nowrap; }
    /* Space between the filter rows and the first game. */
    .rows-gap { height: 4px; }
    .who { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .count { font-size: 13px; font-weight: 700; color: var(--bl-accent-text); }
    /*
      Side by side, not overlapping: with two initials in each circle, overlapping hid part of
      the letters ("OT" under "FT"). Microsoft Fluent calls this a pile (vs. a stack for photos).
    */
    .dots { display: flex; gap: 3px; }
    .dot.more { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800;
      background: var(--bl-field); color: var(--bl-muted); }
    /*
      The key: everyone's circle with their first name, so the colors and initials can be learned
      without opening each game. One line that scrolls sideways if the group is big.
    */
    .group-key { display: flex; gap: 12px; overflow-x: auto; scrollbar-width: none; padding: 10px 16px 2px; }
    .group-key::-webkit-scrollbar { display: none; }
    .group-key .person { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: 13px; font-weight: 600; white-space: nowrap; }
    .people .person { display: inline-flex; align-items: center; gap: 8px; }
    .people .names { display: flex; flex-wrap: wrap; gap: 6px 14px; }
    .verdict { display: flex; gap: 10px; font-size: 13px; font-weight: 600; }
    .verdict span { display: inline-flex; align-items: center; gap: 4px; }
    .verdict .up { color: var(--bl-avail-text); }
    .verdict .down { color: var(--bl-muted); }
    .checking-more { padding: 14px 16px; text-align: center; }
    .people { display: flex; flex-direction: column; gap: 4px; border-radius: 12px; padding: 12px 14px; background: var(--bl-field); font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
    .people small { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--bl-muted); }
    .people .up, .people .down { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
    .people .up { color: var(--bl-avail-text); }
    .people .down { color: var(--bl-muted); font-weight: 500; }
  `,
  template: `
    @if (data() === null) {
      <p class="bl-sheet-note" style="padding: 16px">Loading your group's picks…</p>
    } @else if (data()!.people.length < 2) {
      <div class="bl-empty">
        <p class="title">See what your group wants</p>
        <p class="body">Add friends with their Meeple codes. Games on their lists (and yours) show up here, most-wanted first.</p>
        <a class="bl-btn outline" routerLink="/account" style="text-decoration: none">Add friends</a>
      </div>
    } @else {
      <!-- Whose games first, then players / time below: the same order as My lists
           (All / To play / Liked above, Players / Play time under it). -->
      <!--
        "Wanted by" says what the chips choose between, so the row reads as a sentence
        ("Wanted by: All of us"). Without it, Everyone vs Anyone was unclear (feedback 2026-11-16).
      -->
      <!-- Who's who: each circle with a first name (screen readers already get names on every row). -->
      <div class="group-key" aria-hidden="true">
        @for (person of data()!.people; track person.uid) {
          <span class="person"><app-person-badge [uid]="person.uid" [name]="person.name" [size]="24" />{{ firstName(person.name) }}</span>
        }
      </div>
      <div class="bl-chips chips" role="radiogroup" aria-labelledby="picks-wanted-by">
        <span class="chips-label" id="picks-wanted-by">Wanted by</span>
        @for (f of filters(); track f.value) {
          <button type="button" class="bl-chip" role="radio" [class.on]="filter() === f.value" [attr.aria-checked]="filter() === f.value" (click)="filter.set(f.value)">{{ f.label }}</button>
        }
      </div>
      <!-- "5 of us, about an hour": same filters as My lists (values shared with it). -->
      <app-play-filters [(players)]="players" [(playTime)]="playTime" />
      <div class="rows-gap"></div>
      @for (p of shown(); track p.game.id) {
        <div class="bl-row" (blInView)="wantCopies(p)">
          <!-- Tapping opens the same details sheet as Library / My Lists (players, BGG link, add to a list, who wants it). -->
          <button type="button" class="bl-row-main" style="align-items: center" (click)="open(p)">
            <app-thumb [src]="p.game.photo" [name]="p.game.name || ''" [size]="52" />
            <span class="bl-row-text">
              <span class="bl-name">{{ p.game.name }}</span>
              <span class="who">
                <span class="count">{{ p.wantedBy.length }} of {{ data()!.people.length }} want this</span>
                <!--
                  Each person's two initials on their color (PersonBadges), you first. At most 5,
                  then "+N" (Microsoft Fluent's face-pile guidance), so rows don't overflow on small
                  iPhones. Names are in the label for screen readers and in the details sheet.
                -->
                <span class="dots" [attr.aria-label]="names(p)" role="img">
                  @for (w of p.wantedBy.slice(0, 5); track w.uid) { <app-person-badge class="dot" [uid]="w.uid" [name]="w.name" /> }
                  @if (p.wantedBy.length > 5) { <span class="dot more">+{{ p.wantedBy.length - 5 }}</span> }
                </span>
              </span>
              @if (p.likedBy.length || p.dislikedBy.length) {
                <!-- After playing: who liked it. Names are in the label for screen readers. -->
                <span class="verdict" [attr.aria-label]="verdict(p)">
                  @if (p.likedBy.length) { <span class="up"><bl-icon name="thumbUp" [size]="14" /> {{ p.likedBy.length }} liked</span> }
                  @if (p.dislikedBy.length) { <span class="down"><bl-icon name="thumbDown" [size]="14" /> {{ p.dislikedBy.length }} not for them</span> }
                </span>
              }
              <!-- Same status line and icons as the Library's rows, so a game reads the same everywhere. -->
              @if (best(p); as item) {
                <span class="bl-status-line">
                  <span class="bl-pill" [class.out]="item.is_checked_out">{{ status(item) }}</span>
                  <span class="bl-shelf"><bl-icon name="pin" [size]="14" [stroke]="2.2" /><span class="visually-hidden">Shelf</span>{{ shelf(item) }}</span>
                  @if (hot(p)) { <span class="bl-hot-tag"><bl-icon name="flame" [size]="13" />Hot Games</span> }
                  <!-- All copies: "1 of 2 copies: missing pieces" when only some have a problem. -->
                  <app-notice-tag [copies]="copyDetails(p)" />
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
          @if (!wantedByMe(p)) {
            <button type="button" class="bl-add" [class.on]="added().has(p.game.id!)" [attr.aria-label]="added().has(p.game.id!) ? p.game.name + ' added to your list' : 'Me too: add ' + p.game.name + ' to your list'" (click)="meToo(p.game)">
              <bl-icon [name]="added().has(p.game.id!) ? 'check' : 'plus'" [stroke]="2.5" />
            </button>
          }
        </div>
      } @empty {
        @if (checkingCount()) {
          <!-- Nothing fits yet, but some picks haven't been checked: don't say "no picks" too early. -->
        } @else if (players() || playTime()) {
          <div class="bl-empty">
            <p class="title">No picks fit these filters</p>
            <p class="body">Try another number of players or play time{{ filter() !== 'any' ? ', or "Anyone"' : '' }}.</p>
            <button type="button" class="bl-btn outline" (click)="players.set(null); playTime.set(null)">Clear players and time</button>
          </div>
        } @else {
          <div class="bl-empty"><p class="title">No games match</p><p class="body">Try "Anyone" to see every game your group wants.</p></div>
        }
      }
      @if (checkingCount(); as n) {
        <p class="bl-sheet-note checking-more" role="status">Checking {{ n }} more {{ n === 1 ? 'game' : 'games' }}…</p>
      }
    }

    @if (sheet() === 'details' && selected(); as s) {
      <!-- No listName: the button reads "Add to a list" and lets you choose which one (below). -->
      <app-game-sheet [game]="s.item" [now]="now" [busy]="busy()"
                      [watched]="watch.isWatched(s.item.id)" (watchToggle)="toggleWatch(s.item)"
                      (toggle)="sheet.set('lists')" (closed)="close()">
        <div class="people">
          <small>Who wants this</small>
          <!-- Same circles as the row, each with the full name: ties the row's circles to people. -->
          <span class="names">
            @for (w of s.pick.wantedBy; track w.uid) {
              <span class="person"><app-person-badge [uid]="w.uid" [name]="w.name" [size]="24" />{{ w.name }}</span>
            }
          </span>
          @if (s.pick.likedBy.length) { <span class="up"><bl-icon name="thumbUp" [size]="15" /> Liked: {{ s.pick.likedBy.join(', ') }}</span> }
          @if (s.pick.dislikedBy.length) { <span class="down"><bl-icon name="thumbDown" [size]="15" /> Not for them: {{ s.pick.dislikedBy.join(', ') }}</span> }
        </div>
        <!-- Your own Liked / Want to buy, as in My Lists (e.g. after playing a friend's pick). -->
        <app-rating-controls [game]="s.pick.game" />
      </app-game-sheet>
    }
    @if (sheet() === 'lists') {
      <app-list-picker-sheet [lists]="lists()" [currentId]="currentListId()" [uid]="uid()"
                             (pick)="addTo($event)" (create)="createAndAdd($event)" (closed)="sheet.set('details')" />
    }
  `,
})
export class FriendsPicksComponent implements OnInit {
  private friends = inject(FriendsService);
  private bgg = inject(BggService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);
  private gameService = inject(GameService);
  private userService = inject(UserService);
  readonly watch = inject(WatchService);

  /** Your lists, from My Lists (it already loads them), for "Add to a list". */
  lists = input<UserGameListRef[]>([]);
  uid = input<string | undefined>();
  /**
   * A list was chosen in the picker: My Lists makes it the app's current list, the
   * same as choosing it anywhere else, so the Library's + button adds there too.
   */
  listChosen = output<UserGameListRef>();
  /** Players / play time filters, two-way bound to My Lists so both views share them. */
  players = model<number | null>(null);
  playTime = model<PlayTimeChoice | null>(null);

  sheet = signal<'details' | 'lists' | null>(null);
  private selectedId = signal<string | null>(null);
  /** The open game: its pick (who wants it) and its library record (players, shelf, status). */
  selected = computed(() => {
    const id = this.selectedId();
    const pick = this.data()?.games.find(p => p.copies.some(c => c.id === id));
    const item = id ? this.details().get(id) : undefined;
    return pick && item ? { pick, item } : null;
  });
  busy = signal(false);

  data = signal<{ people: { uid: string; name: string }[]; games: GamePick[] } | null>(null);
  filter = signal<Filter>('any');
  /**
   * Starts from details already known (from My Lists or an earlier visit here), so
   * coming back with a players / time filter on shows the filtered list at once.
   */
  private cache = inject(GameDetailsCache);
  details = signal<Map<string, BggItem>>(this.cache.items());
  added = signal<Set<string>>(new Set());
  private requested = new Set<string>();
  /** Copies whose lookup failed (offline / timeout); not counted as "checking". */
  private failed = signal<Set<string>>(new Set());
  private queue = new Subject<string>();
  now = Date.now();

  /** "Most of us" = at least half the group (and at least 2), e.g. 4+ of 7. */
  private mostCount = computed(() => Math.max(2, Math.ceil((this.data()?.people.length || 0) / 2)));
  filters = computed(() => [
    // "All of us" (was "Everyone"): pairs with "Most of us" and doesn't look like "Anyone".
    { value: 'all' as Filter, label: 'All of us' },
    // "Most", not "Most of us": with the "Wanted by" label in front, the longer text pushed
    // "Anyone" off the edge of an iPhone screen.
    { value: 'most' as Filter, label: `Most (${this.mostCount()}+)` },
    { value: 'any' as Filter, label: 'Anyone' },
  ]);
  shown = computed(() => {
    const d = this.data();
    if (!d) return [];
    const need = this.filter() === 'all' ? d.people.length : this.filter() === 'most' ? this.mostCount() : 1;
    const players = this.players(), time = this.playTime();
    return d.games.filter(p => {
      if (p.wantedBy.length < need) return false;
      if (!players && !time) return true;
      // Not checked yet: hidden until its players / time are known (counted in
      // "Checking N more games…"), so the list only grows instead of shrinking.
      const item = this.best(p);
      return !!item && fitsPlayers(item, players) && fitsPlayTime(item, time);
    });
  });

  /** With a players / time filter on: picks still being checked (not shown yet). */
  checkingCount = computed(() => {
    const d = this.data();
    if (!d || (!this.players() && !this.playTime())) return 0;
    const need = this.filter() === 'all' ? d.people.length : this.filter() === 'most' ? this.mostCount() : 1;
    const failed = this.failed();
    return d.games.filter(p => p.wantedBy.length >= need && !this.best(p) && !p.copies.every(c => failed.has(c.id!))).length;
  });

  constructor() {
    // Rows normally load their details as they scroll into view. With a players / time
    // filter on, every pick needs its details to know whether it fits, so ask for all of
    // them (4 at a time, each only once).
    effect(() => {
      if (!this.players() && !this.playTime()) return;
      (this.data()?.games || []).forEach(p => this.wantCopies(p));
    });
  }

  ngOnInit(): void {
    this.friends.picks$().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(d => this.data.set(d));
    this.queue.pipe(
      mergeMap(id => this.bgg.getBggGameInfo(id).pipe(map((r: any) => ({ id, r })), catchError(() => of({ id, r: null }))), 4),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ id, r }) => {
      const item = r?.result as BggItem | undefined;
      if (!item?.id) {
        // Lost on con Wi-Fi: stop counting it as "checking" and allow a retry the
        // next time the view opens or a filter changes.
        this.requested.delete(id);
        this.failed.update(s => new Set(s).add(id));
        return;
      }
      this.failed.update(s => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
      this.cache.set(item.id, item);
      this.details.update(m => new Map(m).set(item.id, item));
    });
  }

  /**
   * Asks the library for a game once per visit, unless it was checked in the last
   * 2 minutes. Older remembered details stay on screen meanwhile (players and time
   * never change; availability is replaced when the answer arrives).
   */
  want(id: string): void {
    if (!id || this.requested.has(id) || this.cache.isFresh(id)) return;
    this.requested.add(id);
    this.queue.next(id);
  }

  /**
   * Opens the details sheet. The library record normally arrived when the row scrolled
   * into view; if not yet (or that lookup failed on con Wi-Fi), it's fetched now.
   */
  open(p: GamePick): void {
    const shown = this.best(p);
    if (shown) { this.selectedId.set(shown.id); this.sheet.set('details'); return; }
    const id = p.game.id!;
    this.bgg.getBggGameInfo(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r: any) => {
        const item = r?.result as BggItem | undefined;
        if (!item?.id) return;
        this.details.update(m => new Map(m).set(item.id, item));
        this.selectedId.set(id);
        this.sheet.set('details');
      },
      error: () => this.toast.error("Couldn't load this game. Check your connection."),
    });
  }

  close(): void {
    this.sheet.set(null);
    this.selectedId.set(null);
  }

  currentListId(): string | undefined {
    return this.userService.getCurrentGameList()?.id;
  }

  /** Adds the open game to the chosen list (already there = no change) and goes back to its sheet. */
  addTo(list: UserGameListRef): void {
    const game = this.selected()?.pick.game;
    if (!game || this.busy()) return;
    this.busy.set(true);
    this.listChosen.emit(list);
    this.sheet.set('details');
    // Only the fields the Library stores, so a friend's Played tick doesn't come along (as meToo).
    this.gameService.addGameToList(list.id, { bgg_id: game.bgg_id, name: game.name, photo: game.photo, id: game.id })
      .then(() => { this.added.update(s => new Set(s).add(game.id!)); this.toast.show({ text: `Added to ${list.name}` }); })
      .catch(() => this.toast.error("Couldn't add it. Check your connection."))
      .finally(() => this.busy.set(false));
  }

  createAndAdd(name: string): void {
    this.gameService.createGameList(name)
      .then(id => this.addTo({ id, name, owner: this.uid() }))
      .catch(() => this.toast.error("Couldn't create the list. Try again."));
  }

  toggleWatch(item: BggItem): void {
    this.watch.toggle({ id: item.id, name: item.name, shelf: shelfText(item) });
  }

  /** Also on the Hot Games tables (tag on the row). */
  hot(p: GamePick): boolean {
    return isHotGame(p.game.name || '', this.now);
  }

  playersOf(item: BggItem): string {
    return playersText(item);
  }

  minutesOf(item: BggItem): string {
    return minutesText(item);
  }

  /** Looks up every library copy of the game (most games have one; some have 2+). */
  wantCopies(p: GamePick): void {
    p.copies.forEach(c => this.want(c.id!));
  }

  /**
   * The copy to show: an available one if any copy is on the shelf (that's the one to
   * go get), otherwise the first copy once all have been checked. Undefined = still
   * checking, so a row doesn't flash "Checked out" while another copy is loading.
   */
  /**
   * Every copy's loaded record (for the missing-pieces tag; unloaded copies are skipped).
   * The same array is returned until details change, so the tag isn't handed a "new"
   * input on every redraw of the page.
   */
  copyDetails(p: GamePick): (BggItem | undefined)[] {
    const details = this.details();
    if (details !== this.copyCacheFor) { this.copyCache = new WeakMap(); this.copyCacheFor = details; }
    let copies = this.copyCache.get(p.copies);
    if (!copies) { copies = p.copies.map(c => details.get(c.id!)); this.copyCache.set(p.copies, copies); }
    return copies;
  }
  private copyCache = new WeakMap<object, (BggItem | undefined)[]>();
  private copyCacheFor?: Map<string, BggItem>;

  best(p: GamePick): BggItem | undefined {
    const loaded = p.copies.map(c => this.details().get(c.id!)).filter((i): i is BggItem => !!i);
    return loaded.find(i => !i.is_checked_out) ?? (loaded.length === p.copies.length ? loaded[0] : undefined);
  }

  /** Full list of who wants it, you first: "You, Sam K., Maria L." */
  wantNames(p: GamePick): string {
    return p.wantedBy.map(w => w.name).join(', ');
  }

  wantedByMe(p: GamePick): boolean {
    return p.wantedBy.some(w => w.name === 'You') || this.added().has(p.game.id!);
  }

  /** "Bryant G." -> "Bryant", for the key (the circle already carries the last initial). */
  firstName(name: string): string {
    return name.trim().split(/\s+/)[0] || name;
  }

  verdict(p: GamePick): string {
    return [p.likedBy.length ? 'Liked by ' + p.likedBy.join(', ') : '', p.dislikedBy.length ? 'Not for ' + p.dislikedBy.join(', ') : ''].filter(Boolean).join('. ');
  }

  names(p: GamePick): string {
    return 'Wanted by ' + p.wantedBy.map(w => w.name).join(', ');
  }

  status(item: BggItem): string {
    return statusText(item, this.now);
  }

  shelf(item: BggItem): string {
    return shelfText(item);
  }

  meToo(game: Game): void {
    this.friends.meToo(game).then(listName => {
      this.added.update(s => new Set(s).add(game.id!));
      this.toast.show({ text: `Added to ${listName}` });
    }).catch(err => this.toast.error(err?.message === 'no-list' ? 'Make a list first (tap the List button above).' : "Couldn't add it. Check your connection."));
  }
}
