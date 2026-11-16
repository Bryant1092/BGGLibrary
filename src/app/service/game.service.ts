import { inject, Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { USERS_DB, UserService } from './user.service';
import { Game } from '../model/game.model';
import { limit, where } from '@angular/fire/firestore';
import { firstValueFrom, Observable } from 'rxjs';
import { GameList } from '../model/gamelist.model';
import { UserGameListRef } from '../model/user-gamelist-ref.model';

export const DATALIST_DB = {
  DATA_LISTS: 'dataLists'
}

@Injectable({
  providedIn: 'root'
})
export class GameService {
  private firestore = inject(FirestoreService);
  private userService = inject(UserService);

  constructor() { }

  /**
   * Creates the list and the owner's reference to it in one atomic write.
   * Before, they were two separate writes: if the second failed (bad Wi-Fi),
   * the list existed but nobody could see it. The security rules also rely on
   * the two arriving together to tell a brand-new list from someone else's
   * existing list (see firestore.rules).
   */
  createGameList(listName: string, game?: Game): Promise<string> {
    const uid = this.userService.getCurrentUid();
    if (!uid) {
      return Promise.reject(new Error('Not signed in'));
    }
    return this.firestore.createWithRef(
      DATALIST_DB.DATA_LISTS,
      // owner + visible: friends can find the list ("Friends can see", on by default;
      // FriendsService). The owner can switch it off per list.
      { name: listName, gameList: !!game ? [game] : [], owner: uid, visible: true },
      id => [USERS_DB.USERS, uid, USERS_DB.GAME_LISTS, id],
      id => ({ id, name: listName, userId: uid, owner: uid }),
    );
  }

  /** Adds the game unless a game with the same id is already in the list. */
  addGameToList(listId: string, game: Game): Promise<string> {
    return this.firestore.transactUpdate<GameList>(current => {
      const gameList = current?.gameList || [];
      if (gameList.some(g => g.id === game.id)) {
        return { gameList };
      }
      return { gameList: [...gameList, game] };
    }, DATALIST_DB.DATA_LISTS, listId);
  }

  /** Removes every entry with the game's id, even if other stored fields (like the photo URL) changed. */
  removeGamefromList(listId: string, game: Game): Promise<string> {
    return this.firestore.transactUpdate<GameList>(current => ({
      gameList: (current?.gameList || []).filter(g => g.id !== game.id)
    }), DATALIST_DB.DATA_LISTS, listId);
  }

  createUserGameList(gameListId: string, gameListName: string): Promise<string> {
    const uid = this.userService.getCurrentUid();
    if (!uid) {
      return Promise.reject(new Error('Not signed in'));
    }
    return this.createSpecifiedUserGameList({
      id: gameListId,
      name: gameListName,
    }, uid);
  }

  private createSpecifiedUserGameList(gameList: UserGameListRef, uid: string): Promise<string> {
    let data = {
      id: gameList.id,
      name: gameList.name,
      userId: uid,
      owner: gameList?.owner ? gameList.owner : uid
    }
    return this.firestore.createSubDocData(data, USERS_DB.USERS, uid, USERS_DB.GAME_LISTS, gameList.id);
  }

  fetchGameList(gameListId: string): Promise<GameList> {
    return firstValueFrom(this.firestore.getDocData(DATALIST_DB.DATA_LISTS, gameListId));
  }

  /**
   * Live view of a list: emits again whenever anyone it's shared with adds,
   * removes or ticks a game, so friends' changes show up without refreshing.
   * Works offline from the Firestore cache.
   */
  watchGameList(gameListId: string): Observable<GameList | undefined> {
    return this.firestore.getDocData(DATALIST_DB.DATA_LISTS, gameListId);
  }

  /** Sets a game's Played tick. A transaction, like add/remove, so two people ticking at once can't overwrite each other's changes. */
  setPlayed(listId: string, gameId: string, played: boolean): Promise<string> {
    return this.firestore.transactUpdate<GameList>(current => ({
      gameList: (current?.gameList || []).map(g => g.id === gameId ? { ...g, played } : g)
    }), DATALIST_DB.DATA_LISTS, listId);
  }

  fetchUsersWithGameList(gameListId: string): Promise<UserGameListRef[]> {
    return this.firestore.queryCollectionGroupData(USERS_DB.GAME_LISTS, where('id', '==', gameListId));
  }

  /**
   * Lists without an owner field predate ownership tracking, so their
   * holders keep the old behavior and are treated as owners.
   */
  isListOwner(gameList: UserGameListRef | undefined): boolean {
    if (!gameList) {
      return false;
    }
    return !gameList.owner || gameList.owner === this.userService.getCurrentUid();
  }

  /**
   * Owner only: deletes the list and removes it from everyone it was shared with.
   *
   * Order matters: other people's copies first, then the list, then the owner's
   * own copy last. The security rules check "does the owner still hold this
   * list?" on every step; deleting everything at once (as before) could remove
   * the owner's copy first and get the remaining deletes refused, leaving
   * friends with a dead list.
   */
  deleteGameListAndReferences(gameListId: string): Promise<string> {
    const uid = this.userService.getCurrentUid();
    return this.fetchUsersWithGameList(gameListId).then(dataArray => {
      const others = dataArray.filter(ref => ref.userId !== uid);
      return Promise.all(others.map(ref =>
        this.firestore.deleteDocument(USERS_DB.USERS, ref.userId!, USERS_DB.GAME_LISTS, gameListId)
      ))
        .then(() => this.firestore.deleteDocument(DATALIST_DB.DATA_LISTS, gameListId))
        .then(id => uid
          ? this.firestore.deleteDocument(USERS_DB.USERS, uid, USERS_DB.GAME_LISTS, gameListId).then(() => id)
          : id);
    });
  }

  /** Removes a shared list from the current user's account only. The owner and others keep it. */
  leaveGameList(gameListId: string): Promise<string> {
    const uid = this.userService.getCurrentUid();
    if (!uid) {
      return Promise.reject(new Error('Not signed in'));
    }
    return this.firestore.deleteDocument(USERS_DB.USERS, uid, USERS_DB.GAME_LISTS, gameListId);
  }

  /**
   * limit(1): an email belongs to one account, and the security rules
   * (firestore.rules) only allow one-result lookups, so a signed-in user can't
   * pull the whole users collection (everyone's email) with an open query.
   */
  shareGameList(gameList: UserGameListRef, email: string): Promise<string> {
    return this.firestore.queryCollectionData(USERS_DB.USERS, where('email', '==', email), limit(1)).then((users: any) => {
      if (users.length === 0) {
        console.error(`No user found with email: ${email}`);
        return '';
      }
      return this.createSpecifiedUserGameList(gameList, users[0].uid);
    });
  }

  /** "Edit together" with a friend picked from your friends list (no email needed). */
  shareWithUser(gameList: UserGameListRef, uid: string): Promise<string> {
    return this.createSpecifiedUserGameList(gameList, uid);
  }

  renameGameList(gameList: UserGameListRef, newGameListName: string): Promise<string> {
    return this.firestore.updateDocData({
      name: newGameListName
    }, DATALIST_DB.DATA_LISTS, gameList.id).then(id => {
      this.fetchUsersWithGameList(id).then(dataArray => {
        dataArray.forEach(userGameList => {
          this.firestore.updateDocData({
            name: newGameListName
          }, USERS_DB.USERS, userGameList.userId!, USERS_DB.GAME_LISTS, id)
        });
      });
      return id;
    });
  }
}
