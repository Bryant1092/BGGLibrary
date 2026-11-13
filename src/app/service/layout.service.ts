import { Injectable, OnDestroy, signal } from '@angular/core';

/**
 * Tracks whether the screen is narrow enough that the table hides its extra
 * columns (Player Count, Play Time, Location) and shows them in a second row.
 *
 * Previously each table row called getComputedStyle() on the header cells to
 * figure this out. Angular re-evaluates template expressions after every event
 * (each keystroke, click, timer), so that forced the browser to recalculate
 * layout once per row, over and over. matchMedia instead tells us only when
 * the breakpoint is actually crossed.
 */
@Injectable({
  providedIn: 'root'
})
export class LayoutService implements OnDestroy {
  /** Must stay in sync with the `max-width: 580px` media query that hides `.mobile-hide` in the table CSS. */
  private static readonly COMPACT_QUERY = '(max-width: 580px)';

  /** Total table columns, and how many stay visible on narrow screens. */
  private static readonly ALL_COLUMNS = 6;
  private static readonly COMPACT_COLUMNS = 3;

  private readonly mediaQuery = typeof window !== 'undefined' ? window.matchMedia(LayoutService.COMPACT_QUERY) : null;
  private readonly onChange = (event: MediaQueryListEvent) => this.isCompact.set(event.matches);

  /** A signal, so templates that read it update automatically when the breakpoint changes. */
  readonly isCompact = signal(this.mediaQuery?.matches ?? false);

  constructor() {
    this.mediaQuery?.addEventListener('change', this.onChange);
  }

  ngOnDestroy(): void {
    this.mediaQuery?.removeEventListener('change', this.onChange);
  }

  /** colspan for full-width rows (loading, empty, error). */
  colSpan(): number {
    return this.isCompact() ? LayoutService.COMPACT_COLUMNS : LayoutService.ALL_COLUMNS;
  }

  /** rowspan for the add/remove button cell, which covers the extra details row on narrow screens. */
  rowSpan(): number {
    return this.isCompact() ? 2 : 1;
  }
}
