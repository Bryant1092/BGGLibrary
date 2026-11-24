import { NewGamesService } from '../service/new-games.service';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ConInfoService } from '../service/con-info.service';
import { FriendsService } from '../service/friends.service';
import { AlertsService } from '../service/alerts.service';
import { IconComponent } from './icon.component';

/**
 * Bottom navigation (Library / My Lists / Events / Alerts / Account), replacing the top navbar
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
      <!-- Games added to the library since you last opened the New view (NewGamesService, 2026-11-23). -->
      <a routerLink="/library/home" routerLinkActive="active" ariaCurrentWhenActive="page" [attr.aria-label]="libraryLabel()">
        <span class="bl-tab-icon">
          <bl-icon name="grid" [size]="24" />
          @if (newGames()) { <span class="bl-count" aria-hidden="true">{{ newGames() > 9 ? '9+' : newGames() }}</span> }
        </span>
        Library
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
      <!-- "Game is back" alerts not seen yet (AlertsService; added 2026-11-20). Opening the tab clears it. -->
      <a routerLink="/alerts" routerLinkActive="active" ariaCurrentWhenActive="page" [attr.aria-label]="alertsLabel()">
        <span class="bl-tab-icon">
          <bl-icon name="bellOutline" [size]="24" />
          @if (alerts()) { <span class="bl-count" aria-hidden="true">{{ alerts() > 9 ? '9+' : alerts() }}</span> }
        </span>
        Alerts
      </a>
      <!-- Friend requests waiting for an answer: same number badge as Events. -->
      <a routerLink="/account" routerLinkActive="active" ariaCurrentWhenActive="page" [attr.aria-label]="accountLabel()">
        <span class="bl-tab-icon">
          <bl-icon name="user" [size]="24" />
          @if (requests()) { <span class="bl-count" aria-hidden="true">{{ requests() > 9 ? '9+' : requests() }}</span> }
        </span>
        Account
      </a>
    </nav>
  `,
})
export class TabBarComponent {
  private newGamesService = inject(NewGamesService);
  newGames = this.newGamesService.count;
  libraryLabel = computed(() => {
    const n = this.newGames();
    return n ? `Library, ${n} new ${n === 1 ? 'game' : 'games'}` : null;
  });
  constructor() { this.newGamesService.refresh(); }
  private info = inject(ConInfoService);
  unread = this.info.unreadCount;
  private friends = inject(FriendsService);
  alerts = inject(AlertsService).unseen;
  alertsLabel = computed(() => {
    const n = this.alerts();
    return n ? `Alerts, ${n} new` : null;
  });
  requests = computed(() => this.friends.incoming().length);
  accountLabel = computed(() => {
    const n = this.requests();
    return n ? `Account, ${n} friend ${n === 1 ? 'request' : 'requests'}` : null;
  });
  eventsLabel = computed(() => {
    const n = this.unread();
    return n ? `Events, ${n} unread news ${n === 1 ? 'post' : 'posts'}` : null;
  });
}
