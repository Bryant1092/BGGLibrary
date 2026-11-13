import { inject, Injectable } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { USERS_DB, UserService } from './user.service';
import { Game } from '../model/game.model';
import { where } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
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

  createGameList(listName: string, game?: Game): Promise<string> {
    return this.firestore.setDocData({
      name: listName,
      gameList: !!game ? [game] : []
    }, DATALIST_DB.DATA_LISTS).then(id => {
      return this.createUserGameList(id, listName).then((newId: string) => {
        return newId;
      });
   });
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

  /** Owner only: deletes the list and removes it from everyone it was shared with. */
  deleteGameListAndReferences(gameListId: string): Promise<string> {
    return this.fetchUsersWithGameList(gameListId).then(dataArray => {
      return this.firestore.deleteDocument(DATALIST_DB.DATA_LISTS, gameListId).then(id => {
        return Promise.all(dataArray.map(userGameList =>
          this.firestore.deleteDocument(USERS_DB.USERS, userGameList.userId!, USERS_DB.GAME_LISTS, gameListId)
        )).then(() => id);
      });
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

  shareGameList(gameList: UserGameListRef, email: string): Promise<string> {
    return this.firestore.queryCollectionData(USERS_DB.USERS, where('email', '==', email)).then((users: any) => {
      if (users.length === 0) {
        console.error(`No user found with email: ${email}`);
        return '';
      }
      return this.createSpecifiedUserGameList(gameList, users[0].uid);
    });
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
