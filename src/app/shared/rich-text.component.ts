import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { parseRichText } from '../util/rich-text';

/**
 * Shows a Tabletop.Events description with its web addresses as tappable
 * links (opening a new tab, or the browser when installed as an app) and its
 * **bold** bits in bold. Put it inside the element that sets the text style;
 * line breaks are kept by that element's `white-space: pre-line`.
 *
 * Built from segments rather than [innerHTML] so organizer text can never
 * inject markup; Angular also refuses any href that isn't a safe URL.
 */
@Component({
  selector: 'bl-rich-text',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (s of segments(); track $index) {@if (s.href) {<a class="bl-text-link" [href]="s.href" target="_blank" rel="noopener" [class.bold]="s.bold">{{ s.text }}</a>} @else if (s.bold) {<strong>{{ s.text }}</strong>} @else {<span>{{ s.text }}</span>}}`,
})
export class RichTextComponent {
  text = input('');
  protected segments = computed(() => parseRichText(this.text()));
}
