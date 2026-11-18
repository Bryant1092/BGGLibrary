import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { doc, docData, Firestore } from '@angular/fire/firestore';
import { catchError, Observable, of } from 'rxjs';
import { conventionStarted, currentOrNextConvention } from '../util/library-time';

/** One game in the ranking: copies of the same game are already added together. */
export interface ConGame {
  name: string;
  /** Library copy ids (Tabletop.Events librarygame ids). */
  ids: string[];
  /** Checkouts this con, all copies together. */
  count: number;
  thumb: string;
  bggId: number | null;
}

interface ConCheckoutsDoc {
  conId: string;
  conName: string;
  games: ConGame[];
  updatedAt?: { toMillis(): number };
  countingSince?: { toMillis(): number };
}

/**
 * "Most played this con": the server's ranking (functions/index.js, trackConCheckouts),
 * one public document, meta/conCheckouts, updated every 10 minutes during the con.
 *
 * One live connection for the app session: a read only when the ranking changes,
 * about 1,000 reads a day for 10 people (plan of 2026-11-16, under 50,000 free).
 * Hidden until there's a ranking for the current convention (so not before it opens).
 */
@Injectable({ providedIn: 'root' })
export class ConCheckoutsService {
  private firestore = inject(Firestore);

  private data = toSignal(
    (docData(doc(this.firestore, 'meta', 'conCheckouts')) as Observable<ConCheckoutsDoc | undefined>)
      .pipe(catchError(() => of(undefined))),
    { initialValue: undefined },
  );

  /**
   * The latest ranking. After a con ends it stays up (the owner asked, 2026-11-18, to keep
   * BGG.CON 2026's final list showing) until the next con's library opens; from then on only
   * that con's ranking counts, so last con's numbers never pass as the new con's.
   */
  readonly available = computed(() => {
    const d = this.data();
    const con = currentOrNextConvention();
    if (!d?.games?.length) return false;
    return !con?.tteConventionId || d.conId === con.tteConventionId || !conventionStarted(con);
  });

  /** The con the ranking is from (after a con ends, the "current or next" con is a different one). */
  readonly conName = computed(() => this.available() ? this.data()!.conName : null);

  readonly games = computed<ConGame[]>(() => this.available() ? this.data()!.games : []);
  readonly updatedAt = computed(() => this.available() ? this.data()!.updatedAt?.toMillis?.() ?? null : null);
}
