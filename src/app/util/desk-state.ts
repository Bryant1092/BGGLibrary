import { signal } from '@angular/core';

/**
 * When the library desk last recorded a checkout or check-in, while it has stopped
 * scanning (DeskActivity.staleSince); null when scanning is working.
 *
 * A plain signal so pure helpers (statusText in game-format.ts) can read it: any computed()
 * that calls them then updates by itself when the desk goes down or comes back.
 * Written only by DeskActivity.
 */
export const deskDownSince = signal<number | null>(null);
