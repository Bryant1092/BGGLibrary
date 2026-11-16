import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Game } from '../model/game.model';
import { ReactionsService } from '../service/reactions.service';
import { ToastService } from '../service/toast.service';
import { IconComponent } from './icon.component';

/**
 * Liked it / Not for me / Want to buy for one game. Used in the "How was it?"
 * prompt after ticking Played and in the game details sheet. Tapping the chosen
 * thumb again clears it. Saved per person (ReactionsService).
 */
@Component({
  selector: 'app-rating-controls',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; }
    .thumbs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .thumbs button, .buy { min-height: 52px; border-radius: 14px; border: 1.5px solid var(--bl-control-border); background: var(--bl-surface);
      color: var(--bl-text); font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .thumbs button.up[aria-pressed="true"] { background: var(--bl-avail-bg); border-color: var(--bl-avail-bg); color: var(--bl-avail-fg); }
    .thumbs button.down[aria-pressed="true"] { background: var(--bl-out-bg); border-color: var(--bl-out-bg); color: var(--bl-out-fg); }
    .buy { justify-content: space-between; padding: 0 14px; }
    .buy span { display: flex; align-items: center; gap: 8px; }
    .buy[aria-checked="true"] { border-color: var(--bl-accent-text); }
  `,
  template: `
    <div class="thumbs" role="group" [attr.aria-label]="'How was ' + game().name + '?'">
      <button type="button" class="up" [attr.aria-pressed]="liked() === true" (click)="setLiked(true)">
        <bl-icon name="thumbUp" [size]="22" /> Liked it
      </button>
      <button type="button" class="down" [attr.aria-pressed]="liked() === false" (click)="setLiked(false)">
        <bl-icon name="thumbDown" [size]="22" /> Not for me
      </button>
    </div>
    <button type="button" class="buy" role="switch" [attr.aria-checked]="buy()" (click)="toggleBuy()">
      <span><bl-icon name="bag" [size]="22" /> Want to buy</span>
      <span class="bl-switch" aria-hidden="true"></span>
    </button>
  `,
})
export class RatingControlsComponent {
  game = input.required<Game>();
  private reactions = inject(ReactionsService);
  private toast = inject(ToastService);

  liked = computed(() => this.reactions.get(this.game().id).liked ?? null);
  buy = computed(() => !!this.reactions.get(this.game().id).buy);

  setLiked(value: boolean): void {
    this.save({ liked: this.liked() === value ? null : value });
  }

  toggleBuy(): void {
    this.save({ buy: !this.buy() });
  }

  private save(change: { liked?: boolean | null; buy?: boolean }): void {
    this.reactions.set(this.game(), change).catch(() => this.toast.error("Couldn't save that. Check your connection."));
  }
}
