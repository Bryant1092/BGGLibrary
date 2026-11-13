import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, DestroyRef, inject, OnInit, QueryList, ViewChildren } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, finalize, from, ignoreElements, map, merge, mergeMap, of, Subject, switchMap } from 'rxjs';
import { BggService } from '../service/bgg.service';
import { UserService } from '../service/user.service';
import { GameService } from '../service/game.service';
import { NgbdSortableHeader } from '../directive/ngbd-sortable-header.directive';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { UserGameListRef } from '../model/user-gamelist-ref.model';
import { BggItem } from '../model/bgg.model';
import { Game } from '../model/game.model';
import { ActiveService } from '../service/active.service';
import { LayoutService } from '../service/layout.service';
import { timeAgo } from '../util/time-ago';

/**
 * How many game-detail requests to send to Tabletop.Events at once. Before,
 * every game in the list was requested simultaneously (60 games = 60 parallel
 * requests), which is slow on convention wifi and unkind to TTE's server.
 */
const DETAIL_REQUEST_CONCURRENCY = 4;

@Component({
  selector: 'app-user',
  standalone: true,
  imports: [CommonModule, NgbdSortableHeader, FormsModule, NgbModule, ReactiveFormsModule],
  templateUrl: './user.component.html',
  styleUrl: './user.component.css'
})
export class UserComponent implements OnInit, AfterViewInit {
  private bggService = inject(BggService);
  private userService = inject(UserService);
  private gameService = inject(GameService);
  private activeService = inject(ActiveService);
  private destroyRef = inject(DestroyRef);
  private layout = inject(LayoutService);

  @ViewChildren(NgbdSortableHeader) headers!: QueryList<NgbdSortableHeader>;

  firstLoad: boolean = true;
  stopRefresh = false;

  loading: boolean = false;
  /** Games with a remove request in progress, keyed by game id so the spinner can't land on the wrong row. */
  buttonLoading: Set<string> = new Set();
  /**
   * TTE details (availability, players, time, location) per game id. Kept for
   * as long as this page is open, so changing pages, searching, or removing a
   * game no longer re-downloads details for every game in the list. Use
   * "Refresh List" (or leave and come back) to get fresh availability.
   */
  bggGameMap: Map<string, BggItem> = new Map();
  /** Ids queued or in flight, so overlapping loads don't request the same game twice. */
  private pendingDetailIds = new Set<string>();
  /** Ids whose detail request failed; the template stops the loading shimmer for these. */
  private failedDetailIds = new Set<string>();
  /** Each emission is a batch of game ids to fetch; see the pipeline in ngOnInit. */
  private detailRequests = new Subject<string[]>();
  userSignedIn: boolean = false;

  _searchTerm: string = '';
  _pageSize: number = 10;
  _pageNumber: number = 1;
  totalNumItems: number = 0;
  sortColumn: any;
  sortDirection: any;
  accordionItem: string = '';
  debounceTimer: any;

  newListName: string = '';
  userGameLists?: UserGameListRef[];
  currentGameList: Game[] = [];
  filteredGameList: Game[][] = [[]];
  shareEmail: string = '';
  renameList: string = '';
  showAlert: boolean = false;
  alertText: string = 'default';
  showErrorAlert: boolean = false;
  errorAlertText: string = 'default';


