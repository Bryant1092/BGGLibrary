import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UserGameListRef } from '../model/user-gamelist-ref.model';
import { SheetComponent } from './sheet.component';

/**
 * Chooses which list the + button adds to. The choice is remembered
 * (UserService.setCurrentGameList), so it stays "the last list you added to"
 * until changed here, rather than asking every time.
 */
@Component({
  selector: 'app-list-picker-sheet',
  standalone: true,
  imports: [FormsModule, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    form { display: flex; gap: 8px; }
    form .bl-btn { min-height: 48px; flex: none; }
  `,
  template: `
    <app-sheet label="Add games to" (closed)="closed.emit()">
      <div>
        <h2>Add games to</h2>
        <p class="bl-sheet-note">The + button adds to this list. It stays picked until you change it.</p>
      </div>
      @if (lists().length) {
        <div>
          @for (list of lists(); track list.id) {
            <button type="button" class="bl-choice" [attr.aria-pressed]="list.id === currentId()" (click)="pick.emit(list)">
              <span class="bl-radio"></span>
              <span class="text">
                <strong>{{ list.name }}</strong>
                <small>{{ !list.owner || list.owner === uid() ? 'Your list' : 'Shared with you' }}</small>
              </span>
            </button>
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

  submit(): void {
    const name = this.newName().trim();
    if (name) {
      this.create.emit(name);
    }
  }
}
