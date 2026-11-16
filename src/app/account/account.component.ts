import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FriendsCardComponent } from '../shared/friends-card.component';
import { InstallStepsComponent } from '../shared/install-steps.component';
import { PrizeCardComponent } from '../shared/prize-card.component';
import { IconComponent } from '../shared/icon.component';
import { EMPTY, switchMap } from 'rxjs';
import { CONVENTIONS, LibraryDay } from '../config/conventions';
import { ThemeChoice, ThemeService } from '../service/theme.service';
import { InstallService } from '../service/install.service';
import { WatchService } from '../service/watch.service';
import { EventRemindersService, REMINDER_CHOICES } from '../service/event-reminders.service';
import { UserService } from '../service/user.service';
import { currentOrNextConvention } from '../util/library-time';

/**
 * Account tab: who's signed in and Sign out (previously in the top navbar),
 * plus the library hours for the current or next convention so they're easy
 * to check at the con.
 */
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [RouterLink, FriendsCardComponent, InstallStepsComponent, IconComponent, PrizeCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .card { margin: 16px; padding: 16px; border-radius: 16px; background: var(--bl-field); display: flex; flex-direction: column; gap: 12px; }
    .card p { margin: 0; }
    .name { font-size: 18px; font-weight: 700; }
    .muted { color: var(--bl-muted); font-size: 15px; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; font-size: 15px; }
    th { text-align: left; font-weight: 600; padding: 8px 0; }
    td { text-align: right; color: var(--bl-muted); padding: 8px 0; }
    tr + tr { border-top: 1px solid var(--bl-hair); }
    h2 { margin: 0; font-size: 17px; font-weight: 700; }
    .install { background: var(--bl-accent-soft); border: 1.5px solid var(--bl-accent-text); }
    .install img { border-radius: 10px; box-shadow: 0 1px 4px rgba(0, 0, 0, .15); flex: none; }
    .install-head { display: flex; gap: 12px; align-items: center; }
    .install ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; font-size: 15px; }
    .install li { display: flex; gap: 10px; align-items: center; }
    .step { width: 26px; height: 26px; border-radius: 13px; background: var(--bl-accent); color: var(--bl-on-accent); font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; flex: none; }
    .why { font-size: 13px; line-height: 18px; }
    .install-row { margin: 16px; width: calc(100% - 32px); display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px;
      border: 0; background: var(--bl-field); color: inherit; font: inherit; text-align: left; }
    .install-row img { border-radius: 8px; flex: none; }
    .install-row span { flex: 1; display: flex; flex-direction: column; }
    .install-row small { color: var(--bl-muted); font-size: 13px; }
    .alerts { display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: transparent; padding: 0; text-align: left; color: inherit; font: inherit; }
    .alerts > span:first-child { flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .alerts strong { font-size: 16px; }
    .alerts small { color: var(--bl-muted); font-size: 13px; line-height: 18px; }
    .segmented { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 4px; border-radius: 14px; background: var(--bl-surface); border: 1.5px solid var(--bl-control-border); }
    .segmented button { min-height: 44px; border: 0; border-radius: 10px; background: transparent; color: var(--bl-text); font-size: 15px; font-weight: 600; }
    .segmented button[aria-checked="true"] { background: var(--bl-accent); color: var(--bl-on-accent); }
  `,
  template: `
    <div class="bl-page">
      <header class="bl-header">
        <div class="bl-title-row">
          <img src="icons/icon-72x72.png" alt="" width="30" height="30">
          <h1>Account</h1>
        </div>
      </header>

      <main>
        <!--
          Install help. The full card shows until "Not now"; after that a small row keeps the
          steps one tap away (before, "Not now" hid them for good, and on iPhone they're needed
          for notifications). Nothing shows once it's installed or where it can't be installed.
        -->
        @if (install.help() !== 'installed' && install.help() !== 'none') {
          @if (!install.dismissed()) {
            <div class="card install">
              <div class="install-head">
                <img src="icons/icon-72x72.png" alt="" width="44" height="44">
                <div><p class="name">Add BGG Library to your Home Screen</p><p class="muted">{{ install.help() === 'ios' ? 'iPhone · takes 10 seconds' : 'Works offline, alerts when games return' }}</p></div>
              </div>
              <app-install-steps />
              <button type="button" class="bl-link-btn" style="align-self: flex-start" (click)="install.dismiss()">Not now</button>
            </div>
          } @else {
            <button type="button" class="install-row" (click)="install.openSteps()">
              <img src="icons/icon-72x72.png" alt="" width="32" height="32">
              <span><strong>Add to Home Screen</strong><small>For notifications and full-screen</small></span>
              <bl-icon name="chevronRight" [size]="18" />
            </button>
          }
        }
        <div class="card">
          @if (signedIn()) {
            <div>
              <p class="name">{{ displayName() || 'Signed in' }}</p>
              <p class="muted">{{ email() }}</p>
            </div>
            <button type="button" class="bl-btn secondary" (click)="signOut()">Sign out</button>
          } @else if (sharedCode) {
            <!-- Opened a friend's share link while signed out: sign in, then come back to "Add …?". -->
            <p>A friend shared their Meeple code ({{ sharedCode }}). Sign in or sign up to add them.</p>
            <a class="bl-btn" routerLink="/login" [queryParams]="{ redirectUrl: '/account?meeple=' + sharedCode }" style="text-decoration: none">Sign in or sign up</a>
          } @else {
            <p>Sign in to save games to lists and share them with friends.</p>
            <a class="bl-btn" routerLink="/login" [queryParams]="{ redirectUrl: '/library/user' }" style="text-decoration: none">Sign in or sign up</a>
          }
        </div>

        @if (signedIn()) {
          <app-friends-card />
        }

        @if (signedIn()) {
          <!-- Automatic bells for list games (WatchService.autoWatch); on by default. -->
          <div class="card">
            <button type="button" class="alerts" role="switch" [attr.aria-checked]="watch.autoAlerts()" (click)="watch.setAutoAlerts(!watch.autoAlerts())">
              <span><strong>Alerts for games on my lists</strong>
                <small>When a game on your lists is checked out, we'll tell you when it's back. Tap a game's bell to skip just that one.</small></span>
              <span class="bl-switch" aria-hidden="true"></span>
            </button>
          </div>
          <!--
            Reminder time for starred events (EventRemindersService). Apple asks apps to let
            people manage their notifications in the app; Off turns these reminders off.
          -->
          <div class="card">
            <h2 id="event-reminders-label">Reminders for starred events</h2>
            <div class="segmented" role="radiogroup" aria-labelledby="event-reminders-label">
              @for (m of reminderChoices; track m) {
                <button type="button" role="radio" [attr.aria-checked]="reminders.leadMin() === m" (click)="reminders.setLead(m)">
                  {{ m ? m + ' min' : 'Off' }}
                </button>
              }
            </div>
            <p class="muted" style="font-size: 14px">A notification this long before each event you star, even when the app is closed.</p>
          </div>
        }

        <!-- Badge number for BGG's daily prize drawings (works signed out too, on this phone). -->
        <app-prize-card />

        <!-- Appearance lives here, not on the Library screen: it's set once and rarely changed. -->
        <div class="card">
          <h2 id="appearance-label">Appearance</h2>
          <div class="segmented" role="radiogroup" aria-labelledby="appearance-label">
            @for (option of themeOptions; track option.value) {
              <button type="button" role="radio" [attr.aria-checked]="theme.choice() === option.value" (click)="theme.set(option.value)">
                {{ option.label }}
              </button>
            }
          </div>
          <p class="muted" style="font-size: 14px">Auto follows your phone's light/dark setting.</p>
        </div>

        @if (convention(); as c) {
          <div class="card">
            <h2>{{ c.name }} library hours</h2>
            <table>
              @for (day of c.days; track day.date) {
                <tr><th scope="row">{{ dayName(day) }}</th><td>{{ hours(day) }}</td></tr>
              }
            </table>
            <p class="muted">New games (blue barcode) are due in 4 hours; others in 8. Midnight to 8 AM doesn't count.</p>
          </div>
        }
      </main>
    </div>
  `,
})
export class AccountComponent implements OnInit {
  private userService = inject(UserService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  /** Meeple code from a friend's share link (…/account?meeple=MEEP-7K4Q), for the signed-out message. */
  readonly sharedCode = inject(ActivatedRoute).snapshot.queryParamMap.get('meeple');
  theme = inject(ThemeService);
  install = inject(InstallService);
  watch = inject(WatchService);
  reminders = inject(EventRemindersService);
  readonly reminderChoices = REMINDER_CHOICES;

  readonly themeOptions: { value: ThemeChoice; label: string }[] = [
    // "Auto" rather than "Match phone", which wrapped onto two lines at phone width.
    { value: 'system', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  signedIn = signal(false);
  displayName = signal('');
  email = signal('');
  convention = computed(() => currentOrNextConvention() ?? CONVENTIONS[CONVENTIONS.length - 1]);

  ngOnInit(): void {
    this.userService.checkAuth().pipe(
      switchMap((user: any) => {
        this.signedIn.set(!!user);
        this.email.set(user?.email || '');
        return user ? this.userService.fetchUser(user.uid) : EMPTY;
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(profile => {
      // Last name can be empty (e.g. one-word Google names); avoid showing "Cher undefined".
      this.displayName.set(`${profile?.firstName || ''} ${profile?.lastName || ''}`.trim().normalize());
    });
  }

  dayName(day: LibraryDay): string {
    const [y, m, d] = day.date.split('-').map(Number);
    // Noon UTC keeps the calendar date the same in every US time zone.
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  hours(day: LibraryDay): string {
    const label = (t: string) => {
      const [h, mi] = t.split(':').map(Number);
      if (h === 24 || h === 0) return 'midnight';
      const suffix = h >= 12 ? 'PM' : 'AM';
      return `${h % 12 || 12}${mi ? ':' + String(mi).padStart(2, '0') : ''} ${suffix}`;
    };
    return `${label(day.open)} – ${label(day.close)}`;
  }

  signOut(): void {
    this.userService.signUserOut().then(() => this.router.navigate(['/library/home']));
  }
}
