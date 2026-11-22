import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, mergeMap, of, Subject } from 'rxjs';
import { BggItem } from '../model/bgg.model';
import { BggService } from '../service/bgg.service';
import { ReactionsService } from '../service/reactions.service';
import { ToastService } from '../service/toast.service';
import { shelfText, statusText } from '../util/game-format';
import { InViewDirective } from './in-view.directive';
import { ThumbComponent } from './thumb.component';
import { IconComponent } from './icon.component';
import { SheetComponent } from './sheet.component';

/**
 * Buy list (inside My Lists): every game you marked Want to buy, from any list or
 * from the Library, in one place. It's the shopping list for the exhibit hall and
 * the Bazaar. Before, the "Want to buy" filter only covered the list you were looking
 * at, and games marked from the Library weren't on any list at all.
 *
 * Library availability is shown too (you may want to play it again before buying),
 * fetched only for rows on screen, like Friends' picks.
 */
@Component({
  selector: 'app-buy-list',
  standalone: true,
  imports: [InViewDirective, ThumbComponent, IconComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--bl-muted); }
    .up { color: var(--bl-avail-text); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
    .remove { flex: none; width: 44px; height: 44px; border: 0; border-radius: 22px; background: var(--bl-tonal); color: var(--bl-on-tonal);
      display: flex; align-items: center; justify-content: center; }
    /* "Prices" sits on the row, left of the remove button (row actions go on the right, as + and the bell do elsewhere). */
    .prices { flex: none; min-height: 44px; padding: 0 12px; margin-right: 6px; border: 0; border-radius: 22px; background: var(--bl-tonal); color: var(--bl-on-tonal); font: inherit; font-size: 14px; font-weight: 700; }
    /* Two columns of store cards (mockup 7 on the canvas, 2026-11-22): every store fits on one
       screen. Rows share one height (grid-auto-rows: 1fr) so a two-line name doesn't make the
       grid uneven. Letter tiles, not store logos: no trademark permission needed and nothing
       loaded from other sites. Still links underneath, since each opens another website. */
    .stores { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 8px; margin: 12px 0; }
    .store { display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 8px 10px 8px 8px; box-sizing: border-box;
      border-radius: 14px; background: var(--bl-field); border: 1px solid var(--bl-control-border); color: var(--bl-text); text-decoration: none;
      -webkit-tap-highlight-color: transparent; transition: transform .1s ease, background-color .1s ease; }
    .store:active { background: var(--bl-tonal); transform: scale(.97); }
    .mono { flex: none; width: 32px; height: 32px; border-radius: 8px; background: var(--bl-accent-soft); color: var(--bl-accent-text);
      display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; letter-spacing: -.02em; }
    .mono.long { font-size: 10px; }
    .store-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .store-txt strong { font-size: 15px; line-height: 18px; font-weight: 650;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .store-txt small { font-size: 12px; color: var(--bl-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .store-sub { margin: 4px 0 0; font-size: 13px; color: var(--bl-muted); display: flex; align-items: center; gap: 5px; }
    .store-note { margin: 0; font-size: 13px; color: var(--bl-muted); }
  `,
  template: `
    @for (g of reactions.buyList(); track g.id) {
      <div class="bl-row" (blInView)="want(g.id)">
        <div class="bl-row-main" style="align-items: center">
          <app-thumb [src]="g.photo" [name]="g.name" [size]="52" />
          <span class="bl-row-text">
            <span class="bl-name">{{ g.name }}</span>
            <span class="line">
              @if (g.liked === true) { <span class="up"><bl-icon name="thumbUp" [size]="14" /> Liked</span> }
              @if (details().get(g.id); as item) {
                <span class="bl-pill" [class.out]="item.is_checked_out">{{ status(item) }}</span>
                <!-- Same pin icon as every other game row (was the word "Shelf"). -->
                <span class="bl-shelf"><bl-icon name="pin" [size]="14" [stroke]="2.2" /><span class="visually-hidden">Shelf</span>{{ shelf(item) }}</span>
              }
            </span>
          </span>
        </div>
        <!-- Store prices: opens a list of stores, each showing its own search for this game. -->
        <button type="button" class="prices" [attr.aria-label]="'Check prices for ' + g.name" (click)="pricesFor.set(g)">Prices</button>
        <!-- Bought it (or changed your mind): off the list, with Undo. -->
        <button type="button" class="remove" [attr.aria-label]="'Remove ' + g.name + ' from your buy list'" (click)="remove(g)">
          <bl-icon name="check" [size]="20" [stroke]="2.5" />
        </button>
      </div>
    } @empty {
      <div class="bl-empty">
        <p class="title">Your buy list is empty</p>
        <p class="body">After a game, turn on Want to buy (or open any game in the Library). It shows up here for the exhibit hall and the Bazaar.</p>
      </div>
    }
    @if (pricesFor(); as g) {
      <app-sheet [label]="'Check prices for ' + g.name" (closed)="pricesFor.set(null)">
        <h2>Check prices · {{ g.name }}</h2>
        <p class="store-sub">Each opens the store's own search for this game <bl-icon name="external" [size]="13" /></p>
        <div class="stores">
          @for (s of stores(g); track s.name) {
            <a class="store" [href]="s.url" target="_blank" rel="noopener" [attr.aria-label]="s.name + ', ' + s.note + ' (opens the store’s website)'">
              <span class="mono" [class.long]="s.mono.length > 2" aria-hidden="true">{{ s.mono }}</span>
              <span class="store-txt"><strong>{{ s.name }}</strong><small>{{ s.note }}</small></span>
            </a>
          }
        </div>
        <p class="store-note">Prices change; the app doesn't track them.</p>
      </app-sheet>
    }
  `,
})
export class BuyListComponent implements OnInit {
  reactions = inject(ReactionsService);
  private bgg = inject(BggService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  details = signal<Map<string, BggItem>>(new Map());
  private requested = new Set<string>();
  private queue = new Subject<string>();
  private now = Date.now();

  ngOnInit(): void {
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

  /** The game whose store list is open (null = closed). */
  pricesFor = signal<{ id: string; name: string } | null>(null);

  /**
   * "Check prices": links to each store's own search for the game (asked 2026-11-17).
   * Search links, not a price API: Amazon's pricing API needs an Associates account with
   * sales, Target has none, and copying prices off store pages breaks their terms. A link
   * needs no account or key and sends nothing about the person. Search addresses checked
   * 2026-11-17 (each returned results for "ark nova"); BoardGamePrices.com was left out
   * because it has no working search link. Local Dallas stores are included for the con.
   * Added 2026-11-22: Barnes & Noble, Books-A-Million, Miniature Market, Noble Knight, Tanuki
   * Games and Game Kastle (each checked with "azul" except Books-A-Million, which blocks
   * automated requests). Collected (Fort Worth) was left out: its ComicHub shop has no search link.
   * Walmart added the same day (14 stores = an even two-column grid).
   */
  stores(g: { id: string; name: string }): { name: string; mono: string; note: string; url: string }[] {
    // "Harmonies: Crescendo (English edition)" -> "Harmonies: Crescendo": edition notes hurt store searches.
    const q = encodeURIComponent(g.name.replace(/\s*[(\[].*?[)\]]\s*/g, ' ').replace(/\s+[-–]\s+(English|Multilingual).*$/i, '').trim());
    const bggId = this.details().get(g.id)?.bgg_id;
    // Always A–Z by store name (asked 2026-11-22), so a store is easy to find in a long list.
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return [
      { name: 'Amazon', mono: 'A', note: 'Online', url: `https://www.amazon.com/s?k=${q}+board+game` },
      { name: 'Barnes & Noble', mono: 'BN', note: 'Online', url: `https://www.barnesandnoble.com/search?q=${q}+board+game` },
      // Used copies, by BoardGameGeek id when the game's details have loaded.
      { name: 'BGG Marketplace', mono: 'BGG', note: 'Used copies', url: bggId
        ? `https://boardgamegeek.com/geekmarket/browse?objecttype=thing&objectid=${bggId}`
        : `https://boardgamegeek.com/geekmarket/browse?query=${q}` },
      // The store is Common Ground Games; boardgamesdallas.com is its website (renamed 2026-11-22).
      { name: 'Common Ground Games', mono: 'CG', note: 'Dallas', url: `https://www.boardgamesdallas.com/search?q=${q}` },
      { name: 'Boardwalk Games', mono: 'BW', note: 'Dallas area', url: `https://www.boardwalk-games.com/search?q=${q}` },
      // Books-A-Million and Walmart block automated checks, so these couldn't be tested from here (2026-11-22).
      { name: 'Books-A-Million', mono: 'BAM', note: 'Online', url: `https://www.booksamillion.com/search2?query=${q}+board+game` },
      // Small online stock (2 results for "azul", 10 for "catan").
      { name: 'Game Kastle', mono: 'GK', note: 'Austin', url: `https://gamekastle.com/search?q=${q}` },
      { name: 'GameNerdz', mono: 'GN', note: 'Online games', url: `https://www.gamenerdz.com/search.php?search_query=${q}` },
      { name: 'House Rules Board Games', mono: 'HR', note: 'Dallas', url: `https://houserulesboardgames.com/search?q=${q}` },
      { name: 'Miniature Market', mono: 'MM', note: 'Online games', url: `https://www.miniaturemarket.com/search?search=${q}` },
      { name: 'Noble Knight', mono: 'NK', note: 'Out of print', url: `https://www.nobleknight.com/Search?text=${q}` },
      { name: 'Tanuki Games', mono: 'TG', note: 'Austin, imports', url: `https://www.tanukigamesatx.com/search?q=${q}` },
      { name: 'Target', mono: 'T', note: 'Online', url: `https://www.target.com/s?searchTerm=${q}` },
      { name: 'Walmart', mono: 'W', note: 'Online', url: `https://www.walmart.com/search?q=${q}+board+game` },
    ].sort(byName);
  }

  status(item: BggItem): string { return statusText(item, this.now); }
  shelf(item: BggItem): string { return shelfText(item); }

  remove(g: { id: string; name: string; photo: string }): void {
    const game = { id: g.id, name: g.name, photo: g.photo };
    this.reactions.set(game, { buy: false }).then(() => this.toast.show({
      text: `Removed ${g.name}`, actionLabel: 'Undo',
      action: () => { this.reactions.set(game, { buy: true }).catch(() => {}); },
    })).catch(() => this.toast.error("Couldn't change that. Check your connection."));
  }
}
