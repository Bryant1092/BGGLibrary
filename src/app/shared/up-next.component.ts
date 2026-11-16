import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConEvent, EventsService } from '../service/events.service';
import { MapService } from '../service/map.service';
import { formatLibraryTime } from '../util/library-time';
import { IconComponent } from './icon.component';

/** Shown from this long before a starred event starts... */
const SHOW_BEFORE_MS = 60 * 60_000;
/** ...until this long after it started (Apple: remove a "live" item 15-30 min after). */
const SHOW_AFTER_MS = 15 * 60_000;
const DISMISSED_KEY = 'bgglibrary.upNextDismissed';

/**
 * "Up next" card for starred events, on the Library and Events tabs.
 *
 * Why (research 2026-11-16): reminders while the app is open belong in the screen, not
 * in a notification (Apple HIG, Notifications: "present the information in a way that's
 * discoverable but not distracting"). Modeled on Apple's Live Activities guidance:
 * - only what you need at a glance: what, when, where
 * - tapping opens the details; one card even with several events coming up ("+1 more")
 * - shown from an hour before until 15 minutes after the start, then it goes away
 * - can be closed (per event) for people who don't want it
 * Works for everyone, signed in or not, with or without notifications.
 */
@Component({
  selector: 'app-up-next',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .un { margin: 12px 16px 4px; padding: 12px 8px 12px 14px; border-radius: 14px; display: flex; gap: 10px; align-items: center;
      background: var(--bl-accent-soft); border: 1.5px solid var(--bl-accent-text); color: var(--bl-text); }
    .un > bl-icon { color: var(--bl-accent-text); flex: none; }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; border: 0; background: transparent; padding: 0; text-align: left; color: inherit; font: inherit; }
    .kicker { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--bl-accent-text); }
    .kicker.now { color: var(--bl-avail-text); }
    .name { font-size: 16px; font-weight: 700; line-height: 21px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .where { font-size: 13px; color: var(--bl-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .more { font-size: 13px; font-weight: 600; color: var(--bl-accent-text); }
    .side { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: none; }
    .side .bl-icon-btn { color: var(--bl-accent-text); }
    .close { color: var(--bl-muted) !important; }
  `,
  template: `
    @if (next(); as n) {
      <div class="un" role="region" aria-label="Up next">
        <bl-icon name="starFilled" [size]="22" />
        <button type="button" class="main" (click)="open(n.event)" [attr.aria-label]="n.label">
          <span class="kicker" [class.now]="n.started">{{ n.when }}</span>
          <span class="name">{{ n.event.name }}</span>
          <span class="where">{{ n.event.room }}</span>
          @if (n.more) { <span class="more">+ {{ n.more }} more starred {{ n.more === 1 ? 'event' : 'events' }} soon</span> }
        </button>
        <div class="side">
          @if (place(n.event); as p) {
            <button type="button" class="bl-icon-btn" aria-label="Show on map" (click)="map.show(p)"><bl-icon name="map" [size]="22" /></button>
          }
          <button type="button" class="bl-icon-btn close" aria-label="Hide this reminder" (click)="dismiss(n.event.id)"><bl-icon name="close" [size]="18" /></button>
        </div>
      </div>
    }
  `,
})
export class UpNextComponent {
  private events = inject(EventsService);
  private router = inject(Router);
  map = inject(MapService);

  /** Ticks every 30 s so "Starts in 12 min" counts down and the card leaves on time. */
  private now = signal(Date.now());
  private dismissed = signal<Set<string>>(this.readDismissed());

  next = computed(() => {
    const now = this.now(), starred = this.events.starred(), dismissed = this.dismissed();
    const soon = (this.events.events() || [])
      .filter(e => starred.has(e.id) && !dismissed.has(e.id) && e.start - now <= SHOW_BEFORE_MS && now < e.start + SHOW_AFTER_MS)
      .sort((a, b) => a.start - b.start);
    const event = soon[0];
    if (!event) return null;
    const started = now >= event.start;
    const mins = Math.max(1, Math.round((event.start - now) / 60_000));
    const time = formatLibraryTime(event.start, now);
    const when = started
      ? `Happening now · started ${Math.max(0, Math.round((now - event.start) / 60_000))} min ago`
      : `Up next · starts in ${mins} min · ${time}`;
    return { event, started, when, more: soon.length - 1, label: `${when}: ${event.name}, ${event.room}. Open details` };
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  place(e: ConEvent) {
    return this.map.eventRequest(e);
  }

  /** Opens the event's details in the Events tab (EventsComponent reads ?event=). */
  open(e: ConEvent): void {
    this.router.navigate(['/events'], { queryParams: { event: e.id } });
  }

  dismiss(id: string): void {
    const next = new Set(this.dismissed()).add(id);
    this.dismissed.set(next);
    try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])); } catch { /* this view only */ }
  }

  private readDismissed(): Set<string> {
    try { return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || '[]')); } catch { return new Set(); }
  }
}
