import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Friend, FriendList, FriendsService } from '../service/friends.service';
import { Reaction, ReactionsService } from '../service/reactions.service';
import { ToastService } from '../service/toast.service';
import { Game } from '../model/game.model';
import { SheetComponent } from './sheet.component';
import { ThumbComponent } from './thumb.component';
import { IconComponent } from './icon.component';

/**
 * A friend's page: what you both want first (the games worth grabbing together),
 * then the rest of their visible lists with "Me too", which adds the game to your
 * current list. View only: their lists can't be changed from here.
 */
@Component({
  selector: 'app-friend-sheet',
  standalone: true,
  imports: [SheetComponent, ThumbComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .head { display: flex; align-items: center; gap: 12px; }
    .avatar { width: 48px; height: 48px; border-radius: 24px; background: var(--bl-accent-soft); color: var(--bl-accent-text); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; flex: none; }
    .head small { display: block; color: var(--bl-muted); font-size: 14px; }
    h3 { margin: 4px 0 0; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--bl-muted); }
    .game { display: flex; align-items: center; gap: 12px; min-height: 56px; border-bottom: 1px solid var(--bl-hair); }
    .game span { flex: 1; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
    .their { font-weight: 500; color: var(--bl-muted); }
    .their.up { color: var(--bl-avail-text); }
    .both { color: var(--bl-avail-text); font-size: 13px; font-weight: 700; }
    .none { margin: 0; color: var(--bl-muted); }
    .remove { align-self: center; }
  `,
  template: `
    <app-sheet [label]="friend().name" (closed)="closed.emit()">
      <div class="head">
        <span class="avatar" aria-hidden="true">{{ initial() }}</span>
        <div><h2>{{ friend().name }}</h2><small>{{ friend().code }} · {{ listCount() }}</small></div>
      </div>

      @if (lists() === null) {
        <p class="none">Loading their lists…</p>
      } @else if (!theirGames().length) {
        <p class="none">No games to show yet. Only lists they've set to "Friends can see" appear here.</p>
      } @else {
        @if (both().length) {
          <h3>You both want · {{ both().length }}</h3>
          <div>
            @for (g of both(); track g.id) {
              <div class="game"><app-thumb [src]="g.photo" [name]="g.name || ''" [size]="44" /><span>{{ g.name }}@if (theirRatings().get(g.id!)?.liked === true) { <small class="their up"> · 👍 they liked it</small> } @else if (theirRatings().get(g.id!)?.liked === false) { <small class="their"> · 👎 not for them</small> }</span><span class="both" style="flex: none">✓ both</span></div>
            }
          </div>
        }
        @if (rest().length) {
          <h3>Also on their lists · {{ rest().length }}</h3>
          <div>
            @for (g of rest(); track g.id) {
              <div class="game">
                <app-thumb [src]="g.photo" [name]="g.name || ''" [size]="44" /><span>{{ g.name }}@if (theirRatings().get(g.id!)?.liked === true) { <small class="their up"> · 👍 they liked it</small> } @else if (theirRatings().get(g.id!)?.liked === false) { <small class="their"> · 👎 not for them</small> }</span>
                <!-- "Me too" adds it to your current list (the one the Library's + uses). -->
                <button type="button" class="bl-add" [class.on]="added().has(g.id!)" [disabled]="busy().has(g.id!)"
                        [attr.aria-label]="added().has(g.id!) ? g.name + ' added to your list' : 'Me too: add ' + g.name + ' to your list'" (click)="meToo(g)">
                  <bl-icon [name]="added().has(g.id!) ? 'check' : 'plus'" [stroke]="2.5" />
                </button>
              </div>
            }
          </div>
        }
      }

      @if (confirmRemove()) {
        <button type="button" class="bl-btn danger" (click)="remove()">Remove {{ friend().name }} as a friend</button>
        <button type="button" class="bl-btn secondary" (click)="confirmRemove.set(false)">Cancel</button>
      } @else {
        <button type="button" class="bl-link-btn remove" (click)="confirmRemove.set(true)">Remove friend</button>
      }
    </app-sheet>
  `,
})
export class FriendSheetComponent implements OnInit {
  friend = input.required<Friend>();
  closed = output<void>();
  private friends = inject(FriendsService);
  private reactionsService = inject(ReactionsService);
  /** Their thumbs (empty if they don't share ratings). */
  theirRatings = signal<Map<string, Reaction>>(new Map());
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  lists = signal<FriendList[] | null>(null);
  private mine = signal<Set<string>>(new Set());
  /** Games added with "Me too" while this sheet is open (before the live data catches up). */
  added = signal<Set<string>>(new Set());
  busy = signal<Set<string>>(new Set());
  confirmRemove = signal(false);

  initial = computed(() => (this.friend().name.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase());
  listCount = computed(() => {
    const n = this.lists()?.length ?? 0;
    return n === 1 ? '1 list shared with friends' : `${n} lists shared with friends`;
  });
  /** Their games once each (the same game can be on several of their lists). */
  theirGames = computed(() => {
    const seen = new Map<string, Game>();
    for (const l of this.lists() || []) for (const g of l.gameList || []) if (g?.id && !seen.has(g.id)) seen.set(g.id, g);
    return [...seen.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });
  both = computed(() => this.theirGames().filter(g => this.mine().has(g.id!)));
  rest = computed(() => this.theirGames().filter(g => !this.mine().has(g.id!)));

  ngOnInit(): void {
    this.friends.friendLists$(this.friend().uid).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(l => this.lists.set(l));
    this.reactionsService.friendReactions$(this.friend().uid).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(r => this.theirRatings.set(r));
    this.friends.myGames$().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(games => this.mine.set(new Set(games.map(g => g.id!).filter(Boolean))));
  }

  meToo(game: Game): void {
    if (this.added().has(game.id!)) return;
    this.busy.update(s => new Set(s).add(game.id!));
    this.friends.meToo(game).then(listName => {
      this.added.update(s => new Set(s).add(game.id!));
      this.toast.show({ text: `Added to ${listName}` });
    }).catch(err => {
      this.toast.error(err?.message === 'no-list' ? 'Make a list in My Lists first.' : "Couldn't add it. Check your connection.");
    }).finally(() => this.busy.update(s => { const n = new Set(s); n.delete(game.id!); return n; }));
  }

  remove(): void {
    const name = this.friend().name;
    this.friends.remove(this.friend().uid).then(() => {
      this.toast.show({ text: `Removed ${name}` });
      this.closed.emit();
    }).catch(() => this.toast.error("Couldn't remove. Check your connection."));
  }
}
