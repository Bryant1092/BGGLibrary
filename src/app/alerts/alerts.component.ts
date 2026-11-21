import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, OnDestroy, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, firstValueFrom, of } from 'rxjs';
import { AlertsService, GameAlert } from '../service/alerts.service';
import { BggService } from '../service/bgg.service';
import { WatchService } from '../service/watch.service';
import { DeskActivity } from '../service/desk-activity.service';
import { ToastService } from '../service/toast.service';
import { BggItem } from '../model/bgg.model';
import { IconComponent } from '../shared/icon.component';
import { ThumbComponent } from '../shared/thumb.component';
import { GameSheetComponent } from '../shared/game-sheet.component';
import { OfflineBarComponent } from '../shared/offline-bar.component';
import { dallasDateKey, formatLibraryTime, shortDuration } from '../util/library-time';
import { parseTteDate } from '../util/time-ago';
import { shelfText } from '../util/game-format';

/** Where a game is right now, shown on the right of each alert. */
interface LiveStatus { kind: 'in' | 'out' | 'maybe' | 'checking'; text: string; shelf: string; }
interface Row { alert: GameAlert; isNew: boolean; when: string; status: LiveStatus; thumb: string | null; }
interface Group { key: string; rows: Row[]; burst: boolean; title: string; when: string; }
interface Section { key: string; title: string; groups: Group[]; }

/** Three or more alerts this close together are shown as one block ("5 games are back"). */
const BURST_GAP_MS = 5 * 60_000;
const BURST_MIN = 3;
const REFRESH_MS = 2 * 60_000;

/**
 * Alerts tab (added 2026-11-20): history of "game is back" alerts, newest first, for 7 days.
 *
 * Built from research (NN/g, Apple HIG, Material, notification-center guides):
 * - A tab with a number badge, not a header bell: on iPhone the tab bar is always there and
 *   Apple recommends tab badges for unread counts. Opening the tab clears the badge.
 * - Grouped by time, and bursts (a backlog typed in at once) as one block.
 * - The right side of each row is where the game is NOW (Available + shelf / Out again /
 *   May be wrong after an outage): a "back" alert goes stale in minutes, so the history is
 *   only useful with the current status next to it.
 * - Tapping a game opens its details (copies included). ?game=<id> opens one directly: that's
 *   where tapping a phone notification lands.
 */
