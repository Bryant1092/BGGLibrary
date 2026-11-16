import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { doc, docData, Firestore } from '@angular/fire/firestore';
import { catchError, Observable, of } from 'rxjs';
import { currentOrNextConvention } from '../util/library-time';

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

  /** A ranking for the convention that's on now (an old one from last year doesn't count). */
  readonly available = computed(() => {
    const d = this.data();
    const con = currentOrNextConvention();
    return !!d?.games?.length && (!con?.tteConventionId || d.conId === con.tteConventionId);
  });

  readonly games = computed<ConGame[]>(() => this.available() ? this.data()!.games : []);
  readonly updatedAt = computed(() => this.available() ? this.data()!.updatedAt?.toMillis?.() ?? null : null);
}
