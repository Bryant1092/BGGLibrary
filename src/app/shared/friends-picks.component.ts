import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, mergeMap, of, Subject } from 'rxjs';
import { BggItem } from '../model/bgg.model';
import { Game } from '../model/game.model';
import { BggService } from '../service/bgg.service';
import { FriendsService, GamePick } from '../service/friends.service';
import { ToastService } from '../service/toast.service';
import { shelfText, statusText } from '../util/game-format';
import { InViewDirective } from './in-view.directive';
import { ThumbComponent } from './thumb.component';
import { IconComponent } from './icon.component';

type Filter = 'all' | 'most' | 'any';

/**
 * Friends' picks (inside My Lists, so the tab bar stays at four tabs): every game
 * you or your friends want, most-wanted first, with who wants it and whether it's
 * on the shelf right now. Answers the group's question at the library: "what
 * should we grab first?"
 *
 * Each person counts once per game. Friends' games come only from lists they've
 * set to "Friends can see". Availability is fetched only for rows that scroll
 * into view (like Browse a shelf), 4 at a time.
 */
@Component({
  selector: 'app-friends-picks',
  standalone: true,
  imports: [RouterLink, InViewDirective, ThumbComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* margin 0: .bl-chips normally bleeds into the header's padding; here there's none. */
    .chips { padding: 12px 16px 4px; margin: 0; }
    .who { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .count { font-size: 13px; font-weight: 700; color: var(--bl-accent-text); }
    .dots { display: flex; }
    .dot { width: 22px; height: 22px; border-radius: 11px; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center;
      background: var(--bl-accent-soft); color: var(--bl-accent-text); box-shadow: 0 0 0 2px var(--bl-surface); }
    .dot + .dot { margin-left: -5px; }
    .dot.me { background: var(--bl-accent); color: var(--bl-on-accent); }
    .line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--bl-muted); }
  `,
  template: `
    @if (data() === null) {
      <p class="bl-sheet-note" style="padding: 16px">Loading your group's picks…</p>
    } @else if (data()!.people.length < 2) {
      <div class="bl-empty">
        <p class="title">See what your group wants</p>
        <p class="body">Add friends with their Meeple codes. Games on their lists (and yours) show up here, most-wanted first.</p>
        <a class="bl-btn outline" routerLink="/account" style="text-decoration: none">Add friends</a>
      </div>
    } @else {
      <div class="bl-chips chips" role="radiogroup" aria-label="Show games wanted by">
        @for (f of filters(); track f.value) {
          <button type="button" class="bl-chip" role="radio" [class.on]="filter() === f.value" [attr.aria-checked]="filter() === f.value" (click)="filter.set(f.value)">{{ f.label }}</button>
        }
      </div>
      @for (p of shown(); track p.game.id) {
        <div class="bl-row" (blInView)="want(p.game.id!)">
          <div class="bl-row-main" style="align-items: center">
            <app-thumb [src]="p.game.photo" [name]="p.game.name || ''" [size]="52" />
            <span class="bl-row-text">
              <span class="bl-name">{{ p.game.name }}</span>
              <span class="who">
                <span class="count">{{ p.wantedBy.length }} of {{ data()!.people.length }} want this</span>
                <!-- Initials, you first; names are in the label for screen readers. -->
                <span class="dots" [attr.aria-label]="names(p)" role="img">
                  @for (w of p.wantedBy; track w.uid) { <span class="dot" [class.me]="w.name === 'You'">{{ initial(w.name) }}</span> }
                </span>
              </span>
              <span class="line">
                @if (details().get(p.game.id!); as item) {
                  <span class="bl-pill" [class.out]="item.is_checked_out">{{ status(item) }}</span>
                  <span>Shelf {{ shelf(item) }}</span>
                } @else {
                  <span class="bl-pill checking">Checking…</span>
                }
              </span>
            </span>
          </div>
          @if (!wantedByMe(p)) {
            <button type="button" class="bl-add" [class.on]="added().has(p.game.id!)" [attr.aria-label]="'Me too: add ' + p.game.name + ' to your list'" (click)="meToo(p.game)">
              <bl-icon [name]="added().has(p.game.id!) ? 'check' : 'plus'" [stroke]="2.5" />
            </button>
          }
        </div>
      } @empty {
        <div class="bl-empty"><p class="title">No games match</p><p class="body">Try "Anyone" to see every game your group wants.</p></div>
      }
    }
  `,
})
export class FriendsPicksComponent implements OnInit {
  private friends = inject(FriendsService);
  private bgg = inject(BggService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  data = signal<{ people: { uid: string; name: string }[]; games: GamePick[] } | null>(null);
  filter = signal<Filter>('any');
  details = signal<Map<string, BggItem>>(new Map());
  added = signal<Set<string>>(new Set());
  private requested = new Set<string>();
  private queue = new Subject<string>();
  private now = Date.now();

  /** "Most of us" = at least half the group (and at least 2), e.g. 4+ of 7. */
  private mostCount = computed(() => Math.max(2, Math.ceil((this.data()?.people.length || 0) / 2)));
  filters = computed(() => [
    { value: 'all' as Filter, label: 'Everyone' },
    { value: 'most' as Filter, label: `Most of us (${this.mostCount()}+)` },
    { value: 'any' as Filter, label: 'Anyone' },
  ]);
  shown = computed(() => {
    const d = this.data();
    if (!d) return [];
    const need = this.filter() === 'all' ? d.people.length : this.filter() === 'most' ? this.mostCount() : 1;
    return d.games.filter(p => p.wantedBy.length >= need);
  });

  ngOnInit(): void {
    this.friends.picks$().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(d => this.data.set(d));
    this.queue.pipe(
      mergeMap(id => this.bgg.getBggGameInfo(id).pipe(catchError(() => of(null))), 4),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r: any) => {
      const item = r?.result as BggItem | undefined;
      if (item?.id) this.details.update(m => new Map(m).set(item.id, item));
    });
  }

  want(id: string): void {
    if (!id || this.requested.has(id)) return;
    this.requested.add(id);
    this.queue.next(id);
  }

  wantedByMe(p: GamePick): boolean {
    return p.wantedBy.some(w => w.name === 'You') || this.added().has(p.game.id!);
  }

  initial(name: string): string {
    return (name.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();
  }

  names(p: GamePick): string {
    return 'Wanted by ' + p.wantedBy.map(w => w.name).join(', ');
  }

  status(item: BggItem): string {
    return statusText(item, this.now);
  }

  shelf(item: BggItem): string {
    return shelfText(item);
  }

  meToo(game: Game): void {
    this.friends.meToo(game).then(listName => {
      this.added.update(s => new Set(s).add(game.id!));
      this.toast.show({ text: `Added to ${listName}` });
    }).catch(err => this.toast.error(err?.message === 'no-list' ? 'Make a list first (tap the List button above).' : "Couldn't add it. Check your connection."));
  }
}
