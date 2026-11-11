import * as THREE from 'three';
import { RECEIVER, REVEAL } from '@shared/Constants';
import { SeededRandom } from '@shared/Random';
import type { World } from '../world/World';
import type { ReceiverAI, AITarget } from '../entities/ReceiverAI';
import { EDGE_OPEN } from '../world/Level0Layout';

export type RevealMode = 'normal' | 'fast' | 'skip';

type Phase = 'wait' | 'active';

/**
 * Reveal Director — never show the creature in full at first.
 *
 *   Stage 1  a distant black figure at the end of a sightline. It does not move
 *            while watched; once you look away it is gone.
 *   Stage 2  closer, half behind a wall edge. Look away and back — it is closer.
 *            Look away again — gone.
 *   Stage 3  it is standing right behind you. The lights around you stutter and
 *            its breathing is at your neck. Turn around: a beat of stillness, then
 *            the hunt begins.
 *
 * Every appearance/relocation happens only where no player can currently see it,
 * so it never pops in or fades on screen. During the hunt the director also brings
 * it back (far away, unseen) after it vanishes.
 */
export class RevealDirector {
  stage = 0;           // 0,1,2 = reveal stages; 3 = hunting
  private phase: Phase = 'wait';
  private timer: number;
  private activeTime = 0;
  private seen = false;
  private unseen = 0;
  private moved = false;
  private reaction = 0;
  private targetId: string | null = null;
  private rng: SeededRandom;
  private readonly fast: boolean;

  constructor(private ai: ReceiverAI, private world: World, seed: number, mode: RevealMode) {
    this.rng = new SeededRandom(seed ^ 0x2e7ea1);
    this.fast = mode === 'fast';
    this.timer = this.fast ? 4 : REVEAL.STAGE1_AT;
    if (mode === 'skip') { this.stage = 3; this.timer = this.fast ? 3 : 3; }
  }

  private gap(normal: number): number {
    return this.fast ? Math.min(normal, 12) : normal;
  }

  // ── placement helpers ──────────────────────────────────────

  private inView(t: AITarget, p: THREE.Vector3): boolean {
    const dir = p.clone().setY(1.4).sub(t.eye).normalize();
    return t.viewDir.dot(dir) > 0.4;
  }

  private visibleToAnyone(targets: AITarget[], p: THREE.Vector3): boolean {
    return targets.some((t) => !t.dead && this.inView(t, p) &&
      [2.3, 1.3, 0.4].some((y) => this.ai.canSee(t.eye, p.clone().setY(y))));
  }

  private cells(): THREE.Vector3[] {
    const L = this.world.level;
    const out: THREE.Vector3[] = [];
    for (let cy = 0; cy < L.h; cy++) for (let cx = 0; cx < L.w; cx++) {
      const n = this.ai.nav.node(cx, cy);
      out.push(new THREE.Vector3(n.x, 0, n.z));
    }
    return out;
  }

  /** Walls around a cell — stage 2 likes to stand half-concealed beside one. */
  private wallCount(p: THREE.Vector3): number {
    const L = this.world.level;
    const c = this.ai.nav.cellOf(p.x, p.z);
    return [L.hEdges[c.cy][c.cx], L.hEdges[c.cy + 1][c.cx], L.vEdges[c.cy][c.cx], L.vEdges[c.cy][c.cx + 1]].filter((e) => e !== EDGE_OPEN).length;
  }

