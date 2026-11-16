import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, mergeMap, of, Subject } from 'rxjs';
import { BggItem } from '../model/bgg.model';
import { Game } from '../model/game.model';
import { BggService } from '../service/bgg.service';
import { UserGameListRef } from '../model/user-gamelist-ref.model';
import { FriendsService, GamePick } from '../service/friends.service';
import { GameService } from '../service/game.service';
import { UserService } from '../service/user.service';
import { WatchService } from '../service/watch.service';
import { ToastService } from '../service/toast.service';
import { minutesText, playersText, shelfText, statusText } from '../util/game-format';
import { GameSheetComponent } from './game-sheet.component';
import { ListPickerSheetComponent } from './list-picker-sheet.component';
import { RatingControlsComponent } from './rating-controls.component';
import { InViewDirective } from './in-view.directive';
import { ThumbComponent } from './thumb.component';
import { IconComponent } from './icon.component';

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
  imports: [RouterLink, InViewDirective, ThumbComponent, IconComponent, GameSheetComponent, ListPickerSheetComponent, RatingControlsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* margin 0: .bl-chips normally bleeds into the header's padding; here there's none. */
    .chips { padding: 12px 16px 4px; margin: 0; }
    .who { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .count { font-size: 13px; font-weight: 700; color: var(--bl-accent-text); }
    .dots { display: flex; }
    .dot { width: 22px; height: 22px; border-radius: 11px; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center;
      background: var(--bl-accent-soft); color: var(--bl-accent-text); box-shadow: 0 0 0 2px var(--bl-surface); }
    .dot + .dot { margin-left: -5px; }
    .dot.me { background: var(--bl-accent); color: var(--bl-on-accent); }
    .verdict { display: flex; gap: 10px; font-size: 13px; font-weight: 600; }
    .verdict span { display: inline-flex; align-items: center; gap: 4px; }
    .verdict .up { color: var(--bl-avail-text); }
    .verdict .down { color: var(--bl-muted); }
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
      <div class="bl-chips chips" role="radiogroup" aria-label="Show games wanted by">
        @for (f of filters(); track f.value) {
          <button type="button" class="bl-chip" role="radio" [class.on]="filter() === f.value" [attr.aria-checked]="filter() === f.value" (click)="filter.set(f.value)">{{ f.label }}</button>
        }
      </div>
      @for (p of shown(); track p.game.id) {
        <div class="bl-row" (blInView)="wantCopies(p)">
          <!-- Tapping opens the same details sheet as Library / My Lists (players, BGG link, add to a list, who wants it). -->
          <button type="button" class="bl-row-main" style="align-items: center" (click)="open(p)">
            <app-thumb [src]="p.game.photo" [name]="p.game.name || ''" [size]="52" />
            <span class="bl-row-text">
              <span class="bl-name">{{ p.game.name }}</span>
              <span class="who">
                <span class="count">{{ p.wantedBy.length }} of {{ data()!.people.length }} want this</span>
                <!-- Initials, you first; names are in the label for screen readers. -->
                <span class="dots" [attr.aria-label]="names(p)" role="img">
                  @for (w of p.wantedBy; track w.uid) { <span class="dot" [class.me]="w.name === 'You'">{{ initial(w.name) }}</span> }
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
                </span>
                <span class="bl-meta">
                  <span><bl-icon name="users" [size]="15" /><span class="visually-hidden">Players</span>{{ players(item) }}</span>
                  <span><bl-icon name="clock" [size]="15" />{{ minutes(item) }} min</span>
                </span>
              } @else {
                <span class="bl-status-line"><span class="bl-pill checking">Checking…</span></span>
              }
            </span>
          </button>
          @if (!wantedByMe(p)) {
            <button type="button" class="bl-add" [class.on]="added().has(p.game.id!)" [attr.aria-label]="'Me too: add ' + p.game.name + ' to your list'" (click)="meToo(p.game)">
              <bl-icon [name]="added().has(p.game.id!) ? 'check' : 'plus'" [stroke]="2.5" />
            </button>
          }
        </div>
      } @empty {
        <div class="bl-empty"><p class="title">No games match</p><p class="body">Try "Anyone" to see every game your group wants.</p></div>
      }
    }

    @if (sheet() === 'details' && selected(); as s) {
      <!-- No listName: the button reads "Add to a list" and lets you choose which one (below). -->
      <app-game-sheet [game]="s.item" [now]="now" [busy]="busy()"
                      [watched]="watch.isWatched(s.item.id)" (watchToggle)="toggleWatch(s.item)"
                      (toggle)="sheet.set('lists')" (closed)="close()">
        <div class="people">
          <small>Who wants this</small>
          <span>{{ wantNames(s.pick) }}</span>
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
  details = signal<Map<string, BggItem>>(new Map());
  added = signal<Set<string>>(new Set());
  private requested = new Set<string>();
  private queue = new Subject<string>();
  now = Date.now();

  /** "Most of us" = at least half the group (and at least 2), e.g. 4+ of 7. */
  private mostCount = computed(() => Math.max(2, Math.ceil((this.data()?.people.length || 0) / 2)));
  filters = computed(() => [
    { value: 'all' as Filter, label: 'Everyone' },
    { value: 'most' as Filter, label: `Most of us (${this.mostCount()}+)` },
    { value: 'any' as Filter, label: 'Anyone' },
  ]);
  shown = computed(() => {
    const d = this.data();
    if (!d) return [];
    const need = this.filter() === 'all' ? d.people.length : this.filter() === 'most' ? this.mostCount() : 1;
    return d.games.filter(p => p.wantedBy.length >= need);
  });

  ngOnInit(): void {
    this.friends.picks$().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(d => this.data.set(d));
    this.queue.pipe(
      mergeMap(id => this.bgg.getBggGameInfo(id).pipe(catchError(() => of(null))), 4),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r: any) => {
      const item = r?.result as BggItem | undefined;
      if (item?.id) this.details.update(m => new Map(m).set(item.id, item));
    });
  }

  want(id: string): void {
    if (!id || this.requested.has(id)) return;
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

  players(item: BggItem): string {
    return playersText(item);
  }

  minutes(item: BggItem): string {
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

  initial(name: string): string {
    return (name.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();
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
