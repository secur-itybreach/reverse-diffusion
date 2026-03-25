import { defineConfig } from 'vite';

export default defineConfig({
  // ml5 is loaded via CDN script tag (see index.html), not bundled,
  // so we tell Vite to treat it as an external global.
  build: {
    rollupOptions: {
      external: [],
    },
  },
  optimizeDeps: {
    // p5 ships a browser ESM build; no special config needed.
    include: ['p5'],
  },
});
