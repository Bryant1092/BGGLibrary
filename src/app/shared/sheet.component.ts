import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener, input, OnDestroy, output, viewChild } from '@angular/core';

/** Sheets currently open, oldest first. Only the last one is "on top". */
const openSheets: SheetComponent[] = [];

/**
 * Page scroll lock while any sheet is open.
 *
 * Why not just overflow: hidden on <body> (what this did before): iPhone Safari ignores
 * it, so the page behind a sheet kept scrolling, and after the keyboard had been open
 * the sheet and the tab bar drifted with the page (reported 2026-11-16 on "Add Evan G.?").
 * Pinning <body> with position: fixed at the current scroll offset is the lock iOS
 * honours; on close the page is put back exactly where it was.
 */
let pageLock: { y: number } | null = null;

function lockPage(): void {
  if (pageLock) return;
  pageLock = { y: window.scrollY };
  Object.assign(document.body.style, { position: 'fixed', top: `-${pageLock.y}px`, left: '0', right: '0', overflow: 'hidden' });
}

function unlockPage(): void {
  if (!pageLock) return;
  const { y } = pageLock;
  pageLock = null;
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '', overflow: '' });
  // 'instant': Bootstrap sets scroll-behavior: smooth on the page, which would animate this.
  window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
}

/** iOS's own sheet curve: starts fast and settles gently, so the panel doesn't snap into place. */
const SETTLE = 'cubic-bezier(0.32, 0.72, 0, 1)';
/** Accelerates away when closing. */
const EXIT = 'cubic-bezier(0.4, 0, 1, 1)';

/**
 * Bottom sheet used for game details, filters and list actions. It replaces
 * the Bootstrap modals, which opened mid-screen and depended on Bootstrap's
 * JavaScript; a sheet slides up within thumb reach and closes by swiping it
 * down, tapping the dimmed background, the Escape key, or a close button.
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
    this.listenForSwipe();
    // Stop the page behind from scrolling while a sheet is open, and move
    // toasts to the top of the screen (styles.css) so they don't cover the
    // sheet's buttons.
    lockPage();
    document.body.classList.add('bl-sheet-open');
    this.panel().nativeElement.focus({ preventScroll: true });
    if (this.animate) {
      this.scrim().nativeElement.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
      this.panel().nativeElement.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 380, easing: SETTLE });
    }
  }

  /**
   * Swipe down to close, like iPhone's own sheets.
   *
   * Why: the grab bar at the top says "drag me" on iPhone (Apple HIG, sheets), and people
   * tried it; before, only × and tapping outside closed a sheet. The panel follows the
   * finger; letting go past a third of its height, or with a quick flick down, closes it
   * (the closing slide carries on from where it was let go); otherwise it springs back.
   *
   * It never fights scrolling: the drag only starts when the sheet's content is scrolled
   * to the top and the finger moves mostly downward, so scrolling a long sheet, sideways
   * chip rows and pulling back up all work as before. × and tap-outside still work.
   */
  private swipeCleanup?: () => void;

  private listenForSwipe(): void {
    const panel = this.panel().nativeElement;
    const scrim = this.scrim().nativeElement;
    let startX = 0, startY = 0, dragging = false, ignore = false, lastY = 0, lastT = 0, speed = 0;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { ignore = true; return; }
      const t = e.touches[0];
      startX = t.clientX; startY = lastY = t.clientY; lastT = e.timeStamp;
      dragging = false; speed = 0;
      // Typing in a field, or the content isn't at its top: leave the touch to the page.
      ignore = panel.scrollTop > 0 || !!(e.target as HTMLElement).closest?.('input, textarea, select');
    };
    const onMove = (e: TouchEvent) => {
      if (ignore || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX, dy = t.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        // Sideways (chip rows) or upward (scrolling the sheet): not a close gesture.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { ignore = true; return; }
        dragging = true;
        panel.style.transition = scrim.style.transition = 'none';
      }
      e.preventDefault(); // stop the sheet's own scroll / bounce while dragging it
      const dt = e.timeStamp - lastT;
      if (dt > 0) speed = (t.clientY - lastY) / dt; // px per ms, for the flick
      lastY = t.clientY; lastT = e.timeStamp;
      const y = Math.max(0, dy);
      panel.style.transform = `translateY(${y}px)`;
      scrim.style.opacity = String(Math.max(0, 1 - y / panel.offsetHeight));
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const y = Math.max(0, lastY - startY);
      if (y > panel.offsetHeight / 3 || (speed > 0.5 && y > 20)) {
        this.closed.emit(); // playCloseAnimation continues the slide from here
        return;
      }
      // Spring back.
      const ease = this.animate ? `transform 280ms ${SETTLE}, opacity 280ms ease-out` : 'none';
      panel.style.transition = ease; scrim.style.transition = ease;
      panel.style.transform = ''; scrim.style.opacity = '';
    };

    panel.addEventListener('touchstart', onStart, { passive: true });
    // Not passive: preventDefault is what stops the sheet from scrolling while it's dragged.
    panel.addEventListener('touchmove', onMove, { passive: false });
    panel.addEventListener('touchend', onEnd);
    panel.addEventListener('touchcancel', onEnd);
    this.swipeCleanup = () => {
      panel.removeEventListener('touchstart', onStart);
      panel.removeEventListener('touchmove', onMove);
      panel.removeEventListener('touchend', onEnd);
      panel.removeEventListener('touchcancel', onEnd);
    };
  }

  ngOnDestroy(): void {
    this.swipeCleanup?.();
    if (this.animate) {
      this.playCloseAnimation();
    }
    openSheets.splice(openSheets.indexOf(this), 1);
    // Only unlock the page once the last open sheet closes.
    if (openSheets.length === 0) {
      unlockPage();
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
      copy.style.transition = 'none';
      copy.removeAttribute('id');
    }
    ghost.append(scrimCopy, panelCopy);
    document.body.append(ghost);
    panelCopy.scrollTop = panel.scrollTop;
    // After a swipe down the panel is part-way down and the background part-faded: carry on from there.
    const fromY = panel.style.transform || 'none';
    const fromOpacity = scrim.style.opacity || '1';
    scrimCopy.animate([{ opacity: fromOpacity }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
    const slide = panelCopy.animate([{ transform: fromY }, { transform: 'translateY(100%)' }], { duration: 240, easing: EXIT, fill: 'forwards' });
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
