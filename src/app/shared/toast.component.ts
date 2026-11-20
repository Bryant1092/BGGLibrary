import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../service/toast.service';
import { IconComponent } from './icon.component';
import { ThumbComponent } from './thumb.component';

/**
 * Renders ToastService's message above the tab bar. role="status" makes screen readers announce it.
 *
 * Can be closed early (asked 2026-11-18: some messages stay 10 s and cover the list):
 * - the × button, a 44pt tap target like the update bar's;
 * - a swipe sideways, or toward the screen edge it sits on (down above the tab bar, up when
 *   it's at the top while a sheet is open), like iPhone banners. Short drags spring back.
 */
@Component({
  selector: 'app-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ThumbComponent],
  template: `
    <div role="status" aria-live="polite">
      @if (toast.current(); as t) {
        <div class="bl-toast" [class.error]="t.error" [class.with-game]="!!t.game"
             (touchstart)="dragStart($event)" (touchmove)="dragMove($event)" (touchend)="dragEnd($event)" (touchcancel)="dragEnd($event)">
          @if (t.game; as g) {
            <app-thumb [src]="g.image" [name]="g.name" [size]="48" [radius]="10" [lazy]="false" />
            <span class="game" [attr.aria-label]="t.text">
              <strong>{{ g.name }} is back</strong>
              <small><bl-icon name="pin" [size]="14" [stroke]="2.2" /><span class="visually-hidden">Shelf</span>{{ g.shelf }}{{ g.detail ? ' · ' + g.detail : '' }}</small>
            </span>
          } @else {
            <span>{{ t.text }}</span>
          }
          @if (t.actionLabel) {
            <button type="button" (click)="toast.runAction()">{{ t.actionLabel }}</button>
          }
          <button type="button" class="x" aria-label="Dismiss" (click)="toast.dismiss()"><bl-icon name="close" [size]="18" /></button>
        </div>
      }
    </div>
  `,
})
export class ToastComponent {
  toast = inject(ToastService);

  private start: { x: number; y: number; atTop: boolean } | null = null;
  private dx = 0;
  private dy = 0;

  dragStart(e: TouchEvent): void {
    const el = e.currentTarget as HTMLElement;
    const t = e.touches[0];
    this.start = { x: t.clientX, y: t.clientY, atTop: el.getBoundingClientRect().top < window.innerHeight / 2 };
    this.dx = this.dy = 0;
    el.style.transition = 'none';
  }

  dragMove(e: TouchEvent): void {
    if (!this.start) return;
    const t = e.touches[0];
    this.dx = t.clientX - this.start.x;
    // Vertical only toward its own edge (down at the bottom, up at the top).
    const dy = t.clientY - this.start.y;
    this.dy = this.start.atTop ? Math.min(0, dy) : Math.max(0, dy);
    const sideways = Math.abs(this.dx) > Math.abs(this.dy);
    const el = e.currentTarget as HTMLElement;
    el.style.transform = sideways ? `translateX(${this.dx}px)` : `translateY(${this.dy}px)`;
    el.style.opacity = String(Math.max(0.2, 1 - Math.max(Math.abs(this.dx) / 240, Math.abs(this.dy) / 120)));
  }

  dragEnd(e: TouchEvent): void {
    if (!this.start) return;
    this.start = null;
    const el = e.currentTarget as HTMLElement;
    el.style.transition = 'transform .2s ease, opacity .2s ease';
    if (Math.abs(this.dx) > 80 || Math.abs(this.dy) > 36) {
      // Finish sliding off in the drag's direction, then close.
      el.style.transform = Math.abs(this.dx) > Math.abs(this.dy)
        ? `translateX(${Math.sign(this.dx) * window.innerWidth}px)` : `translateY(${Math.sign(this.dy) * 160}px)`;
      el.style.opacity = '0';
      setTimeout(() => this.toast.dismiss(), 180);
    } else {
      el.style.transform = '';
      el.style.opacity = '';
    }
  }
}
