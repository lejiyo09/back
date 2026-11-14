// External GLB models (expansion: forklift, valve manifold, Whisperer).
//
//   node tools/assets/fetch-external.mjs
//
// Downloads each model in tools/assets/external.json (cached in .asset-cache/external),
// writes three quality tiers next to the Poly Haven models and registers them in
// catalog.json:  <id>_low.glb  <id>_medium.glb  <id>_high.glb
//
//  high   — dedup + prune (unused materials/nodes) + quantize + meshopt, geometry untouched
//  medium — high + weld
//  low    — medium + simplify (only where it is worth it), for 4 GB / low-spec devices
//
// Node names and pivots are kept (no flatten/join): the game drives named parts
// (forks, rams, handwheels, bones). Static parts are merged at runtime instead.
//
// Licences: 1DesignTool models may ship inside the game but not be redistributed
// on their own, so their files are generated at build time and git-ignored
// (`redistribute: false`). The Whisperer is CC BY 4.0 and is committed with credit.
// If a download fails the build continues — the game falls back to its procedural
// versions of these props.
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = path.join(root, 'client/public/assets/models');
const cache = path.join(root, '.asset-cache/external');
const list = JSON.parse(await fs.readFile(path.join(root, 'tools/assets/external.json'), 'utf8'));
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const catPath = path.join(out, 'catalog.json');
const catalog = JSON.parse(await fs.readFile(catPath, 'utf8'));

const tris = (doc) => {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(n);
};

for (const [id, e] of Object.entries(list)) {
  const src = path.join(cache, `${id}.glb`);
  try {
    try { await fs.access(src); } catch {
      const res = await fetch(e.url, { headers: { 'user-agent': 'lost-signal-asset-build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fs.mkdir(cache, { recursive: true });
      await fs.writeFile(src, Buffer.from(await res.arrayBuffer()));
    }
    const files = {}, bytes = {}, triCount = {};
    let trisOriginal = 0, size = null, min = null, clips = [];
    for (const tier of ['high', 'medium', 'low']) {
      const doc = await io.read(src);
      trisOriginal = tris(doc);
      clips = doc.getRoot().listAnimations().map((a) => a.getName());
      const ops = [dedup(), prune({ keepLeaves: true, keepAttributes: true })];
      if (tier !== 'high') ops.push(weld());
      if (tier === 'low' && e.simplifyLow) ops.push(simplify({ simplifier: MeshoptSimplifier, ratio: e.simplifyLow, error: 0.01 }));
      ops.push(quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      await doc.transform(...ops);
      const b = getBounds(doc.getRoot().listScenes()[0]);
      size = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
      min = b.min.map((v) => +v.toFixed(3));
      const rel = `${e.group}/${id}_${tier}.glb`;
      const file = path.join(out, rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await io.write(file, doc);
      files[tier] = rel;
      bytes[tier] = (await fs.stat(file)).size;
      triCount[tier] = tris(doc);
    }
    catalog[id] = {
      group: e.group, name: e.name, authors: e.authors, source: e.source, license: e.license, licenseUrl: e.licenseUrl,
      redistribute: e.redistribute, scene: true, clips, files, trisOriginal, tris: triCount, bytes, size, min,
    };
    console.log(`${id}: ${trisOriginal} tris → high ${triCount.high} / medium ${triCount.medium} / low ${triCount.low}; ${Object.values(bytes).map((b) => `${(b / 1024).toFixed(0)}KB`).join(' / ')}`);
  } catch (err) {
    console.warn(`[external] ${id} unavailable (${err.message}) — the game will use its fallback`);
  }
}
await fs.writeFile(catPath, JSON.stringify(catalog, null, 1));
