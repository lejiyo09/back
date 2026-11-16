import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/** One entry of public/assets/models/catalog.json (written by tools/assets/fetch-polyhaven.mjs). */
export interface CatalogEntry {
  group: string;
  name: string;
  authors: string[];
  source: string;
  license: string;
  tris: number | Record<string, number>;
  bytes: Record<string, number>;
  /** external models kept as a scene graph (named parts, bones, clips) in quality tiers */
  scene?: boolean;
  files?: Partial<Record<SceneTier, string>>;
  clips?: string[];
}

export type SceneTier = 'low' | 'medium' | 'high';
/**
 * Glass in the source models uses physical transmission, which makes three.js
 * render the whole scene a second time into a texture every frame (Level 6 ran
 * at a third of its speed). Plain alpha-blended glass looks the same at prop size.
 */
function cheapenGlass(m: THREE.Material): void {
  const p = m as THREE.MeshPhysicalMaterial;
  if (!p.isMeshPhysicalMaterial || !(p.transmission > 0)) return;
  p.transmission = 0;
  p.thickness = 0;
  p.transparent = true;
  p.opacity = Math.min(p.opacity, 0.35);
  p.depthWrite = false;
  p.needsUpdate = true;
}

export interface SceneAsset { scene: THREE.Group; animations: THREE.AnimationClip[] }

interface Template {
  /** meshes flattened with their transform relative to the model root */
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[];
  box: THREE.Box3;
}

export type TextureTier = '512' | '1k';

/**
 * Loads, caches and instances external models (design doc 14.3 / expansion §7).
 *  - GLB (meshopt-compressed, WebP textures) per level group, with progress
 *  - each model is loaded once; every placement shares its geometry & materials
 *  - placements are batched into one InstancedMesh per model part (few draw calls)
 *  - groups can be unloaded when a level is left
 *  - a missing/broken model never breaks a level: callers get null and fall back
 */
export class AssetManager {
  private loader = new GLTFLoader();
  private catalog: Record<string, CatalogEntry> = {};
  private templates = new Map<string, Template>();
  private loading = new Map<string, Promise<Template | null>>();
  private failed = new Set<string>();
  private materialHook?: (m: THREE.Material) => void;

  private scenes = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null>>();

