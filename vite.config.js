import { defineConfig } from 'vite';

export default defineConfig({
  server: { allowedHosts: ['.preview.devinapps.com'] },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
