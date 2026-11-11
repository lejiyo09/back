import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const SERVER_PORT = Number(process.env.LS_SERVER_PORT ?? 3001);

export default defineConfig({
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
