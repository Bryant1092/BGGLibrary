import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, DestroyRef, inject, OnInit, QueryList, ViewChildren } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, ignoreElements, map, merge, of, Subject, switchMap } from 'rxjs';
import { NgbdSortableHeader } from '../directive/ngbd-sortable-header.directive';
import { BggService } from '../service/bgg.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { BggItem } from '../model/bgg.model';
import { UserService } from '../service/user.service';
import { GameService } from '../service/game.service';
import { UserGameListRef } from '../model/user-gamelist-ref.model';
import { ActiveService } from '../service/active.service';
import { LayoutService } from '../service/layout.service';
import { timeAgo } from '../util/time-ago';

@Component({
  selector: 'app-table',
  standalone: true,
  imports: [CommonModule, NgbdSortableHeader, FormsModule, NgbModule, ReactiveFormsModule],
  templateUrl: './table.component.html',
  styleUrl: './table.component.css'
})
export class TableComponent implements OnInit, AfterViewInit {
  private bggService = inject(BggService);
  private userService = inject(UserService);
  private gameService = inject(GameService);
  private activeService = inject(ActiveService);
  private destroyRef = inject(DestroyRef);
  private layout = inject(LayoutService);
  /**
   * Every library fetch goes through this stream instead of calling the API
   * directly. TTE responses take 1-10s, so if each search subscribed on its
   * own, an older slow response could arrive last and overwrite the results
   * for what the user typed most recently. See the pipeline in ngOnInit.
   */
  private fetchRequests = new Subject<void>();

  @ViewChildren(NgbdSortableHeader) headers!: QueryList<NgbdSortableHeader>;

  bggData: any = {};

  items: BggItem[] = [];
  paging: any = {};

  firstLoad = true;
  stopRefresh = false;

  loading: boolean = false;
  /** True when the last library request failed, so the table shows a retry message instead of spinning forever. */
  loadError: boolean = false;
  /**
   * Games with an add/remove request in progress, keyed by game id. Keyed by
   * id rather than row index so the spinner stays on the right game even if
   * the rows re-render or reorder while the request is running.
   */
  buttonLoading: Set<string> = new Set();
  userSignedIn: boolean = false;

  _searchTerm: string = '';
  _pageSize: number = 10;
  _pageNumber: number = 1;
  sortColumn: any;
  sortDirection: any;
  accordionItem: string = '';
  debounceTimer: any;

  newListName: string = '';
  userGameLists?: UserGameListRef[];
  currentGameList?: any[] = [];
  shareEmail: string = '';
  renameList: string = '';
  showAlert: boolean = false;
  alertText: string = 'default';
  showErrorAlert: boolean = false;
  errorAlertText: string = 'default';

  constructor() {}

