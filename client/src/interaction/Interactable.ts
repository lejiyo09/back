import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';

export type InteractableKind = 'door' | 'item' | 'note' | 'tool' | 'device' | 'button';

/** Everything the player can press E on implements this (design doc 4.4). */
export interface Interactable {
  readonly id: string;
  readonly kind: InteractableKind;
  readonly colliders: RAPIER.Collider[];
  /** Text shown in the HUD, e.g. "문 열기". Empty string = not interactable now. */
  prompt(): string;
  /** World position (for host-side distance validation). */
  position(): THREE.Vector3;
  /** Seconds E must be held (0/undefined = instant). */
  holdTime?(): number;
}
