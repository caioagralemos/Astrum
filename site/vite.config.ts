import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The hub's own build is copied to public/demo/ before deploy, so
// "Run the demo" opens the real interface, not a copy of it.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5174, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
