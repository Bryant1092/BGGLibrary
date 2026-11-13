import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, HostListener, inject, OnInit, QueryList, ViewChildren } from '@angular/core';
import { BggService } from '../service/bgg.service';
import { UserService } from '../service/user.service';
import { GameService } from '../service/game.service';
import { NgbdSortableHeader } from '../directive/ngbd-sortable-header.directive';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { UserGameListRef } from '../model/user-gamelist-ref.model';
import { BggItem } from '../model/bgg.model';
import { User } from '../model/user.model';
import moment from 'moment';
import { Game } from '../model/game.model';
import { ActiveService } from '../service/active.service';

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

  @ViewChildren(NgbdSortableHeader) headers!: QueryList<NgbdSortableHeader>;

  firstLoad: boolean = true;
  stopRefresh = false;

  loading: boolean = false;
  buttonLoading: Map<number, boolean> = new Map();
  bggGameMap: Map<string, BggItem> = new Map();
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
    this.userService.checkAuth().subscribe((user: any) => {
      if (user) {
        this.userSignedIn = true;
        this.userService.fetchUser(user.uid).subscribe((user: User) => {
        });
        this.userService.fetchUserGameLists(user.uid).subscribe((gameLists: any) => {
          this.userGameLists = this.userService.getCurrentUserGameLists();
          if (this.firstLoad || !this.selectListValue) {
            this.onSelected();
            this.firstLoad = false;
          }
        });
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

  getBggInfo() {
    this.bggGameMap.clear();
    let errorShown = false;
    this.filteredGameList.flat()?.forEach((game: Game) => {
      this.bggService.getBggGameInfo(game.id!).subscribe({
        next: (item: any) => {
          this.bggGameMap.set(game.id!, item.result);
        },
        error: (err) => {
          console.error(`Failed to load details for ${game.name}`, err);
          if (!errorShown) {
            errorShown = true;
            this.openAlert("Some game details couldn't load. Use Refresh List to try again.", true);
          }
        }
      });
    });
  }

  getBggGameInfo(game: Game): BggItem {
    return this.bggGameMap.get(game.id!)!;
  }

  getColSpan(): number {
    return Array.from(document?.getElementById('headerRow')?.children!).filter(el => {
      return getComputedStyle(el).display !== 'none';
    }).length;
  }

  getRowSpan(): number {
    return this.getColSpan() <= 3 ? 2 : 1;
  }

  checkIfUserGameListEmptyOrNull() {
    return !this.userGameLists || (this.userGameLists?.length || 0) < 1;
  }

  onSelected(showLoading = true, overrideSelectedListId = '') {
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
      this.getBggInfo();
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

  /** Sorts by the current column, handling numeric fields (like is_checked_out) and ties by name. */
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
    let timezone = moment.tz.guess();
    if (datetime == null){ return ""; }
    var date = moment.tz(datetime, 'UTC');
    if (timezone != null) {
        date = date.tz(timezone);
    }
    return date.fromNow();
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

  gameExistsInList(game: Game) {
    return this.filteredGameList.flat()?.some(g => g.id === game.id);
  }

  removeGameFromList(index: number, game: Game) {
    this.buttonLoading.set(index, true);
    this.gameService.removeGamefromList(this.selectListValue, {
      bgg_id: game?.bgg_id,
      name: game?.name,
      photo: game?.photo,
      id: game?.id
    }).then(() => {
      this.onSelected(false);
      setTimeout(() => {
        this.buttonLoading.delete(index);
      }, 200);
    }).catch(err => {
      console.error('Failed to remove game from list', err);
      this.buttonLoading.delete(index);
      this.openAlert("Couldn't remove the game. Check your connection and try again.", true);
    });
  }

  chunkFilteredList(newList: Game[]) {
    this.filteredGameList = !!newList && newList.length > 0 ? this.chunk(newList, this.pageSize) : [[]];
  }

  filterList() {
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

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    document.querySelectorAll('.dynamic-rowspan').forEach(el => {
      el.setAttribute('rowspan', this.getRowSpan().toString());
    });
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
    this.startFetch(200, false, true);
  }

  set pageSize(pageSize: number) {
    this._pageNumber = 1;
    this._pageSize = pageSize;
    this.startFetch(200, true, true);
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
