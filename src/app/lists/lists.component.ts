import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, Injectable, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BehaviorSubject, catchError, EMPTY, finalize, from, ignoreElements, map, merge, mergeMap, of, Subject, switchMap } from 'rxjs';
import { BggItem } from '../model/bgg.model';
import { Game } from '../model/game.model';
import { UserGameListRef } from '../model/user-gamelist-ref.model';
import { BggService } from '../service/bgg.service';
import { GameService } from '../service/game.service';
import { ToastService } from '../service/toast.service';
import { UserService } from '../service/user.service';
import { WatchService } from '../service/watch.service';
import { RecentService } from '../service/recent.service';
import { GameSheetComponent } from '../shared/game-sheet.component';
import { IconComponent } from '../shared/icon.component';
import { SheetComponent } from '../shared/sheet.component';
import { OfflineBarComponent } from '../shared/offline-bar.component';
import { ListPickerSheetComponent } from '../shared/list-picker-sheet.component';
import { ThumbComponent } from '../shared/thumb.component';
import { dueInfo, shortDuration } from '../util/library-time';
import { minutesText, playersText, shelfText, statusText } from '../util/game-format';

/**
 * How many game-detail requests to send to Tabletop.Events at once.
 * Tabletop.Events can't return several games by id in one request (tested), so
 * each game is its own ~0.3 s request. 6 at a time loads a 30-game list in
 * about 1.5 s without flooding their server.
 */
const DETAIL_REQUEST_CONCURRENCY = 6;

/** Details younger than this are reused when coming back to My Lists. */
const DETAILS_FRESH_MS = 2 * 60_000;

/**
 * Game details kept while the app is open. The page used to re-download every
 * game in the list each time you switched to the My Lists tab; now details
 * from the last 2 minutes are reused, and older ones are shown immediately
 * while fresh ones load.
 */
@Injectable({ providedIn: 'root' })
export class ListDetailsCache {
  private entries = new Map<string, { item: BggItem; at: number }>();

  items(): Map<string, BggItem> {
    return new Map([...this.entries].map(([id, entry]) => [id, entry.item]));
  }

  isFresh(id: string): boolean {
    const entry = this.entries.get(id);
    return !!entry && Date.now() - entry.at < DETAILS_FRESH_MS;
  }

  set(id: string, item: BggItem): void {
    this.entries.set(id, { item, at: Date.now() });
  }
}

type ListSheet = 'lists' | 'details' | 'actions' | 'create' | 'rename' | 'share' | 'delete' | null;

interface ListRow {
  game: Game;
  item?: BggItem;
  failed: boolean;
  shelf: string;
  longShelf: boolean;
  status: string;
  meta: string;
  dueAt: number;
}

@Component({
  selector: 'app-lists',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, SheetComponent, GameSheetComponent, OfflineBarComponent, ListPickerSheetComponent, ThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lists.component.html',
})
export class ListsComponent implements OnInit, OnDestroy {
  private bggService = inject(BggService);
  private userService = inject(UserService);
  private gameService = inject(GameService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);
  watch = inject(WatchService);
  private cache = inject(ListDetailsCache);
  private recent = inject(RecentService);

  now = signal(Date.now());
  private clock = setInterval(() => this.now.set(Date.now()), 60_000);
  /**
   * Re-checks checked-out games every 2 minutes while this page is open, so a
   * game that comes back moves to "Available now" without tapping refresh.
   * Only checked-out games are re-requested, to keep traffic small.
   */
  private outRefresh = setInterval(() => {
    if (document.visibilityState === 'visible') {
      this.refreshCheckedOut();
    }
  }, 2 * 60_000);

  uid = signal<string | undefined>(undefined);
  lists = signal<UserGameListRef[] | null>(null);
  selectedId = signal<string | undefined>(undefined);
  private selectedId$ = new BehaviorSubject<string | undefined>(undefined);
  /** Games stored in the selected list (live, so friends' changes appear). */
  games = signal<Game[] | null>(null);

  /**
   * Tabletop.Events details (availability, players, time, shelf) per game id.
   * Kept while the page is open, so switching lists or ticking Played doesn't
   * re-download them; the refresh button gets fresh availability.
   */
  details = signal<Map<string, BggItem>>(this.cache.items());
  private failedIds = signal<Set<string>>(new Set());
  private pendingIds = new Set<string>();
  private detailRequests = new Subject<string[]>();
  updatedAt = signal<number | null>(null);
  refreshing = signal(false);

  sheet = signal<ListSheet>(null);
  selectedGame = signal<{ game: Game; item: BggItem } | null>(null);
  busy = signal(false);
  formValue = signal('');

  selectedList = computed(() => this.lists()?.find(l => l.id === this.selectedId()));
  isOwner = computed(() => this.gameService.isListOwner(this.selectedList()));

