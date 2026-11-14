import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

/**
 * Game thumbnail with a fallback tile.
 *
 * Some games have no thumbnail in Tabletop.Events (bgg_icon_uri is null),
 * mostly recent additions: 14 of the newest 100 in Nov 2026. Others can fail
 * to load, e.g. offline before the image was ever seen. Either way the browser
 * showed a broken-image icon; this shows the game's first letter instead.
 */
@Component({
  selector: 'app-thumb',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: inline-flex; flex: none' },
  styles: `
    img, .fallback { background: var(--bl-field); flex: none; }
    img { object-fit: cover; }
    .fallback { display: flex; align-items: center; justify-content: center; color: var(--bl-muted); font-weight: 800; border: 1px solid var(--bl-hair); box-sizing: border-box; }
  `,
  template: `
    @if (src() && !failed()) {
      <img [src]="src()" alt="" [width]="size()" [height]="size()" [style.border-radius.px]="radius()"
           [attr.loading]="lazy() ? 'lazy' : null" decoding="async" (error)="failed.set(true)">
    } @else {
      <span class="fallback" aria-hidden="true" [style.width.px]="size()" [style.height.px]="size()"
            [style.border-radius.px]="radius()" [style.font-size.px]="size() * 0.42">{{ initial() }}</span>
    }
  `,
})
export class ThumbComponent {
  src = input<string | null | undefined>();
  name = input('');
  size = input(56);
  radius = input(10);
  /** Off-screen rows load their image only when scrolled near. */
  lazy = input(true);
  failed = signal(false);
  /** First letter or digit of the name (skipping quotes and symbols, e.g. "¡Adiós" -> "A"). */
  initial = computed(() => (this.name().match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase());
}
