import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, input, OnDestroy, output, viewChild } from '@angular/core';

/** Sheets currently open, oldest first. Only the last one is "on top". */
const openSheets: SheetComponent[] = [];

/**
 * Bottom sheet used for game details, filters and list actions. It replaces
 * the Bootstrap modals, which opened mid-screen and depended on Bootstrap's
 * JavaScript; a sheet slides up within thumb reach and closes by tapping the
 * dimmed background, the Escape key, or a close button.
 *
 * Sheets can stack (e.g. the "turn on notifications?" sheet over game
 * details): each new one gets a higher z-index so its dimmed background
 * covers the sheet below, and only the top one reacts to Escape.
 */
@Component({
  selector: 'app-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="bl-scrim" aria-label="Close" tabindex="-1" [style.z-index]="zIndex" (click)="closed.emit()"></button>
    <div #panel class="bl-sheet" role="dialog" aria-modal="true" [attr.aria-label]="label()" tabindex="-1" [style.z-index]="zIndex + 1">
      <div class="bl-grab" aria-hidden="true"></div>
      <ng-content />
    </div>
  `,
})
export class SheetComponent implements AfterViewInit, OnDestroy {
  label = input('');
  closed = output<void>();
  private panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  /** Focus goes back here on close, so keyboard and screen-reader users don't lose their place. */
  private returnFocusTo = document.activeElement as HTMLElement | null;
  /** 50, 52, 54… so each stacked sheet and its background sit above the previous one. */
  readonly zIndex = 50 + openSheets.length * 2;

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
  }

  ngOnDestroy(): void {
    openSheets.splice(openSheets.indexOf(this), 1);
    // Only unlock the page once the last open sheet closes.
    if (openSheets.length === 0) {
      document.body.style.overflow = '';
      document.body.classList.remove('bl-sheet-open');
    }
    this.returnFocusTo?.focus?.({ preventScroll: true });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (openSheets[openSheets.length - 1] === this) {
      this.closed.emit();
    }
  }
}
