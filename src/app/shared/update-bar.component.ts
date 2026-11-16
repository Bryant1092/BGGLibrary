import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppUpdateService } from '../service/app-update.service';
import { ConInfoService } from '../service/con-info.service';
import { IconComponent } from './icon.component';

/**
 * "A new version is ready · Update" above the tab bar (AppUpdateService).
 *
 * Stays until Update or × (no timer), like the BGG news message: it's something to act
 * on. Never reloads by itself, so nobody loses what they were doing. Hidden while
 * typing (.bl-typing, styles.css) and while the news message is up, which sits in
 * the same spot; it shows once that's closed.
 */
@Component({
  selector: 'app-update-bar',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <div class="bl-toast bl-update-bar" role="status">
        <span>A new version of the app is ready.</span>
        <button type="button" (click)="updates.update()">Update</button>
        <button type="button" class="close" aria-label="Not now" (click)="updates.dismissed.set(true)"><bl-icon name="close" [size]="18" /></button>
      </div>
    }
  `,
})
export class UpdateBarComponent {
  updates = inject(AppUpdateService);
  private news = inject(ConInfoService);
  show = computed(() => this.updates.ready() && !this.updates.dismissed() && !this.news.toAnnounce().length);
}
