import { NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
const io = new NodeIO();
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  console.log('=====', f, 'scene bounds', JSON.stringify(getBounds(root.listScenes()[0])));
  const show = (n, d) => {
    const m = n.getMesh();
    let tris = 0, attrs = '';
    if (m) for (const p of m.listPrimitives()) { const idx = p.getIndices(); tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3; attrs = p.listSemantics().join(','); }
    const b = m ? getBounds(n) : null;
    console.log(' '.repeat(d * 2) + n.getName(), 't=' + n.getTranslation().map((v) => v.toFixed(2)), 'r=' + n.getRotation().map((v) => v.toFixed(2)), 's=' + n.getScale().map((v) => v.toFixed(2)), m ? `tris ${tris} [${attrs}] min ${b.min.map((v) => v.toFixed(2))} max ${b.max.map((v) => v.toFixed(2))}` : '');
    n.listChildren().forEach((c) => show(c, d + 1));
  };
  root.listScenes()[0].listChildren().forEach((n) => show(n, 0));
  for (const a of root.listAnimations()) {
    console.log(' anim', a.getName());
    for (const ch of a.listChannels()) {
      const s = ch.getSampler(); const out = s.getOutput().getArray(); const inp = s.getInput().getArray();
      const comp = out.length / inp.length;
      const mins = [], maxs = [];
      for (let c = 0; c < comp; c++) { let lo = Infinity, hi = -Infinity; for (let i = c; i < out.length; i += comp) { lo = Math.min(lo, out[i]); hi = Math.max(hi, out[i]); } mins.push(lo.toFixed(2)); maxs.push(hi.toFixed(2)); }
      console.log('   ', ch.getTargetNode()?.getName(), ch.getTargetPath(), 'keys', inp.length, 't0..', inp[inp.length - 1].toFixed(1), 'min', mins.join(','), 'max', maxs.join(','));
    }
  }
  for (const s of root.listSkins()) console.log(' skin joints', s.listJoints().length);
}