  private rows = computed<ListRow[]>(() => {
    const now = this.now();
    const details = this.details();
    const failed = this.failedIds();
    return (this.games() || []).map(game => {
      const item = details.get(game.id!);
      const shelf = item ? shelfText(item) : '';
      return {
        game, item, failed: failed.has(game.id!), shelf, longShelf: shelf.length > 3,
        status: item ? statusText(item, now) : '',
        meta: item ? `${playersText(item)} players · ${minutesText(item)} min` : '',
        // Sort key for "Checked out": soonest due first; stale checkouts (likely
        // never checked back in) go last since they say nothing about when it's back.
        dueAt: (() => {
          const due = item ? dueInfo(item, now) : null;
          return !due ? Infinity : due.stale ? Number.MAX_SAFE_INTEGER : due.dueAt;
        })(),
      };
    });
  });

  /** Available games first (what you can grab now), then checked-out ones by soonest due back. */
  sections = computed(() => {
    const byName = (a: ListRow, b: ListRow) => (a.game.name || '').localeCompare(b.game.name || '');
    const rows = this.rows();
    const available = rows.filter(r => r.item && !r.item.is_checked_out).sort(byName);
    const out = rows.filter(r => r.item?.is_checked_out).sort((a, b) => a.dueAt - b.dueAt || byName(a, b));
    const unknown = rows.filter(r => !r.item).sort(byName);
    return [
      { title: `Available now · ${available.length}`, rows: available, out: false },
      { title: `Checked out · ${out.length}`, rows: out, out: true },
      { title: unknown.some(r => !r.failed) ? 'Checking availability…' : "Couldn't check availability", rows: unknown, out: false },
    ].filter(s => s.rows.length);
  });

  summary = computed(() => {
    const games = this.games() || [];
    const available = this.rows().filter(r => r.item && !r.item.is_checked_out).length;
    const count = games.length === 1 ? '1 game' : `${games.length} games`;
    return this.details().size ? `${count} · ${available} available` : count;
  });

  updatedText = computed(() => {
    const at = this.updatedAt();
    if (!at) return '';
    const ago = this.now() - at;
    return ago < 60_000 ? 'Updated just now' : `Updated ${shortDuration(ago)} ago`;
  });

