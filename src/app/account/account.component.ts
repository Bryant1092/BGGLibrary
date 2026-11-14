import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, switchMap } from 'rxjs';
import { CONVENTIONS, LibraryDay } from '../config/conventions';
import { ThemeChoice, ThemeService } from '../service/theme.service';
import { InstallService } from '../service/install.service';
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
  imports: [RouterLink],
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
        <!-- Install help: hidden once installed, after "Not now", or where no install is possible. -->
        @if (!install.dismissed()) {
          @switch (install.help()) {
            @case ('ios') {
              <div class="card install">
                <div class="install-head">
                  <img src="icons/icon-72x72.png" alt="" width="44" height="44">
                  <div><p class="name">Add BGG Library to your Home Screen</p><p class="muted">iPhone · takes 10 seconds</p></div>
                </div>
                <ol>
                  <li><span class="step">1</span><span>Tap <strong>Share</strong> in Safari's toolbar</span></li>
                  <li><span class="step">2</span><span>Scroll down, tap <strong>Add to Home Screen</strong></span></li>
                  <li><span class="step">3</span><span>Tap <strong>Add</strong>, then open it from your Home Screen</span></li>
                </ol>
                <p class="muted why">Why: notifications when games come back, full-screen app, and iPhone won't clear your saved bells and recent games after a week away.</p>
                <button type="button" class="bl-link-btn" style="align-self: flex-start" (click)="install.dismiss()">Not now</button>
              </div>
            }
            @case ('android-button') {
              <div class="card install" style="flex-direction: row; align-items: center">
                <img src="icons/icon-72x72.png" alt="" width="40" height="40">
                <div style="flex: 1"><p class="name" style="font-size: 16px">Install BGG Library</p><p class="muted">Works offline, alerts when games return</p></div>
                <button type="button" class="bl-btn" style="min-height: 44px; border-radius: 22px" (click)="install.install()">Install</button>
              </div>
            }
            @case ('in-app-browser') {
              <div class="card install">
                <p class="name" style="font-size: 16px">Open in Safari or Chrome to install</p>
                <p class="muted">This page is open inside another app, which can't add it to your home screen. Use that app's menu to open the link in your browser.</p>
              </div>
            }
          }
        }
        <div class="card">
          @if (signedIn()) {
            <div>
              <p class="name">{{ displayName() || 'Signed in' }}</p>
              <p class="muted">{{ email() }}</p>
            </div>
            <button type="button" class="bl-btn secondary" (click)="signOut()">Sign out</button>
          } @else {
            <p>Sign in to save games to lists and share them with friends.</p>
            <a class="bl-btn" routerLink="/login" [queryParams]="{ redirectUrl: '/library/user' }" style="text-decoration: none">Sign in or sign up</a>
          }
        </div>

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
  theme = inject(ThemeService);
  install = inject(InstallService);

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
