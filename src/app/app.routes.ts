import { Routes } from '@angular/router';
import { PageNotFountComponent } from './page-not-fount/page-not-fount.component';
import { LoginComponent } from './login/login.component';
import { LibraryComponent } from './library/library.component';
import { ListsComponent } from './lists/lists.component';
import { AccountComponent } from './account/account.component';
import { authGuard } from './auth/auth.guard';
import { isAuthGuard } from './auth/is-auth.guard';

// The library/home and library/user paths are kept from the old Home/User
// pages so existing bookmarks and home-screen shortcuts still work.
export const routes: Routes = [
    { path: '', redirectTo: 'library/home', pathMatch: "full"},
    { path: 'login', component: LoginComponent, title: 'Sign in - BGG Library', canActivate: [isAuthGuard] },
    { path: 'library', redirectTo: 'library/home', pathMatch: "full"},
    { path: 'library/', redirectTo: 'library/home', pathMatch: "full"},
    { path: 'library/home', component: LibraryComponent, title: 'Library - BGG Library'},
    { path: 'library/user', component: ListsComponent, title: 'My Lists - BGG Library', canActivate: [authGuard]},
    { path: 'account', component: AccountComponent, title: 'Account - BGG Library'},
    { path: '**', component: PageNotFountComponent, title: 'Page Not Found - BGG Library' }
];
