import { ChangeDetectionStrategy, Component, computed, model, signal } from '@angular/core';
import { PLAY_TIME_CHOICES, PLAYER_CHOICES, PlayTimeChoice, playerChoiceText, playersFilterText } from '../util/game-format';
import { IconComponent } from './icon.component';
import { SheetComponent } from './sheet.component';

/**
 * "Players" and "Play time" chips plus their pickers, for My Lists and Friends' picks.
 *
 * Why: at the convention the group picks its next game by how many people are at the
 * table and how long they have ("5 of us, about an hour"). The Library already had these
 * filters; this gives the lists the same choices and the same pickers, so they work the
 * same everywhere.
 *
 * Two-way bound (`[(players)]`, `[(playTime)]`): My Lists holds the values, so they stay
 * set when switching between My lists and Friends' picks.
 */
@Component({
  selector: 'app-play-filters',
  standalone: true,
  imports: [IconComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* margin 0: .bl-chips normally bleeds into the page header's padding. Not named .row:
       Bootstrap (loaded app-wide) stretches everything inside a .row to full width. */
    .pf-row { margin: 0; padding: 12px 16px 0; align-items: center; }
    .clear { flex: none; }
  `,
  template: `
    <div class="bl-chips pf-row" role="group" aria-label="Filter by players and play time">
      <!-- Same chips as the Library's Players / Play time. -->
      <button type="button" class="bl-chip" [class.on]="!!players()" (click)="open.set('players')">
        {{ playersLabel() }} <bl-icon name="chevronDown" [size]="14" [stroke]="2.4" />
      </button>
      <button type="button" class="bl-chip" [class.on]="!!playTime()" (click)="open.set('time')">
        {{ playTimeLabel() }} <bl-icon name="chevronDown" [size]="14" [stroke]="2.4" />
      </button>
      @if (players() || playTime()) {
        <button type="button" class="bl-link-btn clear" (click)="players.set(null); playTime.set(null)">Clear</button>
      }
    </div>

    @if (open() === 'players') {
      <app-sheet label="Players" (closed)="open.set(null)">
        <div class="bl-sheet-head">
          <h2>Players</h2>
          <button type="button" class="bl-link-btn" (click)="setPlayers(null)">Clear</button>
        </div>
        <p class="bl-sheet-note">Shows games that support this many players.</p>
        <div class="bl-option-grid" style="grid-template-columns: repeat(5, minmax(0, 1fr))">
          @for (n of playerChoices; track n) {
            <button type="button" class="bl-option" [attr.aria-pressed]="players() === n" (click)="setPlayers(n)">{{ choiceText(n) }}</button>
          }
        </div>
      </app-sheet>
    }
    @if (open() === 'time') {
      <app-sheet label="Play time" (closed)="open.set(null)">
        <div class="bl-sheet-head">
          <h2>Play time</h2>
          <button type="button" class="bl-link-btn" (click)="setPlayTime(null)">Clear</button>
        </div>
        <p class="bl-sheet-note">Goes by the longest time on the box.</p>
        <div class="bl-option-grid">
          @for (c of timeChoices; track c.value) {
            <button type="button" class="bl-option" [attr.aria-pressed]="playTime() === c.value" (click)="setPlayTime(c.value)">{{ c.label }}</button>
          }
        </div>
      </app-sheet>
    }
  `,
})
export class PlayFiltersComponent {
  players = model<number | null>(null);
  playTime = model<PlayTimeChoice | null>(null);

  readonly playerChoices = PLAYER_CHOICES;
  /** "10+" for the top choice (util/game-format.ts). */
  choiceText = playerChoiceText;
  readonly timeChoices = PLAY_TIME_CHOICES;
  open = signal<'players' | 'time' | null>(null);

  playersLabel = computed(() => {
    const p = this.players();
    return p ? playersFilterText(p) : 'Players';
  });
  playTimeLabel = computed(() => PLAY_TIME_CHOICES.find(c => c.value === this.playTime())?.label || 'Play time');

  setPlayers(n: number | null): void {
    this.players.set(n);
    this.open.set(null);
  }

  setPlayTime(t: PlayTimeChoice | null): void {
    this.playTime.set(t);
    this.open.set(null);
  }
}
