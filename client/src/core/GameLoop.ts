import { PHYSICS_HZ } from '@shared/Constants';

/**
 * Fixed-timestep simulation (60 Hz) decoupled from rendering (design doc 14.2).
 * `render` receives alpha ∈ [0,1) for interpolating between the last two fixed states.
 */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private readonly step = 1 / PHYSICS_HZ;
  running = false;
  fps = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;

  constructor(
    private fixed: (dt: number) => void,
    private render: (dt: number, alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= this.step && steps < 5) {
        this.fixed(this.step);
        this.acc -= this.step;
        steps++;
      }
      if (steps === 5) this.acc = 0; // spiral-of-death guard
      this.render(dt, this.acc / this.step);
      this.fpsAcc += dt;
      this.fpsFrames++;
      if (this.fpsAcc >= 0.5) { this.fps = this.fpsFrames / this.fpsAcc; this.fpsAcc = 0; this.fpsFrames = 0; }
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