  constructor(private base = 'assets/models/', private tier: TextureTier = '512', private sceneTier: SceneTier = 'medium') {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  /** Applied once to every material as it loads (e.g. the level's baked lighting). */
  setMaterialHook(hook: (m: THREE.Material) => void): void {
    this.materialHook = hook;
  }

  async loadCatalog(): Promise<void> {
    try {
      const res = await fetch(`${this.base}catalog.json`);
      if (res.ok) this.catalog = await res.json();
    } catch { /* offline / not built: everything falls back to procedural props */ }
  }

  has(id: string): boolean {
    return this.templates.has(id);
  }

  idsIn(group: string): string[] {
    return Object.entries(this.catalog).filter(([, e]) => e.group === group).map(([id]) => id);
  }

  /** Load every model in the given groups; reports 0..1 progress. Failures are recorded, not thrown. */
  async loadGroups(groups: string[], onProgress?: (p: number) => void): Promise<void> {
    const ids = groups.flatMap((g) => this.idsIn(g));
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      await this.load(id);
      onProgress?.(++done / Math.max(1, ids.length));
    }));
  }

  load(id: string): Promise<Template | null> {
    const cached = this.templates.get(id);
    if (cached) return Promise.resolve(cached);
    if (this.failed.has(id)) return Promise.resolve(null);
    const pending = this.loading.get(id);
    if (pending) return pending;
    const entry = this.catalog[id];
    if (!entry || entry.scene) { this.failed.add(id); return Promise.resolve(null); }
    const url = `${this.base}${entry.group}/${id}_${this.tier}.glb`;
    const p = this.loader.loadAsync(url).then((gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const parts: Template['parts'] = [];
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { cheapenGlass(m); this.materialHook?.(m); });
        parts.push({ geometry: o.geometry, material: mats[0], matrix: o.matrixWorld.clone() });
      });
      const t: Template = { parts, box: new THREE.Box3().setFromObject(root) };
      this.templates.set(id, t);
      this.loading.delete(id);
      return t;
    }).catch((e) => {
      console.warn(`[assets] ${id} failed to load`, e);
      this.failed.add(id);
      this.loading.delete(id);
      return null;
    });
    this.loading.set(id, p);
    return p;
  }

  /**
   * Scene-graph models (forklift, valve manifold, Whisperer): loaded once per
   * quality tier, then each call returns an independent copy that shares
   * geometry and materials (skinned meshes get their own skeleton). Node names
   * and pivots are preserved so callers can drive individual parts.
   * Returns null if the model is not in the catalog or failed to load.
   */
  async loadScene(id: string): Promise<SceneAsset | null> {
    const entry = this.catalog[id];
    const file = entry?.files?.[this.sceneTier] ?? entry?.files?.medium ?? entry?.files?.high;
    if (!entry?.scene || !file) return null;
    if (!this.scenes.has(id)) {
      this.scenes.set(id, this.loader.loadAsync(`${this.base}${file}`).then((g) => {
        g.scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { cheapenGlass(m); this.materialHook?.(m); });
        });
        return { scene: g.scene, animations: g.animations };
      }).catch((e) => { console.warn(`[assets] ${id} failed to load`, e); return null; }));
    }
    const base = await this.scenes.get(id)!;
    if (!base) return null;
    return { scene: cloneSkinned(base.scene) as THREE.Group, animations: base.animations };
  }

  /** Size of a loaded model (metres) or null. */
  size(id: string): THREE.Vector3 | null {
    const t = this.templates.get(id);
    return t ? t.box.getSize(new THREE.Vector3()) : null;
  }

  /** Lowest point / footprint centre offset, so models can stand on the floor. */
  box(id: string): THREE.Box3 | null {
    return this.templates.get(id)?.box.clone() ?? null;
  }

  /** A single, independent copy (shares geometry & materials) — for animated or interactive props. */
  instance(id: string): THREE.Group | null {
    const t = this.templates.get(id);
    if (!t) return null;
    const g = new THREE.Group();
    for (const part of t.parts) {
      const m = new THREE.Mesh(part.geometry, part.material);
      m.applyMatrix4(part.matrix);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  /** Build batched instanced meshes for many placements of loaded models. */
  batch(placements: { id: string; matrix: THREE.Matrix4 }[]): THREE.Group {
    const out = new THREE.Group();
    const byId = new Map<string, THREE.Matrix4[]>();
    for (const p of placements) {
      if (!this.templates.has(p.id)) continue;
      const list = byId.get(p.id) ?? [];
      list.push(p.matrix);
      byId.set(p.id, list);
    }
    const tmp = new THREE.Matrix4();
    for (const [id, mats] of byId) {
      const t = this.templates.get(id)!;
      for (const part of t.parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, part.matrix)));
        im.instanceMatrix.needsUpdate = true;
        // only big pieces throw flashlight shadows; small clutter is not worth a second pass
        im.castShadow = t.box.max.y - t.box.min.y > 0.8;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        out.add(im);
      }
    }
    return out;
  }

  /** Free a group's GPU resources (when leaving a level). */
  unload(group: string): void {
    for (const id of this.idsIn(group)) {
      const t = this.templates.get(id);
      if (!t) continue;
      for (const part of t.parts) {
        part.geometry.dispose();
        const m = part.material as THREE.MeshStandardMaterial;
        for (const tex of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap]) tex?.dispose();
        m.dispose();
      }
      this.templates.delete(id);
    }
  }

  dispose(): void {
    for (const g of new Set(Object.values(this.catalog).map((e) => e.group))) this.unload(g);
    for (const p of this.scenes.values()) void p.then((a) => a?.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }));
    this.scenes.clear();
  }

  /** Stats for the debug overlay / changelog. */
  stats(): { loaded: number; failed: number; tris: number } {
    let tris = 0;
    for (const t of this.templates.values()) for (const p of t.parts) tris += (p.geometry.index?.count ?? p.geometry.attributes.position.count) / 3;
    return { loaded: this.templates.size, failed: this.failed.size, tris: Math.round(tris) };
  }
}
