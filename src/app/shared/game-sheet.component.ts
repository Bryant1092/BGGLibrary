import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BggItem } from '../model/bgg.model';
import { dueInfo, formatLibraryDate, formatLibraryTime, shortDuration } from '../util/library-time';
import { bggUrl, minutesText, playersText, shelfText } from '../util/game-format';
import { IconComponent } from './icon.component';
import { SheetComponent } from './sheet.component';
import { ThumbComponent } from './thumb.component';

/**
 * Game details, opened by tapping a game. Keeps people inside the app; the
 * game name used to link straight to BoardGameGeek in a new tab, which leaves
 * the installed app on a phone.
 */
@Component({
  selector: 'app-game-sheet',
  standalone: true,
  imports: [IconComponent, SheetComponent, ThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .head { display: flex; gap: 14px; align-items: flex-start; }
    .head .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .head h2 { overflow-wrap: anywhere; }
    .head .bl-pill { align-self: flex-start; }
    .head .bl-icon-btn { margin: -6px -10px 0 0; }
    .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .tile { border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 4px; background: var(--bl-field); min-width: 0; }
    .tile.accent { background: var(--bl-accent-soft); }
    .tile small { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--bl-muted); }
    .tile.accent small { color: var(--bl-accent-text); }
    .tile strong { font-size: 20px; font-weight: 700; line-height: 24px; overflow-wrap: anywhere; }
    .due { border-radius: 14px; padding: 14px 16px; display: flex; gap: 12px; align-items: flex-start; background: var(--bl-due-bg); border: 1.5px solid var(--bl-due-border); --fg: var(--bl-due-fg); }
    .due.late { background: var(--bl-late-bg); border-color: var(--bl-late-border); --fg: var(--bl-late-fg); }
    .due > bl-icon { color: var(--fg); margin-top: 2px; }
    .due .text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .kicker { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--fg); }
    .headline { font-size: 22px; font-weight: 800; line-height: 27px; }
    .sooner { font-size: 15px; font-weight: 700; line-height: 20px; color: var(--fg); }
    .detail { font-size: 14px; line-height: 19px; color: var(--bl-muted); }
    .note { font-size: 13px; line-height: 18px; color: var(--bl-muted); }
    .bgg { min-height: 44px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 15px; font-weight: 600; text-decoration: none; color: var(--bl-accent-text); }
  `,
  template: `
    <app-sheet [label]="game().name" (closed)="closed.emit()">
      <div class="head">
        <app-thumb [src]="game().bgg_icon_uri" [name]="game().name" [size]="112" [radius]="14" [lazy]="false" />
        <div class="text">
          <h2>{{ game().name }}</h2>
          <span class="bl-pill" [class.out]="game().is_checked_out">{{ game().is_checked_out ? 'Checked out' : 'Available now' }}</span>
        </div>
        <button type="button" class="bl-icon-btn" aria-label="Close" (click)="closed.emit()"><bl-icon name="close" /></button>
      </div>

      <div class="tiles">
        <div class="tile accent"><small>Location</small><strong>{{ shelf() }}</strong></div>
        <div class="tile"><small>Players</small><strong>{{ players() }}</strong></div>
        <div class="tile"><small>Play time</small><strong>{{ minutes() }}m</strong></div>
      </div>

      @if (due(); as d) {
        <div class="due" [class.late]="d.isLate && !d.stale">
          <bl-icon name="clock" [size]="26" />
          <div class="text">
            @if (d.stale) {
              <span class="kicker">Checked out</span>
              <span class="headline">Since {{ date(d.checkedOutAt) }}</span>
              <span class="detail">That was a while ago, so it may never have been checked back in. Look on shelf {{ shelf() }} or ask at the library desk.</span>
            } @else if (d.isLate) {
              <span class="kicker">Past due</span>
              <span class="headline">Was due {{ time(d.dueAt) }}</span>
              <span class="detail">{{ checkedOutText() }} {{ d.rule }} Ask at the library desk if you're waiting on it.</span>
            } @else {
              <span class="kicker">Due back by</span>
              <span class="headline">{{ time(d.dueAt) }}</span>
              @if (d.soonerAt) {
                <span class="sooner">Often back sooner, around {{ time(d.soonerAt) }}</span>
              }
              <span class="detail">{{ checkedOutText() }} {{ d.rule }}</span>
              @if (d.cappedAtFinalClose) {
                <span class="note">The library closes for the convention at {{ d.finalCloseText }}, so everything is due by then.</span>
              } @else if (d.overnight) {
                <span class="note">The library closes at midnight. Late returns go to the hotel front desk and are checked in when it opens at 8 AM.</span>
              }
            }
          </div>
        </div>
      }

      @if (game().is_checked_out) {
        <button type="button" class="bl-btn secondary" [attr.aria-pressed]="watched()" (click)="watchToggle.emit()"
                [style.color]="watched() ? 'var(--bl-accent-text)' : null" [style.border-color]="watched() ? 'var(--bl-accent-text)' : null">
          <bl-icon [name]="watched() ? 'bell' : 'bellOff'" [size]="20" />
          {{ watched() ? "We'll tell you when it's back" : "Notify me when it's back" }}
        </button>
      }
      <button type="button" class="bl-btn" [class.secondary]="inList()" [disabled]="busy()" (click)="toggle.emit()">{{ actionLabel() }}</button>
      <a class="bgg" [href]="bgg()" target="_blank" rel="noopener">
        View on BoardGameGeek <bl-icon name="external" [size]="16" />
      </a>
    </app-sheet>
  `,
})
export class GameSheetComponent {
  game = input.required<BggItem>();
  /** Name of the list the button adds to; empty when signed out or there are no lists yet. */
  listName = input<string | undefined>();
  inList = input(false);
  busy = input(false);
  /** Current time, passed in so the page's one-minute clock keeps every time on screen in sync. */
  now = input(Date.now());
  closed = output<void>();
  /** The page decides what this means: add, remove, sign in, or pick a list first. */
  toggle = output<void>();
  /** Whether the "notify me when it's back" bell is on for this game (see WatchService). */
  watched = input(false);
  watchToggle = output<void>();

  shelf = computed(() => shelfText(this.game()));
  players = computed(() => playersText(this.game()));
  minutes = computed(() => minutesText(this.game()));
  due = computed(() => dueInfo(this.game(), this.now()));
  bgg = computed(() => bggUrl(this.game()));
  actionLabel = computed(() => {
    const list = this.listName();
    if (!list) return 'Add to a list';
    return this.inList() ? `Remove from ${list}` : `Add to ${list}`;
  });
  checkedOutText = computed(() => {
    const d = this.due();
    if (!d) return '';
    return `Checked out ${this.time(d.checkedOutAt)} (${shortDuration(this.now() - d.checkedOutAt)} ago).`;
  });

  time(ms: number): string {
    return formatLibraryTime(ms, this.now());
  }

  date(ms: number): string {
    return formatLibraryDate(ms);
  }
}
