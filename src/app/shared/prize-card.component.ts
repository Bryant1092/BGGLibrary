import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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
    .won { color: var(--bl-avail-text); font-weight: 700; font-size: 14px; }
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
        @for (w of prize.wins(); track w.key) {
          <span class="won">🎉 Won: {{ w.section }}{{ w.bundle ? ' · bundle ' + w.bundle : '' }}</span>
        }
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
    </div>
  `,
})
export class PrizeCardComponent {
  prize = inject(PrizeService);
  private toast = inject(ToastService);
  editing = signal(false);

  save(value: string): void {
    this.prize.setBadge(value)
      .then(() => this.toast.show({ text: this.prize.badge() ? `Watching badge #${this.prize.badge()} for prize drawings` : 'Stopped watching prize drawings' }))
      .catch(() => this.toast.show({ text: 'Saved on this phone. Alerts with the app closed need a connection; try again later.' }));
    this.editing.set(false);
  }
}
