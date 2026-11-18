import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { doc, docData, Firestore } from '@angular/fire/firestore';
import { catchError, Observable, of } from 'rxjs';
import { conventionStarted, currentOrNextConvention } from '../util/library-time';

/** Plays this con before its own average replaces the library's all-time one. */
export const PLAY_MIN_SAMPLES = 5;

export interface PlayStats {
  /** Average time out per checkout this con (minutes, library open hours only), 0 if none yet. */
  outMinutes: number;
  plays: number;
  /** Average time on the shelf between a check-in and the next checkout (minutes). */
  shelfMinutes: number;
  shelfTimes: number;
  /** When the server last recalculated (ms). */
  updatedAt: number | null;
}

interface PlayTimesDoc {
  conId: string;
  conName: string;
  /** "bgg:<id>" or "name:<lowercase name>" -> [avg minutes out, plays, avg minutes on shelf, times]. */
  games: Record<string, [number, number, number, number]>;
  updatedAt?: { toMillis(): number };
}

/**
 * This con's real time out / time on the shelf per game (asked for 2026-11-18): the server
 * records each checkout and check-in (functions/index.js, trackPlayTimes) into one public
 * document, meta/conPlayTimes, every 10 minutes. The library's own average spans every past
 * con and was often off.
 *
 * Copies of a game count together (same grouping as "Most played this con"). Like that list,
 * the numbers stay up after the con until the next con's library opens.
 * Cost: one live connection, one read each time the server saves (at most every 10 minutes).
 */
@Injectable({ providedIn: 'root' })
export class ConPlayTimesService {
  private firestore = inject(Firestore);

  private data = toSignal(
    (docData(doc(this.firestore, 'meta', 'conPlayTimes')) as Observable<PlayTimesDoc | undefined>)
      .pipe(catchError(() => of(undefined))),
    { initialValue: undefined },
  );

  private current = computed(() => {
    const d = this.data();
    if (!d?.games) return null;
    const con = currentOrNextConvention();
    const ok = !con?.tteConventionId || d.conId === con.tteConventionId || !conventionStarted(con);
    return ok ? d : null;
  });

  /** This con's numbers for a game, or null if it hasn't been checked out or returned yet. */
  statsFor(game: { bgg_id?: number | null; name?: string }): PlayStats | null {
    const d = this.current();
    if (!d) return null;
    const key = game.bgg_id ? `bgg:${game.bgg_id}` : `name:${String(game.name || '').trim().toLowerCase()}`;
    const g = d.games[key];
    if (!g) return null;
    return { outMinutes: g[0], plays: g[1], shelfMinutes: g[2], shelfTimes: g[3], updatedAt: d.updatedAt?.toMillis?.() ?? null };
  }
}
