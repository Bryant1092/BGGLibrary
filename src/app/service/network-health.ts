import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Observable, retry, tap, throwError, timeout, timer } from 'rxjs';
import { DeskActivity } from './desk-activity.service';

/**
 * Convention Wi-Fi: thousands of phones on one network. Requests don't usually
 * fail outright; they stall, drop, or come back as 502/503/504 from overloaded
 * proxies, and the phone still says it's online (so the "You're offline" bar
 * never shows). This file makes Tabletop.Events requests ride that out.
 */

/** A single try is abandoned after this long, then retried. Normal answers take 0.3–3 s. */
const ATTEMPT_TIMEOUT_MS = 15_000;
/** Retries after the first try (3 tries in all). */
const RETRIES = 2;
/** Base waits before retry 1 and 2. */
const BACKOFF_MS = [1_500, 4_000];
/** Longest Retry-After we'll honor; longer than this and the user is better off with saved data. */
const MAX_RETRY_AFTER_MS = 30_000;
/** Failed requests in a row (after retries) before the "Wi-Fi is struggling" bar shows. */
const STRUGGLING_AFTER = 2;

/**
 * Whether Tabletop.Events requests are getting through. Read by the offline
 * bar; any successful answer clears it.
 */
@Injectable({ providedIn: 'root' })
export class NetworkHealth {
  readonly struggling = signal(false);
  private failuresInARow = 0;

  ok(): void {
    this.failuresInARow = 0;
    if (this.struggling()) this.struggling.set(false);
  }

  failed(): void {
    if (++this.failuresInARow >= STRUGGLING_AFTER && !this.struggling()) this.struggling.set(true);
  }
}

/** Worth trying again: no answer at all (dropped, timed out), rate-limited, or a busy gateway. */
function retryable(err: unknown): boolean {
  if (err instanceof HttpErrorResponse) return err.status === 0 || err.status === 429 || err.status >= 502;
  return (err as any)?.name === 'TimeoutError';
}

/**
 * Wait before a retry. The random ±30% matters with thousands of phones: after
 * a Wi-Fi blip they'd otherwise all retry at the same instant and knock the
 * network (or Tabletop.Events) over again. A server's Retry-After wins.
 */
function retryDelay(err: unknown, attempt: number): number {
  const after = err instanceof HttpErrorResponse ? Number(err.headers?.get('Retry-After')) : NaN;
  if (after > 0) return Math.min(after * 1000, MAX_RETRY_AFTER_MS);
  const base = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

/**
 * Timeout + retry for Tabletop.Events reads (GET only: they're safe to repeat).
 * Firebase isn't affected; its SDK already reconnects on its own.
 *
 * Works with the service worker (ngsw-config.json): for a request it has saved,
 * the worker answers from the saved copy after 8 s, so the app sees a success
 * and never needs a retry. For a new request it waits on the network, and the
 * 15 s timeout here stops that from spinning forever.
 */
export function tteResilience(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
  if (req.method !== 'GET' || !req.url.startsWith('https://tabletop.events/api')) return next(req);
  const health = inject(NetworkHealth);
  const desk = inject(DeskActivity);
  return next(req).pipe(
    timeout(ATTEMPT_TIMEOUT_MS),
    retry({
      count: RETRIES,
      delay: (err, attempt) => retryable(err) ? timer(retryDelay(err, attempt)) : throwError(() => err),
    }),
    tap({
      next: event => { if (event instanceof HttpResponse) { health.ok(); desk.note(event.body); } },
      error: err => { if (retryable(err)) health.failed(); },
    }),
  );
}
