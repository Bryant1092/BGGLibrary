import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, switchMap } from 'rxjs';
import { BggService } from '../service/bgg.service';
import { parseTteDate } from '../util/time-ago';
import { ToastService } from '../service/toast.service';
import { BggItem } from '../model/bgg.model';
import { dueInfo, formatLibraryDate, formatLibraryTime, shortDuration } from '../util/library-time';
import { bggUrl, checkedInText, howToPlayUrl, minutesText, playersText, shelfText } from '../util/game-format';
import { isHotGame } from '../util/hot-games';
import { gameNotice } from '../util/game-notice';
import { MapService } from '../service/map.service';
import { DeskActivity } from '../service/desk-activity.service';
import { ConPlayTimesService, PLAY_MIN_SAMPLES } from '../service/con-play-times.service';
import { IconComponent } from './icon.component';
import { SheetComponent } from './sheet.component';
import { ThumbComponent } from './thumb.component';

/**
 * Game details, opened by tapping a game. Keeps people inside the app; the
 * game name used to link straight to BoardGameGeek in a new tab, which leaves
 * the installed app on a phone.
 */
@Component({
  selector: 'app-game-sheet',
  standalone: true,
  imports: [IconComponent, SheetComponent, ThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .checked-in { display: block; margin-top: 6px; font-size: 14px; color: var(--bl-muted); }
    .copies { display: flex; flex-direction: column; gap: 8px; }
    .copies h3.sub { margin: 0; }
    .copies-note { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; font-size: 14px; line-height: 19px;
      background: var(--bl-late-bg); color: var(--bl-late-fg); border: 1px solid var(--bl-late-border); }
    .copies-note bl-icon { flex: none; margin-top: 1px; }
    .copy { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 10px; background: var(--bl-field); }
    .copy.this { outline: 2px solid var(--bl-accent-text); outline-offset: -2px; }
    .copy-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .copy .code { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .copy .tag { margin-left: 8px; font-size: 12px; font-weight: 700; color: var(--bl-accent-text); text-transform: uppercase; letter-spacing: .04em; }
    .copy .line { font-size: 14px; }
    .copy .in { color: var(--bl-avail-text); font-weight: 600; }
    .copy .muted { color: var(--bl-muted); }
    .copy .maybe { flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 999px; font-size: 13px; font-weight: 700;
      background: var(--bl-late-bg); color: var(--bl-late-fg); border: 1px solid var(--bl-late-border); }
    .desk-stale { display: block; padding: 6px 10px; border-radius: 10px; font-size: 14px; line-height: 19px;
      background: var(--bl-late-bg); color: var(--bl-late-fg); border: 1px solid var(--bl-late-border); }
    .head { display: flex; gap: 14px; align-items: flex-start; }
    .head .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .head h2 { overflow-wrap: anywhere; }
    .head .bl-pill { align-self: flex-start; }
    .head-actions { display: flex; flex-direction: column; gap: 4px; margin: -6px -10px 0 0; }
    .head-actions .share { color: var(--bl-on-tonal); background: var(--bl-tonal); }
    .note-box { display: flex; gap: 12px; align-items: center; border-radius: 12px; padding: 12px 14px; border: 1.5px solid var(--bl-control-border); }
    .note-box bl-icon { color: var(--bl-muted); }
    .note-box div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .note-box small { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--bl-muted); }
    .note-box span { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
    .tile-btn { border: 0; font: inherit; cursor: pointer; }
    .tile-link { display: inline-flex; align-items: center; gap: 3px; font-size: 13px; font-weight: 700; }
    .cond.quiet { border: 0; padding: 0 2px; }
    /* Pinned to the sheet's bottom edge. The sheet's own bottom padding moves into the bar
       (styles.css, .bl-sheet:has(.action-bar)): iPhone Safari keeps sticky items clear of the
       scroller's padding, so with it the bar floated ~60pt up with rows showing below (2026-11-20). */
    .action-bar { position: sticky; bottom: 0; z-index: 2; display: flex; gap: 10px;
      margin: 0 -20px; padding: 12px 20px calc(12px + env(safe-area-inset-bottom));
      background: var(--bl-surface); border-top: 1px solid var(--bl-hair); box-shadow: 0 -6px 16px rgba(0, 0, 0, .06); }
    .action-bar .bl-btn { flex: 1; margin: 0; }
    .action-bar .bell { flex: none; padding: 0 16px; }
    .action-bar .bell.on { color: var(--bl-accent-text); border-color: var(--bl-accent-text); }
    .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    /* Label and value both centered: three equal tiles read as a row of stats, and
       keeping label and value on one alignment keeps each tile easy to scan. */
    .tile { border-radius: 12px; padding: 12px 8px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; background: var(--bl-field); min-width: 0; }
    .tile.accent { background: var(--bl-tonal); color: var(--bl-on-tonal); }
    .tile small { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--bl-muted); }
    .tile.accent small { color: var(--bl-on-tonal); }
    .tile strong { font-size: 20px; font-weight: 700; line-height: 24px; overflow-wrap: anywhere; }
    .due { border-radius: 14px; padding: 14px 16px; display: flex; gap: 12px; align-items: flex-start; background: var(--bl-due-bg); border: 1.5px solid var(--bl-due-border); --fg: var(--bl-due-fg); }
    .due.late { background: var(--bl-late-bg); border-color: var(--bl-late-border); --fg: var(--bl-late-fg); }
    .due > bl-icon { color: var(--fg); margin-top: 2px; }
    .due .text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .kicker { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--fg); }
    .headline { font-size: 22px; font-weight: 800; line-height: 27px; }
    .sooner { font-size: 15px; font-weight: 700; line-height: 20px; color: var(--fg); }
    .detail { font-size: 14px; line-height: 19px; color: var(--bl-muted); }
    .note { font-size: 13px; line-height: 18px; color: var(--bl-muted); }
    /* Condition note: amber like "Past due" (the --bl-late colors) when something's wrong, plain outline when it's just good to know. */
    .cond { display: flex; gap: 12px; align-items: flex-start; border-radius: 12px; padding: 12px 14px; border: 1.5px solid var(--bl-control-border); }
    .cond.warn { background: var(--bl-late-bg); border-color: var(--bl-late-border); }
    .cond > bl-icon { color: var(--bl-muted); flex: none; margin-top: 1px; }
    .cond.warn > bl-icon, .cond.warn small { color: var(--bl-late-fg); }
    .cond div { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .cond small { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--bl-muted); }
    .cond span { font-size: 15px; line-height: 20px; overflow-wrap: anywhere; }
    /* Fine print in the This con box (which average "Often back sooner" uses). */
    .cond .muted-note { font-size: 13px; line-height: 18px; color: var(--bl-muted); }
    .hot { margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--bl-accent-soft); font-size: 14px; line-height: 19px; display: flex; gap: 10px; align-items: flex-start; }
    .hot > bl-icon { color: var(--bl-accent-text); }
    .hot-text { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
    .hot-text .bl-link-btn { display: inline-flex; align-items: center; gap: 4px; margin: 0 0 -14px -2px; /* -14: same footprint with the 44px tap height */ }
  `,
  template: `
    <app-sheet [label]="game().name" (closed)="closed.emit()">
      <div class="head">
        <app-thumb [src]="game().bgg_icon_uri" [name]="game().name" [size]="112" [radius]="14" [lazy]="false" />
        <div class="text">
          <h2>{{ game().name }}</h2>
          <span class="bl-pill" [class.out]="game().is_checked_out">{{ game().is_checked_out ? 'Checked out' : 'Available now' }}</span>
          <!-- When it came back, so you know it was just returned. -->
          @if (checkedIn()) { <span class="checked-in">{{ checkedIn() }}</span> }
          <!-- Desk scanning is down (DeskActivity): the pill above is as of the last scan. -->
          @if (desk.staleSince(); as since) {
            <span class="desk-stale" role="status">Check-in/out hasn't updated since {{ deskSinceText(since) }}, so this may be wrong.</span>
          }
        </div>
        <div class="head-actions">
          <button type="button" class="bl-icon-btn" aria-label="Close" (click)="closed.emit()"><bl-icon name="close" /></button>
          <!-- Sends "<game> is available on shelf A" with a link, via the phone's share menu. -->
          <button type="button" class="bl-icon-btn share" aria-label="Share this game" (click)="share()"><bl-icon name="share" /></button>
        </div>
      </div>

      <div class="tiles">
        <!-- Tappable when the map has the library room: first-timers don't know where shelf K is (audit 2026-11-20). -->
        @if (libraryMap()) {
          <button type="button" class="tile accent tile-btn" (click)="showLibraryMap()" [attr.aria-label]="'Location ' + shelf() + '. Show the library on the map'">
            <small>Location</small><strong>{{ shelf() }}</strong><span class="tile-link"><bl-icon name="map" [size]="14" [stroke]="2.4" /> Map</span>
          </button>
        } @else {
          <div class="tile accent"><small>Location</small><strong>{{ shelf() }}</strong></div>
        }
        <div class="tile"><small>Players</small><strong>{{ players() }}</strong></div>
        <div class="tile"><small>Play time</small><strong>{{ minutes() }}m</strong></div>
      </div>

      <!--
        Know before you check it out: missing pieces, no rulebook, damage, or a helpful
        extra (util/game-notice.ts: names removed, staff bookkeeping dropped). Shown above
        everything else, since it can change whether you take this copy. The copy number
        tells copies apart: with two copies, the other one may be complete.
      -->
      @if (notice(); as n) {
        <div class="cond" [class.warn]="n.level === 'warn'" role="note">
          <bl-icon [name]="n.level === 'warn' ? 'warning' : 'info'" [size]="22" />
          <div>
            <small>{{ n.level === 'warn' ? n.tag : 'Good to know' }}{{ n.copy ? ' · copy ' + n.copy : '' }}</small>
            <span>{{ n.text }}</span>
          </div>
        </div>
      }

      <!--
        The library's own note on the box, e.g. "Includes Marine Worlds" (about 1
        in 5 games have one). Free text typed by library staff, so it's shown as-is.
      -->
      @if (note(); as text) {
        <div class="note-box">
          <bl-icon name="box" [size]="22" />
          <div>
            <small>{{ noteIsIncludes() ? 'In the box' : 'Library note' }}</small>
            <span>{{ text }}</span>
          </div>
        </div>
      }

      @if (hot()) {
        <div class="hot">
          <bl-icon name="flame" [size]="20" />
          <div class="hot-text">
            <!-- Checked out here doesn't mean unavailable: the Hot Games copy can be played without a checkout. -->
            <span>{{ game().is_checked_out ? 'The library copy is out, but this game is also on the ' : 'Also on the ' }}<strong>Hot Games tables</strong>: no checkout needed if a table is free.</span>
            @if (hotMap()) { <button type="button" class="bl-link-btn" (click)="showHotMap()"><bl-icon name="map" [size]="16" /> Show on map</button> }
          </div>
        </div>
      }

      @if (due(); as d) {
        <div class="due" [class.late]="d.isLate && !d.stale && !desk.staleSince()">
          <bl-icon name="clock" [size]="26" />
          <div class="text">
            @if (d.stale) {
              <span class="kicker">Checked out</span>
              <span class="headline">Since {{ date(d.checkedOutAt) }}</span>
              <span class="detail">That was a while ago, so it may never have been checked back in. Look on shelf {{ shelf() }} or ask at the library desk.</span>
            } @else if (d.isLate && desk.staleSince()) {
              <!-- Desk not scanning: "Past due" in red would accuse someone of a game that may be back. -->
              <span class="kicker">Due time passed</span>
              <span class="headline">Was due {{ time(d.dueAt) }}</span>
              <span class="detail">Check-ins haven't been recorded since {{ deskSinceText(desk.staleSince()!) }}, so it may already be back. Look on shelf {{ shelf() }} or ask at the library desk.</span>
            } @else if (d.isLate) {
              <span class="kicker">Past due</span>
              <span class="headline">Was due {{ time(d.dueAt) }}</span>
              <span class="detail">{{ checkedOutText() }} {{ d.rule }} Ask at the library desk if you're waiting on it.</span>
            } @else {
              <span class="kicker">Due back by</span>
              <span class="headline">{{ time(d.dueAt) }}</span>
              @if (d.soonerAt) {
                <span class="sooner">Often back sooner, around {{ time(d.soonerAt) }}</span>
              }
              <span class="detail">{{ checkedOutText() }} {{ d.rule }}</span>
              @if (d.cappedAtFinalClose) {
                <span class="note">The library closes for the convention at {{ d.finalCloseText }}, so everything is due by then.</span>
              } @else if (d.overnight) {
                <span class="note">The library closes at midnight. Late returns go to the hotel front desk and are checked in when it opens at 8 AM.</span>
              }
            }
          </div>
        </div>
      }

      <!--
        This con's real numbers (ConPlayTimesService), with how many plays they come from and
        when the server last updated them, so it's clear how much to trust them. "Often back
        sooner" above switches to this con's average at PLAY_MIN_SAMPLES plays.
      -->
      @if (conStats(); as s) {
        <!-- Plain facts, so no box: the bordered and amber boxes stay for things that change your plans. -->
        <div class="cond quiet" role="note">
          <bl-icon name="clock" [size]="22" />
          <div>
            <small>This con{{ s.updatedAt ? ' · updated ' + time(s.updatedAt) : '' }}</small>
            @if (s.plays) {
              <span>Out about <strong>{{ dur(s.outMinutes) }}</strong> per checkout ({{ s.plays }} {{ s.plays === 1 ? 'play' : 'plays' }})</span>
            }
            @if (s.shelfTimes) {
              <span>Back on the shelf about <strong>{{ dur(s.shelfMinutes) }}</strong> before someone takes it ({{ s.shelfTimes }}×)</span>
            }
            @if (game().is_checked_out && !usingConAverage()) {
              <span class="muted-note">"Often back sooner" uses the library's all-time average until this con has {{ minSamples }} plays.</span>
            }
          </div>
        </div>
      }

      <!--
        Every copy with its barcode (added 2026-11-19): which one to look for, and after a desk
        outage which ones haven't been scanned since (they may really be out, or back).
      -->
      @if (copies(); as list) {
        @if (list.length > 1 || unconfirmedCount()) {
          <div class="copies">
            <h3 class="sub">Copies · {{ inCount() }} of {{ list.length }} in{{ unconfirmedCount() ? ' · ' + unconfirmedCount() + ' may be wrong' : '' }}</h3>
            <!-- One explanation for all tagged copies, not a sentence on each (NN/g: indicators add noise). -->
            @if (unconfirmedCount()) {
              <div class="copies-note" role="note">
                <bl-icon name="alert" [size]="18" />
                <span>{{ unconfirmedText() }}</span>
              </div>
            }
            @for (c of list; track c.id) {
              <div class="copy" [class.this]="c.id === game().id">
                <div class="copy-text">
                  <span class="code">{{ c.catalog_number || 'No barcode' }}@if (c.id === game().id) { <span class="tag">This one</span> }</span>
                  <span class="line">
                    @if (c.is_checked_out) { <span class="muted">{{ copyStatus(c) }}</span> } @else { <span class="in">On the shelf</span> }
                    @if (lastScan(c); as t) { <span class="muted"> · last scan {{ t }}</span> }
                  </span>
                </div>
                @if (unconfirmed(c)) {
                  <span class="maybe"><bl-icon name="info" [size]="14" [stroke]="2.4" />{{ c.is_checked_out ? 'May be back' : 'May be out' }}</span>
                }
              </div>
            }
          </div>
        }
      }

      <!-- Extra controls from the page that opened the sheet (e.g. Liked / Want to buy). -->
      <ng-content />
      <!-- Learning the rules before checking a game out saves table time. -->
      <a class="bl-btn secondary" style="text-decoration: none" [href]="howToPlay()" target="_blank" rel="noopener"
         [attr.aria-label]="'Watch how to play ' + game().name + ' (opens a YouTube search)'">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4" fill="var(--bl-accent)"/><path d="M10 9.5v5l4.5-2.5z" fill="#fff"/></svg>
        Watch how to play
      </a>
      <span class="note" style="text-align: center; margin-top: -8px">Opens a YouTube search</span>
      <!-- A real button like "Watch how to play" (asked 2026-11-20), text + "opens elsewhere" icon
           (the standard for leaving the app). No BGG logo: it's their trademark, not ours to redraw.
           With the BGG app installed, iPhone may open the game there instead. -->
      <a class="bl-btn secondary" style="text-decoration: none" [href]="bgg()" target="_blank" rel="noopener"
         [attr.aria-label]="'View ' + game().name + ' on BoardGameGeek (opens outside the app)'">
        View on BoardGameGeek <bl-icon name="external" [size]="18" />
      </a>
      <span class="note" style="text-align: center; margin-top: -8px">Ratings, rules and photos on BoardGameGeek</span>
      <!--
        The two things you came to do stay pinned to the bottom of the sheet while the details
        scroll (audit 2026-11-20): before, they came after up to six info boxes.
      -->
      <div class="action-bar">
        <button type="button" class="bl-btn" [class.secondary]="inList()" [disabled]="busy()" (click)="toggle.emit()">{{ actionLabel() }}</button>
        @if (game().is_checked_out) {
          <button type="button" class="bl-btn secondary bell" [class.on]="watched()" [attr.aria-pressed]="watched()" (click)="watchToggle.emit()"
                  [attr.aria-label]="watched() ? &quot;Notifying you when it&#39;s back. Turn off&quot; : &quot;Notify me when it&#39;s back&quot;">
            <bl-icon [name]="watched() ? 'bell' : 'bellOff'" [size]="20" />
            {{ watched() ? 'Notifying' : 'Notify me' }}
          </button>
        }
      </div>
    </app-sheet>
  `,
})
export class GameSheetComponent {
  private toast = inject(ToastService);
  readonly desk = inject(DeskActivity);
  readonly deskSinceText = (ms: number) => formatLibraryTime(ms);
  game = input.required<BggItem>();
  /** Name of the list the button adds to; empty when signed out or there are no lists yet. */
  listName = input<string | undefined>();
  inList = input(false);
  busy = input(false);
  /** Current time, passed in so the page's one-minute clock keeps every time on screen in sync. */
  now = input(Date.now());
  checkedIn = computed(() => checkedInText(this.game(), this.now()));
  closed = output<void>();
  /** The page decides what this means: add, remove, sign in, or pick a list first. */
  toggle = output<void>();
  /** Whether the "notify me when it's back" bell is on for this game (see WatchService). */
  watched = input(false);
  watchToggle = output<void>();

  shelf = computed(() => shelfText(this.game()));
  players = computed(() => playersText(this.game()));
  minutes = computed(() => minutesText(this.game()));
  /** This con's time out / on the shelf for this game (null until it has any). */
  conStats = computed(() => this.playTimes.statsFor(this.game()));
  /**
   * "Often back sooner, around …" uses this con's own average once the game has
   * PLAY_MIN_SAMPLES plays; until then the library's all-time average (owner's request).
   */
  usingConAverage = computed(() => (this.conStats()?.plays ?? 0) >= PLAY_MIN_SAMPLES && this.conStats()!.outMinutes > 0);
  due = computed(() => dueInfo(
    this.usingConAverage() ? { ...this.game(), average_seconds_checked_out: this.conStats()!.outMinutes * 60 } : this.game(),
    this.now()));
  private playTimes = inject(ConPlayTimesService);
  readonly minSamples = PLAY_MIN_SAMPLES;
  /** "1h 20m" / "25 min" for the This con box. */
  dur(minutes: number): string {
    return minutes < 60 ? `${Math.max(1, minutes)} min` : shortDuration(minutes * 60_000);
  }
  private bggService = inject(BggService);
  /** All copies of this game (BggService.copiesOf); null while loading or if it failed. */
  copies = toSignal(toObservable(computed(() => this.game().name)).pipe(
    switchMap(name => name ? this.bggService.copiesOf({ name }).pipe(catchError(() => of(null))) : of(null))), { initialValue: null });
  inCount = computed(() => (this.copies() || []).filter(c => !c.is_checked_out).length);
  private latestScan = (c: BggItem) => Math.max(parseTteDate(c.last_checkin_date)?.getTime() ?? 0, parseTteDate(c.last_checkout_date)?.getTime() ?? 0);
  /** Not scanned since the desk outage (DeskActivity.unconfirmedBefore). */
  unconfirmed(c: BggItem): boolean {
    const before = this.desk.unconfirmedBefore();
    return before != null && this.latestScan(c) < before;
  }
  unconfirmedCount = computed(() => (this.copies() || []).filter(c => this.unconfirmed(c)).length);
  /** The one explanation above the copies: why some are tagged, and what to do. */
  unconfirmedText = computed(() => {
    if (this.desk.downNow()) return "The library desk isn't scanning right now, so every copy's status may be wrong. Check the shelf.";
    const back = this.desk.unconfirmedBefore();
    return `Tagged copies haven't been scanned since the desk came back${back ? ' at ' + formatLibraryTime(back, this.now()) : ''}, so their status may be wrong. Check the shelf.`;
  });
  /** "8:51 PM" (with "yesterday" / a day when older): the copy's last checkout or check-in. */
  lastScan(c: BggItem): string {
    const t = this.latestScan(c);
    return t ? formatLibraryTime(t, this.now()) : '';
  }
  /** "On the shelf" or "Out 1h 20m" (a running time, or the date for one out a long time). */
  copyStatus(c: BggItem): string {
    if (!c.is_checked_out) return 'On the shelf';
    const out = parseTteDate(c.last_checkout_date)?.getTime();
    if (!out) return 'Checked out';
    const ms = this.now() - out;
    return ms > 2 * 86_400_000 ? `Out since ${formatLibraryDate(out)}` : `Out ${shortDuration(ms)}`;
  }

  bgg = computed(() => bggUrl(this.game()));
  howToPlay = computed(() => howToPlayUrl(this.game()));
  hot = computed(() => isHotGame(this.game().name, this.now()));
  /** Missing pieces / damage / helpful extras for this copy (null when there's nothing to say). */
  notice = computed(() => gameNotice(this.game()));
  private map = inject(MapService);
  /** Where the Hot Games room is on this convention's venue map (null if no map). */
  hotMap = computed(() => this.hot() ? this.map.hotGamesRequest() : null);
  libraryMap = computed(() => this.map.libraryRequest(this.shelf()));
  showLibraryMap(): void {
    const request = this.libraryMap();
    if (request) this.map.show(request);
  }

  /** Opens the venue map over this sheet; closing the map comes back here. */
  showHotMap(): void {
    const request = this.hotMap();
    if (request) this.map.show(request);
  }
  actionLabel = computed(() => {
    const list = this.listName();
    if (!list) return 'Add to a list';
    return this.inList() ? `Remove from ${list}` : `Add to ${list}`;
  });
  checkedOutText = computed(() => {
    const d = this.due();
    if (!d) return '';
    return `Checked out ${this.time(d.checkedOutAt)} (${shortDuration(this.now() - d.checkedOutAt)} ago).`;
  });

  note = computed(() => (this.game().description || '').trim());
  noteIsIncludes = computed(() => /^includes\b/i.test(this.note()));

  /**
   * Shares a short status message plus a link that opens this game in the app
   * (?game=<id>, handled by the Library page). Uses the phone's share menu;
   * where that's missing (most laptops) it copies the text instead. The time
   * is included because the status can change after it's sent.
   */
  async share(): Promise<void> {
    const game = this.game();
    const now = this.now();
    const due = this.due();
    const status = !game.is_checked_out
      ? `is available on shelf ${this.shelf()} (as of ${formatLibraryTime(now, now)})`
      : due && !due.stale && !due.isLate
        ? `is checked out, due back by ${formatLibraryTime(due.dueAt, now)} (shelf ${this.shelf()})`
        : `is checked out right now (shelf ${this.shelf()})`;
    const text = `${game.name} ${status}`;
    const url = new URL(`?game=${encodeURIComponent(game.id)}`, document.baseURI).href;
    try {
      if (navigator.share) {
        await navigator.share({ title: game.name, text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        this.toast.show({ text: 'Copied. Paste it into your group chat.' });
      }
    } catch (err: any) {
      // AbortError = the user closed the share menu; nothing to report.
      if (err?.name !== 'AbortError') {
        this.toast.error("Couldn't share. Try again.");
      }
    }
  }

  time(ms: number): string {
    return formatLibraryTime(ms, this.now());
  }

  date(ms: number): string {
    return formatLibraryDate(ms);
  }
}