  ngOnInit(): void {
    // One stream for detail requests: mergeMap caps parallel requests,
    // catchError per request keeps one failure from stopping the rest, and
    // takeUntilDestroyed cancels anything still queued when the page is left.
    this.detailRequests.pipe(
      mergeMap(ids => from(ids)),
      mergeMap(id => this.bggService.getBggGameInfo(id).pipe(
        map((response: any) => ({ id, item: response?.result as BggItem | undefined })),
        catchError(() => of({ id, item: undefined })),
        finalize(() => {
          this.pendingIds.delete(id);
          if (this.pendingIds.size === 0) {
            this.refreshing.set(false);
            this.updatedAt.set(Date.now());
          }
        })
      ), DETAIL_REQUEST_CONCURRENCY),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(({ id, item }) => {
      if (!item) {
        this.failedIds.update(s => new Set(s).add(id));
        return;
      }
      this.cache.set(id, item);
      this.details.update(m => new Map(m).set(id, item));
      this.failedIds.update(s => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    });

    this.userService.checkAuth().pipe(
      switchMap((user: any) => {
        this.uid.set(user?.uid);
        if (!user) {
          this.lists.set([]);
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
      // Keep the list being viewed if it still exists; otherwise start on the
      // list the + button adds to, so both tabs agree by default.
      const stillThere = lists?.some(l => l.id === this.selectedId());
      if (!stillThere) {
        this.select(this.userService.getCurrentGameList()?.id || lists?.[0]?.id);
      }
    });

    this.selectedId$.pipe(
      switchMap(id => id ? this.gameService.watchGameList(id).pipe(catchError(err => {
        console.error('Failed to load game list', err);
        this.toast.error("Couldn't load this list. Check your connection.");
        return of(undefined);
      })) : of(undefined)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(list => {
      this.games.set(this.selectedId() ? list?.gameList || [] : null);
      this.loadDetails();
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    clearInterval(this.outRefresh);
  }

  private refreshCheckedOut(): void {
    const ids = [...this.details().values()]
      .filter(item => item.is_checked_out && !this.pendingIds.has(item.id))
      .map(item => item.id);
    if (ids.length) {
      ids.forEach(id => this.pendingIds.add(id));
      this.detailRequests.next(ids);
    }
  }

  select(id: string | undefined): void {
    this.selectedId.set(id);
    if (this.selectedId$.value !== id) {
      this.games.set(null);
      this.selectedId$.next(id);
    }
  }

  /**
   * Picking a list here also makes it the Library's "Adding to" list: one current list for the
   * whole app, so the two tabs never show different lists.
   */
  pickList(list: UserGameListRef): void {
    this.userService.setCurrentGameList(list);
    this.select(list.id);
    this.sheet.set(null);
  }

  createList(name: string): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.gameService.createGameList(name)
      .then(id => {
        this.pickList({ id, name, owner: this.uid() });
        this.toast.show({ text: `Created ${name}` });
      })
      .catch(err => {
        console.error('Failed to create list', err);
        this.toast.error("Couldn't create the list. Check your connection and try again.");
      })
      .finally(() => this.busy.set(false));
  }

  /** Requests details for games that aren't loaded or in flight. force=true re-downloads everything (refresh button). */
  loadDetails(force = false): void {
    if (force) {
      this.failedIds.set(new Set());
    }
    const ids = (this.games() || [])
      .map(g => g.id!)
      .filter(id => !!id && !this.pendingIds.has(id) && (force || !this.cache.isFresh(id)));
    if (!ids.length) {
      return;
    }
    ids.forEach(id => this.pendingIds.add(id));
    this.refreshing.set(true);
    this.detailRequests.next(ids);
  }

  refresh(): void {
    this.loadDetails(true);
  }

  // ---------- Rows ----------

  openGame(row: ListRow): void {
    if (row.item) {
      // Counts toward the Library's "Recently viewed" too.
      this.recent.add(row.item);
      this.selectedGame.set({ game: row.game, item: row.item });
      this.sheet.set('details');
    }
  }

  toggleWatch(row: ListRow): void {
    if (row.item) {
      this.toggleWatchItem(row.item);
    }
  }

  toggleWatchItem(item: BggItem): void {
    this.watch.toggle({ id: item.id, name: item.name, shelf: shelfText(item) });
  }

  togglePlayed(game: Game): void {
    const list = this.selectedList();
    if (!list) return;
    this.gameService.setPlayed(list.id, game.id!, !game.played).catch(err => {
      console.error('Failed to update played', err);
      this.toast.error(navigator.onLine ? "Couldn't save that. Try again." : "You're offline. Changes to lists need a connection.");
    });
  }

  /** Details sheet button on this page always removes, with Undo. */
  removeSelected(): void {
    const list = this.selectedList();
    const selected = this.selectedGame();
    if (!list || !selected) return;
    this.busy.set(true);
    this.gameService.removeGamefromList(list.id, { id: selected.game.id }).then(() => {
      this.sheet.set(null);
      this.toast.show({
        text: `Removed from ${list.name}`,
        actionLabel: 'Undo',
        action: () => this.gameService.addGameToList(list.id, selected.game)
          .catch(() => this.toast.error("Couldn't put it back. Add it again from the Library.")),
      });
    }).catch(err => {
      console.error('Failed to remove game', err);
      this.toast.error(navigator.onLine ? "Couldn't remove the game. Try again." : "You're offline. Removing games needs a connection.");
    }).finally(() => this.busy.set(false));
  }

  // ---------- List actions ----------

  openForm(sheet: 'create' | 'rename' | 'share'): void {
    this.formValue.set(sheet === 'rename' ? this.selectedList()?.name || '' : '');
    this.sheet.set(sheet);
  }

  submitForm(): void {
    const value = this.formValue().trim();
    const list = this.selectedList();
    if (!value || this.busy()) return;
    this.busy.set(true);
    let action: Promise<unknown>;
    if (this.sheet() === 'create') {
      action = this.gameService.createGameList(value).then(id => {
        this.userService.setCurrentGameList({ id, name: value, owner: this.uid() });
        this.select(id);
        this.toast.show({ text: `Created ${value}` });
      });
    } else if (this.sheet() === 'rename' && list) {
      action = this.gameService.renameGameList(list, value).then(() => this.toast.show({ text: 'List renamed' }));
    } else if (this.sheet() === 'share' && list) {
      action = this.gameService.shareGameList(list, value.toLocaleLowerCase()).then(id => {
        if (!id) {
          throw new Error('no-account');
        }
        this.toast.show({ text: `Shared with ${value}` });
      });
    } else {
      action = Promise.resolve();
    }
    action.then(() => this.sheet.set(null)).catch(err => {
      console.error('List action failed', err);
      this.toast.error(err?.message === 'no-account'
        ? 'No account uses that email. They need to sign up first.'
        : "That didn't work. Check your connection and try again.");
    }).finally(() => this.busy.set(false));
  }

  /** Owners delete the list for everyone; people it was shared with only remove it from their account. */
  deleteOrLeave(): void {
    const list = this.selectedList();
    if (!list) return;
    const owner = this.isOwner();
    this.busy.set(true);
    (owner ? this.gameService.deleteGameListAndReferences(list.id) : this.gameService.leaveGameList(list.id)).then(() => {
      this.sheet.set(null);
      this.toast.show({ text: owner ? 'List deleted' : 'You left the list' });
    }).catch(err => {
      console.error('Failed to delete/leave list', err);
      this.toast.error(owner ? "Couldn't delete the list" : "Couldn't leave the list");
    }).finally(() => this.busy.set(false));
  }
}
