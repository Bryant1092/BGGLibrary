import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  collection, collectionData, doc, docData, Firestore, getDoc, getDocs, query, runTransaction, serverTimestamp, updateDoc, where, writeBatch,
} from '@angular/fire/firestore';
import { combineLatest, Observable, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { Game } from '../model/game.model';
import { UserService } from './user.service';
import { FirestoreConnection } from './firestore-connection';
import { GameService } from './game.service';
import { ReactionsService } from './reactions.service';

/**
 * Friends and Meeple codes.
 *
 * The group this is for (6–8 people at BGG.CON) each keeps their own lists and
 * wants to see which games several of them want. Friends find each other with a
 * short Meeple code (MEEP-7K4Q) instead of emails, so nobody's email is shown.
 *
 * Firestore (rules in firestore.rules):
 *   codes/{MEEP-XXXX}            { uid }              claimed once, in a transaction
 *   profiles/{uid}               { name, code }       public card: "Bryant G." + code, no email
 *   users/{uid}/friends/{other}  { status, name, code, at }
 *                                status: 'outgoing' (I asked), 'incoming' (they asked), 'friends'
 *   dataLists/{id}               + owner, visible ("Friends can see")
 *
 * Both sides of a friendship are always written together in one batch, so they
 * can't get out of step (and the rules check the pair).
 */

export type FriendStatus = 'outgoing' | 'incoming' | 'friends';

export interface Friend {
  uid: string;
  status: FriendStatus;
  name: string;
  code: string;
}

/** A game and who wants it (me shown as "You"). */
export interface GamePick {
  game: Game;
  /**
   * Every library copy of this game someone listed (same BoardGameGeek id). The library
   * owns two or more copies of some games (e.g. Drillers); each copy is a separate
   * library entry, but "we want to play Drillers" is about the game, not the copy.
   */
  copies: Game[];
  wantedBy: { uid: string; name: string }[];
  /** People who played it and gave a thumbs up / thumbs down (only those sharing ratings). */
  likedBy: string[];
  dislikedBy: string[];
}

export interface FriendList {
  id: string;
  name: string;
  owner: string;
  gameList: Game[];
}

/** No 0/O, 1/I/L or U: easy to read aloud and type without mix-ups. 30^4 = 810,000 codes. */
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'MEEP-';
/** Per account: this phone's copy of your Meeple code (see savedCode). */
const CODE_KEY = 'bgglibrary.meepleCode.';

/** Turns whatever was typed ("meep 7k4q", "7K4Q", "MEEP-7K4Q") into MEEP-7K4Q, or '' if it can't be one. */
export function normalizeCode(input: string): string {
  let s = (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith('MEEP')) s = s.slice(4);
  return s.length === 4 && [...s].every(c => CODE_CHARS.includes(c)) ? PREFIX + s : '';
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return PREFIX + [...bytes].map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

/** "Bryant Gutierrez" -> "Bryant G.": enough for friends to recognise, less than a full name. */
export function shortName(first: string, last: string): string {
  const f = (first || '').trim();
  const l = (last || '').trim();
  return (l ? `${f} ${l[0].toUpperCase()}.` : f).slice(0, 60) || 'Player';
}

@Injectable({ providedIn: 'root' })
export class FriendsService {
  private firestore = inject(Firestore);
  private conn = inject(FirestoreConnection);
  private userService = inject(UserService);
  private gameService = inject(GameService);
  private reactions = inject(ReactionsService);

  /** My friends and requests, kept live while signed in (started once by AppComponent). */
  readonly list = signal<Friend[]>([]);
  readonly incoming = computed(() => this.list().filter(f => f.status === 'incoming'));
  readonly accepted = computed(() => this.list().filter(f => f.status === 'friends'));

  start(destroyRef: DestroyRef): void {
    this.userService.checkAuth().pipe(
      tap(user => { if (user) this.backfillAll(user.uid); }),
      switchMap(user => user ? this.friends$() : of([] as Friend[])),
      takeUntilDestroyed(destroyRef),
    ).subscribe(rows => this.list.set(rows));
  }

  private backfilledFor = '';

  /**
   * Lists made before friends existed have no owner/visible fields, so friends
   * couldn't see them until the owner happened to open each one. Once per sign-in,
   * fill them in for every list I own (visible on, the chosen default). A few
   * small reads; lists already done are skipped.
   */
  private async backfillAll(uid: string): Promise<void> {
    if (this.backfilledFor === uid) return;
    this.backfilledFor = uid;
    try {
      const refs = await getDocs(collection(this.firestore, 'users', uid, 'gameLists'));
      for (const ref of refs.docs) {
        if (ref.data()['owner'] && ref.data()['owner'] !== uid) continue; // shared with me, not mine
        const list = await getDoc(doc(this.firestore, 'dataLists', ref.id));
        if (list.exists() && !list.data()['owner']) {
          await updateDoc(list.ref, { owner: uid, visible: list.data()['visible'] ?? true });
        }
      }
    } catch { /* offline or not allowed: tried again next sign-in */ }
  }

  private uid(): string {
    const uid = this.userService.getCurrentUid();
    if (!uid) throw new Error('Not signed in');
    return uid;
  }

  /**
   * My Meeple code, creating it the first time. The code and the public profile are
   * written in one transaction that fails if the code is taken, so two people can
   * never share a code; on a clash it just tries another.
   */
  /**
   * The Meeple code saved on this phone, shown instantly. A code never changes, but
   * asking the server for it each time Account opened took a few seconds on slow
   * Wi-Fi (reported: "• • • • •" before the code appeared). myCode() refreshes it.
   */
  savedCode(): string {
    const uid = this.userService.getCurrentUid();
    try { return uid ? localStorage.getItem(CODE_KEY + uid) || '' : ''; } catch { return ''; }
  }

  private saveCode(uid: string, code: string): void {
    try { localStorage.setItem(CODE_KEY + uid, code); } catch { /* shown after the server answers instead */ }
  }

  async myCode(): Promise<{ code: string; name: string }> {
    const uid = this.uid();
    const profileRef = doc(this.firestore, 'profiles', uid);
    const existing = await getDoc(profileRef);
    if (existing.exists()) {
      const data = existing.data() as { code: string; name: string };
      this.saveCode(uid, data.code);
      return data;
    }

    const me = await getDoc(doc(this.firestore, 'users', uid));
    const name = shortName(me.data()?.['firstName'] || '', me.data()?.['lastName'] || '');
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = randomCode();
      const codeRef = doc(this.firestore, 'codes', code);
      const claimed = await runTransaction(this.firestore, async tx => {
        if ((await tx.get(codeRef)).exists()) return false;
        tx.set(codeRef, { uid });
        tx.set(profileRef, { name, code });
        return true;
      });
      if (claimed) { this.saveCode(uid, code); return { code, name }; }
    }
    throw new Error('Could not create a Meeple code. Try again.');
  }

  /** My friends and requests, live (both people's changes show up without refreshing). */
  friends$(): Observable<Friend[]> {
    const uid = this.userService.getCurrentUid();
    if (!uid) return of([]);
    return collectionData(collection(this.firestore, 'users', uid, 'friends'), { idField: 'uid' }).pipe(
      map(rows => (rows as Friend[]).sort((a, b) => a.name.localeCompare(b.name))),
      catchError(() => of([])),
    );
  }

  /**
   * Sends a friend request to the owner of a Meeple code. If they already asked me,
   * this accepts their request instead (so two people adding each other at the same
   * time just become friends).
   * Returns what happened, for the message shown.
   */
  async sendRequest(input: string): Promise<{ result: 'sent' | 'accepted' | 'already' | 'self'; name: string }> {
    const code = normalizeCode(input);
    if (!code) throw new Error('bad-code');
    const uid = this.uid();
    const owner = await this.conn.read(() => getDoc(doc(this.firestore, 'codes', code)));
    if (!owner.exists()) throw new Error('no-code');
    const other = owner.data()['uid'] as string;
    if (other === uid) return { result: 'self', name: '' };

    const [theirProfile, mine] = await Promise.all([this.profile(other), this.myCode()]);
    const existing = await this.conn.read(() => getDoc(doc(this.firestore, 'users', uid, 'friends', other)));
    const status = existing.data()?.['status'] as FriendStatus | undefined;
    if (status === 'friends' || status === 'outgoing') return { result: 'already', name: theirProfile.name };
    if (status === 'incoming') {
      await this.accept(other);
      return { result: 'accepted', name: theirProfile.name };
    }
    const batch = writeBatch(this.firestore);
    batch.set(doc(this.firestore, 'users', uid, 'friends', other), { status: 'outgoing', name: theirProfile.name, code, at: serverTimestamp() });
    batch.set(doc(this.firestore, 'users', other, 'friends', uid), { status: 'incoming', name: mine.name, code: mine.code, at: serverTimestamp() });
    // Waits with a time limit; if it runs out the request is still queued and sends
    // when the connection is back (the page says so).
    await this.conn.write(batch.commit());
    return { result: 'sent', name: theirProfile.name };
  }

  /** Accepts a request: both sides become "friends" together. */
  accept(other: string): Promise<void> {
    const uid = this.uid();
    const batch = writeBatch(this.firestore);
    batch.update(doc(this.firestore, 'users', uid, 'friends', other), { status: 'friends', at: serverTimestamp() });
    batch.update(doc(this.firestore, 'users', other, 'friends', uid), { status: 'friends', at: serverTimestamp() });
    return batch.commit();
  }

  /** Declines or cancels a request, or removes a friend: both sides go. */
  remove(other: string): Promise<void> {
    const uid = this.uid();
    const batch = writeBatch(this.firestore);
    batch.delete(doc(this.firestore, 'users', uid, 'friends', other));
    batch.delete(doc(this.firestore, 'users', other, 'friends', uid));
    return batch.commit();
  }

  /** Name and code for a uid (from a Meeple code lookup). */
  async profile(uid: string): Promise<{ name: string; code: string }> {
    const snap = await this.conn.read(() => getDoc(doc(this.firestore, 'profiles', uid)));
    return (snap.data() as { name: string; code: string }) || { name: 'Player', code: '' };
  }

  /** "Friends can see my ratings" (on unless switched off; stored on the public profile). */
  async shareRatings(): Promise<boolean> {
    const uid = this.uid();
    return (await getDoc(doc(this.firestore, 'profiles', uid))).data()?.['shareRatings'] !== false;
  }

  setShareRatings(on: boolean): Promise<void> {
    return updateDoc(doc(this.firestore, 'profiles', this.uid()), { shareRatings: on });
  }

  /** Name for a code, for the "Add Alex?" confirmation before sending. */
  async lookup(input: string): Promise<{ uid: string; name: string } | null> {
    const code = normalizeCode(input);
    if (!code) return null;
    // Time-limited (FirestoreConnection): a stale connection after the app was in the
    // background used to leave "Add" stuck with no message.
    const owner = await this.conn.read(() => getDoc(doc(this.firestore, 'codes', code)));
    if (!owner.exists()) return null;
    const uid = owner.data()['uid'] as string;
    return { uid, name: (await this.profile(uid)).name };
  }

  /** A friend's lists with "Friends can see" on, live. */
  friendLists$(friendUid: string): Observable<FriendList[]> {
    const q = query(collection(this.firestore, 'dataLists'), where('owner', '==', friendUid), where('visible', '==', true));
    return collectionData(q, { idField: 'id' }).pipe(
      map(rows => rows as FriendList[]),
      // e.g. they just removed me as a friend: show nothing rather than an error.
      catchError(() => of([])),
    );
  }

  /** Owner only: turn "Friends can see" on or off for a list. */
  setVisible(listId: string, visible: boolean): Promise<void> {
    return updateDoc(doc(this.firestore, 'dataLists', listId), { visible });
  }

  /**
   * Lists made before friends existed have no owner/visible fields, so friends
   * couldn't find them. The owner fills them in the first time they open the
   * list (visible on, the chosen default). Safe to call repeatedly.
   */
  backfill(listId: string, data: { owner?: string; visible?: boolean } | undefined): void {
    const uid = this.userService.getCurrentUid();
    if (!uid || !data || data.owner) return;
    updateDoc(doc(this.firestore, 'dataLists', listId), { owner: uid, visible: data.visible ?? true }).catch(() => { /* not the owner: nothing to do */ });
  }

  /** Every game in all my lists (own and shared with me), live. For "You both want" and Friends' picks. */
  myGames$(): Observable<Game[]> {
    const uid = this.userService.getCurrentUid();
    if (!uid) return of([]);
    return collectionData(collection(this.firestore, 'users', uid, 'gameLists')).pipe(
      switchMap(refs => refs.length
        ? combineLatest(refs.map(r => docData(doc(this.firestore, 'dataLists', r['id'])).pipe(
            map(d => ((d as any)?.gameList || []) as Game[]),
            catchError(() => of([] as Game[])))))
        : of([] as Game[][])),
      map(lists => lists.flat()),
      catchError(() => of([])),
    );
  }

  /**
   * Friends' picks: every game wanted by me or an accepted friend, with who wants it.
   * Each person counts once per game however many of their lists have it, and only
   * lists with "Friends can see" on count for friends.
   */
  picks$(): Observable<{ people: { uid: string; name: string }[]; games: GamePick[] }> {
    const uid = this.userService.getCurrentUid();
    if (!uid) return of({ people: [], games: [] });
    return this.friends$().pipe(
      map(all => all.filter(f => f.status === 'friends')),
      // Each person's wanted games and their ratings (friends' ratings are empty if they
      // turned "Friends can see my ratings" off).
      switchMap(friends => combineLatest([
        combineLatest([this.myGames$(), this.reactions.friendReactions$(uid)])
          .pipe(map(([games, ratings]) => ({ uid, name: 'You', games, ratings }))),
        ...friends.map(f => combineLatest([this.friendLists$(f.uid), this.reactions.friendReactions$(f.uid)])
          .pipe(map(([lists, ratings]) => ({ uid: f.uid, name: f.name, games: lists.flatMap(l => l.gameList || []), ratings })))),
      ])),
      map(people => {
        // One row per game: copies share a BoardGameGeek id (or, without one, a name).
        const keyOf = (game: Game) => game.bgg_id ? 'bgg:' + game.bgg_id : 'name:' + (game.name || game.id || '').trim().toLowerCase();
        const byGame = new Map<string, GamePick>();
        const keyById = new Map<string, string>();
        for (const person of people) {
          for (const game of person.games) {
            if (!game?.id) continue;
            const key = keyOf(game);
            const pick = byGame.get(key) ?? { game, copies: [], wantedBy: [], likedBy: [], dislikedBy: [] };
            if (!pick.copies.some(c => c.id === game.id)) pick.copies.push(game);
            if (!pick.wantedBy.some(p => p.uid === person.uid)) pick.wantedBy.push({ uid: person.uid, name: person.name });
            byGame.set(key, pick);
            keyById.set(game.id, key);
          }
        }
        // Ratings count for any game in the picks, even if that person didn't list it
        // (e.g. they played it with the group from someone else's list).
        for (const person of people) {
          for (const [gameId, r] of person.ratings) {
            const pick = byGame.get(keyById.get(gameId) || '');
            if (!pick) continue;
            // Once per person, even if they rated more than one copy.
            if (r.liked === true && !pick.likedBy.includes(person.name)) pick.likedBy.push(person.name);
            if (r.liked === false && !pick.dislikedBy.includes(person.name)) pick.dislikedBy.push(person.name);
          }
        }
        const games = [...byGame.values()].sort((a, b) => b.wantedBy.length - a.wantedBy.length || (a.game.name || '').localeCompare(b.game.name || ''));
        return { people: people.map(p => ({ uid: p.uid, name: p.name })), games };
      }),
    );
  }

  /**
   * "Me too": adds a friend's game to the list the Library's + button adds to
   * (the one current list shared by the whole app). Rejects with 'no-list' when
   * there isn't one yet.
   */
  async meToo(game: Game): Promise<string> {
    const list = this.userService.getCurrentGameList();
    if (!list) throw new Error('no-list');
    // Only the fields the Library stores, so a friend's Played tick doesn't come along.
    await this.gameService.addGameToList(list.id, { bgg_id: game.bgg_id, name: game.name, photo: game.photo, id: game.id });
    return list.name;
  }

  /** Watches the visible-to-friends flag of one of my lists. */
  listMeta$(listId: string): Observable<{ owner?: string; visible?: boolean } | undefined> {
    return docData(doc(this.firestore, 'dataLists', listId)).pipe(catchError(() => of(undefined))) as Observable<any>;
  }
}
