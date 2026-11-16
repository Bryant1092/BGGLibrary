import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { collection, collectionData, deleteDoc, doc, Firestore, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { catchError, map, Observable, of, switchMap } from 'rxjs';
import { Game } from '../model/game.model';
import { UserService } from './user.service';

/** How you felt about a game after playing it. Only you change it; accepted friends can see it unless you turn that off. */
export interface Reaction {
  /** true = liked it, false = not for me, null/missing = not rated. */
  liked?: boolean | null;
  /** On your buy list (exhibit hall, Bazaar, later). */
  buy?: boolean;
  /** Kept with the rating so the Buy list can show games that aren't on any list. */
  name?: string;
  photo?: string;
}

/**
 * Liked / Not for me / Want to buy, per game, for the signed-in person.
 *
 * Why this shape (Nov 2026, for the group's routine of "play, then everyone says
 * if they liked it, some add it to a buy list"):
 * - Thumbs, not stars: one tap right after a game. Netflix saw about 200% more
 *   ratings after switching from 5 stars to thumbs; a 1–5 score asks people to
 *   deliberate, which nobody does between games at a con.
 * - Personal, stored under your account (users/{uid}/reactions/{gameId}), not on
 *   the shared list like Played: you played it together, but liking it is yours.
 * - Per game, not per list: rating Wingspan once shows on every list it's on.
 */
@Injectable({ providedIn: 'root' })
export class ReactionsService {
  private firestore = inject(Firestore);
  private userService = inject(UserService);

  /** gameId -> reaction, live while signed in. */
  readonly byGame = signal<Map<string, Reaction>>(new Map());

  /** Called once from AppComponent. */
  start(destroyRef: DestroyRef): void {
    this.userService.checkAuth().pipe(
      switchMap(user => user
        ? collectionData(collection(this.firestore, 'users', user.uid, 'reactions'), { idField: 'id' }).pipe(catchError(() => of([])))
        : of([])),
      takeUntilDestroyed(destroyRef),
    ).subscribe(rows => this.byGame.set(new Map((rows as any[]).map(r => [r.id, { liked: r.liked ?? null, buy: !!r.buy, name: r.name, photo: r.photo }]))));
  }

  /** Every game you marked Want to buy, A–Z: from any list or the Library (Buy list view). */
  readonly buyList = computed(() => [...this.byGame()]
    .filter(([, r]) => r.buy)
    .map(([id, r]) => ({ id, name: r.name || '', photo: r.photo || '', liked: r.liked ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name)));

  /**
   * A friend's ratings, live. Empty if they switched "Friends can see my ratings"
   * off or aren't friends any more (the rules refuse; that's not an error here).
   */
  friendReactions$(uid: string): Observable<Map<string, Reaction>> {
    return collectionData(collection(this.firestore, 'users', uid, 'reactions'), { idField: 'id' }).pipe(
      map(rows => new Map((rows as any[]).map(r => [r.id as string, { liked: r.liked ?? null, buy: !!r.buy }]))),
      catchError(() => of(new Map<string, Reaction>())),
    );
  }

  get(gameId: string | undefined): Reaction {
    return (gameId && this.byGame().get(gameId)) || {};
  }

  /**
   * Saves a change (merged with what's there). The game's name and picture are kept
   * with it so a future "Want to buy" list can show them without other lookups.
   * Shown immediately, then saved; Firestore queues it if the phone is offline.
   */
  set(game: Game, change: Reaction): Promise<void> {
    const uid = this.userService.getCurrentUid();
    if (!uid || !game.id) return Promise.reject(new Error('Not signed in'));
    const next = { ...this.get(game.id), ...change, name: game.name || '', photo: game.photo || '' };
    this.byGame.update(m => new Map(m).set(game.id!, next));
    const ref = doc(this.firestore, 'users', uid, 'reactions', game.id);
    // Nothing left to remember: remove the record instead of keeping an empty one.
    if (next.liked == null && !next.buy) return deleteDoc(ref);
    return setDoc(ref, { liked: next.liked ?? null, buy: !!next.buy, name: game.name || '', photo: game.photo || '', at: serverTimestamp() });
  }
}
