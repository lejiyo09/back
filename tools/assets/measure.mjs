// Adds bounding-box size (metres) to catalog.json entries: size [x,y,z], min [x,y,z]
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const path = 'client/public/assets/models/catalog.json';
const cat = JSON.parse(fs.readFileSync(path, 'utf8'));
for (const [id, e] of Object.entries(cat)) {
  if (e.scene) continue; // external scene models are measured by fetch-external.mjs
  const doc = await io.read(`client/public/assets/models/${e.group}/${id}_512.glb`);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  e.size = b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
  e.min = b.min.map((v) => +v.toFixed(3));
}
fs.writeFileSync(path, JSON.stringify(cat, null, 1));
for (const [id, e] of Object.entries(cat)) console.log(e.group.padEnd(9), id.padEnd(34), e.size.join(' x '), 'min', e.min.join(','));
