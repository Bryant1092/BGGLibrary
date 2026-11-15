import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, input, OnDestroy, output, viewChild } from '@angular/core';

/** Sheets currently open, oldest first. Only the last one is "on top". */
const openSheets: SheetComponent[] = [];

/** iOS's own sheet curve: starts fast and settles gently, so the panel doesn't snap into place. */
const SETTLE = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** Accelerates away when closing. */
const EXIT = 'cubic-bezier(0.4, 0, 1, 1)';

/**
 * Bottom sheet used for game details, filters and list actions. It replaces
 * the Bootstrap modals, which opened mid-screen and depended on Bootstrap's
 * JavaScript; a sheet slides up within thumb reach and closes by tapping the
 * dimmed background, the Escape key, or a close button.
 *
 * Sheets can stack (e.g. the "turn on notifications?" sheet over game
 * details): each new one gets a higher z-index so its dimmed background
 * covers the sheet below, and only the top one reacts to Escape.
 *
 * Motion: the background fades while the panel slides the full height from
 * the bottom edge, and the reverse on close. It used to snap the background
 * on instantly, nudge the panel 24px and vanish with no closing motion, which
 * felt abrupt. Phones with Reduce Motion turned on skip it.
 */
@Component({
  selector: 'app-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #scrim type="button" class="bl-scrim" aria-label="Close" tabindex="-1" [style.z-index]="zIndex" (click)="closed.emit()"></button>
    <div #panel class="bl-sheet" role="dialog" aria-modal="true" [attr.aria-label]="label()" tabindex="-1" [style.z-index]="zIndex + 1">
      <div class="bl-grab" aria-hidden="true"></div>
      <ng-content />
    </div>
  `,
})
export class SheetComponent implements AfterViewInit, OnDestroy {
  label = input('');
  closed = output<void>();
  private scrim = viewChild.required<ElementRef<HTMLElement>>('scrim');
  private panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  /** Focus goes back here on close, so keyboard and screen-reader users don't lose their place. */
  private returnFocusTo = document.activeElement as HTMLElement | null;
  /** 50, 52, 54… so each stacked sheet and its background sit above the previous one. */
  readonly zIndex = 50 + openSheets.length * 2;
  private readonly animate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    && typeof Element.prototype.animate === 'function';

  constructor() {
    openSheets.push(this);
  }

  ngAfterViewInit(): void {
    // Stop the page behind from scrolling while a sheet is open, and move
    // toasts to the top of the screen (styles.css) so they don't cover the
    // sheet's buttons.
    document.body.style.overflow = 'hidden';
    document.body.classList.add('bl-sheet-open');
    this.panel().nativeElement.focus({ preventScroll: true });
    if (this.animate) {
      this.scrim().nativeElement.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
      this.panel().nativeElement.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 380, easing: SETTLE });
    }
  }

  ngOnDestroy(): void {
    if (this.animate) {
      this.playCloseAnimation();
    }
    openSheets.splice(openSheets.indexOf(this), 1);
    // Only unlock the page once the last open sheet closes.
    if (openSheets.length === 0) {
      document.body.style.overflow = '';
      document.body.classList.remove('bl-sheet-open');
    }
    this.returnFocusTo?.focus?.({ preventScroll: true });
  }

  /**
   * Sheets close by being removed from the page by whichever screen opened
   * them (after a pick, a save, the close button…), so there's no chance to
   * animate the real element. Instead a non-interactive copy is left in its
   * place and slid away, then removed. This covers every way a sheet closes.
   */
  private playCloseAnimation(): void {
    const scrim = this.scrim().nativeElement;
    const panel = this.panel().nativeElement;
    const ghost = document.createElement('div');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.setAttribute('inert', '');
    const scrimCopy = scrim.cloneNode(true) as HTMLElement;
    const panelCopy = panel.cloneNode(true) as HTMLElement;
    for (const copy of [scrimCopy, panelCopy]) {
      copy.style.pointerEvents = 'none';
      copy.removeAttribute('id');
    }
    ghost.append(scrimCopy, panelCopy);
    document.body.append(ghost);
    panelCopy.scrollTop = panel.scrollTop;
    scrimCopy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
    const slide = panelCopy.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: 240, easing: EXIT, fill: 'forwards' });
    slide.onfinish = () => ghost.remove();
    setTimeout(() => ghost.remove(), 600); // in case the animation is interrupted
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    // The full-screen map sits above sheets; Escape closes it first, not the sheet underneath.
    if (document.querySelector('app-map-viewer')) return;
    if (openSheets[openSheets.length - 1] === this) {
      this.closed.emit();
    }
  }
}
