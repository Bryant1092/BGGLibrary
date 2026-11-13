import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, input, OnDestroy, output, viewChild } from '@angular/core';

/**
 * Bottom sheet used for game details, filters and list actions. It replaces
 * the Bootstrap modals, which opened mid-screen and depended on Bootstrap's
 * JavaScript; a sheet slides up within thumb reach and closes by tapping the
 * dimmed background, the Escape key, or a close button.
 */
@Component({
  selector: 'app-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="bl-scrim" aria-label="Close" tabindex="-1" (click)="closed.emit()"></button>
    <div #panel class="bl-sheet" role="dialog" aria-modal="true" [attr.aria-label]="label()" tabindex="-1">
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

  ngAfterViewInit(): void {
    // Stop the page behind from scrolling while the sheet is open, and move
    // toasts to the top of the screen (styles.css) so they don't cover the
    // sheet's buttons.
    document.body.style.overflow = 'hidden';
    document.body.classList.add('bl-sheet-open');
    this.panel().nativeElement.focus({ preventScroll: true });
  }

  ngOnDestroy(): void {
    document.body.style.overflow = '';
    document.body.classList.remove('bl-sheet-open');
    this.returnFocusTo?.focus?.({ preventScroll: true });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }
}