  ngOnInit(): void {
    // switchMap: when a new request starts, the previous in-flight HTTP call is
    //   cancelled, so only the latest search can update the table.
    // catchError is inside switchMap (not on the outer stream) so one failed
    //   request doesn't end the whole stream; the next search still works.
    // takeUntilDestroyed: unsubscribes automatically when the page is left,
    //   preventing leaks and updates to a destroyed component.
    this.fetchRequests.pipe(
      switchMap(() => {
        this.loading = true;
        this.loadError = false;
        return this.bggService.getBggLibraryInfo(this._searchTerm, this._pageNumber, this._pageSize, this.sortColumn, this.sortDirection).pipe(
          map((data: any) => ({ data, error: null })),
          catchError(error => of({ data: null, error }))
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(({ data, error }) => {
      this.loading = false;
      if (error) {
        console.error('Failed to load library games', error);
        this.loadError = true;
        this.items = [];
        return;
      }
      this.bggData = data;
      this.items = data?.result?.items || [];
      this.paging = data?.result?.paging || {};
    });

    // These were nested subscribe() calls that were never unsubscribed. Each
    // visit to this page (and each auth change) opened new live Firestore
    // listeners on top of the old ones, so the app got slower and used more
    // data/battery the longer it was open. switchMap closes the previous
    // listeners when the user changes (including sign-out), and
    // takeUntilDestroyed closes them all when the page is left.
    this.userService.checkAuth().pipe(
      switchMap((user: any) => {
        this.userSignedIn = !!user;
        if (!user) {
          return EMPTY;
        }
        return merge(
          // fetchUser is subscribed only for its side effect (it caches the
          // profile in UserService); its values aren't used here.
          this.userService.fetchUser(user.uid).pipe(ignoreElements()),
          this.userService.fetchUserGameLists(user.uid)
        );
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      this.userGameLists = this.userService.getCurrentUserGameLists();
      if (this.firstLoad) {
        this.onSelected();
        this.firstLoad = false;
      }
    });
  }

  ngAfterViewInit() {
    this.activeService.setActiveNavTab(1);
    setTimeout(() => {
      let nameHeader = this.headers.find(h => h.sortable === "name");
      if (!nameHeader) return;
      nameHeader.sort.emit({ column: "name", direction: "asc" });
      nameHeader.direction = "asc";
    }, 100);
  }

  getBggInfo() {
    this.fetchRequests.next();
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
    this.startFetch(100);
	}

  startFetch(delay = 500) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.getBggInfo();
    }, delay);
  }

  getLastcheckoutTime(datetime: any) {
    return timeAgo(datetime);
  }

  addGameToList(game: BggItem) {
    this.buttonLoading.add(game.id);
    this.gameService.addGameToList(this.selectListValue, {
      bgg_id: game?.bgg_id,
      name: game?.name,
      photo: game?.bgg_icon_uri,
      id: game?.id
    }).then((id: string) => {
      this.onSelected();
      setTimeout(() => {
        this.buttonLoading.delete(game.id);
      }, 200);
    }).catch(err => {
      console.error('Failed to add game to list', err);
      this.buttonLoading.delete(game.id);
      this.openAlert("Couldn't add the game. Check your connection and try again.", true);
    });
  }

  removeGameFromList(game: BggItem) {
    this.buttonLoading.add(game.id);
    this.gameService.removeGamefromList(this.selectListValue, {
      bgg_id: game?.bgg_id,
      name: game?.name,
      photo: game?.bgg_icon_uri,
      id: game?.id
    }).then(() => {
      this.onSelected();
      setTimeout(() => {
        this.buttonLoading.delete(game.id);
      }, 200);
    }).catch(err => {
      console.error('Failed to remove game from list', err);
      this.buttonLoading.delete(game.id);
      this.openAlert("Couldn't remove the game. Check your connection and try again.", true);
    });
  }

  createNewList() {
    this.gameService.createGameList(this.newListName).then((id: string) => {
      this.newListName = '';
      this.onSelected(id);
    }).catch(err => {
      console.error('Failed to create list', err);
      this.openAlert("Couldn't create the list. Try again.", true);
    });
  }

  checkIfUserGameListEmptyOrNull() {
    return !this.userGameLists || (this.userGameLists?.length || 0) < 1;
  }

  onSelected(overrideSelectedListId = '') {
    if (!this.selectListValue) {
      // No list left (e.g. the last one was deleted): clear stale "in list" state.
      this.setCurrentGameList([]);
      return;
    }
    if (this.stopRefresh) {
      return;
    }
    this.gameService.fetchGameList(this.selectListValue).then(data => {
      this.setCurrentGameList(data?.gameList || []);
      this.userGameLists = this.userService.getCurrentUserGameLists();
      if (overrideSelectedListId !== '') {
        this.stopRefresh = true
        this.selectListValue = overrideSelectedListId;
        this.stopRefresh = false;
      }
    }).catch(err => {
      console.error('Failed to load selected game list', err);
      this.openAlert("Couldn't load your list. Check your connection.", true);
    });
  }

  /**
   * Ids of the games in the selected list. gameExistsInList() runs for every
   * row on every change-detection pass, so a Set lookup replaces scanning the
   * whole list each time.
   */
  private listGameIds = new Set<string>();

  private setCurrentGameList(gameList: any[]) {
    this.currentGameList = gameList;
    this.listGameIds = new Set(gameList.map(game => game.id));
  }

  gameExistsInList(bggGame: BggItem) {
    return this.listGameIds.has(bggGame.id);
  }

  // colspan/rowspan now come from LayoutService (a cached media-query signal)
  // instead of measuring the header cells with getComputedStyle on every
  // render, and the window resize listener that patched the DOM is no longer
  // needed because the template reacts to the signal.
  getColSpan(): number {
    return this.layout.colSpan();
  }

  getRowSpan(): number {
    return this.layout.rowSpan();
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
      this.onSelected(gameList.id);
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

  getAvailabilityText(item: BggItem): string {
    if (item.is_checked_out === 0) {
      return 'Available';
    }
    return `Checked out ${this.getLastcheckoutTime(item.last_checkout_date)}`;
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

  set pageNumber(pageNumber: number) {
    this._pageNumber = pageNumber;
    this.startFetch(200);
  }

  set pageSize(pageSize: number) {
    this._pageSize = pageSize;
    // Page numbers mean different things at different page sizes (page 8 of 10s
    // doesn't exist at 100s), so start over at page 1.
    this._pageNumber = 1;
    this.startFetch(200);
  }

  set searchTerm(searchTerm: string) {
    const trimmed = searchTerm?.trim() || '';
    if (trimmed === this._searchTerm) {
      return; // e.g. only a trailing space was typed
    }
    this._searchTerm = trimmed;
    // New results start on page 1; staying on page 5 of an old search showed "No Games found".
    this._pageNumber = 1;
    // 350ms after the last keystroke feels responsive while still skipping a
    // request for every letter. Was 800ms, which felt laggy.
    this.startFetch(350);
  }

  get selectListValue() {
    return this.userService.getCurrentGameList()?.id || "";
  }

  set selectListValue(id: string) {
    this.userService.setCurrentGameList(this.userGameLists?.find(item => item.id === id));
  }

}
