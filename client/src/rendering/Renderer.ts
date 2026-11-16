import * as THREE from 'three';
import type { QualityPreset } from '../core/GameConfig';
import { PostProcessing } from './PostProcessing';

/** WebGL 2 renderer (three.js WebGLRenderer) with quality-driven resolution and post-processing. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  private post?: PostProcessing;
  private pixelRatio = 1;
  /** adaptive quality: multiplier on the preset's render scale (0.55 … 1) */
  private scaleMul = 1;
  /** adaptive quality's last resort: skip the post-processing chain */
  bypassPost = false;

  constructor(private canvas: HTMLCanvasElement, private quality: QualityPreset) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = quality.flashlightShadow > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.resize();
  }

  get maxAnisotropy(): number {
    return this.renderer.capabilities.getMaxAnisotropy();
  }

  attach(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.post?.dispose();
    this.post = this.quality.postProcessing ? new PostProcessing(this.renderer, scene, camera, this.quality) : undefined;
    this.resize();
  }

  setExposure(v: number): void {
    this.renderer.toneMappingExposure = v;
  }

  set distress(v: number) {
    if (this.post) this.post.distress = v;
  }

  set glitch(v: number) {
    if (this.post) this.post.glitch = v;
  }

  get renderScale(): number { return this.scaleMul; }
  setRenderScale(m: number, camera?: THREE.PerspectiveCamera): void {
    const v = Math.min(1, Math.max(0.55, Math.round(m * 100) / 100));
    if (v === this.scaleMul) return;
    this.scaleMul = v;
    this.resize(camera);
  }

  resize(camera?: THREE.PerspectiveCamera): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio) * this.quality.renderScale * this.scaleMul;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, this.pixelRatio);
    if (camera) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number): void {
    this.renderer.info.reset();
    if (this.post && !this.bypassPost) this.post.render(time);
    else this.renderer.render(scene, camera);
  }

  dispose(): void {
    this.post?.dispose();
    this.renderer.dispose();
  }
}
