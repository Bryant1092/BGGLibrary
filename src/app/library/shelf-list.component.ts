import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, NgZone, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { BggItem } from '../model/bgg.model';
import { PlayTimeFilter } from '../service/bgg.service';
import { BggService } from '../service/bgg.service';
import { ShelfGame, ShelfInfo, ShelfService } from '../service/shelf.service';
import { ToastService } from '../service/toast.service';
import { IconComponent } from '../shared/icon.component';
import { InViewDirective } from '../shared/in-view.directive';
import { SheetComponent } from '../shared/sheet.component';
import { ThumbComponent } from '../shared/thumb.component';
import { statusText } from '../util/game-format';

/** Rows drawn at first; more are added as you scroll (a shelf can hold 900+ games). */
const FIRST_ROWS = 60;
const MORE_ROWS = 80;
/** Racks and bins this long get the letter index; letter shelves are already one letter. */
const INDEX_MIN_GAMES = 100;

/**
 * "A"–"Z", or "#" for digits and anything else, the way the library files games:
 * ignoring leading punctuation ("¡Adiós" → A) and a leading A/An/The ("A Carnivore
 * Did It!" → C). Matches sortKey() in scripts/build-shelf-index.mjs.
 */
function letterOf(name: string): string {
  const c = shelfKey(name).charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

/** The name as the shelf orders it (see letterOf). */
function shelfKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^[^a-z0-9]+/i, '').replace(/^(the|an|a)s+/i, '').toLowerCase();
}

const LETTER_ORDER = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/**
 * "Browse a shelf": the games on one library shelf, in shelf (A–Z) order, for
 * when you're standing in front of it.
 *
 * - The list comes from ShelfService (built at deploy); each row's
 *   availability is fetched live as it scrolls into view ("Checking…" until then).
 * - Search, Players and Play time narrow the shelf on the phone, instantly.
 *   "Available now" and Sort don't apply here (Library hides them): the shelf's
 *   own order is the point, and availability is only known for rows seen so far.
 * - Long racks/bins (CARD RACK, NEW…) get a letter index down the right edge,
 *   like Contacts: tap or slide to a letter. Its letters are small, so "Jump
 *   to letter" in the header opens the same letters as full-size buttons for
 *   anyone who finds the strip hard to hit (WCAG 2.5.8 target size).
 */
