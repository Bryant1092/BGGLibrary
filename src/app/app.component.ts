import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { HideNavService } from './service/hide-nav.service';
import { WatchService } from './service/watch.service';
import { InstallService } from './service/install.service';
import { MapService } from './service/map.service';
import { ConInfoService } from './service/con-info.service';
import { FriendsService } from './service/friends.service';
import { ReactionsService } from './service/reactions.service';
import { NewsPromptComponent } from './shared/news-prompt.component';
import { MapViewerComponent } from './shared/map-viewer.component';
import { IconComponent } from './shared/icon.component';
import { SheetComponent } from './shared/sheet.component';
import { TabBarComponent } from './shared/tab-bar.component';
import { ToastComponent } from './shared/toast.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TabBarComponent, ToastComponent, SheetComponent, IconComponent, MapViewerComponent, NewsPromptComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  private hideNavService = inject(HideNavService);
  private friends = inject(FriendsService);
  private reactions = inject(ReactionsService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  watch = inject(WatchService);
  // Created at startup because Android announces "installable" only once, early
  // (beforeinstallprompt); the Account tab uses it for its Install button.
  private install = inject(InstallService);
  /** The full-screen venue map is shown here so any tab can open it (MapService.show). */
  map = inject(MapService);
  /** BGG news posts: the Events tab's unread number and the new-post message. */
  private conInfo = inject(ConInfoService);

  isHideNav = false;

  ngOnInit(): void {
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
    this.friends.start(this.destroyRef);
    // Your Liked / Want to buy marks, live (shown on every list a game is on).
    this.reactions.start(this.destroyRef);
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
      timer = setTimeout(() => { if (!isTextField(document.activeElement)) root.classList.remove('bl-typing'); }, 150);
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    this.destroyRef.onDestroy(() => {
      clearTimeout(timer);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    });
  }
}
