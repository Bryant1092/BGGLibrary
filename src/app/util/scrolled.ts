import { DestroyRef, inject, signal, Signal } from '@angular/core';

/**
 * True once the page has scrolled more than `px` down. Library and My Lists use it to show a
 * search / list button in the slim pinned title row after the controls scroll away
 * (audit 2026-11-20). Call from an injection context (a field initializer).
 */
export function scrolledPast(px: number): Signal<boolean> {
  const value = signal(typeof window !== 'undefined' && window.scrollY > px);
  if (typeof window === 'undefined') return value;
  const onScroll = () => {
    const next = window.scrollY > px;
    if (next !== value()) value.set(next);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  inject(DestroyRef).onDestroy(() => window.removeEventListener('scroll', onScroll));
  return value.asReadonly();
}

/**
 * Brings the scrolled-away controls back: focus first (iPhone only opens the keyboard for a
 * focus inside the tap itself), then scroll to the top.
 */
export function revealControls(input?: HTMLInputElement): void {
  input?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