  ngOnInit() {
    // Game details are fetched through one stream so that:
    //  - mergeMap(..., DETAIL_REQUEST_CONCURRENCY) caps parallel requests;
    //  - catchError per request means one failure doesn't stop the others;
    //  - finalize clears the pending flag whether the request succeeds or fails;
    //  - takeUntilDestroyed cancels anything still queued when the page is left.
    let errorShownForBatch = false;
    this.detailRequests.pipe(
      mergeMap(ids => {
        errorShownForBatch = false;
        return from(ids);
      }),
      mergeMap(id => this.bggService.getBggGameInfo(id).pipe(
        map((response: any) => ({ id, item: response?.result as BggItem | undefined, error: null })),
        catchError(error => of({ id, item: undefined, error })),
        finalize(() => this.pendingDetailIds.delete(id))
      ), DETAIL_REQUEST_CONCURRENCY),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(({ id, item, error }) => {
      if (error || !item) {
        console.error(`Failed to load details for game ${id}`, error);
        this.failedDetailIds.add(id);
        // Many requests can fail together on bad wifi; show one alert, not one per game.
        if (!errorShownForBatch) {
          errorShownForBatch = true;
          this.openAlert("Some game details couldn't load. Use Refresh List to try again.", true);
        }
        return;
      }
      this.failedDetailIds.delete(id);
      this.bggGameMap.set(id, item);
    });

    // Previously nested subscribe() calls that were never unsubscribed, so each
    // visit to this page stacked more live Firestore listeners. switchMap closes
    // the previous user's listeners (including on sign-out) and
    // takeUntilDestroyed closes everything when the page is left.
    this.userService.checkAuth().pipe(
      switchMap((user: any) => {
        this.userSignedIn = !!user;
        if (!user) {
          return EMPTY;
        }
        return merge(
          // Subscribed only for its side effect of caching the profile in UserService.
          this.userService.fetchUser(user.uid).pipe(ignoreElements()),
          this.userService.fetchUserGameLists(user.uid)
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      this.userGameLists = this.userService.getCurrentUserGameLists();
      if (this.firstLoad || !this.selectListValue) {
        this.onSelected();
        this.firstLoad = false;
      }
    });
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.activeService.setActiveNavTab(2);
      let nameHeader = this.headers.find(h => h.sortable === "name");
      if (!nameHeader) return;
      nameHeader.sort.emit({ column: "name", direction: "asc" });
      nameHeader.direction = "asc";
      this.onSelected();
    }, 100);
    setTimeout(() => {
      this.onSelected();
      this.startFetch();
    }, 400);
  }

  startFetch(delay = 500, filter = false, refetchBggInfo = false) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      if (filter) {
        this.filterList();
      }
      if (refetchBggInfo) {
        this.getBggInfo();
      }
    }, delay);
  }

  /**
   * Requests TTE details for games in the selected list that aren't already
   * loaded or in flight. Details are loaded for the whole list (not just the
   * visible page) because sorting by Availability needs every game's status.
   *
   * @param force discard cached details first (used by "Refresh List" to get
   *   up-to-date availability).
   */
  getBggInfo(force = false) {
    if (force) {
      this.bggGameMap.clear();
      this.failedDetailIds.clear();
    }
    const ids = this.currentGameList
      .map(game => game.id!)
      .filter(id => !!id && !this.bggGameMap.has(id) && !this.pendingDetailIds.has(id));
    if (ids.length === 0) {
      return;
    }
    ids.forEach(id => {
      this.pendingDetailIds.add(id);
      this.failedDetailIds.delete(id);
    });
    this.detailRequests.next(ids);
  }

  /** "Refresh List" menu action: reload the list from Firestore and re-download all game details. */
  refreshList() {
    this.onSelected(true, '', true);
  }

  getBggGameInfo(game: Game): BggItem {
    return this.bggGameMap.get(game.id!)!;
  }

  /** True when this game's details failed to load, so the template shows a static placeholder instead of a loading shimmer forever. */
  detailsFailed(game: Game): boolean {
    return this.failedDetailIds.has(game.id!);
  }

  // colspan/rowspan come from LayoutService (a cached media-query signal)
  // instead of measuring header cells with getComputedStyle on every render.
  getColSpan(): number {
    return this.layout.colSpan();
  }

  getRowSpan(): number {
    return this.layout.rowSpan();
  }

  checkIfUserGameListEmptyOrNull() {
    return !this.userGameLists || (this.userGameLists?.length || 0) < 1;
  }

  onSelected(showLoading = true, overrideSelectedListId = '', forceDetailRefresh = false) {
    if (!this.selectListValue) {
      // No list left (e.g. the last one was deleted): don't keep showing its games.
      this.currentGameList = [];
      this.filterList();
      this.loading = false;
      return;
    }
    this.loading = showLoading
    this.gameService.fetchGameList(this.selectListValue).then(data => {
      let newList = data?.gameList?.sort((a, b) => {
        return a?.name?.localeCompare(b?.name || '') || 0;
      });
      this.currentGameList = newList || [];
      this.filterList();
      // Only fetches games not already loaded, unless this is a manual refresh.
      this.getBggInfo(forceDetailRefresh);
      this.userGameLists = this.userService.getCurrentUserGameLists();
      if (overrideSelectedListId !== '') {
        this.stopRefresh = true
        this.selectListValue = overrideSelectedListId;
        this.stopRefresh = false;
      }
      setTimeout(() => {
        this.loading = false;
      }, 200)
    }).catch(err => {
      console.error('Failed to load game list', err);
      this.loading = false;
      this.openAlert("Couldn't load your list. Check your connection and use Refresh List.", true);
    });
  }

  chunk(arr: any[], size: number) {
    return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
      arr.slice(i * size, i * size + size)
    );
  }

  get currentListRef(): UserGameListRef | undefined {
    return this.userGameLists?.find(list => list.id === this.selectListValue);
  }

  isCurrentListOwner(): boolean {
    return this.gameService.isListOwner(this.currentListRef);
  }

  /** Owners delete the list for everyone; people it was shared with only remove it from their account. */
  deleteOrLeaveSelectedList() {
    const list = this.currentListRef;
    if (!list) {
      return;
    }
    const isOwner = this.isCurrentListOwner();
    const action = isOwner
      ? this.gameService.deleteGameListAndReferences(list.id)
      : this.gameService.leaveGameList(list.id);
    action.then(() => {
      this.userGameLists = this.userGameLists?.filter(l => l.id !== list.id) || [];
      this.selectListValue = this.userGameLists[0]?.id || '';
      this.onSelected();
      this.openAlert(isOwner ? 'List deleted' : 'You left the list');
    }).catch(err => {
      console.error('Failed to delete/leave list', err);
      this.openAlert(isOwner ? "Couldn't delete the list" : "Couldn't leave the list", true);
    });
  }

  onSort({ column, direction }: any) {
		// resetting other headers
		this.headers.forEach((header) => {
			if (header.sortable !== column) {
				header.direction = '';
			}
		});
		this.sortColumn = column;
		this.sortDirection = direction;
    this.chunkFilteredList(this.sortGames(this.filteredGameList.flat()));
	}

  /**
   * Sorts by the current column using the TTE details loaded for each game.
   * The previous version called localeCompare on every value, which throws on
   * numeric fields like is_checked_out. Numbers are now compared numerically,
   * and ties (e.g. all available games) fall back to name order so the list
   * stays predictable.
   */
  private sortGames(games: Game[]): Game[] {
    const column = this.sortColumn as keyof BggItem;
    if (!column || !this.sortDirection) {
      return games;
    }
    const valueOf = (game: Game): string | number => {
      if (column === 'name') {
        return game.name || '';
      }
      const value = this.getBggGameInfo(game)?.[column];
      return typeof value === 'number' ? value : String(value ?? '');
    };
    const sign = this.sortDirection === 'desc' ? -1 : 1;
    return [...games].sort((a, b) => {
      const first = valueOf(a);
      const second = valueOf(b);
      const result = typeof first === 'number' && typeof second === 'number'
        ? first - second
        : String(first).localeCompare(String(second));
      return result !== 0 ? result * sign : (a.name || '').localeCompare(b.name || '');
    });
  }

  getAvailabilityText(item: Game): string {
    let bggItem = this.getBggGameInfo(item);
    if (bggItem.is_checked_out === 0) {
      return 'Available';
    }
    return `Checked out ${this.getLastcheckoutTime(bggItem.last_checkout_date)}`;
  }

  getLastcheckoutTime(datetime: any) {
    return timeAgo(datetime);
  }

  createNewList() {
    this.gameService.createGameList(this.newListName).then((id: string) => {
      this.selectListValue = id;
      this.newListName = '';
      this.onSelected(true, id);
    }).catch(err => {
      console.error('Failed to create list', err);
      this.openAlert("Couldn't create the list. Try again.", true);
    });
  }

  shareGameList() {
    let gameList = this.userGameLists?.find(item => item.id === this.selectListValue)!;
    this.gameService.shareGameList(gameList, this.shareEmail?.toLocaleLowerCase()).then(id => {
      if (!id || id === '') {
        console.error('Failed to share game list');
        this.openAlert("Email doesn't exist", true)
      }
      else {
        this.openAlert('Game list was successfully shared');
      }
      this.shareEmail = '';
    });
  }

  listIndex() {
    return this.pageNumber - 1;
  }

  /**
   * Called for every row on every change-detection pass. It used to flatten
   * and scan the whole filtered list each time; a Set built once per list
   * load makes it a constant-time lookup.
   */
  gameExistsInList(game: Game) {
    return this.listGameIds.has(game.id!);
  }

  private listGameIds = new Set<string>();

  removeGameFromList(game: Game) {
    this.buttonLoading.add(game.id!);
    this.gameService.removeGamefromList(this.selectListValue, {
      bgg_id: game?.bgg_id,
      name: game?.name,
      photo: game?.photo,
      id: game?.id
    }).then(() => {
      this.onSelected(false);
      setTimeout(() => {
        this.buttonLoading.delete(game.id!);
      }, 200);
    }).catch(err => {
      console.error('Failed to remove game from list', err);
      this.buttonLoading.delete(game.id!);
      this.openAlert("Couldn't remove the game. Check your connection and try again.", true);
    });
  }

  chunkFilteredList(newList: Game[]) {
    this.filteredGameList = !!newList && newList.length > 0 ? this.chunk(newList, this.pageSize) : [[]];
  }

  filterList() {
    this.listGameIds = new Set(this.currentGameList.map(game => game.id!));
    let newList = this.currentGameList.filter(g => {
      return g.name?.toLocaleLowerCase().includes(this.searchTerm.toLocaleLowerCase())
    });
    this._pageNumber = 1;
    // Keep the chosen sort while searching instead of falling back to name order.
    this.chunkFilteredList(this.sortGames(newList || []));
    this.totalNumItems = newList.length || 0;
  }

  renameGameList() {
    let gameList = this.userGameLists?.find(item => item.id === this.selectListValue)!;
    this.gameService.renameGameList(gameList, this.renameList).then(id => {
      if (!id || id === '') {
        console.error('Failed to rename game list');
        this.openAlert("Unable to rename list", true)
      }
      else {
        this.openAlert('Game list was successfully renamed');
      }
      this.renameList = '';
      this.onSelected(false, gameList.id);
    });
  }

  openAlert(text: string, error = false) {
    if (!error) {
      this.alertText = text;
      this.showAlert = true;
    } else {
      this.errorAlertText = text;
      this.showErrorAlert = true;
    }
    setTimeout(() => {
      this.showAlert = false;
      this.showErrorAlert = false;
    }, 3000);
  }

  get pageNumber() {
    return this._pageNumber;
  }

  get pageSize() {
    return this._pageSize;
  }

  get searchTerm() {
    return this._searchTerm;
  }

  // Changing page or page size used to re-download TTE details for every game
  // in the list. Details are now loaded once per list (see getBggInfo), so
  // these only need to re-slice the already-loaded list locally.
  set pageNumber(pageNumber: number) {
    this._pageNumber = pageNumber;
  }

  set pageSize(pageSize: number) {
    this._pageNumber = 1;
    this._pageSize = pageSize;
    this.startFetch(200, true);
  }

  set searchTerm(searchTerm: string) {
    const trimmed = searchTerm?.trim() || '';
    if (trimmed === this._searchTerm) {
      return;
    }
    this._searchTerm = trimmed;
    // Filtering is local, so a short delay keeps typing smooth without lag.
    this.startFetch(250, true);
  }

  get selectListValue() {
    return this.userService.getCurrentGameList()?.id || "";
  }

  set selectListValue(id: string) {
    this.userService.setCurrentGameList(this.userGameLists?.find(item => item.id === id));
  }
}
