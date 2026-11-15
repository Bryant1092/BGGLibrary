import { AfterViewInit, ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject, NgZone, OnDestroy, signal, viewChild } from '@angular/core';
import { MapRequest, MapService } from '../service/map.service';
import { IconComponent } from './icon.component';

const MAX_ZOOM = 8;

/**
 * Full-screen venue map with a circled spot, or several labeled ones
 * (MapRequest.spots, e.g. all the HomeGrown playtesting rooms).
 *
 * Gestures: drag to pan, pinch (two fingers) or mouse wheel to zoom around
 * that point, double-tap to zoom in, plus +/-/fit buttons for one-handed use
 * and accessibility. It opens zoomed in and centered on the spot.
 *
 * Pointer handling runs outside Angular's change detection and writes the
 * transform straight to the element, so dragging stays smooth (a change
 * detection pass on every finger move would make it stutter on phones).
 */
@Component({
  selector: 'app-map-viewer',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { position: fixed; inset: 0; z-index: 70; display: flex; flex-direction: column; background: #1c1b1a; color: #fff; }
    .bar { display: flex; align-items: center; gap: 8px; padding: calc(8px + env(safe-area-inset-top)) 8px 8px; background: rgba(28, 27, 26, .96); z-index: 2; }
    .bar .label { flex: 1; min-width: 0; font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar button { color: #fff; }
    .switch { display: flex; gap: 4px; padding: 3px; border-radius: 12px; background: rgba(255, 255, 255, .12); }
    .switch button { min-height: 36px; padding: 0 12px; border: 0; border-radius: 9px; background: transparent; color: #fff; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
    .switch button.on { background: #fff; color: #1c1b1a; }
    .viewport { position: relative; flex: 1; overflow: hidden; touch-action: none; cursor: grab; background: #2b2a28; }
    .stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
    .stage img { display: block; width: 100%; height: 100%; user-select: none; -webkit-user-drag: none; pointer-events: none; }
    .spot { position: absolute; border-radius: 50%; transform: translate(-50%, -50%); border: 3px solid #f97316; box-shadow: 0 0 0 3px rgba(255, 255, 255, .9), 0 0 0 9999px rgba(0, 0, 0, .18); pointer-events: none; }
    .spot::after { content: ''; position: absolute; inset: -3px; border-radius: 50%; border: 3px solid #f97316; animation: pulse 1.6s ease-out infinite; }
    @keyframes pulse { to { transform: scale(1.8); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .spot::after { animation: none; } }
    /*
      Several places: each circle gets a number, and a legend lists the names. Name labels on
      the map overlapped when rooms are close together (Gaston, McMillan and Bryan Beeman are
      neighbours), so they're numbered like a map key instead. The numbers sit inside the zoomed
      map but are scaled back by 1/zoom (--inv, set in apply()) so they stay a readable size.
    */
    .spot.multi { box-shadow: 0 0 0 3px rgba(255, 255, 255, .9); }
    .spot-num { position: absolute; transform: translate(-50%, -50%) scale(var(--inv, 1)); width: 22px; height: 22px; border-radius: 11px;
      display: flex; align-items: center; justify-content: center; background: #f97316; color: #1c1b1a; font-size: 13px; font-weight: 800;
      box-shadow: 0 0 0 2px #fff; pointer-events: none; }
    .legend { position: absolute; left: 12px; bottom: calc(16px + env(safe-area-inset-bottom)); right: 76px; z-index: 2; margin: 0; padding: 6px; list-style: none;
      border-radius: 14px; background: rgba(28, 27, 26, .94); box-shadow: 0 2px 10px rgba(0, 0, 0, .4); }
    .legend button { width: 100%; min-height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 8px; border: 0; border-radius: 10px;
      background: transparent; color: #fff; font: inherit; font-size: 14px; font-weight: 600; text-align: left; cursor: pointer; }
    .legend button.on { background: rgba(255, 255, 255, .14); }
    .legend .n { flex: none; width: 22px; height: 22px; border-radius: 11px; display: flex; align-items: center; justify-content: center; background: #f97316; color: #1c1b1a; font-size: 13px; font-weight: 800; }
    .controls { position: absolute; right: 12px; bottom: calc(16px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 8px; z-index: 2; }
    .controls button { width: 48px; height: 48px; border-radius: 24px; border: 0; background: #fff; color: #1c1b1a; box-shadow: 0 2px 8px rgba(0, 0, 0, .35); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; cursor: pointer; }
    .loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #d6d3d1; font-size: 15px; }
  `,
  template: `
    @if (req(); as r) {
      <div class="bar">
        <button type="button" class="bl-icon-btn" aria-label="Close map" (click)="service.close()"><bl-icon name="close" /></button>
        <span class="label">{{ r.label || current()?.title + ' map' }}</span>
        @if ((service.maps()?.maps?.length || 0) > 1) {
          <div class="switch" role="tablist" aria-label="Map">
            @for (m of service.maps()!.maps; track m.id) {
              <button type="button" role="tab" [class.on]="m.id === r.map" [attr.aria-selected]="m.id === r.map" (click)="switchTo(m.id)">{{ m.title }}</button>
            }
          </div>
        }
      </div>
      <div #viewport class="viewport" role="img" [attr.aria-label]="(current()?.title || '') + ' map' + (r.label ? ', showing ' + r.label : '')">
        @if (!loaded()) { <div class="loading">Loading map…</div> }
        <div #stage class="stage" [style.width.px]="baseW()" [style.height.px]="baseH()">
          <img [src]="current()?.src" alt="" (load)="onLoad()" draggable="false">
          @if (r.spot && loaded()) {
            <span class="spot" [style.left.%]="r.spot.x" [style.top.%]="r.spot.y" [style.width.%]="r.spot.r * 2" [style.aspect-ratio]="1"></span>
          }
          @if (r.spots && loaded()) {
            <!-- The dimmed surround of a single spot is left off here; several overlapping would darken the map. -->
            @for (s of r.spots; track s.label; let i = $index) {
              <span class="spot multi" [style.left.%]="s.spot.x" [style.top.%]="s.spot.y" [style.width.%]="s.spot.r * 2" [style.aspect-ratio]="1"></span>
              <span class="spot-num" [style.left.%]="s.spot.x" [style.top.%]="s.spot.y">{{ i + 1 }}</span>
            }
          }
        </div>
        @if (r.spots && loaded()) {
          <!-- Map key: tap a place to zoom to it; tap it again to see them all. -->
          <ol class="legend" aria-label="Places on the map">
            @for (s of r.spots; track s.label; let i = $index) {
              <li><button type="button" [class.on]="focused() === i" [attr.aria-pressed]="focused() === i" (click)="focusOne(i)">
                <span class="n" aria-hidden="true">{{ i + 1 }}</span>{{ s.label }}
              </button></li>
            }
          </ol>
        }
        <div class="controls">
          <button type="button" aria-label="Zoom in" (click)="zoomBy(1.6)">+</button>
          <button type="button" aria-label="Zoom out" (click)="zoomBy(1 / 1.6)">−</button>
          <button type="button" [attr.aria-label]="r.spot || r.spots ? 'Center on ' + (r.label || 'the spot') : 'Fit map to screen'" (click)="r.spot || r.spots ? focusSpot() : fit()">
            <bl-icon [name]="r.spot || r.spots ? 'pin' : 'grid'" [size]="22" />
          </button>
        </div>
      </div>
    }
  `,
})
export class MapViewerComponent implements AfterViewInit, OnDestroy {
  service = inject(MapService);
  private zone = inject(NgZone);
  private viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private stage = viewChild<ElementRef<HTMLElement>>('stage');

  req = this.service.request;
  current = computed(() => this.service.maps()?.maps.find(m => m.id === this.req()?.map));
  loaded = signal(false);
  /** Which numbered place is zoomed to (legend), or -1 for all of them. */
  focused = signal(-1);
  /** Size of the map at zoom 1 = whole map fits the screen. */
  baseW = signal(0);
  baseH = signal(0);

  private scale = 1;
  private x = 0;
  private y = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private lastTap = 0;
  private cleanup: (() => void)[] = [];
  private returnFocusTo = document.activeElement as HTMLElement | null;

  ngAfterViewInit(): void {
    document.body.style.overflow = 'hidden';
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    this.zone.runOutsideAngular(() => {
      const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
        el.addEventListener(type, fn as EventListener, opts);
        this.cleanup.push(() => el.removeEventListener(type, fn as EventListener));
      };
      on('pointerdown', e => this.onDown(e));
      on('pointermove', e => this.onMove(e));
      on('pointerup', e => this.onUp(e));
      on('pointercancel', e => this.onUp(e));
      on('wheel', e => { e.preventDefault(); const p = this.pt(e); this.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y); }, { passive: false });
      const resize = () => this.layout(false);
      window.addEventListener('resize', resize);
      this.cleanup.push(() => window.removeEventListener('resize', resize));
    });
    this.layout(true);
  }

  ngOnDestroy(): void {
    this.cleanup.forEach(fn => fn());
    document.body.style.overflow = '';
    this.returnFocusTo?.focus?.({ preventScroll: true });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.service.close();
    else if (e.key === '+' || e.key === '=') this.zoomBy(1.6);
    else if (e.key === '-') this.zoomBy(1 / 1.6);
  }

  onLoad(): void {
    this.loaded.set(true);
    // The spot element appears after load; center on it once laid out.
    requestAnimationFrame(() => this.layout(true));
  }

  switchTo(id: MapRequest['map']): void {
    if (id === this.req()?.map) return;
    this.loaded.set(false);
    this.service.show({ map: id });
    requestAnimationFrame(() => this.layout(true));
  }

  zoomBy(factor: number): void {
    const el = this.viewport()?.nativeElement;
    if (el) this.zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  }

  fit(): void {
    this.scale = 1;
    this.center(0.5, 0.5);
  }

  /** Zoom so the circle is comfortably large (about 40% of the screen width) and center it. */
  focusSpot(): void {
    const spots = this.req()?.spots;
    if (spots?.length) {
      this.focused.set(-1);
      return this.focusAll(spots.map(s => s.spot));
    }
    const spot = this.req()?.spot;
    const el = this.viewport()?.nativeElement;
    if (!spot || !el) return this.fit();
    const circlePx = (spot.r * 2 / 100) * this.baseW();
    this.scale = Math.min(MAX_ZOOM, Math.max(1.5, (el.clientWidth * 0.4) / Math.max(circlePx, 1)));
    this.center(spot.x / 100, spot.y / 100);
  }

  /** Legend tap: zoom to one place, or back out to all of them if it's already the one shown. */
  focusOne(i: number): void {
    const spots = this.req()?.spots;
    if (!spots?.[i]) return;
    if (this.focused() === i) {
      this.focused.set(-1);
      this.focusAll(spots.map(s => s.spot));
      return;
    }
    this.focused.set(i);
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    const spot = spots[i].spot;
    const circlePx = (spot.r * 2 / 100) * this.baseW();
    this.scale = Math.min(MAX_ZOOM, Math.max(1.5, (el.clientWidth * 0.35) / Math.max(circlePx, 1)));
    this.center(spot.x / 100, spot.y / 100);
  }

  /** Zoom and center so every circle fits on screen, above the legend. */
  private focusAll(spots: { x: number; y: number; r: number }[]): void {
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    const aspect = this.baseW() / Math.max(this.baseH(), 1);
    // Percent of map width / height; labels hang below the circles, so leave extra room there.
    const left = Math.min(...spots.map(s => s.x - s.r * 2)), right = Math.max(...spots.map(s => s.x + s.r * 2));
    const top = Math.min(...spots.map(s => s.y - s.r * aspect * 2)), bottom = Math.max(...spots.map(s => s.y + s.r * aspect * 2));
    const boxW = (right - left) / 100 * this.baseW(), boxH = (bottom - top) / 100 * this.baseH();
    // Labels keep their on-screen size at any zoom (about 200px wide at most), so half of
    // that is reserved at each side; otherwise an edge label ("Pegasus A · HomeGrown Lab") is cut off.
    // The legend covers the bottom ~45px per place, so the circles are fitted into the space above it.
    const legendH = 12 + spots.length * 44 + 16;
    const roomW = el.clientWidth * 0.85, roomH = Math.max(el.clientHeight - legendH - 40, el.clientHeight * 0.4);
    this.scale = Math.min(MAX_ZOOM, Math.max(1, Math.min(roomW / boxW, roomH / boxH)));
    this.center((left + right) / 200, (top + bottom) / 200);
    // Shift up so the group is centered in the space above the legend.
    this.y -= legendH / 2;
    this.apply();
  }

  /** Recomputes the fit size; on open/switch also jumps to the spot (or fits). */
  private layout(reset: boolean): void {
    const el = this.viewport()?.nativeElement;
    const map = this.current();
    if (!el || !map) return;
    const fitScale = Math.min(el.clientWidth / map.width, el.clientHeight / map.height);
    this.baseW.set(map.width * fitScale);
    this.baseH.set(map.height * fitScale);
    if (reset) {
      // Wait a frame so the new base size is applied before positioning.
      requestAnimationFrame(() => this.req()?.spot || this.req()?.spots ? this.focusSpot() : this.fit());
    } else {
      this.apply();
    }
  }

  /** Centers the given point of the map (0–1 fractions) in the viewport. */
  private center(fx: number, fy: number): void {
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    this.x = el.clientWidth / 2 - fx * this.baseW() * this.scale;
    this.y = el.clientHeight / 2 - fy * this.baseH() * this.scale;
    this.apply();
  }

  private zoomAt(factor: number, px: number, py: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(1, this.scale * factor));
    const f = next / this.scale;
    // Keep the point under the fingers/cursor fixed while zooming.
    this.x = px - (px - this.x) * f;
    this.y = py - (py - this.y) * f;
    this.scale = next;
    this.apply();
  }

  /** Keeps the map from being dragged off screen, then writes the transform. */
  private apply(): void {
    const el = this.viewport()?.nativeElement;
    const stage = this.stage()?.nativeElement;
    if (!el || !stage) return;
    const w = this.baseW() * this.scale, h = this.baseH() * this.scale;
    const clamp = (pos: number, size: number, view: number) => size <= view ? (view - size) / 2 : Math.min(0, Math.max(view - size, pos));
    this.x = clamp(this.x, w, el.clientWidth);
    this.y = clamp(this.y, h, el.clientHeight);
    stage.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    stage.style.setProperty('--inv', String(1 / this.scale));
  }

  /**
   * Pointer position relative to the viewport. (offsetX/Y would be relative to
   * whichever element is under the finger, including the scaled map itself.)
   */
  private pt(e: MouseEvent): { x: number; y: number } {
    const rect = this.viewport()!.nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onDown(e: PointerEvent): void {
    // Taps on the zoom buttons are button presses, not the start of a drag.
    if ((e.target as Element).closest('button')) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = this.pt(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 1) {
      // Double-tap: zoom in where tapped (or back out when fully zoomed).
      const now = Date.now();
      if (now - this.lastTap < 300) {
        if (this.scale >= MAX_ZOOM * 0.9) this.fit(); else this.zoomAt(2, p.x, p.y);
        this.lastTap = 0;
      } else {
        this.lastTap = now;
      }
    }
  }

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const p = this.pt(e);
    const pts = [...this.pointers.values()];
    if (this.pointers.size === 1) {
      this.x += p.x - prev.x;
      this.y += p.y - prev.y;
      this.pointers.set(e.pointerId, p);
      this.apply();
    } else if (this.pointers.size === 2) {
      const other = pts.find(p => p !== prev)!;
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(p.x - other.x, p.y - other.y);
      this.pointers.set(e.pointerId, p);
      if (before > 0) this.zoomAt(after / before, (p.x + other.x) / 2, (p.y + other.y) / 2);
    }
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
  }
}
