import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { IconComponent } from './icon.component';
import { dallasDateKey, formatDeadline, formatLibraryTime, prizePickupDeadline, shortDuration } from '../util/library-time';
import { PrizeService } from '../service/prize.service';
import { ToastService } from '../service/toast.service';

/**
 * Account card: your badge number for BGG's daily prize drawings. The app checks
 * BGG's winner lists for it (PrizeService) and tells you if you win; signed in with
 * notifications on, it also arrives when the app is closed.
 */
@Component({
  selector: 'app-prize-card',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: contents; }
    .pc { margin: 16px; padding: 16px; border-radius: 16px; background: var(--bl-field); display: flex; flex-direction: column; gap: 10px; }
    h2 { margin: 0; font-size: 17px; font-weight: 700; }
    p { margin: 0; color: var(--bl-muted); font-size: 14px; line-height: 20px; }
    form { display: flex; gap: 8px; }
    form .bl-input { flex: 1; min-width: 0; }
    form .bl-btn { width: auto; min-height: 48px; padding: 0 18px; flex: none; }
    .watching { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .watching strong { font-size: 16px; color: var(--bl-text); }
    .edit-actions { display: flex; gap: 24px; }
    .checked { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: var(--bl-surface); font-size: 14px; color: var(--bl-muted); }
    .checked bl-icon { color: var(--bl-avail-text); }
    .draws { display: flex; flex-direction: column; }
    .draw { display: grid; grid-template-columns: minmax(0, 1fr) 96px 14px; align-items: center; column-gap: 10px; min-height: 60px;
      padding: 8px 0; border: 0; border-bottom: 1px solid var(--bl-hair); background: none; color: inherit; font: inherit; text-align: left; width: 100%; }
    .draw .what { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .draw .what strong { font-size: 15px; }
    .draw .what span { font-size: 13px; color: var(--bl-muted); }
    .result { padding: 5px 0; border-radius: 999px; font-size: 13px; font-weight: 700; text-align: center; background: var(--bl-out-bg); color: var(--bl-out-fg); }
    .result.won { background: var(--bl-avail-bg); color: var(--bl-avail-fg); font-weight: 800; }
    .result.unchecked { background: none; border: 1px dashed var(--bl-control-border); color: var(--bl-muted); font-weight: 600; }
    .chev { color: var(--bl-muted); }
    /* Deadline and countdown in one box: one piece of information (common region). */
    .deadline { align-self: flex-start; margin-top: 6px; display: flex; align-items: flex-start; gap: 8px; padding: 7px 12px 7px 10px; border-radius: 10px;
      background: var(--bl-late-bg); color: var(--bl-late-fg); border: 1px solid var(--bl-late-border); }
    .deadline bl-icon { flex: none; margin-top: 2px; }
    .deadline .lines { display: flex; flex-direction: column; gap: 1px; font-size: 13px; line-height: 18px; color: var(--bl-late-fg); }
    .deadline .lines b { font-weight: 700; }
    .deadline .lines i { font-style: normal; font-weight: 600; opacity: .85; }
    .deadline.closed { background: var(--bl-out-bg); color: var(--bl-out-fg); border-color: transparent; }
    .deadline.closed .lines { color: var(--bl-out-fg); }
    .more { min-height: 44px; border: 0; background: none; color: var(--bl-accent-text); font: inherit; font-size: 15px; font-weight: 600; }
    .note { font-size: 13px; line-height: 18px; }
  `,
  template: `
    <div class="pc">
      <h2>🎁 Prize drawings</h2>
      <p>BGG draws prize winners every day by badge number, and you must pick up the next day or it goes to someone else. Add your badge number and we'll tell you if you win, even when the app is closed.</p>
      @if (prize.badge() && !editing()) {
        <div class="watching">
          <strong>Watching badge #{{ prize.badge() }}</strong>
          <button type="button" class="bl-link-btn" (click)="editing.set(true)">Change</button>
        </div>
      } @else {
        <form (submit)="$event.preventDefault(); save(badgeInput.value)">
          <label class="visually-hidden" for="badge-number">Your badge number</label>
          <input #badgeInput id="badge-number" class="bl-input" inputmode="numeric" autocomplete="off" maxlength="6"
                 placeholder="Badge number (on your badge)" [value]="prize.badge()">
          <button type="submit" class="bl-btn">Save</button>
        </form>
        @if (prize.badge()) {
          <!-- Cancel: back out of Change without saving (tapping Change by accident shouldn't
               require a Save). Stop watching: remove the number from this phone and the account. -->
          <div class="edit-actions">
            <button type="button" class="bl-link-btn" (click)="editing.set(false)">Cancel</button>
            <button type="button" class="bl-link-btn" (click)="save('')">Stop watching</button>
          </div>
        }
      }

      <!--
        Every drawing BGG has posted, with your result (added 2026-11-20): "No win" shows the app
        did check, instead of silence. Wins open the "You won!" sheet; on pickup day the deadline
        box counts down. The check time is when the news posts were last fetched.
      -->
      @if (prize.badge() && prize.checkedAt()) {
        <div class="checked"><bl-icon name="check" [size]="16" [stroke]="2.6" /><span>Checked {{ time(prize.checkedAt()) }} · every 15 minutes</span></div>
      }
      @if (prize.drawings().length) {
        <div class="draws">
          @for (d of shown(); track d.key) {
            @if (d.win; as w) {
              <button type="button" class="draw" (click)="prize.open(w)" [attr.aria-label]="d.section + ': you won. ' + deadlineLabel(d.postedAt)">
                <span class="what">
                  <strong>{{ d.section }}</strong>
                  <span>Posted {{ time(d.postedAt) }}{{ w.bundle ? ' · bundle ' + w.bundle : '' }}</span>
                  @if (deadline(d.postedAt); as dl) {
                    <span class="deadline" [class.closed]="dl.closed">
                      <bl-icon name="clock" [size]="16" [stroke]="2.4" />
                      <span class="lines">
                        <b>{{ dl.closed ? 'Pickup closed' : 'Pick up by ' + dl.by }}</b>
                        @if (dl.left) { <i>{{ dl.left }} left</i> }
                      </span>
                    </span>
                  }
                </span>
                <span class="result won">You won!</span>
                <bl-icon class="chev" name="chevronRight" [size]="14" [stroke]="2.6" />
              </button>
            } @else {
              <div class="draw">
                <span class="what"><strong>{{ d.section }}</strong><span>Posted {{ time(d.postedAt) }}</span></span>
                @if (prize.badge()) { <span class="result">No win</span> } @else { <span class="result unchecked">Not checked</span> }
                <span></span>
              </div>
            }
          }
          @if (prize.drawings().length > 3) {
            <button type="button" class="more" (click)="showAll.set(!showAll())">{{ showAll() ? 'Show fewer' : 'Show all ' + prize.drawings().length + ' drawings' }}</button>
          }
        </div>
        <p class="note">{{ prize.badge() ? '' : 'Add your badge number to check these drawings. ' }}Drawings BGG has posted in the con news. Winners pick up at the Prize Booth the next day before the Exhibit Hall closes, or the prize goes into the next drawing.</p>
      }
    </div>
  `,
})
export class PrizeCardComponent {
  prize = inject(PrizeService);
  private toast = inject(ToastService);
  editing = signal(false);
  showAll = signal(false);
  /** Ticks each minute for the countdown. */
  private now = signal(Date.now());
  shown = computed(() => this.showAll() ? this.prize.drawings() : this.prize.drawings().slice(0, 3));

  constructor() {
    const t = setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  time(ms: number): string {
    return formatLibraryTime(ms, this.now());
  }

  /** "5 PM today" + "6h 18m left" on pickup day; closed once it's passed; null if hours unknown. */
  deadline(postedAt: number): { by: string; left: string; closed: boolean } | null {
    const by = prizePickupDeadline(postedAt);
    if (!by) return null;
    const now = this.now();
    if (now >= by) return { by: '', left: '', closed: true };
    const today = dallasDateKey(by) === dallasDateKey(now);
    return { by: formatDeadline(by, now), left: today ? shortDuration(by - now) : '', closed: false };
  }

  deadlineLabel(postedAt: number): string {
    const d = this.deadline(postedAt);
    return !d ? '' : d.closed ? 'Pickup closed.' : `Pick up by ${d.by}${d.left ? ', ' + d.left + ' left' : ''}.`;
  }

  save(value: string): void {
    this.prize.setBadge(value)
      .then(() => this.toast.show({ text: this.prize.badge() ? `Watching badge #${this.prize.badge()} for prize drawings` : 'Stopped watching prize drawings' }))
      .catch(() => this.toast.show({ text: 'Saved on this phone. Alerts with the app closed need a connection; try again later.' }));
    this.editing.set(false);
  }
}