@Component({
  selector: 'app-shelf-list',
  standalone: true,
  imports: [IconComponent, ThumbComponent, InViewDirective, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // has-index leaves room on the right of each row so the letter strip never covers the + button.
  host: { '[class.has-index]': 'showIndex() && letters().length > 1', '[style.--strip-top.px]': 'stripTop()' },
  template: `
    <div class="shelf-head">
      <span class="shelf-badge" aria-hidden="true"><small>Shelf</small><strong [class.long]="info().shelf.length > 3">{{ info().shelf }}</strong></span>
      <span class="shelf-title">
        <strong>{{ title() }}</strong>
        <span>{{ countText() }}</span>
      </span>
      @if (showIndex()) {
        <button type="button" class="bl-link-btn" (click)="jumpSheet.set(true)">Jump to letter</button>
      }
    </div>

    @if (games() === undefined) {
      @for (n of [1, 2, 3, 4, 5]; track n) {
        <div class="bl-row" aria-hidden="true"><div class="bl-row-main"><div class="bl-thumb bl-skel"></div>
          <div class="bl-row-text"><div class="bl-skel" style="height: 16px; width: 70%"></div><div class="bl-skel" style="height: 14px; width: 40%"></div></div></div></div>
      }
    } @else if (games() === null) {
      <div class="bl-empty">
        <p class="title">Couldn't load this shelf</p>
        <p class="body">Check your connection and try again. Shelves you've opened before work offline.</p>
        <button type="button" class="bl-btn outline" (click)="retry()">Try again</button>
      </div>
    } @else {
      @for (row of visibleRows(); track row.game.id) {
        @if (row.letterStart) {
          <h3 class="bl-section shelf-letter" [attr.id]="'shelf-letter-' + row.letter">{{ row.letter }}</h3>
        }
        <div class="bl-row" (blInView)="shelf.want(row.game.id)">
          <button type="button" class="bl-row-main" (click)="openGame(row.game)">
            <app-thumb [src]="row.game.thumb" [name]="row.game.name" />
            <span class="bl-row-text">
              <span class="bl-name">{{ row.game.name }}</span>
              <span class="bl-status-line">
                @if (row.status) {
                  <span class="bl-pill" [class.out]="row.out">{{ row.status }}</span>
                } @else {
                  <span class="bl-pill checking">Checking…</span>
                }
              </span>
              <span class="bl-meta">
                <span><bl-icon name="users" [size]="15" /><span class="visually-hidden">Players</span>{{ row.players }}</span>
                <span><bl-icon name="clock" [size]="15" />{{ row.minutes }} min</span>
              </span>
            </span>
          </button>
          <button type="button" class="bl-add" [class.on]="row.inList" [disabled]="row.busy" [attr.aria-pressed]="row.inList"
                  [attr.aria-label]="(row.inList ? 'Remove ' + row.game.name + ' from ' : 'Add ' + row.game.name + ' to ') + (listName() || 'a list')"
                  (click)="addGame(row.game)">
            <bl-icon [name]="row.inList ? 'check' : 'plus'" [stroke]="2.5" />
          </button>
        </div>
      } @empty {
        <div class="bl-empty">
          <p class="title">No games on this shelf match</p>
          <p class="body">Try fewer filters or a different spelling.</p>
        </div>
      }
      @if (visibleRows().length < filtered().length) {
        <!-- Drawing more rows as this comes into view keeps long shelves fast on phones. -->
        <div class="bl-more" (blInView)="showMore()">
          <button type="button" class="bl-btn outline" (click)="showMore()">Show more games</button>
        </div>
      }
    }

    @if (showIndex() && letters().length > 1) {
      <!--
        Letter index. Pointer events (outside Angular, for smooth sliding) pick the letter
        under the finger; each letter is also a real button for keyboards and screen readers.
      -->
      <nav #strip class="shelf-index" aria-label="Jump to letter">
        @for (l of letters(); track l) {
          <button type="button" [attr.aria-label]="'Jump to ' + (l === '#' ? 'numbers' : l)" (click)="jumpTo(l)">{{ l }}</button>
        }
      </nav>
      @if (bubble()) { <div class="shelf-bubble" aria-hidden="true">{{ bubble() }}</div> }
    }

    @if (jumpSheet()) {
      <app-sheet label="Jump to letter" (closed)="jumpSheet.set(false)">
        <h2>Jump to letter</h2>
        <div class="bl-option-grid" style="grid-template-columns: repeat(6, minmax(0, 1fr))">
          @for (l of letters(); track l) {
            <button type="button" class="bl-option" (click)="jumpSheet.set(false); jumpTo(l)">{{ l }}</button>
          }
        </div>
      </app-sheet>
    }
  `,
})
export class ShelfListComponent {
  shelf = inject(ShelfService);
  private bgg = inject(BggService);
  private toast = inject(ToastService);
  private zone = inject(NgZone);
  private destroyRef = inject(DestroyRef);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private strip = viewChild<ElementRef<HTMLElement>>('strip');

  info = input.required<ShelfInfo>();
  thumbHost = input('');
  query = input('');
  players = input<number | null>(null);
  playTime = input<PlayTimeFilter | null>(null);
  now = input(Date.now());
  listIds = input<Set<string>>(new Set());
  busyIds = input<Set<string>>(new Set());
  listName = input<string | undefined>(undefined);

  /** Open a game's details / add or remove it (Library does both, with the live game). */
  open = output<BggItem>();
  toggle = output<BggItem>();

  /** undefined while loading, null if it failed. */
  games = signal<ShelfGame[] | null | undefined>(undefined);
  private shown = signal(FIRST_ROWS);
  jumpSheet = signal(false);
  bubble = signal('');
  private reload = signal(0);
  /** Where the letter strip starts: just under Library's pinned header, whose height varies. */
  stripTop = signal(260);

  title = computed(() => {
    const s = this.info().shelf;
    return s.length === 1 ? `Shelf ${s}` : s === '#' ? 'Shelf #' : s.charAt(0) + s.slice(1).toLowerCase();
  });
  showIndex = computed(() => this.info().shelf.length > 1 && this.info().count >= INDEX_MIN_GAMES);

  /** Shelf games narrowed by search / players / play time (same rules as Library's server filters). */
  filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const p = this.players();
    const t = this.playTime();
    return (this.games() || []).filter(g =>
      (!q || g.name.toLowerCase().includes(q))
      && (!p || (g.minPlayers <= p && p <= g.maxPlayers))
      && (!t || (t === 'upTo30' ? g.maxMinutes > 0 && g.maxMinutes <= 30 : t === 'upTo60' ? g.maxMinutes > 0 && g.maxMinutes <= 60 : g.maxMinutes > 60)));
  });

  countText = computed(() => {
    const all = this.games()?.length ?? this.info().count;
    const shown = this.filtered().length;
    return (this.games() && shown !== all ? `${shown} of ${all} games` : `${all} games`) + ' · in shelf order';
  });

  /** Letters that have games, always in #, A–Z order. */
  letters = computed(() => {
    const present = new Set(this.filtered().map(g => letterOf(g.name)));
    return LETTER_ORDER.filter(l => present.has(l));
  });

  visibleRows = computed(() => {
    const live = this.shelf.live();
    const now = this.now();
    const ids = this.listIds();
    const busy = this.busyIds();
    const index = this.showIndex();
    let last = '';
    return this.filtered().slice(0, this.shown()).map(game => {
      const item = live.get(game.id);
      const letter = letterOf(game.name);
      const letterStart = index && letter !== last;
      last = letter;
      return {
        game, letter, letterStart,
        status: item ? statusText(item, now) : '',
        out: !!item?.is_checked_out,
        players: game.minPlayers === game.maxPlayers ? `${game.minPlayers}` : `${game.minPlayers}–${game.maxPlayers}`,
        minutes: game.minMinutes === game.maxMinutes ? `${game.minMinutes}` : `${game.minMinutes}–${game.maxMinutes}`,
        inList: ids.has(game.id),
        busy: busy.has(game.id),
      };
    });
  });

  constructor() {
    // Loads the shelf whenever a different one is picked (or after "Try again").
    toObservable(computed(() => ({ info: this.info(), host: this.thumbHost(), n: this.reload() }))).pipe(
      switchMap(({ info, host }) => {
        this.games.set(undefined);
        this.shown.set(FIRST_ROWS);
        return info ? this.shelf.games(info, host) : of(null);
      }),
      takeUntilDestroyed()
    // Sorted here too (it's quick), so shelf order and the letter index always agree,
    // even with a shelf file cached from an older build.
    ).subscribe(games => this.games.set(games && [...games].sort((a, b) => {
      const la = LETTER_ORDER.indexOf(letterOf(a.name)), lb = LETTER_ORDER.indexOf(letterOf(b.name));
      return la - lb || shelfKey(a.name).localeCompare(shelfKey(b.name));
    })));

    afterNextRender(() => {
      const header = document.querySelector('.bl-header') as HTMLElement | null;
      if (!header) return;
      const measure = new ResizeObserver(() => this.stripTop.set(header.getBoundingClientRect().bottom));
      measure.observe(header);
      this.destroyRef.onDestroy(() => measure.disconnect());
    });

    // Sliding a finger along the letter strip: handled outside Angular so it stays smooth.
    const onStrip = (e: PointerEvent) => {
      const strip = this.strip()?.nativeElement;
      if (!strip || (e.type === 'pointermove' && !e.buttons && e.pointerType === 'mouse')) return;
      const button = document.elementFromPoint(strip.getBoundingClientRect().left + strip.offsetWidth / 2, e.clientY)?.closest('.shelf-index button');
      const letter = button?.textContent?.trim();
      if (!letter) return;
      e.preventDefault();
      this.zone.run(() => { this.bubble.set(letter); this.jumpTo(letter); });
    };
    const end = () => this.zone.run(() => setTimeout(() => this.bubble.set(''), 350));
    this.zone.runOutsideAngular(() => {
      const el = this.host.nativeElement;
      const down = (e: PointerEvent) => {
        if (!(e.target as Element).closest('.shelf-index')) return;
        (e.target as Element).closest('.shelf-index')!.setPointerCapture?.(e.pointerId);
        onStrip(e);
      };
      const move = (e: PointerEvent) => { if ((e.target as Element).closest?.('.shelf-index') || this.bubble()) onStrip(e); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      this.destroyRef.onDestroy(() => {
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', end);
        el.removeEventListener('pointercancel', end);
      });
    });
  }

  retry(): void {
    this.reload.update(n => n + 1);
  }

  showMore(): void {
    this.shown.update(n => Math.min(n + MORE_ROWS, this.filtered().length));
  }

  /**
   * Scrolls so the letter's first game sits just under the page's pinned header.
   *
   * The jump is instant, like the index in Contacts: an animated scroll across
   * hundreds of rows ended up hundreds of pixels off, because rows passed on
   * the way finish laying out (text, images, live status) and shift the page
   * mid-animation. After the jump it re-aligns twice as things settle, unless
   * you've started scrolling yourself.
   */
  jumpTo(letter: string): void {
    const index = this.filtered().findIndex(g => letterOf(g.name) === letter);
    if (index < 0) return;
    // Rows past the drawn ones don't exist yet: draw up to the target (plus a screenful).
    if (index >= this.shown()) this.shown.set(Math.min(index + 30, this.filtered().length));
    const align = (): number | null => {
      const target = document.getElementById('shelf-letter-' + letter);
      if (!target) return null;
      const header = document.querySelector('.bl-header') as HTMLElement | null;
      // Only a pinned header covers the letter; sideways it scrolls away (styles.css, landscape).
      const pinned = header && getComputedStyle(header).position === 'sticky' ? header.offsetHeight : 0;
      const top = Math.round(target.getBoundingClientRect().top + window.scrollY - pinned);
      // 'instant', not 'auto': Bootstrap's base styles set scroll-behavior: smooth on the page, which 'auto' would follow.
      window.scrollTo({ top, behavior: 'instant' as ScrollBehavior });
      return window.scrollY;
    };
    requestAnimationFrame(() => {
      let expected = align();
      for (const delay of [150, 600]) {
        setTimeout(() => {
          if (expected === null || Math.abs(window.scrollY - expected) > 2) return; // the user scrolled since
          expected = align();
        }, delay);
      }
    });
  }

  /** Details need the full live game; use it if this row already loaded, else fetch it first. */
  openGame(game: ShelfGame): void {
    this.withLive(game, item => this.open.emit(item));
  }

  addGame(game: ShelfGame): void {
    this.withLive(game, item => this.toggle.emit(item));
  }

  private withLive(game: ShelfGame, then: (item: BggItem) => void): void {
    const item = this.shelf.live().get(game.id);
    if (item) return then(item);
    this.bgg.getBggGameInfo(game.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r: any) => r?.result?.id ? then(r.result) : this.toast.error("Couldn't open this game. Check your connection."),
      error: () => this.toast.error("Couldn't open this game. Check your connection."),
    });
  }
}
