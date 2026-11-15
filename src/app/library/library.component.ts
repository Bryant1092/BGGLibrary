import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Injectable, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, catchError, EMPTY, from, ignoreElements, map, merge, mergeMap, of, Subject, switchMap } from 'rxjs';
import { BggItem } from '../model/bgg.model';
import { UserGameListRef } from '../model/user-gamelist-ref.model';
import { BggService, LibrarySearch, LibrarySort, PlayTimeFilter } from '../service/bgg.service';
import { GameService } from '../service/game.service';
import { ToastService } from '../service/toast.service';
import { UserService } from '../service/user.service';
import { WatchService } from '../service/watch.service';
import { RecentService } from '../service/recent.service';
import { GameSheetComponent } from '../shared/game-sheet.component';
import { IconComponent } from '../shared/icon.component';
import { ListPickerSheetComponent } from '../shared/list-picker-sheet.component';
import { SheetComponent } from '../shared/sheet.component';
import { ThumbComponent } from '../shared/thumb.component';
import { OfflineBarComponent } from '../shared/offline-bar.component';
import { ShelfIndex, ShelfInfo, ShelfService } from '../service/shelf.service';
import { ShelfListComponent } from './shelf-list.component';
import { currentOrNextConvention, libraryStatus, shortDuration } from '../util/library-time';
import { isNewArrival, minutesText, playersText, returnedText, shelfText, statusText } from '../util/game-format';
import { matchHotGames } from '../util/hot-games';

/**
 * 12 per page. Tabletop.Events' response time grows with page size (measured
 * Nov 2026: 10 games ~1.3 s, 15 ~1.7 s, 25 ~2.6 s), and most people search for
 * a specific game, so a small first page shows results about twice as fast.
 * "Load more" covers browsing.
 */
const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 350;

const PLAY_TIME_LABELS: Record<PlayTimeFilter, string> = {
  upTo30: 'Up to 30 min',
  upTo60: 'Up to 1 hour',
  over60: 'Over 1 hour',
};

/** Shown in the Sort sheet; `chip` is the short label on the sort chip. */
const SORT_OPTIONS: { value: LibrarySort; label: string; chip: string; note: string }[] = [
  { value: 'name', label: 'Name A–Z', chip: 'A–Z', note: 'Alphabetical' },
  { value: 'nameDesc', label: 'Name Z–A', chip: 'Z–A', note: 'Reverse alphabetical' },
  { value: 'availability', label: 'Available first', chip: 'Available first', note: 'Checked-out games go to the end' },
  { value: 'popular', label: 'Most played', chip: 'Most played', note: 'Checked out most often at past conventions' },
  { value: 'newest', label: 'Newest to the library', chip: 'Newest', note: 'Games added most recently come first' },
  { value: 'returned', label: 'Just returned', chip: 'Just returned', note: 'New arrivals first, then games just checked back in' },
];

interface Filters {
  /** "Browse a shelf": a shelf name like "M" or "CARD RACK", or null for the whole library. */
  shelf: string | null;
  query: string;
  availableOnly: boolean;
  players: number | null;
  playTime: PlayTimeFilter | null;
  sort: LibrarySort;
}

const DEFAULT_FILTERS: Filters = { shelf: null, query: '', availableOnly: false, players: null, playTime: null, sort: 'name' };

/**
 * Remembers the Library page's search, filters and loaded results while the
 * app is open. Switching to My Lists and back used to reset the search, which
 * is annoying when you're comparing a list against search results.
 */
@Injectable({ providedIn: 'root' })
export class LibraryPageState {
  filters: Filters = { ...DEFAULT_FILTERS };
  items: BggItem[] = [];
  page = 1;
  total = 0;
  scrollY = 0;
}