  private apparitionSpot(t: AITarget, targets: AITarget[], [min, max]: readonly number[], preferWalls: boolean): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    const flatView = t.viewDir.clone().setY(0).normalize();
    for (const p of this.cells()) {
      const d = p.distanceTo(t.feet);
      if (d < min || d > max) continue;
      if (this.visibleToAnyone(targets, p)) continue;               // must appear unseen
      if (!this.ai.canSee(t.eye, p.clone().setY(2.1)) || !this.ai.canSee(t.eye, p.clone().setY(1.2))) continue; // but in plain sight once they turn
      const ang = Math.acos(THREE.MathUtils.clamp(flatView.dot(p.clone().sub(t.feet).setY(0).normalize()), -1, 1));
      const light = this.world.baked.sample(p.x, p.z);
      let score = this.rng.next() * 1.5;
      score += ang > 0.9 && ang < 2.1 ? 1.5 : 0;          // just off to the side: they'll turn into it
      score += light > 0.5 ? 1 : 0;                       // silhouette against yellow
      if (preferWalls) score += Math.min(2, this.wallCount(p)) * 0.8;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best && preferWalls) {
      // tuck it against the nearest wall so part of it is hidden by the edge
      best.x += this.rng.range(-0.5, 0.5);
      best.z += this.rng.range(-0.5, 0.5);
    }
    return best;
  }

  private closerSpot(t: AITarget, targets: AITarget[]): THREE.Vector3 | null {
    const cur = this.ai.pos.distanceTo(t.feet);
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (const p of this.cells()) {
      const d = p.distanceTo(t.feet);
      if (d < 3.5 || d > Math.min(6.5, cur - 2)) continue;
      if (this.visibleToAnyone(targets, p)) continue;
      if (!this.ai.canSee(t.eye, p.clone().setY(1.8))) continue;
      const score = -Math.abs(d - 4.5) + this.rng.next() + this.wallCount(p) * 0.4;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  /** Directly behind the player, with a clear capsule-wide gap. */
  private behindSpot(t: AITarget, targets: AITarget[]): THREE.Vector3 | null {
    const back = t.viewDir.clone().setY(0).normalize().negate();
    if (back.lengthSq() < 0.5) return null;
    const dist = REVEAL.BEHIND_DIST;
    const p = t.feet.clone().addScaledVector(back, dist).setY(0);
    const side = new THREE.Vector3(-back.z, 0, back.x).multiplyScalar(RECEIVER.RADIUS + 0.05);
    for (const y of [0.4, 1.3, 2.0]) for (const s of [-1, 0, 1]) {
      const from = t.feet.clone().setY(y).addScaledVector(side, s);
      const to = from.clone().addScaledVector(back, dist + RECEIVER.RADIUS + 0.2);
      if (!this.ai.canSee(from, to)) return null;
    }
    const L = this.world.level;
    const c = this.ai.nav.cellOf(p.x, p.z);
    if (c.cx < 0 || c.cy < 0 || c.cx >= L.w || c.cy >= L.h) return null;
    if (this.visibleToAnyone(targets, p)) return null; // e.g. a teammate is looking this way
    return p;
  }

  private farUnseenSpot(targets: AITarget[]): THREE.Vector3 | null {
    const alive = targets.filter((t) => !t.dead);
    const maps = alive.map((t) => this.ai.nav.distances(t.feet.x, t.feet.z));
    const pts = this.cells().filter((_, i) => {
      const min = maps.length ? Math.min(...maps.map((m) => (m[i] < 0 ? 999 : m[i]))) : 999;
      return min >= RECEIVER.SPAWN_MIN_CELLS;
    });
    this.rng.shuffle(pts);
    return pts.find((p) => !alive.some((t) => [2.3, 1.3].some((y) => this.ai.canSee(t.eye, p.clone().setY(y))))) ?? null;
  }

  /** The most isolated survivor gets the attention (design doc 8.4). */
  private pickTarget(targets: AITarget[]): AITarget | null {
    const alive = targets.filter((t) => !t.dead);
    if (!alive.length) return null;
    const keep = alive.find((t) => t.id === this.targetId);
    if (keep && this.phase === 'active') return keep;
    let best = alive[0], bestIso = -1;
    for (const t of alive) {
      const iso = alive.length === 1 ? 1 : Math.min(...alive.filter((o) => o !== t).map((o) => o.feet.distanceTo(t.feet)));
      if (iso > bestIso) { bestIso = iso; best = t; }
    }
    this.targetId = best.id;
    return best;
  }

  private faceYaw(from: THREE.Vector3, to: THREE.Vector3): number {
    return Math.atan2(to.x - from.x, to.z - from.z);
  }

  private beginWait(seconds: number, nextStage = this.stage): void {
    this.stage = nextStage;
    this.phase = 'wait';
    this.timer = seconds;
  }

  // ── tick ───────────────────────────────────────────────────

  update(dt: number, targets: AITarget[]): void {
    if (this.stage >= 3) { this.huntUpdate(dt, targets); return; }
    const t = this.pickTarget(targets);
    if (!t) return;

    if (this.phase === 'wait') {
      this.timer -= dt;
      if (this.timer > 0) return;
      let spot: THREE.Vector3 | null = null;
      if (this.stage === 0) spot = this.apparitionSpot(t, targets, REVEAL.STAGE1_DIST, false);
      else if (this.stage === 1) spot = this.apparitionSpot(t, targets, REVEAL.STAGE2_DIST, true);
      // stage 3 only while they walk calmly (not mid-sprint) — the moment must land
      else if (t.speed < 4.5) spot = this.behindSpot(t, targets);
      if (!spot) { this.timer = this.stage === 2 ? 0.5 : 2; return; }
      this.ai.appear(spot, this.faceYaw(spot, t.feet), this.stage === 2 ? 'lurk' : 'apparition');
      this.phase = 'active';
      this.activeTime = 0;
      this.seen = false;
      this.unseen = 0;
      this.moved = false;
      this.reaction = 0;
      return;
    }

    // active
    this.activeTime += dt;
    const watched = this.ai.observed;
    if (watched) { this.seen = true; this.unseen = 0; } else this.unseen += dt;
    const dist = this.ai.pos.distanceTo(t.feet);

    if (this.stage === 0 || this.stage === 1) {
      const tooClose = dist < 4.5 && !watched;
      if (tooClose) { this.ai.vanish(); this.beginWait(this.gap(this.stage === 0 ? REVEAL.STAGE2_GAP : REVEAL.STAGE3_GAP), this.stage + 1); return; }
      if (this.seen && this.unseen > 0.15) {
        if (this.stage === 1 && !this.moved) {
          // it moved while you weren't looking
          const p = this.closerSpot(t, targets);
          if (p) {
            this.ai.appear(p, this.faceYaw(p, t.feet), 'apparition');
            this.moved = true;
            this.seen = false;
            return;
          }
        }
        this.ai.vanish();
        this.beginWait(this.gap(this.stage === 0 ? REVEAL.STAGE2_GAP : REVEAL.STAGE3_GAP), this.stage + 1);
        return;
      }
      if (!this.seen && this.activeTime > REVEAL.APPARITION_TIMEOUT && !watched) {
        this.ai.vanish();
        this.beginWait(REVEAL.RETRY_DELAY);
      }
      return;
    }

    // stage 2 — lurking right behind
    if (watched) {
      this.reaction += dt;
      if (this.reaction >= REVEAL.LURK_REACTION) {
        this.ai.ambush(t.id, t.feet.clone());
        this.stage = 3;
      }
      return;
    }
    if (this.activeTime > REVEAL.LURK_TIMEOUT || dist > 4) {
      this.ai.vanish();
      this.beginWait(this.fast ? 3 : REVEAL.RETRY_DELAY);
    }
  }

  private huntUpdate(dt: number, targets: AITarget[]): void {
    if (this.ai.state !== 'hidden') return;
    if (this.timer > 0) { this.timer -= dt; return; }
    if (this.ai.hiddenTimer > 0) return;
    const p = this.farUnseenSpot(targets);
    if (!p) { this.timer = 2; return; }
    this.ai.appear(p, this.rng.range(0, Math.PI * 2), 'patrol');
  }

  debugInfo(): string {
    if (this.stage >= 3) return 'hunting';
    return `reveal stage ${this.stage + 1}/3 · ${this.phase}${this.phase === 'wait' ? ` ${Math.max(0, this.timer).toFixed(0)}s` : ` ${this.activeTime.toFixed(0)}s${this.seen ? ' seen' : ''}`}`;
  }
}
