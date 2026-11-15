import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { HideNavService } from './service/hide-nav.service';
import { WatchService } from './service/watch.service';
import { InstallService } from './service/install.service';
import { MapService } from './service/map.service';
import { MapViewerComponent } from './shared/map-viewer.component';
import { IconComponent } from './shared/icon.component';
import { SheetComponent } from './shared/sheet.component';
import { TabBarComponent } from './shared/tab-bar.component';
import { ToastComponent } from './shared/toast.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TabBarComponent, ToastComponent, SheetComponent, IconComponent, MapViewerComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  private hideNavService = inject(HideNavService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);
  watch = inject(WatchService);
  // Created at startup because Android announces "installable" only once, early
  // (beforeinstallprompt); the Account tab uses it for its Install button.
  private install = inject(InstallService);
  /** The full-screen venue map is shown here so any tab can open it (MapService.show). */
  map = inject(MapService);

  isHideNav = false;

  ngOnInit(): void {
    this.hideNavService.checkHideNav()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(value => {
        this.isHideNav = value;
        this.cdr.detectChanges();
      });
    // Started here (not on My Lists) so bells are checked whichever tab is open.
    this.watch.start(this.destroyRef);
  }
}
