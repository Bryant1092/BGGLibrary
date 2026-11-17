import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { PersonBadges } from '../service/person-badges.service';

/**
 * A friend's circle: two initials on their color (PersonBadges). "You" is the orange accent.
 * Decorative (aria-hidden): every place it's used also has the person's name as text or in a label.
 */
@Component({
  selector: 'app-person-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[style.--size.px]': 'size()' },
  styles: `
    :host { display: inline-flex; flex: none; }
    .b { width: var(--size); height: var(--size); border-radius: 50%; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: calc(var(--size) * .42); letter-spacing: -.02em; line-height: 1;
      /* Each color's own darker ring in light mode (--bl-pN-edge in styles.css), so pale colors
         like yellow keep a clear outline on white pages and grey cards; none in dark mode. */
      box-shadow: inset 0 0 0 2px var(--edge, transparent); }
    .me { background: var(--bl-me-bg); color: var(--bl-me-fg); }
  `,
  template: `<span class="b" [class.me]="badge().color === 'me'" [style.background]="bg()" [style.color]="fg()" [style.--edge]="edge()">{{ badge().initials }}</span>`,
})
export class PersonBadgeComponent {
  private badges = inject(PersonBadges);
  uid = input.required<string>();
  name = input('');
  size = input(22);
  badge = computed(() => this.badges.badge(this.uid(), this.name()));
  bg = computed(() => { const c = this.badge().color; return c === 'me' ? null : `var(--bl-p${c}-bg)`; });
  fg = computed(() => { const c = this.badge().color; return c === 'me' ? null : `var(--bl-p${c}-fg)`; });
  edge = computed(() => { const c = this.badge().color; return c === 'me' ? null : `var(--bl-p${c}-edge)`; });
}
