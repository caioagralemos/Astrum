import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Relative paths, so the same build works from the hub, from the desktop
  // window and from a static web host.
  base: './',
  server: { port: 5173, strictPort: true, host: true },
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { main: fileURLToPath(new URL('index.html', import.meta.url)), bench: fileURLToPath(new URL('bench.html', import.meta.url)) } } },
});
