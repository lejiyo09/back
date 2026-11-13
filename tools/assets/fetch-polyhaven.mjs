// Downloads CC0 models from Poly Haven, optimises them and writes web-ready GLBs.
//   node tools/assets/fetch-polyhaven.mjs            (all)
//   node tools/assets/fetch-polyhaven.mjs level-03   (one group)
// Output: client/public/assets/models/<group>/<id>_{512,1k}.glb + catalog.json
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, textureCompress, meshopt, resample, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cache = path.join(root, '.asset-cache', 'polyhaven');
const out = path.join(root, 'client/public/assets/models');
const list = JSON.parse(await fs.readFile(path.join(root, 'tools/assets/asset-list.json'), 'utf8'));
const only = process.argv[2];
const MAX_TRIS = 12000; // simplify anything heavier for the web

async function get(url, dest) {
  try { await fs.access(dest); return; } catch { /* download */ }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) { await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, Buffer.from(await res.arrayBuffer())); return; }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`download failed ${url}`);
}

function triCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    n += idx ? idx.getCount() / 3 : (p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
  }
  return Math.round(n);
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
let catalog = {};
try { catalog = JSON.parse(await fs.readFile(path.join(out, 'catalog.json'), 'utf8')); } catch { /* new */ }

for (const [group, ids] of Object.entries(list)) {
  if (only && only !== group) continue;
  for (const id of ids) {
    try {
      const info = await (await fetch(`https://api.polyhaven.com/info/${id}`)).json();
      const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
      const g = files.gltf?.['1k']?.gltf;
      if (!g) { console.warn(`skip ${id}: no 1k glTF`); continue; }
      const dir = path.join(cache, id);
      const gltfPath = path.join(dir, path.basename(new URL(g.url).pathname));
      await get(g.url, gltfPath);
      for (const [rel, inc] of Object.entries(g.include)) await get(inc.url, path.join(dir, rel));
      const sizes = {};
      let tris0 = 0, tris = 0;
      for (const [label, px] of [['512', 512], ['1k', 1024]]) {
        const doc = await io.read(gltfPath);
        tris0 = triCount(doc);
        const ops = [dedup(), prune(), weld()];
        if (tris0 > MAX_TRIS) ops.push(simplify({ simplifier: MeshoptSimplifier, ratio: MAX_TRIS / tris0, error: 0.002 }));
        ops.push(resample(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [px, px], quality: 80 }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
        await doc.transform(...ops);
        tris = triCount(doc);
        const file = path.join(out, group, `${id}_${label}.glb`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await io.write(file, doc);
        sizes[label] = (await fs.stat(file)).size;
      }
      catalog[id] = {
        group, name: info.name, authors: Object.keys(info.authors ?? {}),
        source: `https://polyhaven.com/a/${id}`, license: 'CC0 1.0 (Poly Haven)',
        trisOriginal: tris0, tris, bytes: sizes,
      };
      console.log(`${group}/${id}: ${tris0}→${tris} tris, 512=${(sizes['512'] / 1024).toFixed(0)}KB 1k=${(sizes['1k'] / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.warn(`FAILED ${id}: ${e.message}`);
    }
  }
}
await fs.writeFile(path.join(out, 'catalog.json'), JSON.stringify(catalog, null, 1));
