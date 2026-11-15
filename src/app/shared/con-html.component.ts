import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { cleanConHtml } from '../util/con-html';

/**
 * Shows a BGG news post or info page (HTML from Tabletop.Events) in the app's
 * own type and colors.
 *
 * The HTML is first passed through cleanConHtml, a strict allowlist (see
 * util/con-html.ts), and only then trusted. Angular's default sanitizer would
 * strip the ids that the posts' "jump to section" links need.
 *
 * Those "#section" links scroll inside the sheet rather than changing the
 * page address, which would otherwise navigate the app away.
 */
@Component({
  selector: 'bl-con-html',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bl-con-html', '(click)': 'onClick($event)' },
  template: `<div [innerHTML]="safe()"></div>`,
})
export class ConHtmlComponent {
  private sanitizer = inject(DomSanitizer);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  html = input('');
  // Trusted only after cleanConHtml's allowlist has removed everything else.
  protected safe = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(cleanConHtml(this.html())));

  onClick(e: MouseEvent): void {
    const link = (e.target as Element).closest?.('a[href^="#"]');
    if (!link) return;
    e.preventDefault();
    const id = link.getAttribute('href')!.slice(1);
    const target = this.host.nativeElement.querySelector(`[id="${CSS.escape(id)}"]`);
    target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
}
