import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../service/toast.service';

/** Renders ToastService's message above the tab bar. role="status" makes screen readers announce it. */
@Component({
  selector: 'app-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="status" aria-live="polite">
      @if (toast.current(); as t) {
        <div class="bl-toast" [class.error]="t.error">
          <span>{{ t.text }}</span>
          @if (t.actionLabel) {
            <button type="button" (click)="toast.runAction()">{{ t.actionLabel }}</button>
          }
        </div>
      }
    </div>
  `,
})
export class ToastComponent {
  toast = inject(ToastService);
}
