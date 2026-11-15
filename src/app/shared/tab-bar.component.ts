import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from './icon.component';

/**
 * Bottom navigation (Library / My Lists / Events / Account), replacing the top navbar
 * and its hamburger menu. With only four places to go, tabs keep them one tap
 * away and within thumb reach on a phone, which is how both iOS and Android
 * apps place top-level navigation (both allow up to 5 tabs).
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
      <a routerLink="/events" routerLinkActive="active" ariaCurrentWhenActive="page">
        <bl-icon name="calendar" [size]="24" />Events
      </a>
      <a routerLink="/account" routerLinkActive="active" ariaCurrentWhenActive="page">
        <bl-icon name="user" [size]="24" />Account
      </a>
    </nav>
  `,
})
export class TabBarComponent {}
