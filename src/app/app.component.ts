import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { HideNavService } from './service/hide-nav.service';
import { TabBarComponent } from './shared/tab-bar.component';
import { ToastComponent } from './shared/toast.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TabBarComponent, ToastComponent],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit {
  private hideNavService = inject(HideNavService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  isHideNav = false;

  ngOnInit(): void {
    this.hideNavService.checkHideNav()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(value => {
        this.isHideNav = value;
        this.cdr.detectChanges();
      });
  }
}
