import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, HostListener, inject, OnInit, QueryList, ViewChildren } from '@angular/core';
import { NgbdSortableHeader } from '../directive/ngbd-sortable-header.directive';
import { BggService } from '../service/bgg.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import 'moment-timezone';
import moment from 'moment';
import { BggItem } from '../model/bgg.model';
import { UserService } from '../service/user.service';
import { GameService } from '../service/game.service';
import { User } from '../model/user.model';
import { UserGameListRef } from '../model/user-gamelist-ref.model';
import { ActiveService } from '../service/active.service';

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

  @ViewChildren(NgbdSortableHeader) headers!: QueryList<NgbdSortableHeader>;

  bggData: any = {};

  items: BggItem[] = [];
  paging: any = {};

  firstLoad = true;
  stopRefresh = false;

  loading: boolean = false;
  loadError: boolean = false;
  buttonLoading: Map<number, boolean> = new Map();
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
    this.userService.checkAuth().subscribe((user: any) => {
      if (user) {
        this.userSignedIn = true;
        this.userService.fetchUser(user.uid).subscribe((user: User) => {});
        this.userService.fetchUserGameLists(user.uid).subscribe((gameLists: any) => {
          this.userGameLists = this.userService.getCurrentUserGameLists();
          if (this.firstLoad) {
            this.onSelected();
            this.firstLoad = false;
          }
        });
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
    this.loading = true;
    this.loadError = false;
    this.bggService.getBggLibraryInfo(this._searchTerm, this._pageNumber, this._pageSize, this.sortColumn, this.sortDirection).subscribe({
      next: (data: any) => {
        this.loading = false;
        this.bggData = data;
        this.items = data?.result?.items || [];
        this.paging = data?.result?.paging || {};
      },
      error: (err) => {
        console.error('Failed to load library games', err);
        this.loading = false;
        this.loadError = true;
        this.items = [];
      }
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
    this.startFetch(100);
	}

  startFetch(delay = 500) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.getBggInfo();
    }, delay);
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

  addGameToList(index: number, game: BggItem) {
    this.buttonLoading.set(index, true);
    this.gameService.addGameToList(this.selectListValue, {
      bgg_id: game?.bgg_id,
      name: game?.name,
      photo: game?.bgg_icon_uri,
      id: game?.id
    }).then((id: string) => {
      this.onSelected();
      setTimeout(() => {
        this.buttonLoading.delete(index);
      }, 200);
    }).catch(err => {
      console.error('Failed to add game to list', err);
      this.buttonLoading.delete(index);
      this.openAlert("Couldn't add the game. Check your connection and try again.", true);
    });
  }

  removeGameFromList(index: number, game: BggItem) {
    this.buttonLoading.set(index, true);
    this.gameService.removeGamefromList(this.selectListValue, {
      bgg_id: game?.bgg_id,
      name: game?.name,
      photo: game?.bgg_icon_uri,
      id: game?.id
    }).then(() => {
      this.onSelected();
      setTimeout(() => {
        this.buttonLoading.delete(index);
      }, 200);
    }).catch(err => {
      console.error('Failed to remove game from list', err);
      this.buttonLoading.delete(index);
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
      this.currentGameList = [];
      return;
    }
    if (this.stopRefresh) {
      return;
    }
    this.gameService.fetchGameList(this.selectListValue).then(data => {
      this.currentGameList = data?.gameList;
      this.userGameLists = this.userService.getCurrentUserGameLists();
      if (overrideSelectedListId !== '') {
        this.stopRefresh = true
        this.selectListValue = overrideSelectedListId;
        this.stopRefresh = false;
      }
    });
  }

  gameExistsInList(bggGame: BggItem) {
    return this.currentGameList?.some(game => game.id === bggGame.id);
  }

  getColSpan(): number {
    return Array.from(document?.getElementById('headerRow')?.children!).filter(el => {
      return getComputedStyle(el).display !== 'none';
    }).length;
  }

  getRowSpan(): number {
    return this.getColSpan() <= 3 ? 2 : 1;
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    document.querySelectorAll('.dynamic-rowspan').forEach(el => {
      el.setAttribute('rowspan', this.getRowSpan().toString());
    });
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
    this.startFetch(200);
  }

  set searchTerm(searchTerm: string) {
    this._searchTerm = searchTerm?.trim();
    this.startFetch(800);
  }

  get selectListValue() {
    return this.userService.getCurrentGameList()?.id || "";
  }

  set selectListValue(id: string) {
    this.userService.setCurrentGameList(this.userGameLists?.find(item => item.id === id));
  }

}
