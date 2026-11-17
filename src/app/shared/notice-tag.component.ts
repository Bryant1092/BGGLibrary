import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { gameNotice, NoticeSource } from '../util/game-notice';
import { IconComponent } from './icon.component';

/**
 * Small amber "⚠ Missing pieces" tag on a game row (next to "Hot Games"), so problem
 * copies stand out while scanning a list. The details sheet has the full note.
 *
 * Only warnings get a tag: "good to know" extras (English rules included) would just
 * add noise to every row; they're on the details sheet.
 *
 * Rows that merge several copies of a game (Friends' picks, Most played) pass all the
 * copies: when only some have the problem it says "1 of 2 copies: …", so people know a
 * complete copy exists and can check the copy number in the details.
 */
@Component({
  selector: 'app-notice-tag',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: contents; }
    .tag { display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 7px; border-radius: 11px; font-size: 12px; font-weight: 700;
      background: var(--bl-late-bg); color: var(--bl-late-fg); box-shadow: inset 0 0 0 1px var(--bl-late-border); white-space: nowrap;
      /* Don't stretch to full width when it sits on its own line (My Lists rows). */
      align-self: flex-start; }
  `,
  template: `
    @if (label(); as text) {
      <span class="tag"><bl-icon name="warning" [size]="13" [stroke]="2.4" />{{ text }}</span>
    }
  `,
})
export class NoticeTagComponent {
  /** One copy (most rows). */
  game = input<NoticeSource | null | undefined>(null);
  /** Or every copy of a merged row; copies not loaded yet are left out. */
  copies = input<(NoticeSource | null | undefined)[] | null>(null);

  label = computed(() => {
    const all = (this.copies() ?? [this.game()]).filter((g): g is NoticeSource => !!g);
    const warnings = all.map(g => gameNotice(g)).filter(n => n?.level === 'warn');
    if (!warnings.length) return '';
    const tag = warnings[0]!.tag;
    return warnings.length < all.length ? `${warnings.length} of ${all.length} copies: ${tag.toLowerCase()}` : tag;
  });
}