@Component({
  selector: 'app-library',
  standalone: true,
  imports: [IconComponent, SheetComponent, GameSheetComponent, ListPickerSheetComponent, ThumbComponent, OfflineBarComponent, ShelfListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './library.component.html',
})
export class LibraryComponent implements OnInit, OnDestroy {
  private bggService = inject(BggService);
  private userService = inject(UserService);
  private gameService = inject(GameService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private saved = inject(LibraryPageState);
  private route = inject(ActivatedRoute);
  watch = inject(WatchService);
  recent = inject(RecentService);
  private shelfService = inject(ShelfService);
  /** Which shelves exist and their sizes (public/shelves/index.json); null until loaded. */
  shelfIndex = signal<ShelfIndex | null>(null);
  /** Recent games whose status was re-checked since the page opened; the rest show "Checking…". */
  private recentChecked = signal<Set<string>>(new Set());
  private recentCheckedAt = 0;

  readonly playerOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly playTimeOptions = Object.entries(PLAY_TIME_LABELS) as [PlayTimeFilter, string][];
  readonly sortOptions = SORT_OPTIONS;

  filters = signal<Filters>({ ...this.saved.filters });
  items = signal<BggItem[]>(this.saved.items);
  total = signal(this.saved.total);
  private page = this.saved.page;
  loading = signal(false);
  loadingMore = signal(false);
  loadError = signal(false);

  /** Ticks every minute so "Out 45m", due times and library hours stay current without a reload. */
  now = signal(Date.now());
  private clock = setInterval(() => this.now.set(Date.now()), 60_000);

  signedIn = signal(false);
  uid = signal<string | undefined>(undefined);
  lists = signal<UserGameListRef[]>([]);
  currentList = signal<UserGameListRef | undefined>(undefined);
  private currentListId$ = new BehaviorSubject<string | undefined>(undefined);
  /** Ids of games in the current list, kept live so friends' changes show up. */
  listGameIds = signal<Set<string>>(new Set());
  /** Games with an add/remove in progress, keyed by id. */
  busyIds = signal<Set<string>>(new Set());

  sheet = signal<'details' | 'players' | 'time' | 'sort' | 'lists' | 'shelf' | null>(null);
  selected = signal<BggItem | null>(null);
  /** A game the user tried to add before choosing/creating a list; added once they do. */
  private pendingAdd: BggItem | null = null;

  /**
   * Every search goes through this stream. switchMap cancels the previous
   * request, so a slow older response can't overwrite newer results.
   */
  private requests = new Subject<{ page: number; append: boolean }>();
  private debounceTimer?: ReturnType<typeof setTimeout>;

  status = computed(() => libraryStatus(this.now()));

  /** The picked shelf's details, when browsing a shelf. */
  shelfInfo = computed<ShelfInfo | null>(() => {
    const name = this.filters().shelf;
    return name ? this.shelfIndex()?.shelves.find(s => s.shelf === name) ?? null : null;
  });
  /** Shelf picker: NEW, # and A–Z as a grid; racks and bins as a list with their sizes. */
  shelfLetters = computed(() => {
    const shelves = this.shelfIndex()?.shelves || [];
    const order = ['NEW', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
    return order.map(name => shelves.find(s => s.shelf === name)).filter((s): s is ShelfInfo => !!s);
  });
  shelfRacks = computed(() => (this.shelfIndex()?.shelves || [])
    .filter(s => s.shelf.length > 1 && s.shelf !== 'NEW' && s.shelf !== 'Unknown')
    .sort((a, b) => b.count - a.count));
  shelfChip = computed(() => this.filters().shelf ? `Shelf: ${this.filters().shelf}` : 'Shelf');
  hasHotGames = computed(() => currentOrNextConvention(this.now())?.hasHotGames ?? false);
  hasMore = computed(() => this.items().length < this.total());
  playersChip = computed(() => {
    const p = this.filters().players;
    return p ? `${p} ${p === 1 ? 'player' : 'players'}` : 'Players';
  });
  sortChip = computed(() => SORT_OPTIONS.find(o => o.value === this.filters().sort)?.chip || 'A–Z');
  playTimeChip = computed(() => {
    const t = this.filters().playTime;
    return t ? PLAY_TIME_LABELS[t] : 'Play time';
  });
  hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.shelf || f.query || f.availableOnly || f.players || f.playTime);
  });

  /** Row view-models, so the template doesn't recompute text for every row on every change check. */
  rows = computed(() => {
    const now = this.now();
    const ids = this.listGameIds();
    const busy = this.busyIds();
    const list = this.currentList()?.name;
    const returnedMode = this.filters().sort === 'returned';
    return this.items().map(item => ({
      item,
      isNew: returnedMode && isNewArrival(item),
      status: !returnedMode ? statusText(item, now) : isNewArrival(item) ? 'New arrival' : returnedText(item, now),
      out: !!item.is_checked_out,
      shelf: shelfText(item),
      players: playersText(item),
      minutes: minutesText(item),
      inList: ids.has(item.id),
      busy: busy.has(item.id),
      addLabel: ids.has(item.id) ? `Remove ${item.name} from ${list}` : `Add ${item.name} to ${list || 'a list'}`,
    }));
  });

  /**
   * Rows split into headed groups for the Just returned sort: new arrivals
   * first (the new games people are after), then real returns. Other sorts
   * are a single unheaded group. Only loaded results can be split, since
   * Tabletop.Events sorts by one field.
   */
  rowGroups = computed(() => {
    const rows = this.rows();
    if (this.filters().sort !== 'returned') {
      return [{ title: '', note: '', rows }];
    }
    return [
      { title: 'New to the library', note: 'Just added by library staff, not returned by a player.', rows: rows.filter(r => r.isNew) },
      { title: 'Checked back in · newest first', note: '', rows: rows.filter(r => !r.isNew) },
    ].filter(group => group.rows.length);
  });

  /**
   * Recently viewed games, shown above the results while the search box is
   * empty. Uses the last known details instantly and marks each "Checking…"
   * until its fresh status arrives (see checkRecent).
   */
  recentRows = computed(() => {
    if (this.filters().query) return [];
    const now = this.now();
    const checked = this.recentChecked();
    return this.recent.games().map(({ item, viewedAt }) => {
      const ago = now - viewedAt;
      return {
        item,
        checking: !checked.has(item.id),
        status: statusText(item, now),
        out: !!item.is_checked_out,
        shelf: shelfText(item),
        when: ago < 60_000 ? 'just now' : `${shortDuration(ago)} ago`,
      };
    });
  });

  /** BGG.CON Hot Games matching the search; shown as cards above the results. */
  hotMatches = computed(() => matchHotGames(this.filters().query, this.now()));

  ngOnInit(): void {
    this.requests.pipe(
      switchMap(({ page, append }) => {
        (append ? this.loadingMore : this.loading).set(true);
        this.loadError.set(false);
        const f = this.filters();
        const search: LibrarySearch = {
          query: f.query, page, pageSize: PAGE_SIZE, availableOnly: f.availableOnly,
          players: f.players, playTime: f.playTime, sort: f.sort,
        };
        return this.bggService.searchLibrary(search).pipe(
          map(data => ({ data, page, append, error: null as unknown })),
          // Inside switchMap so one failed request doesn't end the stream.
          catchError(error => of({ data: null, page, append, error }))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(({ data, page, append, error }) => {
      this.loading.set(false);
      this.loadingMore.set(false);
      if (error || !data) {
        console.error('Failed to load library games', error);
        if (append) {
          this.toast.error("Couldn't load more games. Check your connection.");
        } else {
          this.loadError.set(true);
          this.items.set([]);
        }
        return;
      }
      const newItems = data.result?.items || [];
      this.page = page;
      this.total.set(Number(data.result?.paging?.total_items) || 0);
      this.items.set(append ? [...this.items(), ...newItems] : newItems);
    });

    // Signed-in user's lists. switchMap drops the previous user's listeners on
    // sign-in/out; takeUntilDestroyed closes them when the page is left.
    this.userService.checkAuth().pipe(
      switchMap((user: any) => {
        this.signedIn.set(!!user);
        this.uid.set(user?.uid);
        if (!user) {
          this.lists.set([]);
          this.setCurrentList(undefined);
          return EMPTY;
        }
        return merge(
          this.userService.fetchUser(user.uid).pipe(ignoreElements()),
          this.userService.fetchUserGameLists(user.uid)
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(lists => {
      this.lists.set(lists || []);
      this.setCurrentList(this.userService.getCurrentGameList());
    });

    // Live ids of the games in the current list (for the +/check buttons).
    this.currentListId$.pipe(
      switchMap(id => id ? this.gameService.watchGameList(id).pipe(catchError(() => of(undefined))) : of(undefined)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(list => {
      this.listGameIds.set(new Set((list?.gameList || []).map(g => g.id!).filter(Boolean)));
    });

    if (this.items().length === 0) {
      this.search();
    } else {
      // Coming back from another tab: show the saved results where they were.
      setTimeout(() => window.scrollTo(0, this.saved.scrollY));
    }
    this.checkRecent();
    this.openSharedGame();
    // Small file (shelf names and sizes); the shelf picker needs it.
    this.shelfService.index().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(index => this.shelfIndex.set(index));
  }

  /**
   * Re-checks the status of recently viewed games (one small request each,
   * at most 8). Skipped if done in the last minute, so switching tabs back and
   * forth doesn't repeat it.
   */
  private checkRecent(): void {
    const games = this.recent.games();
    if (!games.length || Date.now() - this.recentCheckedAt < 60_000) return;
    this.recentCheckedAt = Date.now();
    from(games.map(g => g.item.id)).pipe(
      mergeMap(id => this.bggService.getBggGameInfo(id).pipe(catchError(() => of(null))), 4),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((response: any) => {
      const item = response?.result as BggItem | undefined;
      if (item?.id) {
        this.recent.refresh(item);
        this.recentChecked.update(ids => new Set(ids).add(item.id));
      }
    });
  }

  /**
   * A link shared from a game's details ends in ?game=<id>; open that game's
   * details, then drop the parameter so a reload doesn't reopen it.
   */
  private openSharedGame(): void {
    const id = this.route.snapshot.queryParamMap.get('game');
    if (!id) return;
    this.router.navigate([], { queryParams: { game: null }, queryParamsHandling: 'merge', replaceUrl: true });
    this.bggService.getBggGameInfo(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response: any) => { if (response?.result?.id) this.openDetails(response.result); },
      error: () => this.toast.error("Couldn't open the shared game. Check your connection."),
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    clearTimeout(this.debounceTimer);
    Object.assign(this.saved, {
      filters: this.filters(), items: this.items(), page: this.page, total: this.total(), scrollY: window.scrollY,
    });
  }

  private setCurrentList(list: UserGameListRef | undefined): void {
    this.currentList.set(list);
    if (this.currentListId$.value !== list?.id) {
      this.currentListId$.next(list?.id);
    }
  }

  // ---------- Search and filters ----------

  search(): void {
    clearTimeout(this.debounceTimer);
    window.scrollTo(0, 0);
    // Browsing a shelf filters on the phone (ShelfListComponent), so there's nothing to ask
    // Tabletop.Events; the normal results reload when the shelf is cleared.
    if (this.filters().shelf) return;
    this.requests.next({ page: 1, append: false });
  }

  /** Picking a shelf (or null for the whole library again). */
  setShelf(shelf: string | null): void {
    this.sheet.set(null);
    if (shelf === this.filters().shelf) return;
    this.filters.update(f => ({ ...f, shelf }));
    window.scrollTo(0, 0);
    // Back to the whole library: reload its results with the current search and filters.
    if (!shelf) this.search();
  }

  loadMore(): void {
    if (!this.loadingMore()) {
      this.requests.next({ page: this.page + 1, append: true });
    }
  }

  onQuery(value: string): void {
    const query = value.trim();
    if (query === this.filters().query) {
      return; // e.g. only a trailing space was typed
    }
    this.filters.update(f => ({ ...f, query }));
    // Waits for a pause in typing so every letter doesn't send a request.
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.search(), SEARCH_DEBOUNCE_MS);
  }

  clearQuery(input: HTMLInputElement): void {
    input.value = '';
    this.filters.update(f => ({ ...f, query: '' }));
    this.search();
    this.checkRecent();
    input.focus();
  }

  toggleAvailable(): void {
    this.filters.update(f => ({ ...f, availableOnly: !f.availableOnly }));
    this.search();
  }

  setPlayers(players: number | null): void {
    this.filters.update(f => ({ ...f, players }));
    this.sheet.set(null);
    this.search();
  }

  setPlayTime(playTime: PlayTimeFilter | null): void {
    this.filters.update(f => ({ ...f, playTime }));
    this.sheet.set(null);
    this.search();
  }

  setSort(sort: LibrarySort): void {
    this.sheet.set(null);
    if (sort !== this.filters().sort) {
      this.filters.update(f => ({ ...f, sort }));
      this.search();
    }
  }

  clearAll(input: HTMLInputElement): void {
    input.value = '';
    this.filters.set({ ...DEFAULT_FILTERS, sort: this.filters().sort });
    this.search();
  }

  // ---------- Details and lists ----------

  openDetails(item: BggItem): void {
    this.selected.set(item);
    this.sheet.set('details');
    this.recent.add(item);
    // Just opened, so its details are current: no "Checking…" for it.
    this.recentChecked.update(ids => new Set(ids).add(item.id));
  }

  isInList(item: BggItem): boolean {
    return this.listGameIds().has(item.id);
  }

  /** The + / check button and the details sheet's main button. */
  toggleGame(item: BggItem): void {
    if (!this.signedIn()) {
      this.sheet.set(null);
      this.toast.show({
        text: 'Sign in to save games to a list',
        actionLabel: 'Sign in',
        action: () => this.router.navigate(['/login'], { queryParams: { redirectUrl: '/library/home' } }),
      });
      return;
    }
    const list = this.currentList();
    if (!list) {
      this.pendingAdd = item;
      this.sheet.set('lists');
      return;
    }
    if (this.isInList(item)) {
      this.removeGame(item, list, true);
    } else {
      this.addGame(item, list, true);
    }
  }

  private setBusy(id: string, busy: boolean): void {
    this.busyIds.update(ids => {
      const next = new Set(ids);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  }

  private addGame(item: BggItem, list: UserGameListRef, offerUndo: boolean): void {
    this.setBusy(item.id, true);
    this.gameService.addGameToList(list.id, { bgg_id: item.bgg_id, name: item.name, photo: item.bgg_icon_uri, id: item.id })
      .then(() => {
        this.listGameIds.update(ids => new Set(ids).add(item.id));
        if (offerUndo) {
          this.toast.show({ text: `Added to ${list.name}`, actionLabel: 'Undo', action: () => this.removeGame(item, list, false) });
        }
      })
      .catch(err => {
        console.error('Failed to add game to list', err);
        // Adding uses a Firestore transaction, which needs a connection.
        this.toast.error(navigator.onLine ? "Couldn't add the game. Try again." : "You're offline. Adding games needs a connection.");
      })
      .finally(() => this.setBusy(item.id, false));
  }

  private removeGame(item: BggItem, list: UserGameListRef, offerUndo: boolean): void {
    this.setBusy(item.id, true);
    this.gameService.removeGamefromList(list.id, { id: item.id })
      .then(() => {
        this.listGameIds.update(ids => {
          const next = new Set(ids);
          next.delete(item.id);
          return next;
        });
        if (offerUndo) {
          this.toast.show({ text: `Removed from ${list.name}`, actionLabel: 'Undo', action: () => this.addGame(item, list, false) });
        }
      })
      .catch(err => {
        console.error('Failed to remove game from list', err);
        this.toast.error(navigator.onLine ? "Couldn't remove the game. Try again." : "You're offline. Removing games needs a connection.");
      })
      .finally(() => this.setBusy(item.id, false));
  }

  pickList(list: UserGameListRef): void {
    this.userService.setCurrentGameList(list);
    this.setCurrentList(list);
    this.sheet.set(null);
    if (this.pendingAdd) {
      const item = this.pendingAdd;
      this.pendingAdd = null;
      this.addGame(item, list, true);
    } else {
      this.toast.show({ text: `New games go to ${list.name}` });
    }
  }

  createList(name: string): void {
    this.gameService.createGameList(name)
      .then(id => this.pickList({ id, name, owner: this.uid() }))
      .catch(err => {
        console.error('Failed to create list', err);
        this.toast.error("Couldn't create the list. Try again.");
      });
  }

  toggleWatch(item: BggItem): void {
    this.watch.toggle({ id: item.id, name: item.name, shelf: shelfText(item) });
  }

  closeSheet(): void {
    this.pendingAdd = null;
    this.sheet.set(null);
  }
}
