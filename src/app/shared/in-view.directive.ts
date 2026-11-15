import { Directive, ElementRef, inject, OnDestroy, OnInit, output } from '@angular/core';

/**
 * Emits (blInView) when the element scrolls into view, and again each time it
 * comes back after leaving. Used by "Browse a shelf" so a game's live status is
 * only fetched for rows people actually see.
 *
 * One IntersectionObserver is shared by every row (creating one per row is
 * much heavier with hundreds of rows). The 200px margin starts loading just
 * before a row appears, so it's usually ready by the time it's on screen.
 */
@Directive({ selector: '[blInView]', standalone: true })
export class InViewDirective implements OnInit, OnDestroy {
  private static observer?: IntersectionObserver;
  private static callbacks = new WeakMap<Element, () => void>();

  blInView = output<void>();
  private el = inject<ElementRef<Element>>(ElementRef).nativeElement;

  private static shared(): IntersectionObserver {
    return InViewDirective.observer ??= new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) InViewDirective.callbacks.get(entry.target)?.();
      }
    }, { rootMargin: '200px 0px' });
  }

  ngOnInit(): void {
    InViewDirective.callbacks.set(this.el, () => this.blInView.emit());
    InViewDirective.shared().observe(this.el);
  }

  ngOnDestroy(): void {
    InViewDirective.observer?.unobserve(this.el);
    InViewDirective.callbacks.delete(this.el);
  }
}
