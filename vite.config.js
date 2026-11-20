import { defineConfig } from 'vite';

export default defineConfig({
  server: { allowedHosts: ['.preview.devinapps.com'] },
  build: { rollupOptions: { input: { rainforest: 'index.html', xianxia: 'xianxia.html' }, output: { manualChunks: { three: ['three'] } } } },
});
