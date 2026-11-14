// A private build of the steps demo only (never the hub's own build or its dist folder):
//   npx vite build --config ui/src/steps-demo/vite.demo.config.ts --outDir <somewhere outside the repo>
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  root: ui,
  base: './',
  build: {
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { steps: fileURLToPath(new URL('../../steps-demo.html', import.meta.url)) } },
  },
});
