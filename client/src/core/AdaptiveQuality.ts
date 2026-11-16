import type { Renderer } from '../rendering/Renderer';

/**
 * Keeps low-spec machines playable (expansion §9: 60 fps desktop / 30 fps low).
 * Every 2 s it looks at the real frame rate: below 42 fps the render resolution
 * drops 10 % (down to 55 %); after three windows above 58 fps it climbs back.
 * At the floor and still under 28 fps the post-processing chain is switched off.
 * The first seconds after a level loads (shader compilation) are ignored.
 */
export class AdaptiveQuality {
  private t = 0;
  private warmup = 5;
  private frames = 0;
  private good = 0;
  private bad = 0;
  enabled = true;
  /** last measured fps (debug overlay / tests) */
  fps = 0;
  onChange?: (scale: number, postOff: boolean) => void;

  constructor(private renderer: Renderer) {}

  private last = 0;

  /** call once per rendered frame; timing uses the wall clock (game dt is capped on slow machines) */
  frame(_dt: number, active: boolean): void {
    const now = performance.now();
    const dt = this.last ? Math.min(2, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.enabled) return;
    if (this.warmup > 0) { this.warmup -= dt; return; }
    if (!active) { this.t = 0; this.frames = 0; return; }
    this.t += dt;
    this.frames++;
    if (this.t < 2) return;
    this.fps = this.frames / this.t;
    this.t = 0;
    this.frames = 0;
    const r = this.renderer;
    if (this.fps < 42) {
      this.good = 0;
      if (r.renderScale > 0.55) r.setRenderScale(r.renderScale - 0.1);
      else if (this.fps < 28 && !r.bypassPost && ++this.bad >= 2) r.bypassPost = true;
      else return;
      this.onChange?.(r.renderScale, r.bypassPost);
    } else if (this.fps > 58) {
      this.bad = 0;
      if (++this.good >= 3 && r.renderScale < 1) { r.setRenderScale(r.renderScale + 0.1); this.good = 0; this.onChange?.(r.renderScale, r.bypassPost); }
    } else { this.good = 0; this.bad = 0; }
  }
}
