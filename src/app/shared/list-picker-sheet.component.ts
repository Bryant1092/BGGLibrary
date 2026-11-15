import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UserGameListRef } from '../model/user-gamelist-ref.model';
import { SheetComponent } from './sheet.component';
import { IconComponent } from './icon.component';

/** Lists at which the search box appears. Below this it's just clutter; at 8+ a full list scrolls on a phone. */
const SEARCH_FROM = 8;

/**
 * The one way to choose a list, used by both the Library and My Lists pages.
 *
 * Before, the Library used this sheet while My Lists had a sideways row of
 * chips, so the same task worked two ways (feedback from the app's developer).
 * Chips also hide lists off-screen past ~5 and couldn't be scrolled with a
 * mouse. A sheet holds any number of lists, which matters once friends'
 * lists arrive.
 *
 * Both pages share one "current list" (UserService.setCurrentGameList): it is
 * the list My Lists shows AND the list the Library's + button adds to, so the
 * two tabs never disagree. It's remembered until changed.
 *
 * The heading, note and search box stay pinned at the top while only the lists
 * scroll, so the search box is never scrolled away.
 */
@Component({
  selector: 'app-list-picker-sheet',
  standalone: true,
  imports: [FormsModule, SheetComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* Pinned header. The sheet itself is the scroller, so sticky keeps this on top of the
       scrolling lists; top: -8px cancels the sheet's 8px top padding so nothing peeks above it. */
    .head { position: sticky; top: -8px; z-index: 1; margin: -8px -20px 0; padding: 8px 20px 4px; background: var(--bl-surface); display: flex; flex-direction: column; gap: 10px; }
    .search { position: relative; }
    .search bl-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--bl-muted); pointer-events: none; }
    .search .bl-input { padding-left: 40px; }
    .group { margin: 4px 0 0; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--bl-muted); }
    .none { margin: 8px 0; color: var(--bl-muted); }
    form { display: flex; gap: 8px; }
    form .bl-btn { min-height: 48px; flex: none; }
  `,
  template: `
    <app-sheet label="Choose a list" (closed)="closed.emit()">
      <div class="head">
        <h2>Choose a list</h2>
        <p class="bl-sheet-note">Shown in My Lists, and where the Library's + button adds games. Stays picked until you change it.</p>
        @if (lists().length >= searchFrom) {
          <div class="search">
            <bl-icon name="search" [size]="18" />
            <label class="visually-hidden" for="list-filter">Find a list</label>
            <input id="list-filter" class="bl-input" type="search" placeholder="Find a list" autocomplete="off"
                   [ngModel]="query()" (ngModelChange)="query.set($event)">
          </div>
        }
      </div>
      @if (lists().length) {
        <div>
          @for (group of groups(); track group.title) {
            <!-- Headings only when there's more than one group; "Your lists" alone says nothing. -->
            @if (groups().length > 1) { <h3 class="group">{{ group.title }}</h3> }
            @for (list of group.lists; track list.id) {
              <button type="button" class="bl-choice" [attr.aria-pressed]="list.id === currentId()" (click)="pick.emit(list)">
                <span class="bl-radio"></span>
                <span class="text">
                  <strong>{{ list.name }}</strong>
                  <small>{{ group.mine ? 'Your list' : 'Shared with you' }}</small>
                </span>
              </button>
            }
          } @empty {
            <p class="none">No lists match “{{ query().trim() }}”.</p>
          }
        </div>
      }
      <form (ngSubmit)="submit()">
        <label class="visually-hidden" for="new-list-name">New list name</label>
        <input id="new-list-name" class="bl-input" name="newListName" placeholder="New list name" autocomplete="off" maxlength="60"
               [ngModel]="newName()" (ngModelChange)="newName.set($event)">
        <button type="submit" class="bl-btn" [disabled]="!newName().trim()">Create</button>
      </form>
    </app-sheet>
  `,
})
export class ListPickerSheetComponent {
  lists = input<UserGameListRef[]>([]);
  currentId = input<string | undefined>();
  uid = input<string | undefined>();
  pick = output<UserGameListRef>();
  create = output<string>();
  closed = output<void>();
  newName = signal('');
  query = signal('');
  readonly searchFrom = SEARCH_FROM;

  /** "Your lists" then "Shared with you", each A–Z, filtered by the search box. */
  groups = computed(() => {
    const q = this.query().trim().toLocaleLowerCase();
    const uid = this.uid();
    const shown = this.lists()
      .filter(l => !q || l.name.toLocaleLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    const mine = shown.filter(l => !l.owner || l.owner === uid);
    const shared = shown.filter(l => l.owner && l.owner !== uid);
    return [
      { title: 'Your lists', mine: true, lists: mine },
      { title: 'Shared with you', mine: false, lists: shared },
    ].filter(g => g.lists.length);
  });

  submit(): void {
    const name = this.newName().trim();
    if (name) {
      this.create.emit(name);
    }
  }
}
