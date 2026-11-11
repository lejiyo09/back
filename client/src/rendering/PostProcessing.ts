import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { QualityPreset } from '../core/GameConfig';

/** Film grain, vignette, slight warm grade, optional chromatic aberration — applied in display space. */
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.06 },
    uVignette: { value: 0.35 },
    uAberration: { value: 0.0 },
    uDistress: { value: 0.0 },
    uGlitch: { value: 0.0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uAberration, uDistress, uGlitch;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      // signal interference: torn horizontal bands that jump between frames
      float frame = floor(uTime * 24.0);
      float band = floor(uv.y * 36.0);
      float tear = step(1.0 - uGlitch * 0.35, hash(vec2(band, frame)));
      uv.x += tear * (hash(vec2(frame, band)) - 0.5) * 0.08 * uGlitch;
      float roll = step(0.985 - uGlitch * 0.05, hash(vec2(frame, 7.0)));
      uv.y = fract(uv.y + roll * 0.04 * uGlitch);
      vec2 c = uv - 0.5;
      float ab = uAberration + uDistress * 0.004 + uGlitch * 0.012;
      vec3 col;
      if (ab > 0.0) {
        col.r = texture2D(tDiffuse, uv + c * ab).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - c * ab).b;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      // grain (luma-weighted: stronger in darks like a real sensor)
      float n = hash(floor(uv * uResolution) + fract(uTime * 7.3) * 91.0) - 0.5;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col += n * uGrain * (1.2 - luma);
      // static snow + scanlines while interfered
      float snow = hash(floor(vUv * uResolution * 0.5) + frame * 13.1);
      col = mix(col, vec3(snow), uGlitch * 0.14 * (0.4 + 0.6 * tear));
      col *= 1.0 - uGlitch * 0.12 * step(0.5, fract(vUv.y * uResolution.y * 0.25));
      // vignette
      float v = smoothstep(0.85, 0.2, length(c * vec2(1.0, 0.85)));
      col *= mix(1.0, v, uVignette + uDistress * 0.3);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostProcessing {
  readonly composer: EffectComposer;
  private film: ShaderPass;
  private bloom?: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, q: QualityPreset) {
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.6, 0.92);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.film = new ShaderPass(FilmShader);
    this.film.uniforms.uAberration.value = q.chromaticAberration ? 0.0025 : 0;
    this.composer.addPass(this.film);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.film.uniforms.uResolution.value.set(w * pixelRatio, h * pixelRatio);
  }

  /** 0..1 — vignette/aberration push for tension moments (used by the scare director later). */
  set distress(v: number) {
    this.film.uniforms.uDistress.value = v;
  }

  set glitch(v: number) {
    this.film.uniforms.uGlitch.value = v;
  }

  render(time: number): void {
    this.film.uniforms.uTime.value = time;
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
