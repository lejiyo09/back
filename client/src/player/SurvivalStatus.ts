import { NOISE, PLAYER_HEALTH, SURVIVAL } from '@shared/Constants';

/** Health, stamina, battery and emitted noise (design doc 4.2). */
export class SurvivalStatus {
  health: number = SURVIVAL.MAX_HEALTH;
  stamina: number = SURVIVAL.MAX_STAMINA;
  battery: number = SURVIVAL.MAX_BATTERY;
  /** Current noise radius in metres — read by the Receiver AI next milestone. */
  noise = 0;
  exhausted = false;
  private regenDelay = 0;
  private healthRegenDelay = 0;

  update(dt: number, sprinting: boolean, flashlightOn: boolean): void {
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - SURVIVAL.STAMINA_DRAIN_PER_SEC * dt);
      this.regenDelay = SURVIVAL.STAMINA_REGEN_DELAY;
      if (this.stamina <= 0) this.exhausted = true;
    } else if (this.regenDelay > 0) {
      this.regenDelay -= dt;
    } else {
      this.stamina = Math.min(SURVIVAL.MAX_STAMINA, this.stamina + SURVIVAL.STAMINA_REGEN_PER_SEC * dt);
      if (this.stamina >= SURVIVAL.STAMINA_MIN_TO_SPRINT * 2) this.exhausted = false;
    }
    if (flashlightOn) this.battery = Math.max(0, this.battery - SURVIVAL.BATTERY_DRAIN_PER_SEC * dt);
    this.noise = Math.max(0, this.noise - NOISE.DECAY_PER_SEC * dt);
    if (this.health > 0 && this.health < SURVIVAL.MAX_HEALTH) {
      if (this.healthRegenDelay > 0) this.healthRegenDelay -= dt;
      else this.health = Math.min(SURVIVAL.MAX_HEALTH, this.health + PLAYER_HEALTH.REGEN_PER_SEC * dt);
    }
  }

  /** Returns true if this damage killed the player. */
  damage(amount: number): boolean {
    if (this.health <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.healthRegenDelay = PLAYER_HEALTH.REGEN_DELAY;
    return this.health <= 0;
  }

  revive(): void {
    this.health = SURVIVAL.MAX_HEALTH;
    this.stamina = SURVIVAL.MAX_STAMINA;
    this.exhausted = false;
    this.noise = 0;
  }

  canSprint(): boolean {
    return !this.exhausted && this.stamina > 0;
  }

  emitNoise(radius: number): void {
    this.noise = Math.max(this.noise, radius);
  }

  addBattery(amount: number): void {
    this.battery = Math.min(SURVIVAL.MAX_BATTERY, this.battery + amount);
  }
}
