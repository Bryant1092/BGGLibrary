import { Routes } from '@angular/router';
import { LibraryComponent } from './library/library.component';
import { authGuard } from './auth/auth.guard';
import { isAuthGuard } from './auth/is-auth.guard';

// The library/home and library/user paths are kept from the old Home/User
// pages so existing bookmarks and home-screen shortcuts still work.
//
// Only the Library page is in the main download; the others load when first
// opened (loadComponent), so the first screen appears sooner. The service
// worker caches those files too, so they still open offline after one visit.
export const routes: Routes = [
    { path: '', redirectTo: 'library/home', pathMatch: "full"},
    { path: 'login', loadComponent: () => import('./login/login.component').then(m => m.LoginComponent), title: 'Sign in - BGG Library', canActivate: [isAuthGuard] },
    { path: 'library', redirectTo: 'library/home', pathMatch: "full"},
    { path: 'library/', redirectTo: 'library/home', pathMatch: "full"},
    { path: 'library/home', component: LibraryComponent, title: 'Library - BGG Library'},
    { path: 'library/user', loadComponent: () => import('./lists/lists.component').then(m => m.ListsComponent), title: 'My Lists - BGG Library', canActivate: [authGuard]},
    { path: 'events', loadComponent: () => import('./events/events.component').then(m => m.EventsComponent), title: 'Events - BGG Library'},
    { path: 'account', loadComponent: () => import('./account/account.component').then(m => m.AccountComponent), title: 'Account - BGG Library'},
    { path: '**', loadComponent: () => import('./page-not-fount/page-not-fount.component').then(m => m.PageNotFountComponent), title: 'Page Not Found - BGG Library' }
];
