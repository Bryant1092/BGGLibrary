import { DeskActivity } from './service/desk-activity.service';
import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { HideNavService } from './service/hide-nav.service';
import { WatchService } from './service/watch.service';
import { InstallService } from './service/install.service';
import { InstallStepsComponent } from './shared/install-steps.component';
import { PrizeWin } from './util/prize-drawing';
import { formatDeadline, prizePickupDeadline } from './util/library-time';
import { MapService } from './service/map.service';
import { ConInfoService } from './service/con-info.service';
import { FriendsService } from './service/friends.service';
import { FirestoreConnection } from './service/firestore-connection';
import { EventRemindersService } from './service/event-reminders.service';
import { ReactionsService } from './service/reactions.service';
import { PushService } from './service/push.service';
import { NotificationTapsService } from './service/notification-taps.service';
import { PrizeService } from './service/prize.service';
import { NewsPromptComponent } from './shared/news-prompt.component';
import { MapViewerComponent } from './shared/map-viewer.component';
import { IconComponent } from './shared/icon.component';
import { SheetComponent } from './shared/sheet.component';
import { TabBarComponent } from './shared/tab-bar.component';
import { ToastComponent } from './shared/toast.component';
import { OfflineReadyService } from './service/offline-ready.service';
import { AppUpdateService } from './service/app-update.service';
import { UpdateBarComponent } from './shared/update-bar.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TabBarComponent, ToastComponent, UpdateBarComponent, SheetComponent, IconComponent, MapViewerComponent, NewsPromptComponent, InstallStepsComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  private hideNavService = inject(HideNavService);
  private friends = inject(FriendsService);
  private firestoreConnection = inject(FirestoreConnection);
  private eventReminders = inject(EventRemindersService);
  private offlineReady = inject(OfflineReadyService);
  private appUpdate = inject(AppUpdateService);
  // Started here so "desk down" labels work on every tab, even before any header bar shows.
  private deskActivity = inject(DeskActivity);
  private reactions = inject(ReactionsService);
  private push = inject(PushService);
  // Notification taps open their page (iPhone ignores the service worker's own navigation).
  private notificationTaps = inject(NotificationTapsService);
  prize = inject(PrizeService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  watch = inject(WatchService);
  // Created at startup because Android announces "installable" only once, early
  // (beforeinstallprompt); the Account tab uses it for its Install button.
  install = inject(InstallService);

  /** "Sat 5 PM" / "5 PM today" for the "You won!" sheet, from the drawing's post (prizePickupDeadline). */
  pickupBy(win: PrizeWin): string {
    const post = this.prize.drawings().find(d => d.win?.key === win.key);
    const by = post ? prizePickupDeadline(post.postedAt) : null;
    return by ? formatDeadline(by) : '';
  }

  /** "Show on map" in the "You won!" sheet: the Prize Booth (MapService.prizeBoothRequest). */
  showPrizeBooth(win: PrizeWin): void {
    this.prize.markSeen(win);
    const request = this.map.prizeBoothRequest(this.prize.booth().where);
    if (request) this.map.show(request);
  }
  /** The full-screen venue map is shown here so any tab can open it (MapService.show). */
  map = inject(MapService);
  /** BGG news posts: the Events tab's unread number and the new-post message. */
  private conInfo = inject(ConInfoService);

  isHideNav = false;

  ngOnInit(): void {
    // Safety net for the blank-after-update screen (see index.html): once the first screen
    // has drawn, if the phone is showing a spot past the end of the page, go to the top and
    // nudge iPhone into repainting (same 1px trick as after the keyboard closes).
    setTimeout(() => {
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      if (window.scrollY > Math.max(0, maxY)) window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      window.scrollBy({ top: 1, behavior: 'instant' as ScrollBehavior });
      window.scrollBy({ top: -1, behavior: 'instant' as ScrollBehavior });
    }, 300);
    // A mouse wheel only scrolls up and down, so the sideways chip rows (filters, map categories)
    // couldn't be scrolled without a touchscreen. Over a chip row that can scroll sideways, turn
    // vertical wheel movement into horizontal scrolling. Touch and trackpad swipes are unaffected.
    document.addEventListener('wheel', e => {
      const row = (e.target as Element | null)?.closest?.('.bl-chips, app-map-viewer .chips') as HTMLElement | null;
      if (!row || e.shiftKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
      row.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    this.hideTabBarWhileTyping();
    this.keepTabBarAtBottom();

    this.hideNavService.checkHideNav()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(value => {
        this.isHideNav = value;
        this.cdr.detectChanges();
      });
    // Started here (not on My Lists) so bells are checked whichever tab is open.
    this.watch.start(this.destroyRef);
    // Also here, so new BGG posts are noticed (badge + message) whichever tab is open.
    this.conInfo.start(this.destroyRef);
    // Friends and requests, live, so a new request shows on the Account tab from any tab.
    // Reconnects Firestore after the Home Screen app comes back from the background,
    // so the first tap doesn't wait on a dead connection (FirestoreConnection).
    this.firestoreConnection.start(this.destroyRef);
    this.friends.start(this.destroyRef);
    // Saves starred events to the account so the server can send reminders.
    this.eventReminders.start(this.destroyRef);
    // Your Liked / Want to buy marks, live (shown on every list a game is on).
    this.reactions.start(this.destroyRef);
    // Keeps this phone's push address saved, so "X is back" arrives with the app closed.
    this.push.start(this.destroyRef);
    // Your badge number vs BGG's prize-drawing winner lists (shows "You won!").
    this.prize.start(this.destroyRef);
    // Watches the offline download (search, maps, app) for the Account tab's
    // "Ready offline" line and the one-time "Saved for offline use" toast.
    this.offlineReady.start(this.destroyRef);
    // Notices new versions (on open, back from the background, every 15 min) for the update bar.
    this.appUpdate.start(this.destroyRef);
  }

  /**
   * Puts the tab bar back at the bottom of the screen when iPhone has lost track of it.
   *
   * Reported 2026-11-18 at the con: with no typing involved, the Home Screen app showed the
   * tab bar stuck mid-screen with the page continuing below it, on every tab, until the app
   * was closed and reopened. iPhone had placed it at the bottom of a shorter screen (it
   * happened while other apps' Live Activities were showing, after coming back from the
   * background).
   *
   * After coming back, on a resize and when scrolling stops, this checks whether the bar's
   * bottom edge is at the bottom of the screen. If it isn't, it does the 1px scroll nudge,
   * then makes the browser re-place the bar from scratch. Each check is one position
   * measurement, so it costs nothing noticeable. Skipped while typing (the bar is hidden then,
   * hideTabBarWhileTyping) or while a sheet has the page locked.
   */
  private keepTabBarAtBottom(): void {
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    const root = document.documentElement;
    const misplaced = (bar: HTMLElement) => {
      const bottom = bar.getBoundingClientRect().bottom;
      // Also compare with the screen itself: in a Home Screen app in portrait, the window
      // should be about as tall as the screen; a much shorter one is the same bug.
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
      const portrait = window.innerHeight > window.innerWidth;
      const shrunk = standalone && portrait && window.innerHeight < screen.height * 0.85;
      return Math.abs(bottom - window.innerHeight) > 2 || shrunk;
    };
    const check = () => {
      if (root.classList.contains('bl-typing') || document.body.style.position === 'fixed') return;
      const bar = document.querySelector<HTMLElement>('.bl-tabbar');
      if (!bar || !misplaced(bar)) return;
      window.scrollBy({ top: 1, behavior: 'instant' as ScrollBehavior });
      window.scrollBy({ top: -1, behavior: 'instant' as ScrollBehavior });
      requestAnimationFrame(() => {
        if (!misplaced(bar)) return;
        // Still wrong: take it out of the layout and put it back, so it's placed again.
        bar.style.display = 'none';
        void bar.offsetHeight;
        bar.style.display = '';
      });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = (ms: number) => { clearTimeout(timer); timer = setTimeout(check, ms); };
    const onVisible = () => { if (document.visibilityState === 'visible') soon(400); };
    const onResize = () => soon(300);
    const onScroll = () => soon(250); // runs once scrolling has stopped
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onResize);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    this.destroyRef.onDestroy(() => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onResize);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
    });
  }

  /**
   * Hides the tab bar while the on-screen keyboard is up (class on <html>, styles.css).
   *
   * iPhone Safari keeps position: fixed elements pinned to where the bottom of the
   * screen was before the keyboard opened, so the tab bar floated mid-screen with
   * games scrolling past underneath it (reported with screenshots, Nov 2026).
   * Native iPhone apps let the keyboard cover the tab bar; hiding it matches that.
   *
   * "Keyboard up" = a text field has focus on a touchscreen. Phones don't report the
   * keyboard directly, and desktop browsers (fine pointer) have no on-screen
   * keyboard, so they keep the tab bar. The short delay on focusout avoids a flicker
   * when moving straight from one field to another.
   */
  private hideTabBarWhileTyping(): void {
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;
    const root = document.documentElement;
    const isTextField = (el: EventTarget | null) => el instanceof HTMLTextAreaElement
      || (el instanceof HTMLInputElement && !/^(checkbox|radio|button|submit|range|color|file)$/.test(el.type))
      || (el instanceof HTMLElement && el.isContentEditable);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onIn = (e: FocusEvent) => { if (isTextField(e.target)) { clearTimeout(timer); root.classList.add('bl-typing'); } };
    const onOut = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (isTextField(document.activeElement)) return;
        root.classList.remove('bl-typing');
        // iOS: after the keyboard closes, fixed elements (tab bar, sheets) can stay offset
        // and move with the page until it scrolls (seen 2026-11-16 after "Add friend").
        // A 1px scroll and back makes Safari place them again. Skipped while a sheet has
        // the page locked (SheetComponent), where the page can't scroll anyway.
        setTimeout(() => {
          if (document.body.style.position === 'fixed' || isTextField(document.activeElement)) return;
          window.scrollBy({ top: 1, behavior: 'instant' as ScrollBehavior });
          window.scrollBy({ top: -1, behavior: 'instant' as ScrollBehavior });
        }, 150);
      }, 150);
    };
    document.addEventListener('focusin', onIn);
    // (keepTabBarAtBottom below handles the same symptom when no keyboard was involved.)
    document.addEventListener('focusout', onOut);
    this.destroyRef.onDestroy(() => {
      clearTimeout(timer);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    });
  }
}
