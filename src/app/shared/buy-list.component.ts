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
  imports: [InViewDirective, ThumbComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--bl-muted); }
    .up { color: var(--bl-avail-text); font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
    .remove { flex: none; width: 44px; height: 44px; border: 0; border-radius: 22px; background: var(--bl-accent-soft); color: var(--bl-accent-text);
      display: flex; align-items: center; justify-content: center; }
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
