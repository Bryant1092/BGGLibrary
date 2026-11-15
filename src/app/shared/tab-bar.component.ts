import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ConInfoService } from '../service/con-info.service';
import { IconComponent } from './icon.component';

/**
 * Bottom navigation (Library / My Lists / Events / Account), replacing the top navbar
 * and its hamburger menu. With only four places to go, tabs keep them one tap
 * away and within thumb reach on a phone, which is how both iOS and Android
 * apps place top-level navigation (both allow up to 5 tabs).
 *
 * Events shows the number of unread BGG news posts. A number rather than a dot,
 * because the count itself is the information ("2" = you missed a day), Apple
 * says tab badges should count unread items and clear once they're viewed, and
 * a number doesn't depend on color alone. It's the only badge on the bar, so
 * dots and numbers are never mixed. Capped at "9+" so it stays a small pill.
 */
@Component({
  selector: 'app-tab-bar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="bl-tabbar" aria-label="Main">
      <a routerLink="/library/home" routerLinkActive="active" ariaCurrentWhenActive="page">
        <bl-icon name="grid" [size]="24" />Library
      </a>
      <a routerLink="/library/user" routerLinkActive="active" ariaCurrentWhenActive="page">
        <bl-icon name="list" [size]="24" />My Lists
      </a>
      <!-- The visible number is hidden from screen readers; the link's label says it in words instead. -->
      <a routerLink="/events" routerLinkActive="active" ariaCurrentWhenActive="page" [attr.aria-label]="eventsLabel()">
        <span class="bl-tab-icon">
          <bl-icon name="calendar" [size]="24" />
          @if (unread()) { <span class="bl-count" aria-hidden="true">{{ unread() > 9 ? '9+' : unread() }}</span> }
        </span>
        Events
      </a>
      <a routerLink="/account" routerLinkActive="active" ariaCurrentWhenActive="page">
        <bl-icon name="user" [size]="24" />Account
      </a>
    </nav>
  `,
})
export class TabBarComponent {
  private info = inject(ConInfoService);
  unread = this.info.unreadCount;
  eventsLabel = computed(() => {
    const n = this.unread();
    return n ? `Events, ${n} unread news ${n === 1 ? 'post' : 'posts'}` : null;
  });
}
