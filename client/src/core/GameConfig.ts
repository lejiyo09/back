export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  renderScale: number;
  maxPixelRatio: number;
  antialias: boolean;
  textureSize: number;
  flashlightShadow: number; // 0 = disabled, else shadow map size
  dynamicLights: number;    // pooled real-time fluorescent lights near the player
  postProcessing: boolean;
  bloom: boolean;
  chromaticAberration: boolean;
}

/** Design doc 9.4 — performance policy per quality tier. */
export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low:    { renderScale: 0.7, maxPixelRatio: 1,   antialias: false, textureSize: 256,  flashlightShadow: 0,    dynamicLights: 2, postProcessing: false, bloom: false, chromaticAberration: false },
  medium: { renderScale: 1,   maxPixelRatio: 1,   antialias: true,  textureSize: 512,  flashlightShadow: 512,  dynamicLights: 4, postProcessing: true,  bloom: false, chromaticAberration: false },
  high:   { renderScale: 1,   maxPixelRatio: 1.5, antialias: true,  textureSize: 1024, flashlightShadow: 1024, dynamicLights: 6, postProcessing: true,  bloom: true,  chromaticAberration: false },
  ultra:  { renderScale: 1,   maxPixelRatio: 2,   antialias: true,  textureSize: 2048, flashlightShadow: 2048, dynamicLights: 8, postProcessing: true,  bloom: true,  chromaticAberration: true },
};

export interface Settings {
  quality: QualityLevel;
  mouseSensitivity: number; // 0.2 .. 2
  masterVolume: number;     // 0 .. 1
  brightness: number;       // 0.6 .. 1.6 (exposure)
  flickerIntensity: number; // 0 .. 1 (accessibility: light flicker strength)
  headBob: boolean;         // accessibility: camera sway
  playerName: string;
}

const DEFAULTS: Settings = {
  quality: 'medium',
  mouseSensitivity: 1,
  masterVolume: 0.8,
  brightness: 1,
  flickerIntensity: 1,
  headBob: true,
  playerName: '',
};

const KEY = 'lost-signal.settings.v1';

function guessQuality(): QualityLevel {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  if ((mem !== undefined && mem <= 4) || cores <= 4) return 'low';
  return 'medium';
}

export function loadSettings(): Settings {
  let stored: Partial<Settings> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw) as Partial<Settings>;
  } catch { /* storage unavailable */ }
  const s: Settings = { ...DEFAULTS, quality: guessQuality(), ...stored };
  if (!(s.quality in QUALITY_PRESETS)) s.quality = 'medium';
  return s;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** URL flags for testing: ?debug=1&seed=123&quality=low&autostart=single */
export const URL_FLAGS = (() => {
  const q = new URLSearchParams(location.search);
  const seed = q.get('seed');
  return {
    debug: q.has('debug'),
    seed: seed !== null && /^\d+$/.test(seed) ? Number(seed) >>> 0 : undefined,
    quality: (q.get('quality') as QualityLevel | null) ?? undefined,
    autostart: q.get('autostart') ?? undefined,
    /** ai=now (spawn in 3 s) | ai=off */
    ai: q.get('ai') ?? undefined,
  };
})();
