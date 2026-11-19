import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
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
    .bgg { min-height: 44px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 15px; font-weight: 600; text-decoration: none; color: var(--bl-accent-text); }
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
        <div class="tile accent"><small>Location</small><strong>{{ shelf() }}</strong></div>
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
        <div class="cond" role="note">
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

      @if (game().is_checked_out) {
        <button type="button" class="bl-btn secondary" [attr.aria-pressed]="watched()" (click)="watchToggle.emit()"
                [style.color]="watched() ? 'var(--bl-accent-text)' : null" [style.border-color]="watched() ? 'var(--bl-accent-text)' : null">
          <bl-icon [name]="watched() ? 'bell' : 'bellOff'" [size]="20" />
          {{ watched() ? "We'll tell you when it's back" : "Notify me when it's back" }}
        </button>
      }
      <!-- Extra controls from the page that opened the sheet (e.g. Liked / Want to buy). -->
      <ng-content />
      <button type="button" class="bl-btn" [class.secondary]="inList()" [disabled]="busy()" (click)="toggle.emit()">{{ actionLabel() }}</button>
      <!-- Learning the rules before checking a game out saves table time. -->
      <a class="bl-btn secondary" style="text-decoration: none" [href]="howToPlay()" target="_blank" rel="noopener"
         [attr.aria-label]="'Watch how to play ' + game().name + ' (opens a YouTube search)'">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="4" fill="var(--bl-accent)"/><path d="M10 9.5v5l4.5-2.5z" fill="#fff"/></svg>
        Watch how to play
      </a>
      <span class="note" style="text-align: center; margin-top: -8px">Opens a YouTube search</span>
      <a class="bgg" [href]="bgg()" target="_blank" rel="noopener">
        View on BoardGameGeek <bl-icon name="external" [size]="16" />
      </a>
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
  bgg = computed(() => bggUrl(this.game()));
  howToPlay = computed(() => howToPlayUrl(this.game()));
  hot = computed(() => isHotGame(this.game().name, this.now()));
  /** Missing pieces / damage / helpful extras for this copy (null when there's nothing to say). */
  notice = computed(() => gameNotice(this.game()));
  private map = inject(MapService);
  /** Where the Hot Games room is on this convention's venue map (null if no map). */
  hotMap = computed(() => this.hot() ? this.map.hotGamesRequest() : null);

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
