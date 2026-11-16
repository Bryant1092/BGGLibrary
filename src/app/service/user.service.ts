import { inject, Injectable } from '@angular/core';
import { User } from '../model/user.model';
import { Observable, tap } from 'rxjs';
import { traceUntilFirst } from '@angular/fire/performance';
import { Auth, authState, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithEmailAndPassword, sendPasswordResetEmail, signInWithPopup, signOut, UserCredential } from '@angular/fire/auth';
import { FirestoreService } from './firestore.service';
import { UserGameListRef } from '../model/user-gamelist-ref.model';

export const USERS_DB = {
    USERS: 'users',
    GAME_LISTS: 'gameLists'
  };

const REMEMBERED_LIST_KEY = 'bgglibrary.currentListId';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private auth = inject(Auth);
  private firestore = inject(FirestoreService);
  private user!: User;
  private gameLists!: UserGameListRef[];
  private currentGameList?: UserGameListRef;

  addUser(user: User): Promise<string> {
    return this.firestore.setDocData(user, USERS_DB.USERS, user.uid);
  }

  /**
   * Creates the profile document if it doesn't exist yet. This also repairs
   * accounts whose profile failed to save at sign-up.
   */
  ensureUserProfile(user: User): Promise<void> {
    return this.firestore.docExists(USERS_DB.USERS, user.uid).then(exists => {
      if (!exists) {
        return this.addUser(user).then(() => undefined);
      }
      return undefined;
    });
  }

  /** Splits a display name into first/last without producing undefined (Firestore rejects undefined fields). */
  static splitDisplayName(displayName: string | null | undefined, email?: string | null): { firstName: string, lastName: string } {
    const parts = (displayName || '').trim().split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || (email || '').split('@')[0] || 'Player',
      lastName: parts.slice(1).join(' ')
    };
  }

  /** Available as soon as Firebase Auth restores the session, unlike the profile document. */
  getCurrentUid(): string | undefined {
    return this.auth.currentUser?.uid;
  }

  fetchUser(uid: string): Observable<User> {
    return this.firestore.getDocData(USERS_DB.USERS, uid).pipe(
      tap(user => {
        this.user = user;
      })
    );
  }

  fetchUserGameLists(uid: string): Observable<UserGameListRef[]> {
    return this.firestore.getCollectionData(USERS_DB.USERS, uid, USERS_DB.GAME_LISTS).pipe(
      tap(gameLists => {
        this.gameLists = gameLists;
        // Keep the current list's latest name, and fall back to the list
        // remembered from the last visit (then the first list) when there's
        // no current list or it was deleted/left.
        const current = gameLists.find((l: UserGameListRef) => l.id === this.currentGameList?.id);
        const remembered = gameLists.find((l: UserGameListRef) => l.id === this.readRememberedListId());
        this.setCurrentGameList(current || remembered || gameLists[0]);
      })
    );
  }

  createUser(email: string, password: string): Promise<UserCredential> {
    return createUserWithEmailAndPassword(this.auth, email, password);
  }

  getCurrentUserData(): User {
    return this.user;
  }

  getCurrentUserGameLists(): UserGameListRef[] {
    return this.gameLists;
  }

  getCurrentGameList(): UserGameListRef | undefined {
    return this.currentGameList;
  }

  /**
   * The list the Library page's + button adds to. It's remembered on this
   * device so it stays the "last list you added to" across visits, instead of
   * resetting to the first list every time the app opens.
   */
  setCurrentGameList(gameList: UserGameListRef | undefined): void {
    this.currentGameList = gameList;
    if (gameList?.id) {
      try {
        localStorage.setItem(REMEMBERED_LIST_KEY, gameList.id);
      } catch { /* storage blocked (e.g. private mode): just don't remember */ }
    }
  }

  private readRememberedListId(): string | null {
    try {
      return localStorage.getItem(REMEMBERED_LIST_KEY);
    } catch {
      return null;
    }
  }

  checkAuth(): Observable<any> {
    return authState(this.auth).pipe(
      traceUntilFirst('auth'),
    );
  }

  signUserIn(email: string, password: string): Promise<UserCredential> {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  /**
   * "Forgot password?": Firebase emails a link to set a new password. Without this,
   * anyone who signed up with email and forgot their password was locked out.
   * After resetting, Firebase's page offers a "Continue" link back to the sign-in
   * screen. With email enumeration protection on (Firebase's default), this
   * succeeds even for unknown emails, so the app's message stays neutral.
   */
  sendPasswordReset(email: string): Promise<void> {
    return sendPasswordResetEmail(this.auth, email, { url: new URL('login', document.baseURI).href });
  }

  signUserInWithGoogle(): Promise<UserCredential> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account"
  })
    return signInWithPopup(this.auth, provider);
  }

  signUserOut(): Promise<void> {
    // Forget the in-memory lists so the next person to sign in on this phone
    // never sees the previous account's lists, even briefly.
    this.gameLists = [];
    this.currentGameList = undefined;
    return signOut(this.auth).then(() => {
      console.log('User signed out');
    }, err => console.error('error signing out', err));
  }
}
