import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { InstallService } from '../service/install.service';

/**
 * The "add to Home Screen" instructions for this phone, in one place: used by the
 * card on the Account tab and by the sheet that "Show me how" opens (Account row,
 * My Lists notifications card). Before, the steps only lived in the Account card,
 * and "Not now" hid them for good.
 */
@Component({
  selector: 'app-install-steps',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; font-size: 15px; }
    li { display: flex; gap: 10px; align-items: center; }
    .step { width: 26px; height: 26px; border-radius: 13px; background: var(--bl-accent); color: var(--bl-on-accent); font-weight: 700; font-size: 14px;
      display: flex; align-items: center; justify-content: center; flex: none; }
    p { margin: 0; color: var(--bl-muted); font-size: 13px; line-height: 18px; }
    .bl-btn { width: auto; align-self: flex-start; min-height: 44px; border-radius: 22px; padding: 0 20px; }
  `,
  template: `
    @switch (install.help()) {
      @case ('ios') {
        <ol>
          <li><span class="step">1</span><span>Tap <strong>Share</strong> in Safari's toolbar (the square with an arrow)</span></li>
          <li><span class="step">2</span><span>Scroll down, tap <strong>Add to Home Screen</strong></span></li>
          <li><span class="step">3</span><span>Tap <strong>Add</strong>, then open it from your Home Screen</span></li>
        </ol>
      }
      @case ('android-button') {
        <button type="button" class="bl-btn" (click)="install.install()">Install</button>
      }
      @case ('in-app-browser') {
        <p>This page is open inside another app, which can't add it to your home screen. Use that app's menu to open the link in Safari or Chrome, then add it from there.</p>
      }
      @case ('installed') {
        <p>It's already on your Home Screen. Open it from there.</p>
      }
      @default {
        <p>Open this page in Chrome or Safari and use the browser's menu: "Install app" or "Add to Home Screen".</p>
      }
    }
    <p>Why: notifications when games come back (iPhone only sends them to Home Screen apps), full-screen app, and your saved bells and recent games aren't cleared after a week away.</p>
  `,
})
export class InstallStepsComponent {
  install = inject(InstallService);
}
