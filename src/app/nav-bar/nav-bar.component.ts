import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, DestroyRef, inject, OnDestroy, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, switchMap } from 'rxjs';
import { UserService } from '../service/user.service';
import { User } from '../model/user.model';
import { ActiveService } from '../service/active.service';


@Component({
  selector: 'app-nav-bar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './nav-bar.component.html',
  styleUrl: './nav-bar.component.css'
})
export class NavBarComponent implements OnInit, AfterViewInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private activeService = inject(ActiveService);
  private destroyRef = inject(DestroyRef);
  active: number = 1;
  loggedIn: boolean = false;
  userSubscription: any;
  querySub: any;
  redirectUrl = { redirectUrl: '/' }
  displayName?: string;
  email?: string;

  ngOnInit(): void {
    this.querySub = this.route.queryParams.subscribe(params => {
      if (params['redirectUrl']) {
        this.redirectUrl = { redirectUrl: decodeURIComponent(params['redirectUrl'])};
      } else {
        this.redirectUrl = { redirectUrl: '/' };
      }
    });
    // switchMap replaces the previous profile listener whenever the auth state
    // changes. Before, getUserData() opened a new Firestore listener on every
    // auth change without closing the old one.
    this.userSubscription = this.userService.checkAuth().pipe(
      switchMap((user: any) => {
        this.loggedIn = !!user;
        if (!user?.uid) {
          this.displayName = undefined;
          this.email = undefined;
          return EMPTY;
        }
        if (![1,2,3].includes(this.active)) {
          this.activeService.setActiveNavTab(1);
        }
        return this.userService.fetchUser(user.uid);
      })
    ).subscribe((user: any) => this.setUserData(user));
  }

  ngAfterViewInit(): void {
    // The nav bar normally lives for the whole session, but unsubscribing on
    // destroy keeps it leak-free if it is ever removed (e.g. the login page hides it).
    this.activeService.checkActiveNavTab().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((active: number) => {
      this.active = active;
    });
  }

  ngOnDestroy(): void {
    this.querySub.unsubscribe();
    this.userSubscription.unsubscribe();
  }

  handleNavClick(index: number): void {
    this.activeService.setActiveNavTab(index);
    if (this.docWidthLessThan768()) {
      document.getElementById('navToggleButton')?.click();
    }
  }


  private setUserData(user: any) {
    if (!!user) {
      // Last name can be empty (e.g. one-word Google names); avoid showing "Cher undefined".
      this.displayName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim().normalize();
      this.email = user.email;
    }
  }

  logout() {
    this.userService.signUserOut();
    this.loggedIn = false;
    this.router.navigate(['/']);
    this.active = 1;
  }

  docWidthLessThan768() {
    return document.body.clientWidth < 768;
  }

}
