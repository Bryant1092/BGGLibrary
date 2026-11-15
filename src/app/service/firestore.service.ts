import { inject, Injectable } from '@angular/core';
import { addDoc, arrayUnion, collection, collectionData, collectionGroup, deleteDoc, doc, docData, Firestore, getDoc, getDocs, limitToLast, orderBy, query, QueryConstraint, QueryFieldFilterConstraint, runTransaction, setDoc, updateDoc, where, writeBatch } from '@angular/fire/firestore';
import { debounceTime, exhaustAll, lastValueFrom, mergeAll, Observable, takeLast, tap, firstValueFrom } from 'rxjs';
import { UserGameListRef } from '../model/user-gamelist-ref.model';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  private firestore = inject(Firestore);

  constructor() { }

  getDocData(...pathSegments: string[]): Observable<any> {
    return docData(doc(this.firestore, pathSegments.shift()!, ...pathSegments));
  }

  getCollectionData(...pathSegments: string[]): Observable<any> {
    return collectionData(collection(this.firestore, pathSegments.shift()!, ...pathSegments));
  }

  setDocData(data: any, ...pathSegments: string[]): Promise<string> {
    let ref;
    if (pathSegments.length === 1) {
      ref = doc(collection(this.firestore, pathSegments[0]));
    } else {
      ref = doc(this.firestore, pathSegments.shift()!, ...pathSegments);
    }
    return setDoc(ref, data).then(() => {
      return ref.id;
    });
  }

  updateDocData(data: any, ...pathSegments: string[]): Promise<string> {
    let ref = doc(this.firestore, pathSegments.shift()!, ...pathSegments);
    return updateDoc(ref, data).then(() => {
      return ref.id;
    });
  }

  /**
   * Reads a document and writes back changes computed from its current data,
   * atomically. Use this instead of arrayUnion/arrayRemove when array items are
   * objects, because those only match when every field is identical.
   */
  transactUpdate<T>(computeUpdate: (current: T) => Partial<T>, ...pathSegments: string[]): Promise<string> {
    const ref = doc(this.firestore, pathSegments.shift()!, ...pathSegments);
    return runTransaction(this.firestore, async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) {
        throw new Error(`Document not found: ${ref.path}`);
      }
      transaction.update(ref, computeUpdate(snapshot.data() as T) as any);
      return ref.id;
    });
  }

  /**
   * Creates a new document with a generated id in `collectionName` plus a
   * second document whose path includes that id, in one atomic write (both or
   * neither). Used for a new list and its owner's reference, so the security
   * rules can see they were made together (see firestore.rules).
   * `refPath` gets the new id: e.g. id => ['users', uid, 'gameLists', id].
   */
  createWithRef(collectionName: string, data: any, refPath: (id: string) => string[], refData: (id: string) => any): Promise<string> {
    const ref = doc(collection(this.firestore, collectionName));
    const segments = refPath(ref.id);
    const batch = writeBatch(this.firestore);
    batch.set(ref, data);
    batch.set(doc(this.firestore, segments.shift()!, ...segments), refData(ref.id));
    return batch.commit().then(() => ref.id);
  }

  docExists(...pathSegments: string[]): Promise<boolean> {
    const ref = doc(this.firestore, pathSegments.shift()!, ...pathSegments);
    return getDoc(ref).then(snapshot => snapshot.exists());
  }

  createSubDocData(data: any, ...pathSegments: string[]) {
    let docRef = doc(this.firestore, pathSegments.shift()!, ...pathSegments);
    return setDoc(docRef, data).then(() => {
      return docRef.id;
    });
  }

  queryCollectionGroupData(groupName: string, groupQuery: QueryFieldFilterConstraint): Promise<any> {
    let collectionGroupRef = collectionGroup(this.firestore, groupName);
    return firstValueFrom(collectionData(query(collectionGroupRef, groupQuery)).pipe(
      debounceTime(200),
    ));
  }

  /** `more` adds constraints such as limit(1) (see GameService.shareGameList). */
  queryCollectionData(collectionName: string, collectionQuery: QueryFieldFilterConstraint, ...more: QueryConstraint[]): Promise<any> {
    let collectionGroupRef = collection(this.firestore, collectionName);
    return firstValueFrom(collectionData(query(collectionGroupRef, collectionQuery, ...more)).pipe(
      debounceTime(200),
    ));
  }

  deleteDocument(...pathSegments: string[]): Promise<string> {
    let docRef = doc(this.firestore, pathSegments.shift()!,...pathSegments);
    return deleteDoc(docRef).then(() => {
      return docRef.id;
    });
  }
}