@Component({
  selector: 'app-alerts',
  standalone: true,
  imports: [IconComponent, ThumbComponent, GameSheetComponent, OfflineBarComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bl-page">
      <header class="bl-header">
        <div class="bl-title-row">
          <img src="icons/icon-72x72.png" alt="" width="30" height="30">
          <h1>Alerts</h1>
        </div>
        <app-offline-bar />
      </header>

      <main>
        @if (sections().length) {
          <p class="intro">Games with your bell that came back. The right side shows each one's status and location right now.</p>
          @for (s of sections(); track s.key) {
            <h2 class="bl-section">{{ s.title }}</h2>
            @for (g of s.groups; track g.key) {
              <!-- A burst (a backlog typed in at once) gets a heading; its games are normal rows below it. -->
              @if (g.burst) {
                <div class="burst-head"><strong>{{ g.title }}</strong><span>{{ g.when }}</span></div>
              }
              @for (r of g.rows; track r.alert.id) {
                <button type="button" class="row" [class.is-new]="r.isNew" (click)="open(r.alert)" [attr.aria-label]="label(r)">
                  <span class="dot-slot">@if (r.isNew) { <span class="new-dot" aria-hidden="true"></span> }</span>
                  <app-thumb [src]="r.thumb" [name]="r.alert.name" [size]="44" [radius]="8" />
                  <span class="text">
                    <strong>{{ r.alert.name }}</strong>
                    <span>{{ r.when }}</span>
                  </span>
                  <!-- Fixed-width column: every pill the same width, location under it, so the eye runs straight down. -->
                  <span class="status-col" aria-hidden="true">
                    <span class="status" [class]="r.status.kind">{{ r.status.text }}</span>
                    @if (r.status.shelf) { <span class="where"><bl-icon name="pin" [size]="13" [stroke]="2.4" />{{ r.status.shelf }}</span> }
                  </span>
                </button>
              }
            }
          }
          <p class="kept">Alerts are kept for 7 days.</p>
        } @else {
          <div class="empty">
            <span class="empty-icon"><bl-icon name="bell" [size]="34" /></span>
            <h2>No alerts yet</h2>
            <p>Tap the bell on a checked-out game and you'll find it here when it's back on the shelf. Alerts are kept for 7 days.</p>
            <a class="bl-btn" routerLink="/library/user" style="text-decoration: none">Go to My Lists</a>
          </div>
        }
      </main>
    </div>

    @if (selected(); as game) {
      <app-game-sheet [game]="game" [now]="now()" [watched]="watch.isWatched(game.id)"
                      (watchToggle)="toggleWatch(game)" (closed)="selected.set(null)" />
    }
  `,
  styles: `
    .intro { margin: 0; padding: 12px 16px 0; font-size: 14px; line-height: 19px; color: var(--bl-muted); }
    .row { display: grid; grid-template-columns: 10px 44px minmax(0, 1fr) minmax(108px, max-content); align-items: center; column-gap: 10px;
      width: 100%; min-height: 64px; padding: 8px 16px 8px 6px; border: 0; background: none; color: inherit; font: inherit;
      text-align: left; position: relative; }
    /* Thin divider from the name to the right edge (iOS list style), so each status reads with its own game. */
    .row::after { content: ""; position: absolute; left: 70px; right: 0; bottom: 0; height: 1px; background: var(--bl-hair); }
    .row.is-new { background: var(--bl-field); }
    .dot-slot { display: flex; justify-content: center; }
    .new-dot { width: 8px; height: 8px; border-radius: 4px; background: var(--bl-accent-text); }
    .text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .text strong { font-size: 16px; line-height: 20px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .text span { font-size: 13px; color: var(--bl-muted); }
    .status-col { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
    .status { display: block; padding: 5px 10px; box-sizing: border-box; border-radius: 999px; font-size: 13px; font-weight: 700; text-align: center; white-space: nowrap; }
    .status.in { background: var(--bl-avail-bg); color: var(--bl-avail-fg); }
    .status.out { background: var(--bl-out-bg); color: var(--bl-out-fg); }
    .status.maybe { background: var(--bl-late-bg); color: var(--bl-late-fg); box-shadow: inset 0 0 0 1px var(--bl-late-border); }
    .status.checking { background: var(--bl-field); color: var(--bl-muted); font-weight: 600; }
    .where { display: flex; align-items: center; justify-content: center; gap: 3px; font-size: 13px; font-weight: 700; color: var(--bl-text); }
    .burst-head { display: flex; align-items: baseline; gap: 8px; padding: 10px 16px 4px 30px; }
    .burst-head strong { flex: 1; font-size: 15px; }
    .burst-head span { font-size: 13px; color: var(--bl-muted); }
    .kept { margin: 0; padding: 16px; font-size: 13px; color: var(--bl-muted); text-align: center; }
    .empty { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 80px 40px; text-align: center; }
    .empty-icon { width: 72px; height: 72px; border-radius: 36px; background: var(--bl-field); color: var(--bl-accent-text); display: flex; align-items: center; justify-content: center; }
    .empty h2 { margin: 0; font-size: 22px; }
    .empty p { margin: 0; font-size: 16px; line-height: 23px; color: var(--bl-muted); }
  `,
})
export class AlertsComponent implements OnInit, OnDestroy {
  private alertsService = inject(AlertsService);
  private bgg = inject(BggService);
  private desk = inject(DeskActivity);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  readonly watch = inject(WatchService);

  now = signal(Date.now());
  selected = signal<BggItem | null>(null);
  /** Current Tabletop.Events record per game (null = couldn't load). */
  private live = signal(new Map<string, BggItem | null>());
  /** Alerts newer than this were new when you opened the tab (they keep their dot while you're here). */
  private newSince = this.alertsService.seenUntil();
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    // Opening the tab clears the badge, and so does an alert arriving while you're looking.
    effect(() => {
      this.alertsService.alerts();
      untracked(() => this.alertsService.markSeen());
    });
    // Load the current status for any game not loaded yet.
    effect(() => {
      const ids = [...new Set(this.alertsService.alerts().map(a => a.gameId))];
      untracked(() => this.loadLive(ids.filter(id => !this.live().has(id))));
    });
  }

  ngOnInit(): void {
    this.timer = setInterval(() => {
      this.now.set(Date.now());
      this.loadLive([...new Set(this.alertsService.alerts().map(a => a.gameId))]);
    }, REFRESH_MS);
    // ?game=<id>: a tapped notification (or the in-app toast) opens that game's details here.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = params.get('game');
      if (!id) return;
      this.router.navigate([], { queryParams: { game: null }, queryParamsHandling: 'merge', replaceUrl: true });
      this.openId(id);
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  sections = computed<Section[]>(() => {
    const now = this.now();
    const live = this.live();
    const before = this.desk.unconfirmedBefore();
    const rows: Row[] = this.alertsService.alerts().map(a => {
      const item = live.get(a.gameId);
      return { alert: a, isNew: a.createdAt > this.newSince, when: this.whenText(a, now), status: this.status(item, before), thumb: item?.bgg_icon_uri || null };
    });
    const sections: Section[] = [];
    for (const r of rows) {
      const key = this.sectionKey(r.alert.createdAt, now);
      let s = sections[sections.length - 1];
      if (!s || s.key !== key) sections.push(s = { key, title: this.sectionTitle(key, r.alert.createdAt, now), groups: [] });
      const g = s.groups[s.groups.length - 1];
      const prev = g?.rows[g.rows.length - 1];
      if (g && prev && prev.alert.createdAt - r.alert.createdAt <= BURST_GAP_MS) g.rows.push(r);
      else s.groups.push({ key: r.alert.id, rows: [r], burst: false, title: '', when: '' });
    }
    // A run of BURST_MIN or more is one block; shorter runs are separate rows.
    for (const s of sections) {
      s.groups = s.groups.flatMap((g): Group[] => {
        if (g.rows.length < BURST_MIN) return g.rows.map(r => ({ key: r.alert.id, rows: [r], burst: false, title: '', when: '' }));
        const first = g.rows[g.rows.length - 1].alert.createdAt, last = g.rows[0].alert.createdAt;
        const a = formatLibraryTime(first, now), b = formatLibraryTime(last, now);
        return [{ ...g, burst: true, title: `${g.rows.length} games are back`, when: a === b ? a : `${a}–${b}` }];
      });
    }
    return sections;
  });

  open(alert: GameAlert): void {
    const item = this.live().get(alert.gameId);
    if (item) this.selected.set(item);
    else this.openId(alert.gameId);
  }

  toggleWatch(item: BggItem): void {
    this.watch.toggle({ id: item.id, name: item.name, shelf: shelfText(item) });
  }

  /** Screen readers hear the row as one sentence, status included. */
  label(r: Row): string {
    return `${r.isNew ? 'New. ' : ''}${r.alert.name} is back, ${r.when}. Now: ${r.status.text}${r.status.shelf ? ' on shelf ' + r.status.shelf : ''}.`;
  }

  private async openId(id: string): Promise<void> {
    const res: any = await firstValueFrom(this.bgg.getBggGameInfo(id).pipe(catchError(() => of(null))));
    if (res?.result?.id) this.selected.set(res.result);
    else this.toast.error("Couldn't open that game. Check your connection.");
  }

  /** A few at a time, so a long history doesn't send dozens of requests at once. */
  private async loadLive(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 4) {
      const batch = await Promise.all(ids.slice(i, i + 4).map(async id => {
        const res: any = await firstValueFrom(this.bgg.getBggGameInfo(id).pipe(catchError(() => of(null))));
        return [id, (res?.result as BggItem) ?? null] as const;
      }));
      const next = new Map(this.live());
      for (const [id, item] of batch) if (item || !next.get(id)) next.set(id, item);
      this.live.set(next);
    }
  }

  private status(item: BggItem | null | undefined, unconfirmedBefore: number | null): LiveStatus {
    if (item === undefined) return { kind: 'checking', text: 'Checking…', shelf: '' };
    if (item === null) return { kind: 'checking', text: "Couldn't check", shelf: '' };
    const latest = Math.max(parseTteDate(item.last_checkin_date)?.getTime() ?? 0, parseTteDate(item.last_checkout_date)?.getTime() ?? 0);
    if (unconfirmedBefore != null && latest < unconfirmedBefore) return { kind: 'maybe', text: 'Not sure', shelf: '' };
    return item.is_checked_out ? { kind: 'out', text: 'Out again', shelf: '' } : { kind: 'in', text: 'Available', shelf: shelfText(item) };
  }

  private whenText(a: GameAlert, now: number): string {
    if (a.late) return `Check-in recorded late · ${formatLibraryTime(a.createdAt, now)}`;
    const t = a.checkedInAt || a.createdAt;
    const ago = now - t;
    return `Checked in ${formatLibraryTime(t, now)}${ago < 3600_000 ? ` · ${ago < 60_000 ? 'just now' : shortDuration(ago) + ' ago'}` : ''}`;
  }

  private sectionKey(ms: number, now: number): string {
    if (now - ms < 15 * 60_000) return 'now';
    return dallasDateKey(ms);
  }

  private sectionTitle(key: string, ms: number, now: number): string {
    if (key === 'now') return 'Just now';
    if (key === dallasDateKey(now)) return 'Earlier today';
    if (key === dallasDateKey(now - 86_400_000)) return 'Yesterday';
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'short', day: 'numeric' }).format(ms);
  }
}
