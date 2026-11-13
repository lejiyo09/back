import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Offline play: after the build, list every file in dist and write sw.js from
 * sw-template.js. The app shell is precached on install; the 3D models (one
 * quality tier at a time) are downloaded in the background on request.
 */
function offlineServiceWorker() {
  let outDir = 'dist';
  return {
    name: 'lost-signal-offline',
    apply: 'build' as const,
    configResolved(c: { build: { outDir: string }; root: string }) { outDir = join(c.root, c.build.outDir); },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
      walk(outDir);
      const rel = files.filter((f) => !f.endsWith(".gitkeep")).map((f) => './' + relative(outDir, f).split('\\').join('/')).filter((f) => f !== './sw.js');
      const hash = createHash('sha1');
      for (const f of files) if (!f.endsWith('sw.js')) hash.update(f + statSync(f).size + (f.endsWith('.json') || f.endsWith('.html') ? readFileSync(f, 'utf8') : ''));
      const core = rel.filter((f) => !f.endsWith('.glb'));
      const packs = { '512': rel.filter((f) => f.endsWith('_512.glb')), '1k': rel.filter((f) => f.endsWith('_1k.glb')) };
      const sw = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__CORE__', JSON.stringify(core))
        .replace('__PACKS__', JSON.stringify(packs));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

const SERVER_PORT = Number(process.env.LS_SERVER_PORT ?? 3001);

export default defineConfig({
  base: './',
  plugins: [offlineServiceWorker()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    // In development the Socket.IO server runs separately; proxy it so the client
    // can always connect to its own origin (same as production).
    proxy: {
      '/socket.io': { target: `http://localhost:${SERVER_PORT}`, ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
