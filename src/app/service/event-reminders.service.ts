import { DestroyRef, effect, inject, Injectable, Injector, signal, untracked } from '@angular/core';
import { deleteDoc, doc, Firestore, serverTimestamp, setDoc, Timestamp } from '@angular/fire/firestore';
import { ConEvent, EventsService } from './events.service';
import { UserService } from './user.service';
import { currentOrNextConvention } from '../util/library-time';

const LEAD_KEY = 'bgglibrary.eventReminderMin';
const SYNCED_PREFIX = 'bgglibrary.eventStarsSynced.';
/** Reminder choices in minutes; 0 = off. 15 is the default (see below). */
export const REMINDER_CHOICES = [0, 10, 15, 30];
/** No reminder when the event starts sooner than this: too late to be useful. */
const TOO_LATE_MS = 5 * 60_000;

interface Synced { start: number; remindAt: number | null; name: string; room: string }

/**
 * Reminders for starred events, sent by the server even when the app is closed
 * (functions/index.js, sendEventReminders).
 *
 * Research (2026-11-16): an iPhone Home Screen app can't schedule its own
 * notifications (the Notification Triggers API is Chrome-only), so each starred
 * event is saved to the account (users/{uid}/eventStars/{eventId}) with remindAt =
 * start minus the reminder time, and a server job sends one reminder when it's due.
 * - One reminder per event, not "before" plus "starting": Apple's HIG says not to send
 *   several notifications about the same thing.
 * - 15 minutes by default: conference apps commonly remind ~10 minutes before; the
 *   Hyatt is big (four levels), so a little more time to walk. Changeable (10/15/30/Off)
 *   in Account, as Apple asks apps to offer in-app notification settings.
 * - No reminder when it would arrive less than 5 minutes before the start.
 *
 * Writes only what changed (a copy of what was saved is kept on this phone), and
 * never re-arms a reminder whose time has already passed (it was probably sent).
 * Signed out: nothing is saved; the in-app "Up next" card still works.
 */
@Injectable({ providedIn: 'root' })
export class EventRemindersService {
  private firestore = inject(Firestore);
  private userService = inject(UserService);
  private events = inject(EventsService);
  private injector = inject(Injector);

  /** Minutes before the start; 0 = off. */
  readonly leadMin = signal<number>(this.readLead());
  private uid = signal<string | null>(null);

  /** Called once from AppComponent. */
  start(destroyRef: DestroyRef): void {
    const sub = this.userService.checkAuth().subscribe((user: any) => this.uid.set(user?.uid || null));
    destroyRef.onDestroy(() => sub.unsubscribe());

    // The schedule is needed to know each starred event's time. It's normally loaded by
    // the Events tab; with stars saved, load it (cached copy first) so reminder changes
    // made from Account and the "Up next" card work without visiting Events.
    const convention = currentOrNextConvention();
    if (convention && this.events.starred().size) this.events.load(convention);

    effect(() => {
      const uid = this.uid(), events = this.events.events(), starred = this.events.starred(), lead = this.leadMin();
      if (!uid || !events) return;
      untracked(() => this.sync(uid, events, starred, lead).catch(err => console.warn('Could not save event reminders', err)));
    }, { injector: this.injector });
  }

  setLead(minutes: number): void {
    this.leadMin.set(minutes);
    try { localStorage.setItem(LEAD_KEY, String(minutes)); } catch { /* this session only */ }
  }

  private async sync(uid: string, events: ConEvent[], starred: Set<string>, lead: number): Promise<void> {
    const now = Date.now();
    const saved = this.readSynced(uid);
    const byId = new Map(events.map(e => [e.id, e]));
    const next: Record<string, Synced> = {};
    const writes: Promise<unknown>[] = [];

    for (const id of starred) {
      const e = byId.get(id);
      if (!e) { if (saved[id]) next[id] = saved[id]; continue; } // not in this schedule: leave as is
      if (e.end < now) { if (saved[id]) writes.push(this.remove(uid, id)); continue; } // over: tidy up
      const old = saved[id];
      // Already due (and so probably sent): keep it, so changing the reminder time later
      // can't send a second one for the same event.
      const alreadyDue = !!old?.remindAt && old.remindAt <= now && old.start === e.start;
      const remindAt = alreadyDue ? old.remindAt : this.remindAt(e.start, lead, now);
      const want: Synced = { start: e.start, remindAt, name: e.name, room: e.room };
      next[id] = want;
      if (old && old.start === want.start && old.remindAt === want.remindAt && old.name === want.name && old.room === want.room) continue;
      if (alreadyDue && old) { next[id] = old; continue; }
      writes.push(setDoc(doc(this.firestore, 'users', uid, 'eventStars', id), {
        name: e.name.slice(0, 200),
        start: Timestamp.fromMillis(e.start),
        room: e.room.slice(0, 200),
        ...(remindAt ? { remindAt: Timestamp.fromMillis(remindAt) } : {}),
        at: serverTimestamp(),
      }));
    }
    // Unstarred on this phone: remove the saved copy so no reminder is sent.
    for (const id of Object.keys(saved)) {
      if (!starred.has(id)) writes.push(this.remove(uid, id));
    }
    if (!writes.length) return;
    await Promise.all(writes);
    this.writeSynced(uid, next);
  }

  /** When to remind, or null for none (off, or too close to the start to help). */
  private remindAt(start: number, lead: number, now: number): number | null {
    if (!lead || start - now < TOO_LATE_MS) return null;
    // Starred less than `lead` minutes ahead: remind right away ("Starts in 9 min").
    return Math.max(start - lead * 60_000, now);
  }

  private remove(uid: string, id: string): Promise<void> {
    return deleteDoc(doc(this.firestore, 'users', uid, 'eventStars', id));
  }

  private readLead(): number {
    try {
      const v = Number(localStorage.getItem(LEAD_KEY));
      return REMINDER_CHOICES.includes(v) && localStorage.getItem(LEAD_KEY) !== null ? v : 15;
    } catch { return 15; }
  }

  private readSynced(uid: string): Record<string, Synced> {
    try { return JSON.parse(localStorage.getItem(SYNCED_PREFIX + uid) || '{}'); } catch { return {}; }
  }

  private writeSynced(uid: string, value: Record<string, Synced>): void {
    try { localStorage.setItem(SYNCED_PREFIX + uid, JSON.stringify(value)); } catch { /* re-synced next time */ }
  }
}
